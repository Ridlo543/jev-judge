import { z } from "zod";

export interface ValidationSuccess {
  ok: true;
  data: Record<string, unknown>;
}

export interface ValidationError {
  ok: false;
  message: string;
}

export type ValidationResult = ValidationSuccess | ValidationError;

// Bounded threshold helper
const thresholdNumber = z.number().min(0).max(1);

// Schemas for all 14 tools
export const reviewSchema = z
  .object({
    diff: z.string().min(1, "diff cannot be empty").max(50_000, "diff exceeds 50,000 characters"),
    request: z.string().min(1, "request cannot be empty").max(50_000, "request exceeds 50,000 characters"),
    tests: z.string().max(50_000).optional(),
    claims: z.array(z.string().min(1).max(2_000)).max(16).optional(),
    evidence: z.union([z.string().max(200_000), z.array(z.any())]).optional(),
    auto_accept: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    composite_floor: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .refine(
    (data) => {
      if (data.auto_accept !== undefined && data.review_at !== undefined) {
        return data.review_at <= data.auto_accept;
      }
      return true;
    },
    { message: "review_at cannot exceed auto_accept" },
  );

export const gateSchema = z
  .object({
    diff: z.string().min(1, "diff cannot be empty").max(50_000, "diff exceeds 50,000 characters"),
    request: z.string().min(1, "request cannot be empty").max(50_000, "request exceeds 50,000 characters"),
    claims: z
      .array(z.string().min(1).max(2_000))
      .min(1, "claims must contain at least 1 claim")
      .max(16, "claims cannot exceed 16 items"),
    evidence: z.union([
      z.string().min(1, "evidence cannot be empty").max(200_000, "evidence exceeds 200,000 characters"),
      z
        .array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1, "evidence item text cannot be empty"),
          }),
        )
        .min(1, "evidence array must contain at least 1 item"),
    ]),
    tests: z.string().max(50_000).optional(),
    auto_accept: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    composite_floor: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .refine(
    (data) => {
      if (data.auto_accept !== undefined && data.review_at !== undefined) {
        return data.review_at <= data.auto_accept;
      }
      return true;
    },
    { message: "review_at cannot exceed auto_accept" },
  );

export const actionGateSchema = z.object({
  action: z.string().min(1, "action cannot be empty").max(10_000),
  context: z.string().max(10_000).optional(),
  _meta: z.unknown().optional(),
});

export const decideSchema = z.object({
  decision: z.string().min(1, "decision cannot be empty").max(1_500),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1, "candidate id cannot be empty"),
        description: z.string().min(1, "candidate description cannot be empty"),
      }),
    )
    .min(2, "candidates must contain at least 2 options")
    .max(6, "candidates cannot exceed 6 options"),
  evidence: z.string().min(1, "evidence cannot be empty").max(12_000),
  priorities: z.string().min(1, "priorities cannot be empty").max(2_000),
  requirements: z.array(z.string().min(1)).max(3).optional(),
  escape_hatches: z.boolean().optional(),
  _meta: z.unknown().optional(),
});

export const findSchema = z.object({
  query: z.string().min(1, "query cannot be empty").max(2_000),
  candidates: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().min(1, "candidate text cannot be empty"),
      }),
    )
    .min(1, "candidates array cannot be empty")
    .max(250),
  top_k: z.number().int().min(1).max(50).optional(),
  _meta: z.unknown().optional(),
});

export const rerankSchema = z.object({
  query: z.string().min(1, "query cannot be empty").max(2_000),
  candidates: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().min(1, "candidate text cannot be empty"),
      }),
    )
    .min(1, "candidates array cannot be empty")
    .max(250),
  top_k: z.number().int().min(1).max(250).optional(),
  _meta: z.unknown().optional(),
});

export const compareSchema = z.object({
  passage_a: z.string().min(1, "passage_a cannot be empty").max(20_000),
  passage_b: z.string().min(1, "passage_b cannot be empty").max(20_000),
  aspects: z.array(z.string().min(1)).max(10).optional(),
  auto_accept: thresholdNumber.optional(),
  _meta: z.unknown().optional(),
});

export const verifySchema = z
  .object({
    claims: z
      .array(z.string().min(1).max(2_000))
      .min(1, "claims must contain at least 1 claim")
      .max(16, "claims cannot exceed 16 items"),
    evidence: z.union([
      z.string().min(1, "evidence cannot be empty").max(200_000),
      z
        .array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1, "evidence item text cannot be empty"),
          }),
        )
        .min(1, "evidence array must contain at least 1 item"),
    ]),
    auto_accept: thresholdNumber.optional(),
    subject_at: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .refine(
    (data) => {
      if (data.auto_accept !== undefined && data.subject_at !== undefined) {
        return data.subject_at <= data.auto_accept;
      }
      return true;
    },
    { message: "subject_at cannot exceed auto_accept" },
  );

export const screenSchema = z
  .object({
    text: z.string().min(1, "text cannot be empty").max(50_000),
    purpose: z.string().max(2_000).optional(),
    block_at: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .refine(
    (data) => {
      if (data.block_at !== undefined && data.review_at !== undefined) {
        return data.review_at <= data.block_at;
      }
      return true;
    },
    { message: "review_at cannot exceed block_at" },
  );

export const extractSchema = z.object({
  document: z.string().min(1, "document cannot be empty").max(50_000),
  fields: z
    .array(
      z.object({
        id: z.string().min(1),
        pattern: z.string().min(1),
        flags: z.string().optional(),
        description: z.string().min(1),
      }),
    )
    .min(1, "fields array cannot be empty")
    .max(32),
  auto_accept: thresholdNumber.optional(),
  _meta: z.unknown().optional(),
});

export const auditSchema = z.object({
  source: z.string().min(1, "source cannot be empty").max(50_000),
  records: z
    .array(
      z.object({
        id: z.string().min(1),
        request: z.string().min(1),
        value: z.string(),
      }),
    )
    .min(1, "records array cannot be empty")
    .max(32),
  wrong_at: thresholdNumber.optional(),
  _meta: z.unknown().optional(),
});

export const noulSchema = z.object({
  propositions: z
    .array(z.string().min(1).max(2_000))
    .min(1, "propositions array cannot be empty")
    .max(64),
  context: z.string().max(150_000).optional(),
  auto_accept: thresholdNumber.optional(),
  _meta: z.unknown().optional(),
});

export const judgeSchema = z.object({
  state: z.unknown(),
  question: z.unknown(),
  _meta: z.unknown().optional(),
});

export const judgeBatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        state: z.unknown(),
        question: z.unknown(),
      }),
    )
    .min(1, "items array cannot be empty"),
  concurrency: z.number().int().min(1).max(20).optional(),
  _meta: z.unknown().optional(),
});

const SCHEMAS_BY_TOOL_NAME: Record<string, z.ZodTypeAny> = {
  jev_review: reviewSchema,
  jev_review_patch: reviewSchema,
  jev_gate: gateSchema,
  jev_gate_acceptance: gateSchema,
  jev_action_gate: actionGateSchema,
  jev_screen_command: actionGateSchema,
  jev_decide: decideSchema,
  jev_decide_architecture: decideSchema,
  jev_find: findSchema,
  jev_find_best: findSchema,
  jev_rerank: rerankSchema,
  jev_rerank_candidates: rerankSchema,
  jev_compare: compareSchema,
  jev_compare_passages: compareSchema,
  jev_verify: verifySchema,
  jev_verify_citations: verifySchema,
  jev_screen: screenSchema,
  jev_screen_content: screenSchema,
  jev_extract: extractSchema,
  jev_extract_fields: extractSchema,
  jev_audit: auditSchema,
  jev_audit_records: auditSchema,
  jev_noul: noulSchema,
  jev_check_probability: noulSchema,
  jev_judge: judgeSchema,
  jev_judge_batch: judgeBatchSchema,
};

/**
 * Validates raw arguments fail-closed before execution.
 * Formats clean, actionable human/agent-readable error messages.
 */
export function validateToolCall(
  toolName: string,
  rawArgs: unknown,
): ValidationResult {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return {
      ok: false,
      message: `Validation error [${toolName}]: Arguments must be a valid JSON object.`,
    };
  }

  const schema = SCHEMAS_BY_TOOL_NAME[toolName];
  if (!schema) {
    // If no specific schema exists, permit standard object
    return { ok: true, data: rawArgs as Record<string, unknown> };
  }

  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const pathStr = issue.path.length > 0 ? `'${issue.path.join(".")}'` : "root";
        return `${pathStr}: ${issue.message}`;
      })
      .join("; ");

    return {
      ok: false,
      message: `Validation error [${toolName}]: ${issues}`,
    };
  }

  return { ok: true, data: parsed.data as Record<string, unknown> };
}
