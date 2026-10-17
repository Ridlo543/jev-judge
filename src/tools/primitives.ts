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
  aliases: ["jev_decision_primitive"],
  description:
    "Universal flexible TypeSafe Jev decision primitive for boolean propositions, multi-choice, or ordinal scoring.\n" +
    "USE WHEN: You need an open-ended calibrated judgment, custom question rubric, or multi-criteria decision not covered by domain tools.\n" +
    "DO NOT USE WHEN: A specialized tool exists (use jev_review for code diffs, jev_action_gate for shell commands, jev_verify for text citations).\n" +
    "RETURNS: Typed verdicts, calibrated probabilities (0.0 to 1.0), and confidence scores.",
  inputSchema: {
    type: "object",
    properties: {
      state: {
        description: "The situation, code snippet, git diff, document, or context being judged (optional).",
      },
      context: {
        description: "Alias for state.",
      },
      question: {
        description:
          "The question(s) to evaluate. Can be a string, a question object, or a map of questions.",
      },
      questions: {
        description: "Map of questions to evaluate (alias for question).",
      },
      prompt: {
        description: "Single question or prompt string.",
      },
    },
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
    "Evaluate multiple independent items or requests concurrently with rate limiting and throughput control.\n" +
    "USE WHEN: Processing a queue or list of independent questions/evaluations simultaneously in batch.\n" +
    "DO NOT USE WHEN: Evaluating a single situation or code snippet (use jev_judge).\n" +
    "RETURNS: Array of item results with individual verdicts and calibrated probabilities.",
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
  aliases: ["jev_check_probability", "jev_truth_probability"],
  description:
    "Compute calibrated truth probability (0.0 to 1.0) for a list of simple propositions or hypotheses without custom rubrics.\n" +
    "USE WHEN: You only have simple statements to test for truth probability without questions, criteria, or score levels.\n" +
    "DO NOT USE WHEN: You have cited evidence documents to fact-check against (use jev_verify) or complex rubrics (use jev_judge).\n" +
    "RETURNS: Probability per proposition (0.0 to 1.0) and likely / unlikely classification.",
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
