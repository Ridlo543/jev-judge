import { rawJevJudgment } from "../client";
import type {
  ChoiceAnswer,
  JevActionGateInput,
  JevActionGateResult,
  JevGateInput,
  JevGateResult,
  JevReviewInput,
  JevReviewResult,
  NoulAnswer,
  PolicyAction,
  Questions,
  ScoreAnswer,
} from "../types";
import type { ToolContext, ToolDefinition } from "./types";

export const MAX_DOC_CHARS = 50_000;
export const MAX_CLAIMS = 16;
export const MAX_CLAIM_CHARS = 2_000;
export const MAX_EVIDENCE_CHARS = 200_000;

export const REVIEW_WEIGHTS = {
  correctness: 0.4,
  spec_match: 0.3,
  test_gap: 0.15,
  blast_radius: 0.15,
} as const;

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)} […truncated]`, truncated: true };
}

export function reviewComposite(scores: {
  correctness: number;
  specMatch: number;
  testGap: number;
  blastRadius: number;
}): number {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const clamp02 = (v: number) => Math.min(2, Math.max(0, v));
  const correctness = clamp01(clamp02(scores.correctness) / 2);
  const specMatch = clamp01(clamp02(scores.specMatch) / 2);
  const tests = clamp01(1 - clamp02(scores.testGap) / 2);
  const blast = clamp01(1 - clamp02(scores.blastRadius) / 2);
  return (
    REVIEW_WEIGHTS.correctness * correctness +
    REVIEW_WEIGHTS.spec_match * specMatch +
    REVIEW_WEIGHTS.test_gap * tests +
    REVIEW_WEIGHTS.blast_radius * blast
  );
}

export function reviewAction(input: {
  composite: number;
  safeToApply: number;
  minConfidence: number;
  autoAccept: number;
  reviewAt: number;
  compositeFloor: number;
}): PolicyAction {
  if (input.minConfidence < input.reviewAt || input.safeToApply < input.reviewAt) {
    return "escalate";
  }
  if (
    input.safeToApply >= input.autoAccept &&
    input.composite >= input.compositeFloor &&
    input.minConfidence >= input.autoAccept
  ) {
    return "auto";
  }
  return "review";
}

/**
 * Review a proposed patch/diff against a task specification.
 */
export async function reviewDiff(
  input: JevReviewInput,
  context?: ToolContext,
): Promise<JevReviewResult> {
  const diffTrunc = truncate(input.diff, MAX_DOC_CHARS);
  const reqTrunc = truncate(input.request, MAX_DOC_CHARS);
  const testsTrunc = input.tests ? truncate(input.tests, MAX_DOC_CHARS) : undefined;
  const isTruncated = diffTrunc.truncated || reqTrunc.truncated || (testsTrunc?.truncated ?? false);

  const autoAccept = input.auto_accept ?? 0.8;
  const reviewAt = input.review_at ?? Math.min(0.5, autoAccept);
  const compositeFloor = input.composite_floor ?? 0.7;

  let state = `TASK REQUEST:\n${reqTrunc.text}\n\nPROPOSED DIFF / PATCH:\n${diffTrunc.text}`;
  if (testsTrunc) {
    state += `\n\nTEST RESULTS / VERIFICATION EVIDENCE:\n${testsTrunc.text}`;
  }

  const questions: Questions = {
    correctness: {
      type: "score",
      instructions: "Rate the correctness and bug-freeness of this patch (0 = broken/buggy, 1 = plausible with issues, 2 = correct and complete).",
      criteria: ["broken or buggy", "plausible with non-blocking issues", "correct and complete"],
    },
    spec_match: {
      type: "score",
      instructions: "Does this patch fulfill the task request? (0 = diverges, 1 = partial match, 2 = exact specification match).",
      criteria: ["diverges from request", "partial match", "exact specification match"],
    },
    test_gap: {
      type: "score",
      instructions: "Assess test coverage or gap for critical paths (0 = well tested/safe or non-executable documentation/styling, 1 = partial tests, 2 = untested critical path). For non-code changes (documentation, markdown, comments), rate 0.",
      criteria: ["well tested/safe or non-code docs", "partial test coverage", "untested critical path"],
    },
    blast_radius: {
      type: "score",
      instructions: "Assess regression risk or blast radius (0 = tight localized changes or non-code docs, 1 = moderate, 2 = wide unconstrained blast radius).",
      criteria: ["tight localized changes or non-code docs", "moderate blast radius", "wide unconstrained blast radius"],
    },
    safe_to_apply: {
      type: "noul",
      instructions: "Is this patch safe to apply and merge without breaking production?",
    },
  };

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const correctness = (ans.correctness as ScoreAnswer)?.score ?? 0;
  const specMatch = (ans.spec_match as ScoreAnswer)?.score ?? 0;
  const testGap = (ans.test_gap as ScoreAnswer)?.score ?? 2;
  const blastRadius = (ans.blast_radius as ScoreAnswer)?.score ?? 2;
  const safeToApply = (ans.safe_to_apply as NoulAnswer)?.noul ?? 0;

  const minConf = Math.min(
    (ans.correctness as ScoreAnswer)?.confidence ?? 1.0,
    (ans.spec_match as ScoreAnswer)?.confidence ?? 1.0,
    (ans.test_gap as ScoreAnswer)?.confidence ?? 1.0,
    (ans.blast_radius as ScoreAnswer)?.confidence ?? 1.0,
  );

  const composite = reviewComposite({
    correctness,
    specMatch,
    testGap,
    blastRadius,
  });

  let action = reviewAction({
    composite,
    safeToApply,
    minConfidence: minConf,
    autoAccept,
    reviewAt,
    compositeFloor,
  });

  // Truncated input never permits auto
  if (isTruncated && action === "auto") {
    action = "review";
  }

  return {
    scores: {
      correctness,
      spec_match: specMatch,
      test_gap: testGap,
      blast_radius: blastRadius,
    },
    composite: Math.round(composite * 100) / 100,
    safe_to_apply: safeToApply,
    safe_to_apply_verdict: safeToApply >= autoAccept,
    action,
    truncated: isTruncated,
    thresholds: {
      auto_accept: autoAccept,
      review_at: reviewAt,
      composite_floor: compositeFloor,
    },
  };
}

/**
 * Gate completion before accepting work: review patch + verify completion claims vs evidence.
 */
export async function gatePatch(
  input: JevGateInput,
  context?: ToolContext,
): Promise<JevGateResult> {
  const reviewRes = await reviewDiff(input, context);

  const claims = (input.claims || []).slice(0, MAX_CLAIMS).map((c) => truncate(c, MAX_CLAIM_CHARS).text);
  let evidenceText = "";
  if (typeof input.evidence === "string") {
    evidenceText = truncate(input.evidence, MAX_EVIDENCE_CHARS).text;
  } else if (Array.isArray(input.evidence)) {
    evidenceText = input.evidence
      .map((item, idx) => `[Evidence ${item.id ?? idx + 1}]:\n${item.text}`)
      .join("\n\n");
    evidenceText = truncate(evidenceText, MAX_EVIDENCE_CHARS).text;
  }

  if (claims.length === 0) {
    return {
      ...reviewRes,
      claims: [],
      all_claims_verified: true,
      contradicted_count: 0,
    };
  }

  const claimQuestions: Questions = {};
  for (let i = 0; i < claims.length; i++) {
    claimQuestions[`claim_${i}`] = {
      type: "choice",
      instructions: `Evaluate whether the evidence supports, contradicts, or says nothing about this claim: "${claims[i]}"`,
      criteria: {
        supports: "The evidence clearly supports and confirms the claim",
        contradicts: "The evidence contradicts, disproves, or shows failure for the claim",
        says_nothing: "The evidence neither supports nor contradicts the claim (or is silent)",
      },
    };
  }

  const state = `EVIDENCE FOR COMPLETION CLAIMS:\n${evidenceText}`;
  const rawClaims = await rawJevJudgment(state, claimQuestions, context?.options);

  const claimResults: JevGateResult["claims"] = [];
  let contradictedCount = 0;
  let allVerified = true;

  const autoAccept = input.auto_accept ?? 0.8;
  const reviewAt = input.review_at ?? Math.min(0.5, autoAccept);

  for (let i = 0; i < claims.length; i++) {
    const ans = rawClaims.answers[`claim_${i}`] as ChoiceAnswer | undefined;
    const choice = ans?.choice ?? "says_nothing";
    const confidence = ans?.confidence ?? 0;
    const probs = ans?.probabilities ?? {};

    let verdict: "verified" | "contradicted" | "unsupported" = "unsupported";
    if (choice === "supports") verdict = "verified";
    else if (choice === "contradicts") verdict = "contradicted";
    else verdict = "unsupported";

    if (verdict === "contradicted") {
      contradictedCount++;
      allVerified = false;
    } else if (verdict !== "verified") {
      allVerified = false;
    }

    const action = confidence >= autoAccept && verdict === "verified" ? "auto" : "review";

    claimResults.push({
      claim: claims[i],
      verdict,
      probabilities: probs,
      confidence,
      action,
    });
  }

  let finalAction = reviewRes.action;

  // Strict Anti-Fake-Done Rule: Any contradicted claim escalates immediately
  if (contradictedCount > 0) {
    finalAction = "escalate";
  } else if (!allVerified && finalAction === "auto") {
    finalAction = "review";
  }

  return {
    ...reviewRes,
    action: finalAction,
    claims: claimResults,
    all_claims_verified: allVerified,
    contradicted_count: contradictedCount,
  };
}

/**
 * Screen risky actions/commands before an agent executes them.
 */
export async function screenAction(
  input: JevActionGateInput,
  context?: ToolContext,
): Promise<JevActionGateResult> {
  const state =
    `Action an autonomous agent is about to execute:\n${input.action}` +
    (input.context ? `\n\nTask Context:\n${input.context}` : "");

  const questions: Questions = {
    risk: {
      type: "score",
      instructions: "How risky is it to run this action automatically? (0 = safe/read-only, 1 = low, 2 = needs review, 3 = high/destructive).",
      criteria: [
        "safe and read-only",
        "low risk",
        "needs human review",
        "high risk — could destroy data, drop tables, or break production",
      ],
    },
    touches_prod: {
      type: "noul",
      instructions: "Does this action touch production environments or delete/overwrite important data?",
    },
    recommendation: {
      type: "choice",
      instructions: "What should the harness do with this action?",
      criteria: {
        allow: "safe to run automatically without prompting",
        confirm: "pause and ask human operator to confirm",
        block: "block execution and require a safer alternative",
      },
    },
  };

  const raw = await rawJevJudgment(state, questions, context?.options);
  const ans = raw.answers;

  const recAns = ans.recommendation as ChoiceAnswer | undefined;
  const riskAns = ans.risk as ScoreAnswer | undefined;
  const prodAns = ans.touches_prod as NoulAnswer | undefined;

  const recChoice = recAns?.choice ?? "confirm";
  const recommendation =
    recChoice === "allow" || recChoice === "block" ? recChoice : "confirm";

  return {
    recommendation,
    confidence: recAns?.confidence ?? 0.5,
    risk_score: riskAns?.score ?? 1.5,
    touches_prod: (prodAns?.noul ?? 0) >= 0.5,
    touches_prod_probability: prodAns?.noul ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const jevReviewTool: ToolDefinition = {
  name: "jev_review",
  aliases: ["jev_review_patch"],
  description:
    "Score a proposed git diff / patch against the task request without confirmation bias.\n" +
    "USE WHEN: Reviewing code changes to evaluate correctness, spec conformance, test coverage gaps, and blast radius.\n" +
    "SKIP WHEN: You only have completion claims to verify without a code diff (use jev_verify).\n" +
    "RETURNS: Rubric scores (0..2), composite score (0..1), safe_to_apply probability, and action (auto | review | escalate).",
  inputSchema: {
    type: "object",
    properties: {
      diff: { type: "string", description: "The git diff or patch text to evaluate." },
      request: { type: "string", description: "The original task request or acceptance specification." },
      tests: { type: "string", description: "Optional output log from executed tests." },
      auto_accept: { type: "number", description: "Threshold for auto-approval (default: 0.8)." },
      review_at: { type: "number", description: "Threshold below which to escalate to human (default: min(0.5, auto_accept))." },
      composite_floor: { type: "number", description: "Minimum weighted composite score required for auto (default: 0.7)." },
    },
    required: ["diff", "request"],
  },
  handler: async (args, context) => {
    return reviewDiff(args as unknown as JevReviewInput, context);
  },
};

export const jevGateTool: ToolDefinition = {
  name: "jev_gate",
  aliases: ["jev_gate_acceptance"],
  description:
    "Acceptance gate before declaring a task done: reviews patch diff AND audits developer completion claims against evidence logs.\n" +
    "USE WHEN: Calling a feature done, closing an issue, or creating a final PR to prevent fake done claims.\n" +
    "SKIP WHEN: Only scoring a diff without checking test/log assertions (use jev_review).\n" +
    "RETURNS: Review scores and claim verdicts (verified | contradicted | unsupported). Strictly escalates if any claim is contradicted.",
  inputSchema: {
    type: "object",
    properties: {
      diff: { type: "string", description: "The git diff or patch text to evaluate." },
      request: { type: "string", description: "The original task request." },
      claims: {
        type: "array",
        items: { type: "string" },
        description: "List of completion claims to verify against evidence (e.g. ['all unit tests pass', 'no secrets committed']).",
      },
      evidence: {
        type: "string",
        description: "The evidence text or logs (e.g. terminal test runner output, curl response).",
      },
      tests: { type: "string", description: "Optional test log output." },
      auto_accept: { type: "number", description: "Threshold for auto-approval (default: 0.8)." },
      review_at: { type: "number", description: "Threshold for escalation (default: min(0.5, auto_accept))." },
      composite_floor: { type: "number", description: "Minimum composite score (default: 0.7)." },
    },
    required: ["diff", "request", "claims", "evidence"],
  },
  handler: async (args, context) => {
    return gatePatch(args as unknown as JevGateInput, context);
  },
};

export const jevActionGateTool: ToolDefinition = {
  name: "jev_action_gate",
  aliases: ["jev_screen_command"],
  description:
    "Pre-execution safety screening before running autonomous shell commands or file operations.\n" +
    "USE WHEN: About to execute a potentially destructive or production-affecting action (e.g. rm, drop, alter, restart, overwrite).\n" +
    "SKIP WHEN: The action is a routine read-only command (e.g. ls, cat, git status, reading files).\n" +
    "RETURNS: Risk score (0..3), touches_prod boolean, and recommendation (allow | confirm | block).",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "The shell command or action about to run." },
      context: { type: "string", description: "Optional context describing what the agent is attempting to accomplish." },
    },
    required: ["action"],
  },
  handler: async (args, context) => {
    return screenAction(args as unknown as JevActionGateInput, context);
  },
};

export const codingTools: ToolDefinition[] = [
  jevReviewTool,
  jevGateTool,
  jevActionGateTool,
];
