import {
  DEFAULT_PROTOCOL,
  DEFAULT_TIMEOUT_MS,
  type JevProtocol,
  redactApiKey,
  requireConfig,
  resolveConfig,
} from "./config";
import type {
  Answer,
  Answers,
  FlexibleQuestion,
  JevClientOptions,
  JevJudgeResult,
  JudgeResponse,
  JudgmentState,
  Question,
  Questions,
  SimplifiedQuestionInput,
} from "./types";

export { DEFAULT_PROTOCOL, DEFAULT_TIMEOUT_MS };

const RETRYABLE_STATUS_CODES: Record<number, true> = {
  408: true,
  409: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
};

/** Sleep helper with optional abort signal support. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(new Error("Request aborted during retry wait"));
    return promise;
  }
  const timer = setTimeout(() => resolve(), ms);
  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      reject(new Error("Request aborted during retry wait"));
    },
    { once: true },
  );
  return promise;
}

/**
 * Low-level core call to OpenAI-compatible or TypeSafe Direct endpoint.
 * Includes jittered exponential backoff for transient failures (408, 409, 429, 5xx).
 */
export async function rawJevJudgment(
  state: JudgmentState,
  questions: Questions,
  options: JevClientOptions = {},
): Promise<JevJudgeResult> {
  const config = requireConfig({
    protocol: options.protocol,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    timeoutMs: options.timeoutMs,
  });

  const protocol: JevProtocol = config.protocol;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const timeoutMs = config.timeoutMs;
  const maxRetries = options.maxRetries ?? 2;
  // Resolve target URL
  let targetUrl = baseUrl;
  if (protocol === "chat-completions") {
    if (!targetUrl.endsWith("/chat/completions")) {
      targetUrl = `${targetUrl}/chat/completions`;
    }
  }

  const payload = {
    model,
    state,
    questions,
  };

  const t0 = performance.now();
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const shouldRetry = attempt < maxRetries && Boolean(RETRYABLE_STATUS_CODES[res.status]);

        if (shouldRetry) {
          attempt++;
          const jitter = Math.random() * 100;
          const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
          await sleep(delay);
          continue;
        }

        throw new Error(
          `Jev provider returned HTTP ${res.status} (${res.statusText}) at ${targetUrl}: ${
            errorText || "(empty body)"
          }`,
        );
      }

      const rawJson = (await res.json()) as Record<string, unknown>;
      const durationMs = Math.round(performance.now() - t0);

      let parsedAnswers: Answers | null = null;
      let returnedModel = model;
      let usage: JevJudgeResult["usage"];

      if (protocol === "chat-completions") {
        const choices = rawJson.choices as Array<{ message?: { content?: string } }> | undefined;
        const contentRaw = choices?.[0]?.message?.content;
        if (!contentRaw) {
          throw new Error(
            `Invalid OpenAI-compatible response: missing message.content in choices[0]. Raw: ${JSON.stringify(
              rawJson,
            ).slice(0, 300)}`,
          );
        }

        try {
          const parsed = JSON.parse(contentRaw) as {
            answers?: Answers;
            model?: string;
            usage?: JevJudgeResult["usage"];
            [key: string]: unknown;
          };
          parsedAnswers = parsed.answers || (parsed as unknown as Answers);
          if (parsed.model) returnedModel = parsed.model;
        } catch (err) {
          throw new Error(
            `Failed to parse Jev JSON content: "${contentRaw.slice(0, 300)}" (${String(err)})`,
          );
        }

        const rawUsage = rawJson.usage as
          | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
          | undefined;
        if (rawUsage) {
          usage = rawUsage;
        }
      } else {
        // typesafe-direct
        parsedAnswers = (rawJson.answers as Answers) || (rawJson as unknown as Answers);
        if (typeof rawJson.model === "string") returnedModel = rawJson.model;
        if (rawJson.usage && typeof rawJson.usage === "object") {
          usage = rawJson.usage as JevJudgeResult["usage"];
        }
      }

      if (!parsedAnswers || typeof parsedAnswers !== "object") {
        throw new Error(
          `Jev response missing 'answers' object. Endpoint: ${targetUrl}, Protocol: ${protocol}`,
        );
      }

      // Ensure compatibility for boolean consumers (OMP / generic callers)
      for (const key of Object.keys(parsedAnswers)) {
        const ans = parsedAnswers[key];
        if (ans && ans.type === "noul") {
          ans.bool = ans.noul;
        }
      }

      return {
        model: returnedModel,
        answers: parsedAnswers,
        usage,
        durationMs,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(
          `Jev request timed out after ${timeoutMs}ms (endpoint: ${targetUrl}, key: ${redactApiKey(
            config.apiKey,
          )})`,
        );
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 100;
        const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
        await sleep(delay);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ||
    new Error(`Jev request failed after ${maxRetries + 1} attempts at ${targetUrl}`)
  );
}

/**
 * Normalize any question variation (string, bool alias, array criteria, etc.)
 * into a strictly valid Native Jev Question.
 */
export function normalizeQuestion(input: unknown): Question {
  if (typeof input === "string") {
    return {
      type: "noul",
      instructions: input,
    };
  }

  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type.toLowerCase() : undefined;

    if (type === "choice") {
      const rawOpts = raw.criteria ?? raw.options;
      let criteria: Record<string, string>;
      if (Array.isArray(rawOpts)) {
        criteria = Object.fromEntries(rawOpts.map((k) => [String(k), String(k)]));
      } else if (typeof rawOpts === "object" && rawOpts !== null) {
        criteria = rawOpts as Record<string, string>;
      } else {
        criteria = { yes: "yes", no: "no" };
      }
      return {
        type: "choice",
        instructions: String(raw.instructions || "Select the most appropriate option"),
        criteria,
      };
    }

    if (type === "score") {
      const rawLevels = raw.criteria ?? raw.levels ?? raw.options;
      let criteria: string[];
      if (Array.isArray(rawLevels)) {
        criteria = rawLevels.map(String);
      } else if (typeof rawLevels === "object" && rawLevels !== null) {
        criteria = Object.values(rawLevels).map(String);
      } else {
        criteria = ["1", "2", "3", "4", "5"];
      }
      return {
        type: "score",
        instructions: String(raw.instructions || "Rate the level"),
        criteria,
      };
    }

    // Default to noul (boolean)
    const noulCriteria =
      raw.criteria && typeof raw.criteria === "object"
        ? (raw.criteria as Record<string, string>)
        : undefined;

    return {
      type: "noul",
      instructions: String(raw.instructions || "Is this valid and true?"),
      ...(noulCriteria ? { criteria: noulCriteria } : {}),
    };
  }

  return {
    type: "noul",
    instructions: String(input),
  };
}

/**
 * Normalizes any form of question input into a valid Questions map.
 */
export function normalizeQuestions(input: SimplifiedQuestionInput): Questions {
  if (typeof input === "string") {
    return {
      verdict: normalizeQuestion(input),
    };
  }

  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((q, idx) => [`q${idx + 1}`, normalizeQuestion(q)]));
  }

  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    if (
      typeof raw.type === "string" &&
      ["noul", "bool", "boolean", "choice", "score"].includes(raw.type.toLowerCase())
    ) {
      return {
        verdict: normalizeQuestion(raw),
      };
    }

    const result: Questions = {};
    for (const [key, val] of Object.entries(input)) {
      result[key] = normalizeQuestion(val);
    }
    return result;
  }

  return {
    verdict: {
      type: "noul",
      instructions: "Is this valid?",
    },
  };
}

/**
 * Standard, flexible judgment interface for any agent, script, or evaluator.
 */
export async function judge<TAnswers extends Answers = Answers>(
  state: JudgmentState,
  questionInput: SimplifiedQuestionInput,
  options: JevClientOptions = {},
): Promise<JudgeResponse<TAnswers>> {
  const questions = normalizeQuestions(questionInput);
  const expandedQuestions: Questions = {};

  for (const [key, q] of Object.entries(questions)) {
    expandedQuestions[key] = q;
    if (q.type === "choice") {
      const criteria = q.criteria || {};
      for (const [optKey, optDesc] of Object.entries(criteria)) {
        expandedQuestions[`opt_${key}_${optKey}`] = {
          type: "noul",
          instructions: `${q.instructions} — Is '${optKey}' (${optDesc}) the most appropriate choice?`,
          criteria: { true: optKey, false: `not ${optKey}` },
        };
      }
    } else if (q.type === "score") {
      const criteria = q.criteria || [];
      for (let i = 0; i < criteria.length; i++) {
        expandedQuestions[`lvl_${key}_${i}`] = {
          type: "noul",
          instructions: `${q.instructions} — Does this match level '${criteria[i]}'?`,
          criteria: { true: criteria[i], false: `not ${criteria[i]}` },
        };
      }
    }
  }

  const result = await rawJevJudgment(state, expandedQuestions, options);
  const synthesizedAnswers: Record<string, Answer> = {};
  const verdicts: Record<string, boolean | string | number> = {};
  const probabilities: Record<string, number> = {};

  for (const [key, q] of Object.entries(questions)) {
    const directAns = result.answers[key];

    if (q.type === "choice") {
      if (directAns && directAns.type === "choice" && typeof (directAns as ChoiceAnswer).choice === "string") {
        synthesizedAnswers[key] = directAns;
        verdicts[key] = (directAns as ChoiceAnswer).choice;
        probabilities[key] = (directAns as ChoiceAnswer).confidence;
      } else {
        const criteriaKeys = Object.keys(q.criteria || {});
        const scores = criteriaKeys.map((cKey) => ({
          key: cKey,
          p: (result.answers[`opt_${key}_${cKey}`] as NoulAnswer | undefined)?.noul ?? 0,
        }));
        scores.sort((a, b) => b.p - a.p);
        const best = scores[0] || { key: criteriaKeys[0] || "yes", p: 0.8 };
        const sum = scores.reduce((acc, s) => acc + s.p, 0) || 1;

        const choiceAns: ChoiceAnswer = {
          type: "choice",
          choice: best.key,
          confidence: best.p,
          probabilities: Object.fromEntries(
            scores.map((s) => [s.key, Math.round((s.p / sum) * 100) / 100]),
          ),
        };
        synthesizedAnswers[key] = choiceAns;
        verdicts[key] = best.key;
        probabilities[key] = best.p;
      }
    } else if (q.type === "score") {
      if (directAns && directAns.type === "score" && typeof (directAns as ScoreAnswer).score === "number") {
        synthesizedAnswers[key] = directAns;
        verdicts[key] = (directAns as ScoreAnswer).score;
        probabilities[key] = (directAns as ScoreAnswer).confidence ?? 1.0;
      } else {
        const levels = q.criteria || [];
        const scores = levels.map((lvl, idx) => ({
          idx,
          lvl,
          p: (result.answers[`lvl_${key}_${idx}`] as NoulAnswer | undefined)?.noul ?? 0,
        }));
        const sum = scores.reduce((acc, s) => acc + s.p, 0) || 1;
        const expectedScore = scores.reduce((acc, s) => acc + s.idx * (s.p / sum), 0);
        const maxProb = Math.max(...scores.map((s) => s.p), 0.7);

        const scoreAns: ScoreAnswer = {
          type: "score",
          score: Math.round(expectedScore * 100) / 100,
          confidence: maxProb,
          legend: Object.fromEntries(levels.map((lvl, idx) => [String(idx), lvl])),
          probabilities: Object.fromEntries(
            scores.map((s) => [String(s.idx), Math.round((s.p / sum) * 100) / 100]),
          ),
        };
        synthesizedAnswers[key] = scoreAns;
        verdicts[key] = Math.round(expectedScore * 100) / 100;
        probabilities[key] = maxProb;
      }
    } else {
      const noulAns = directAns as NoulAnswer | undefined;
      const p = noulAns?.noul ?? 0;
      const isTrue = p >= (options.defaultThreshold ?? 0.5);
      synthesizedAnswers[key] = {
        type: "noul",
        noul: p,
        bool: p,
      };
      verdicts[key] = isTrue;
      probabilities[key] = p;
    }
  }

  const originalKeys = Object.keys(questions);
  const primaryKey = originalKeys[0];
  const primaryAns = primaryKey ? synthesizedAnswers[primaryKey] : undefined;

  let verdict: boolean | string | number = false;
  let probability: number | undefined;
  let confidence: number | undefined;

  if (primaryKey && primaryAns) {
    verdict = verdicts[primaryKey] ?? false;
    if (primaryAns.type === "noul") {
      probability = primaryAns.noul;
    } else if (primaryAns.type === "choice") {
      confidence = primaryAns.confidence;
    } else if (primaryAns.type === "score") {
      confidence = primaryAns.confidence;
    }
  }

  return {
    verdict,
    probability,
    confidence,
    verdicts,
    probabilities,
    answers: synthesizedAnswers as TAnswers,
    questions,
    state,
    raw: result,
  };
}

/**
 * Quick boolean verdict (true/false) based on probability >= threshold.
 */
export async function judgeBool(
  state: JudgmentState,
  instructions: string,
  options: JevClientOptions & { threshold?: number } = {},
): Promise<boolean> {
  const threshold = options.threshold ?? options.defaultThreshold ?? 0.5;
  const res = await judge(state, instructions, options);
  return (res.probability ?? (res.verdict === true ? 1 : 0)) >= threshold;
}

/**
 * Quick calibrated probability retrieval (0.0 - 1.0) for a question.
 */
export async function judgeProbability(
  state: JudgmentState,
  instructions: string,
  options: JevClientOptions = {},
): Promise<number> {
  const res = await judge(state, instructions, options);
  return res.probability ?? (res.verdict === true ? 1.0 : 0.0);
}

/**
 * Quick categorical choice classification.
 */
export async function judgeChoice(
  state: JudgmentState,
  instructions: string,
  options: string[] | Record<string, string>,
  clientOptions: JevClientOptions = {},
): Promise<string> {
  const res = await judge(
    state,
    {
      type: "choice",
      instructions,
      options,
    },
    clientOptions,
  );
  return String(res.verdict);
}

/**
 * Quick ordinal score rating.
 */
export async function judgeScore(
  state: JudgmentState,
  instructions: string,
  levels: string[],
  clientOptions: JevClientOptions = {},
): Promise<number> {
  const res = await judge(
    state,
    {
      type: "score",
      instructions,
      levels,
    },
    clientOptions,
  );
  return Number(res.verdict);
}

/**
 * Multi-question evaluator in a single round-trip.
 */
export async function judgeMulti(
  state: JudgmentState,
  questionsMap: Record<string, SimplifiedQuestionInput | FlexibleQuestion>,
  clientOptions: JevClientOptions = {},
): Promise<JudgeResponse> {
  return judge(state, questionsMap as SimplifiedQuestionInput, clientOptions);
}

export interface BatchItem {
  id: string;
  state: JudgmentState;
  question: SimplifiedQuestionInput;
}

export interface BatchResultItem {
  id: string;
  success: boolean;
  response?: JudgeResponse;
  error?: string;
}

/**
 * Batch evaluation with concurrency control.
 */
export async function judgeBatch(
  items: BatchItem[],
  options: JevClientOptions & { concurrency?: number } = {},
): Promise<BatchResultItem[]> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const results: BatchResultItem[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      try {
        const response = await judge(item.state, item.question, options);
        results[idx] = { id: item.id, success: true, response };
      } catch (err) {
        results[idx] = {
          id: item.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
