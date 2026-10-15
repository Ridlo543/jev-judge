import { rawJevJudgment } from "../client";
import type {
  ChoiceAnswer,
  JevCompareInput,
  JevCompareResult,
  JevDecideInput,
  JevDecideResult,
  JevFindInput,
  JevFindResult,
  JevRerankInput,
  JevRerankResult,
  NoulAnswer,
  Questions,
  ScoreAnswer,
} from "../types";
import { truncate } from "./coding";
import type { ToolContext, ToolDefinition } from "./types";

export const MAX_DECISION_CHARS = 1_500;
export const MAX_EVIDENCE_DECIDE_CHARS = 12_000;
export const MAX_PRIORITIES_CHARS = 2_000;
export const MAX_CANDIDATES_DECIDE = 6;
export const MAX_REQUIREMENTS = 3;

export const DECIDE_ESCAPE_HATCHES: Record<string, string> = {
  ask_user: "A consequential user preference or requirement is missing; ask instead of inventing it",
  investigate: "Gather missing technical or factual evidence before selecting a candidate",
  none: "None of the supplied candidates fits the known requirements",
};

export const COMPARE_RELATIONS: Record<string, string> = {
  same_fact: "Both passages state the same underlying fact or claim",
  contradicts: "The passages state opposing facts about the same subject",
  different_facts: "The passages discuss different subjects or make non-overlapping claims",
};

export const ASPECT_RELATIONS: Record<string, string> = {
  same_fact: "Both passages make comparable assertions about this aspect and they agree",
  contradicts: "Both passages address this aspect and their assertions conflict",
  different_facts:
    "The passages do not both make a comparable assertion about this aspect: at least one does not address it, or their mentions do not overlap",
};

/**
 * Arbitrate one bounded choice among 2-6 candidates with evidence and priorities.
 */
export async function decideChoice(
  input: JevDecideInput,
  context?: ToolContext,
): Promise<JevDecideResult> {
  const candidates = (input.candidates || []).slice(0, MAX_CANDIDATES_DECIDE);
  if (candidates.length < 2) {
    throw new Error("jev_decide requires at least 2 candidates to choose from.");
  }

  const decisionTrunc = truncate(input.decision, MAX_DECISION_CHARS).text;
  const evidenceTrunc = truncate(input.evidence, MAX_EVIDENCE_DECIDE_CHARS).text;
  const prioritiesTrunc = truncate(input.priorities, MAX_PRIORITIES_CHARS).text;

  const candidateDescriptions = candidates
    .map((c) => `[Candidate ID: ${c.id}]\n${c.description}`)
    .join("\n\n");

  const state =
    `DECISION TO MAKE:\n${decisionTrunc}\n\n` +
    `AVAILABLE EVIDENCE & FACTS:\n${evidenceTrunc}\n\n` +
    `USER PRIORITIES & CONSTRAINTS:\n${prioritiesTrunc}\n\n` +
    `CANDIDATES:\n${candidateDescriptions}`;

  const criteria: Record<string, string> = {};
  for (const c of candidates) {
    criteria[c.id] = c.description.slice(0, 200);
  }

  const includeEscape = input.escape_hatches ?? true;
  if (includeEscape) {
    for (const [key, desc] of Object.entries(DECIDE_ESCAPE_HATCHES)) {
      criteria[key] = desc;
    }
  }

  const questions: Questions = {
    selected_candidate: {
      type: "choice",
      instructions: "Select the single best candidate that best satisfies the decision, evidence, and priorities.",
      criteria,
    },
  };

  const requirements = (input.requirements || []).slice(0, MAX_REQUIREMENTS);
  for (let reqIdx = 0; reqIdx < requirements.length; reqIdx++) {
    const req = requirements[reqIdx];
    for (const c of candidates) {
      questions[`check_${c.id}_req_${reqIdx}`] = {
        type: "choice",
        instructions: `Does candidate "${c.id}" satisfy this requirement: "${req}"?`,
        criteria: {
          supported: "The evidence clearly indicates this candidate satisfies the requirement",
          contradicted: "The evidence indicates this candidate fails or violates this requirement",
          unknown: "The evidence is insufficient to verify whether this requirement is satisfied",
        },
      };
    }
  }

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const choiceAns = ans.selected_candidate as ChoiceAnswer | undefined;
  const selected = choiceAns?.choice ?? candidates[0].id;
  const confidence = choiceAns?.confidence ?? 0;
  const probabilities = choiceAns?.probabilities ?? {};
  const escaped = Boolean(DECIDE_ESCAPE_HATCHES[selected]);

  const checks: JevDecideResult["checks"] = [];
  const warnings: string[] = [];

  for (let reqIdx = 0; reqIdx < requirements.length; reqIdx++) {
    for (const c of candidates) {
      const qKey = `check_${c.id}_req_${reqIdx}`;
      const checkAns = ans[qKey] as ChoiceAnswer | undefined;
      const statusRaw = checkAns?.choice ?? "unknown";
      const status =
        statusRaw === "supported" || statusRaw === "contradicted" ? statusRaw : "unknown";

      checks.push({
        candidate: c.id,
        requirement: reqIdx + 1,
        status,
      });

      if (c.id === selected && status === "contradicted") {
        warnings.push(
          `Recommended candidate '${c.id}' contradicts requirement #${reqIdx + 1}: "${requirements[reqIdx]}"`,
        );
      }
    }
  }

  return {
    recommendation: {
      selected,
      escaped,
      confidence,
      probabilities,
    },
    checks,
    warnings,
  };
}

/**
 * Find the single best candidate by semantic relevance and verify if an answer exists.
 */
export async function findBest(
  input: JevFindInput,
  context?: ToolContext,
): Promise<JevFindResult> {
  const candidates = input.candidates || [];
  if (candidates.length === 0) {
    return {
      exists: 0,
      exists_verdict: "absent",
      top: [],
    };
  }

  const topK = Math.min(candidates.length, Math.max(1, input.top_k ?? 5));
  const queryTrunc = truncate(input.query, 2_000).text;

  const candidateEntries = candidates.map((c, idx) => ({
    id: c.id ?? `candidate_${idx + 1}`,
    text: truncate(c.text, 2_000).text,
  }));

  const candidateText = candidateEntries
    .map((c) => `[ID: ${c.id}]:\n${c.text}`)
    .join("\n\n");

  const state = `QUERY / NEED:\n${queryTrunc}\n\nCANDIDATES TO SEARCH:\n${candidateText}`;

  const criteria: Record<string, string> = {};
  for (const c of candidateEntries) {
    criteria[c.id] = c.text.slice(0, 150);
  }

  const questions: Questions = {
    exists: {
      type: "noul",
      instructions: "Does any candidate in the set actually satisfy, address, or answer the query?",
    },
    best_candidate: {
      type: "choice",
      instructions: "Which candidate is the most relevant and responsive to the query?",
      criteria,
    },
  };

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const existsProb = (ans.exists as NoulAnswer)?.noul ?? 0;
  const choiceAns = ans.best_candidate as ChoiceAnswer | undefined;
  const probs = choiceAns?.probabilities ?? {};

  let existsVerdict: "answered" | "partial" | "absent" = "absent";
  if (existsProb >= 0.7) existsVerdict = "answered";
  else if (existsProb >= 0.35) existsVerdict = "partial";
  else existsVerdict = "absent";

  const ranked = candidateEntries
    .map((c) => ({
      id: c.id,
      text: c.text,
      probability: probs[c.id] ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, topK);

  return {
    exists: existsProb,
    exists_verdict: existsVerdict,
    top: ranked,
  };
}

/**
 * Rerank an entire array of candidates by semantic relevance.
 */
export async function rerankCandidates(
  input: JevRerankInput,
  context?: ToolContext,
): Promise<JevRerankResult> {
  const candidates = input.candidates || [];
  if (candidates.length === 0) {
    return { ranked: [] };
  }

  const topK = Math.min(candidates.length, Math.max(1, input.top_k ?? candidates.length));
  const queryTrunc = truncate(input.query, 2_000).text;

  const candidateEntries = candidates.map((c, idx) => ({
    id: c.id ?? `cand_${idx + 1}`,
    text: truncate(c.text, 2_000).text,
  }));

  const candidateText = candidateEntries
    .map((c) => `[ID: ${c.id}]:\n${c.text}`)
    .join("\n\n");

  const state = `SEARCH QUERY:\n${queryTrunc}\n\nCANDIDATES TO RANK:\n${candidateText}`;

  const criteria: Record<string, string> = {};
  for (const c of candidateEntries) {
    criteria[c.id] = c.text.slice(0, 150);
  }

  const questions: Questions = {
    relevance: {
      type: "choice",
      instructions: "Distribute probability across candidates based on semantic relevance to the search query.",
      criteria,
    },
  };

  const raw = await rawJevJudgment(state, questions, context?.options);
  const choiceAns = raw.answers.relevance as ChoiceAnswer | undefined;
  const probs = choiceAns?.probabilities ?? {};

  const ranked = candidateEntries
    .map((c) => ({
      id: c.id,
      text: c.text,
      relevance: probs[c.id] ?? 0,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, topK)
    .map((c, idx) => ({
      rank: idx + 1,
      id: c.id,
      text: c.text,
      relevance: Math.round(c.relevance * 1000) / 1000,
    }));

  return { ranked };
}

/**
 * Compare two passages overall and across optional individual aspects.
 */
export async function comparePassages(
  input: JevCompareInput,
  context?: ToolContext,
): Promise<JevCompareResult> {
  const passageATrunc = truncate(input.passage_a, 20_000).text;
  const passageBTrunc = truncate(input.passage_b, 20_000).text;
  const autoAccept = input.auto_accept ?? 0.85;

  const state = `PASSAGE A:\n${passageATrunc}\n\nPASSAGE B:\n${passageBTrunc}`;

  const questions: Questions = {
    overall_relation: {
      type: "choice",
      instructions: "How do Passage A and Passage B relate in their substantive assertions?",
      criteria: COMPARE_RELATIONS,
    },
  };

  const aspects = (input.aspects || []).slice(0, 10);
  for (let i = 0; i < aspects.length; i++) {
    const asp = aspects[i];
    questions[`aspect_${i}`] = {
      type: "choice",
      instructions: `How do the passages compare regarding the aspect '${asp}'?`,
      criteria: ASPECT_RELATIONS,
    };
  }

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const overallAns = ans.overall_relation as ChoiceAnswer | undefined;
  const choiceRaw = overallAns?.choice ?? "different_facts";
  const confidence = overallAns?.confidence ?? 0;
  const probs = overallAns?.probabilities ?? {};

  const relation =
    choiceRaw === "same_fact" || choiceRaw === "contradicts" ? choiceRaw : "different_facts";
  const action = confidence >= autoAccept ? "auto" : "review";

  let aspectResults: JevCompareResult["aspects"] = undefined;
  if (aspects.length > 0) {
    aspectResults = {};
    for (let i = 0; i < aspects.length; i++) {
      const aspName = aspects[i];
      const aspAns = ans[`aspect_${i}`] as ChoiceAnswer | undefined;
      const aspChoice = aspAns?.choice ?? "different_facts";
      const aspRelation =
        aspChoice === "same_fact" || aspChoice === "contradicts" ? aspChoice : "different_facts";

      aspectResults[aspName] = {
        relation: aspRelation,
        confidence: aspAns?.confidence ?? 0,
        probabilities: aspAns?.probabilities ?? {},
      };
    }
  }

  return {
    relation,
    confidence,
    probabilities: probs,
    action,
    aspects: aspectResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const jevDecideTool: ToolDefinition = {
  name: "jev_decide",
  aliases: ["jev_decide_architecture"],
  description:
    "Arbitrate one bounded technical or architectural choice among 2-6 candidates with requirements, evidence, and priorities.\n" +
    "USE WHEN: Deciding between 2-6 concrete alternatives with trade-offs, evidence, and user priorities.\n" +
    "SKIP WHEN: The choice is routine, trivial, or already decided by user instruction.\n" +
    "RETURNS: Selected candidate ID, confidence score, requirement checks, and escape hatches (ask_user, investigate, none).",
  inputSchema: {
    type: "object",
    properties: {
      decision: { type: "string", description: "Problem or choice statement to resolve." },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
          },
          required: ["id", "description"],
        },
        description: "List of 2-6 candidate alternatives.",
      },
      evidence: { type: "string", description: "Empirical facts, benchmarks, or code measurements." },
      priorities: { type: "string", description: "Explicit preferences or constraints." },
      requirements: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of up to 3 testable requirements.",
      },
      escape_hatches: { type: "boolean", description: "Include ask_user, investigate, and none (default: true)." },
    },
    required: ["decision", "candidates", "evidence", "priorities"],
  },
  handler: async (args, context) => {
    return decideChoice(args as unknown as JevDecideInput, context);
  },
};

export const jevFindTool: ToolDefinition = {
  name: "jev_find",
  aliases: ["jev_find_best"],
  description:
    "Pick the single best candidate from an array by semantic meaning and determine if any candidate actually answers the query.\n" +
    "USE WHEN: Picking the one best candidate among several choices (files, notes, code snippets).\n" +
    "SKIP WHEN: An exact regex or keyword match decides it deterministically (use grep/rg).\n" +
    "RETURNS: exists_verdict (answered | partial | absent) and top candidates ranked by probability.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query or specification." },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
          },
          required: ["text"],
        },
        description: "Array of candidates to search through.",
      },
      top_k: { type: "number", description: "Number of top candidates to return (default: 5)." },
    },
    required: ["query", "candidates"],
  },
  handler: async (args, context) => {
    return findBest(args as unknown as JevFindInput, context);
  },
};

export const jevRerankTool: ToolDefinition = {
  name: "jev_rerank",
  aliases: ["jev_rerank_candidates"],
  description:
    "Score every candidate independently by semantic relevance without an external vector database.\n" +
    "USE WHEN: Full ordering matters (retrieval results, deduplication triage, feed ranking).\n" +
    "SKIP WHEN: You only need the single best hit (use jev_find).\n" +
    "RETURNS: Ranked array of candidates with rank order and relevance scores (0..1).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query or target topic." },
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
          },
          required: ["text"],
        },
        description: "Array of text candidates to rank.",
      },
      top_k: { type: "number", description: "Number of top items to return (default: all)." },
    },
    required: ["query", "candidates"],
  },
  handler: async (args, context) => {
    return rerankCandidates(args as unknown as JevRerankInput, context);
  },
};

export const jevCompareTool: ToolDefinition = {
  name: "jev_compare",
  aliases: ["jev_compare_passages"],
  description:
    "Judge how two passages relate overall and per aspect (same_fact | contradicts | different_facts).\n" +
    "USE WHEN: Comparing two documents, spec vs implementation, or detecting contradictory assertions.\n" +
    "SKIP WHEN: You already know how the passages relate.\n" +
    "RETURNS: Relation verdict, confidence, and per-aspect comparison breakdown.",
  inputSchema: {
    type: "object",
    properties: {
      passage_a: { type: "string", description: "First text passage or spec excerpt." },
      passage_b: { type: "string", description: "Second text passage or spec excerpt." },
      aspects: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of up to 10 specific aspects to compare individually (e.g. ['performance', 'caching']).",
      },
      auto_accept: { type: "number", description: "Threshold for auto decision (default: 0.85)." },
    },
    required: ["passage_a", "passage_b"],
  },
  handler: async (args, context) => {
    return comparePassages(args as unknown as JevCompareInput, context);
  },
};

export const researchTools: ToolDefinition[] = [
  jevDecideTool,
  jevFindTool,
  jevRerankTool,
  jevCompareTool,
];
