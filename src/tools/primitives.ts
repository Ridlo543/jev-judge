import { judge, judgeBatch, rawJevJudgment } from "../client";
import type {
  BatchItem,
  JevNoulInput,
  JevNoulResult,
  JudgmentState,
  NoulAnswer,
  Questions,
  SimplifiedQuestionInput,
} from "../types";
import { truncate } from "./coding";
import type { ToolContext, ToolDefinition } from "./types";

export const MAX_NOUL_PROPOSITIONS = 64;

/**
 * Calibrated probability per stated proposition.
 */
export async function judgeNoul(
  input: JevNoulInput,
  context?: ToolContext,
): Promise<JevNoulResult> {
  const propositions = (input.propositions || []).slice(0, MAX_NOUL_PROPOSITIONS);
  const autoAccept = input.auto_accept ?? 0.85;

  if (propositions.length === 0) {
    return {
      results: [],
      thresholds: { auto_accept: autoAccept },
    };
  }

  const questions: Questions = {};
  for (let i = 0; i < propositions.length; i++) {
    questions[`prop_${i}`] = {
      type: "noul",
      instructions: `Is the following proposition true: "${truncate(propositions[i], 2_000).text}"?`,
    };
  }

  const state = input.context
    ? `CONTEXT / EVIDENCE:\n${truncate(input.context, 100_000).text}`
    : "Evaluate based on general facts, logic, and knowledge.";

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const results: JevNoulResult["results"] = [];
  for (let i = 0; i < propositions.length; i++) {
    const pAns = ans[`prop_${i}`] as NoulAnswer | undefined;
    const prob = pAns?.noul ?? 0.5;

    let label: "likely" | "unlikely" | "uncertain" = "uncertain";
    if (prob >= autoAccept) {
      label = "likely";
    } else if (prob + autoAccept <= 1.0) {
      label = "unlikely";
    } else {
      label = "uncertain";
    }

    const auto = label !== "uncertain";

    results.push({
      proposition: propositions[i],
      probability: prob,
      likely: prob >= 0.5,
      label,
      auto,
    });
  }

  return {
    results,
    thresholds: { auto_accept: autoAccept },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const jevJudgeTool: ToolDefinition = {
  name: "jev_judge",
  description:
    "Universal flexible TypeSafe Jev decision primitive for boolean, choice, or ordinal scoring.\n" +
    "USE WHEN: You need an open-ended single or multi-criteria evaluation not covered by specialized tools.\n" +
    "SKIP WHEN: A specialized tool exists (e.g. jev_gate for acceptance, jev_verify for citations).\n" +
    "RETURNS: Typed verdicts, calibrated probabilities, and confidence scores.",
  inputSchema: {
    type: "object",
    properties: {
      state: {
        description: "The situation, code snippet, git diff, document, or context being judged.",
      },
      question: {
        description:
          "The question(s) to evaluate. Can be a string, a question object, or a map of questions.",
      },
    },
    required: ["state", "question"],
  },
  handler: async (args, context) => {
    return judge(
      args.state as JudgmentState,
      args.question as SimplifiedQuestionInput,
      context?.options,
    );
  },
};

export const jevJudgeBatchTool: ToolDefinition = {
  name: "jev_judge_batch",
  description:
    "Evaluate multiple independent items or requests in batch concurrently with rate limiting and throughput control.\n" +
    "USE WHEN: Processing a queue or list of items simultaneously.\n" +
    "SKIP WHEN: Judging a single situation (use jev_judge).\n" +
    "RETURNS: Array of item results with individual verdicts.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            state: {},
            question: {},
          },
          required: ["id", "state", "question"],
        },
        description: "Array of items { id, state, question } to evaluate.",
      },
      concurrency: {
        type: "number",
        description: "Max concurrent requests (default: 3).",
      },
    },
    required: ["items"],
  },
  handler: async (args, context) => {
    return judgeBatch(
      args.items as BatchItem[],
      { ...context?.options, concurrency: args.concurrency as number | undefined },
    );
  },
};

export const jevNoulTool: ToolDefinition = {
  name: "jev_noul",
  aliases: ["jev_check_probability"],
  description:
    "Compute calibrated probability (0.0 to 1.0) for stated propositions or hypotheses.\n" +
    "USE WHEN: You need an objective truth probability for stated assertions.\n" +
    "SKIP WHEN: Checking claims against a specific citation or document (use jev_verify).\n" +
    "RETURNS: Probability (0..1), likely/unlikely label, and auto-acceptance thresholding.",
  inputSchema: {
    type: "object",
    properties: {
      propositions: {
        type: "array",
        items: { type: "string" },
        description: "List of testable statements or hypotheses to assess.",
      },
      context: {
        type: "string",
        description: "Optional context document or evidence.",
      },
      auto_accept: {
        type: "number",
        description: "Confidence threshold to mark a proposition likely (default: 0.85).",
      },
    },
    required: ["propositions"],
  },
  handler: async (args, context) => {
    return judgeNoul(args as unknown as JevNoulInput, context);
  },
};

export const primitiveTools: ToolDefinition[] = [
  jevJudgeTool,
  jevJudgeBatchTool,
  jevNoulTool,
];
