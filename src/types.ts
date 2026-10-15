import type { JevProtocol } from "./config";

export type NativeQuestionType = "noul" | "choice" | "score";
export type QuestionType = NativeQuestionType | "bool" | "boolean";

export interface NoulQuestion {
  type: "noul" | "bool" | "boolean";
  instructions: string;
  criteria?: { true?: string; false?: string } | Record<string, string>;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria?: Record<string, string> | string[];
  options?: Record<string, string> | string[];
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria?: string[];
  levels?: string[];
}

export type FlexibleQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Native Question payload strictly conforming to Jev 1.13 endpoint requirement */
export interface NativeNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: Record<string, string>;
}

export interface NativeChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface NativeScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type Question = NativeNoulQuestion | NativeChoiceQuestion | NativeScoreQuestion;
export type Questions = Record<string, Question>;

export type SimplifiedQuestionInput =
  | string
  | string[]
  | FlexibleQuestion
  | Questions
  | Record<string, string | FlexibleQuestion | Question>;

export interface NoulAnswer {
  type: "noul" | "bool";
  /** Probability of yes / true, calibrated between 0.0 and 1.0 */
  noul: number;
  /** Alias for noul for OMP / bool consumers */
  bool?: number;
}

export interface ChoiceAnswer {
  type: "choice";
  /** Chosen option key */
  choice: string;
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
  /** Normalized probability distribution across all criteria */
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  /** Weighted expected rating / level value */
  score: number;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

export type JudgmentState = string | Record<string, unknown> | unknown[] | number | boolean | null;

export interface JudgeResponse<TAnswers extends Answers = Answers> {
  /** Primary verdict for single question, or first verdict for multi-question */
  verdict: boolean | string | number;
  /** Calibrated probability (for noul/bool questions) */
  probability?: number;
  /** Confidence score (for choice/score questions) */
  confidence?: number;
  /** Map of all verdicts keyed by question ID */
  verdicts: Record<string, boolean | string | number>;
  /** Map of all probabilities / confidence scores keyed by question ID */
  probabilities: Record<string, number>;
  /** Parsed answers map directly from Jev */
  answers: TAnswers;
  /** Normalized input questions preserving prompt instructions and criteria */
  questions?: Questions;
  /** Target state or document evaluated */
  state?: JudgmentState;
  /** Full raw API response metadata */
  raw: JevJudgeResult;
}

export interface JevJudgeResult {
  model: string;
  answers: Answers;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  durationMs: number;
}

export interface JevClientOptions {
  /** Wire protocol: chat-completions (OpenAI compatible) or typesafe-direct */
  protocol?: JevProtocol;
  /** Base URL for OpenAI-compatible endpoint or direct gateway */
  baseUrl?: string;
  /** API key */
  apiKey?: string;
  /** Model ID (defaults to opencode-free/jev-1.13-free or jev-latest) */
  model?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Max retries for 408/429/5xx status codes */
  maxRetries?: number;
  /** Default confidence threshold (defaults to 0.5) */
  defaultThreshold?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain Tool Schemas (14 Tools)
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyAction = "auto" | "review" | "escalate";
export type ClaimVerdict = "verified" | "contradicted" | "unsupported";

/* Coding Domain */
export interface JevReviewInput {
  diff: string;
  request: string;
  tests?: string;
  auto_accept?: number;
  review_at?: number;
  composite_floor?: number;
}

export interface JevReviewResult {
  scores: {
    correctness: number;
    spec_match: number;
    test_gap: number;
    blast_radius: number;
  };
  composite: number;
  safe_to_apply: number;
  safe_to_apply_verdict: boolean;
  action: PolicyAction;
  truncated: boolean;
  thresholds: {
    auto_accept: number;
    review_at: number;
    composite_floor: number;
  };
}

export interface JevGateInput extends JevReviewInput {
  claims: string[];
  evidence: string | Array<{ id?: string; text: string }>;
}

export interface JevGateResult extends JevReviewResult {
  claims: Array<{
    claim: string;
    verdict: ClaimVerdict;
    probabilities: Record<string, number>;
    confidence: number;
    action: "auto" | "review";
  }>;
  all_claims_verified: boolean;
  contradicted_count: number;
}

export interface JevActionGateInput {
  action: string;
  context?: string;
}

export interface JevActionGateResult {
  recommendation: "allow" | "confirm" | "block";
  confidence: number;
  risk_score: number;
  touches_prod: boolean;
  touches_prod_probability: number;
}

/* Research Domain */
export interface JevDecideInput {
  decision: string;
  candidates: Array<{ id: string; description: string }>;
  evidence: string;
  priorities: string;
  requirements?: string[];
  escape_hatches?: boolean;
}

export interface JevDecideResult {
  recommendation: {
    selected: string;
    escaped: boolean;
    confidence: number;
    probabilities: Record<string, number>;
  };
  checks: Array<{
    candidate: string;
    requirement: number;
    status: "supported" | "contradicted" | "unknown";
  }>;
  warnings: string[];
}

export interface JevFindInput {
  query: string;
  candidates: Array<{ id?: string; text: string }>;
  top_k?: number;
}

export interface JevFindResult {
  exists: number;
  exists_verdict: "answered" | "partial" | "absent";
  top: Array<{ id: string; text: string; probability: number }>;
}

export interface JevRerankInput {
  query: string;
  candidates: Array<{ id?: string; text: string }>;
  top_k?: number;
}

export interface JevRerankResult {
  ranked: Array<{ rank: number; id: string; text: string; relevance: number }>;
}

export interface JevCompareInput {
  passage_a: string;
  passage_b: string;
  aspects?: string[];
  auto_accept?: number;
}

export interface JevCompareResult {
  relation: "same_fact" | "contradicts" | "different_facts";
  confidence: number;
  probabilities: Record<string, number>;
  action: "auto" | "review";
  aspects?: Record<
    string,
    {
      relation: "same_fact" | "contradicts" | "different_facts";
      confidence: number;
      probabilities: Record<string, number>;
    }
  >;
}

/* Guardrails Domain */
export interface JevVerifyInput {
  claims: string[];
  evidence: string | Array<{ id?: string; text: string }>;
  auto_accept?: number;
  subject_at?: number;
}

export interface JevVerifyResult {
  claims: Array<{
    claim: string;
    verdict: ClaimVerdict;
    relation_verdict?: ClaimVerdict;
    probabilities: Record<string, number>;
    confidence: number;
    same_subject: number;
    action: "auto" | "review";
  }>;
  summary: {
    total: number;
    verified: number;
    contradicted: number;
    unsupported: number;
  };
}

export interface JevScreenInput {
  text: string;
  purpose?: string;
  block_at?: number;
  review_at?: number;
}

export interface JevScreenResult {
  probabilities: {
    injection: number;
    substance?: number;
    relevance?: number;
  };
  recommendation: {
    action: "pass" | "review" | "block" | "skip";
    reason: string;
  };
  thresholds: {
    block_at: number;
    review_at: number;
  };
}

export interface JevExtractField {
  id: string;
  pattern: string;
  flags?: string;
  description: string;
}

export interface JevExtractInput {
  document: string;
  fields: JevExtractField[];
  purpose?: string;
  auto_accept?: number;
  minimum_margin?: number;
}

export interface JevExtractResult {
  results: Record<
    string,
    {
      value: string | null;
      status: "auto" | "review" | "not_found" | "invalid_pattern";
      confidence: number;
      top_probability: number;
      candidates_considered: number;
    }
  >;
}

export interface JevAuditRecord {
  id: string;
  request: string;
  value: string;
}

export interface JevAuditInput {
  source: string;
  records: JevAuditRecord[];
  wrong_at?: number;
}

export interface JevAuditResult {
  action: "pass" | "review" | "escalate";
  records: Array<{
    id: string;
    checks: {
      hallucinated?: number;
      off_target?: number;
      incomplete?: number;
      format?: number;
      absence?: number;
    };
    p_wrong: number;
    action: "ok" | "wrong";
  }>;
  summary: {
    records: number;
    flagged: number;
  };
}

/* Primitives Domain */
export interface JevNoulInput {
  propositions: string[];
  context?: string;
  auto_accept?: number;
}

export interface JevNoulResult {
  results: Array<{
    proposition: string;
    probability: number;
    likely: boolean;
    label: "likely" | "unlikely" | "uncertain";
    auto: boolean;
  }>;
  thresholds: {
    auto_accept: number;
  };
}
