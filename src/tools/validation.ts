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
    diff: z.string().min(1, "diff cannot be empty").max(50_000).optional(),
    patch: z.string().min(1, "diff cannot be empty").max(50_000).optional(),
    request: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    task: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    spec: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    prompt: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    tests: z.string().max(50_000).optional(),
    claims: z.array(z.string().min(1)).max(16).optional(),
    claim: z.string().min(1).optional(),
    evidence: z.union([z.string().max(200_000), z.array(z.any())]).optional(),
    context: z.string().max(200_000).optional(),
    auto_accept: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    composite_floor: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => {
    const rawDiff = (data.diff ?? data.patch ?? "").trim();
    const rawRequest = (data.request ?? data.task ?? data.spec ?? data.prompt ?? "").trim();
    let rawClaims: string[] | undefined = undefined;
    if (Array.isArray(data.claims)) rawClaims = data.claims;
    else if (typeof data.claims === "string") rawClaims = [data.claims];
    else if (typeof data.claim === "string") rawClaims = [data.claim];

    return {
      diff: rawDiff,
      request: rawRequest,
      tests: data.tests,
      claims: rawClaims,
      evidence: data.evidence ?? data.context,
      auto_accept: data.auto_accept,
      review_at: data.review_at,
      composite_floor: data.composite_floor,
      _meta: data._meta,
    };
  })
  .refine((data) => data.diff.length > 0, {
    message: "Diff cannot be empty (provide 'diff' or 'patch')",
  })
  .refine((data) => data.request.length > 0, {
    message: "Request cannot be empty (provide 'request', 'task', or 'spec')",
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
    diff: z.string().min(1, "diff cannot be empty").max(50_000).optional(),
    patch: z.string().min(1, "diff cannot be empty").max(50_000).optional(),
    request: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    task: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    spec: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    prompt: z.string().min(1, "request cannot be empty").max(50_000).optional(),
    claims: z.array(z.string().min(1)).max(16).optional(),
    claim: z.string().min(1).optional(),
    evidence: z.union([z.string().max(200_000), z.array(z.any())]).optional(),
    context: z.string().max(200_000).optional(),
    tests: z.string().max(50_000).optional(),
    auto_accept: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    composite_floor: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => {
    const rawDiff = (data.diff ?? data.patch ?? "").trim();
    const rawRequest = (data.request ?? data.task ?? data.spec ?? data.prompt ?? "").trim();
    let rawClaims: string[] = [];
    if (Array.isArray(data.claims)) rawClaims = data.claims;
    else if (typeof data.claims === "string") rawClaims = [data.claims];
    else if (typeof data.claim === "string") rawClaims = [data.claim];

    return {
      diff: rawDiff,
      request: rawRequest,
      claims: rawClaims,
      evidence: data.evidence ?? data.context ?? "",
      tests: data.tests,
      auto_accept: data.auto_accept,
      review_at: data.review_at,
      composite_floor: data.composite_floor,
      _meta: data._meta,
    };
  })
  .refine((data) => data.diff.length > 0, {
    message: "Diff cannot be empty (provide 'diff' or 'patch')",
  })
  .refine((data) => data.request.length > 0, {
    message: "Request cannot be empty (provide 'request', 'task', or 'spec')",
  })
  .refine((data) => data.claims.length > 0, {
    message: "claims must contain at least 1 claim (provide 'claims' array or 'claim' string)",
  })
  .refine(
    (data) =>
      typeof data.evidence === "string" ? data.evidence.length > 0 : data.evidence.length > 0,
    {
      message: "Evidence text cannot be empty (provide 'evidence' or 'context')",
    },
  )
  .refine(
    (data) => {
      if (data.auto_accept !== undefined && data.review_at !== undefined) {
        return data.review_at <= data.auto_accept;
      }
      return true;
    },
    { message: "review_at cannot exceed auto_accept" },
  );
export const actionGateSchema = z
  .object({
    action: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    cmd: z.string().min(1).optional(),
    context: z.string().max(10_000).optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    action: (data.action || data.command || data.cmd || "").trim(),
    context: data.context,
    _meta: data._meta,
  }))
  .refine((data) => data.action.length > 0, {
    message: "Action or command cannot be empty (provide 'action' or 'command')",
  });

const decideCandidateItem = z.union([
  z.string().min(1).transform((s) => ({ id: s, description: s })),
  z.object({
    id: z.string().min(1, "candidate id cannot be empty"),
    description: z.string().min(1, "candidate description cannot be empty"),
  }),
]);

export const decideSchema = z
  .object({
    decision: z.string().min(1).max(1_500).optional(),
    question: z.string().min(1).max(1_500).optional(),
    prompt: z.string().min(1).max(1_500).optional(),
    candidates: z.array(decideCandidateItem).min(2, "candidates must contain at least 2 options").max(6),
    evidence: z.string().max(12_000).optional(),
    context: z.string().max(12_000).optional(),
    priorities: z.string().max(2_000).optional(),
    requirements: z.array(z.string().min(1)).max(3).optional(),
    escape_hatches: z.boolean().optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    decision: data.decision ?? data.question ?? data.prompt ?? "",
    candidates: data.candidates,
    evidence: data.evidence ?? data.context ?? "(No explicit evidence provided)",
    priorities: data.priorities ?? "(Satisfy technical requirements and best practices)",
    requirements: data.requirements,
    escape_hatches: data.escape_hatches,
    _meta: data._meta,
  }))
  .refine((data) => data.decision.length > 0, {
    message: "decision cannot be empty (provide 'decision', 'question', or 'prompt')",
  });

const searchCandidateItem = z.union([
  z.string().min(1).transform((s) => ({ text: s })),
  z.object({
    id: z.string().optional(),
    text: z.string().min(1, "candidate text cannot be empty"),
  }),
]);

export const findSchema = z
  .object({
    query: z.string().min(1).max(2_000).optional(),
    q: z.string().min(1).max(2_000).optional(),
    candidates: z.array(searchCandidateItem).min(1, "candidates array cannot be empty").max(250),
    top_k: z.number().int().min(1).max(50).optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    query: data.query ?? data.q ?? "",
    candidates: data.candidates.map((c, idx) => ({
      id: ("id" in c && c.id ? c.id : undefined) ?? `cand_${idx + 1}`,
      text: c.text,
    })),
    top_k: data.top_k,
    _meta: data._meta,
  }))
  .refine((data) => data.query.length > 0, {
    message: "query cannot be empty (provide 'query' or 'q')",
  });

export const rerankSchema = z
  .object({
    query: z.string().min(1).max(2_000).optional(),
    q: z.string().min(1).max(2_000).optional(),
    candidates: z.array(searchCandidateItem).min(1, "candidates array cannot be empty").max(250),
    top_k: z.number().int().min(1).max(250).optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    query: data.query ?? data.q ?? "",
    candidates: data.candidates.map((c, idx) => ({
      id: ("id" in c && c.id ? c.id : undefined) ?? `cand_${idx + 1}`,
      text: c.text,
    })),
    top_k: data.top_k,
    _meta: data._meta,
  }))
  .refine((data) => data.query.length > 0, {
    message: "query cannot be empty (provide 'query' or 'q')",
  });

export const compareSchema = z
  .object({
    passage_a: z.string().min(1).optional(),
    passage_b: z.string().min(1).optional(),
    a: z.string().min(1).optional(),
    b: z.string().min(1).optional(),
    text_a: z.string().min(1).optional(),
    text_b: z.string().min(1).optional(),
    doc_a: z.string().min(1).optional(),
    doc_b: z.string().min(1).optional(),
    aspects: z.array(z.string().min(1)).max(10).optional(),
    auto_accept: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    passage_a: data.passage_a ?? data.a ?? data.text_a ?? data.doc_a ?? "",
    passage_b: data.passage_b ?? data.b ?? data.text_b ?? data.doc_b ?? "",
    aspects: data.aspects,
    auto_accept: data.auto_accept,
    _meta: data._meta,
  }))
  .refine((data) => data.passage_a.length > 0 && data.passage_b.length > 0, {
    message: "Both passages must be provided (e.g. 'passage_a' & 'passage_b', or 'a' & 'b')",
  });

export const verifySchema = z
  .object({
    claims: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    claim: z.string().min(1).optional(),
    evidence: z
      .union([
        z.string().min(1),
        z.array(
          z.object({
            id: z.string().optional(),
            text: z.string().min(1),
          }),
        ),
      ])
      .optional(),
    context: z.string().min(1).optional(),
    document: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    auto_accept: thresholdNumber.optional(),
    subject_at: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => {
    let rawClaims: string[] = [];
    if (Array.isArray(data.claims)) {
      rawClaims = data.claims;
    } else if (typeof data.claims === "string") {
      rawClaims = [data.claims];
    } else if (typeof data.claim === "string") {
      rawClaims = [data.claim];
    }

    const rawEvidence =
      data.evidence ?? data.context ?? data.document ?? data.source ?? "";

    return {
      claims: rawClaims,
      evidence: rawEvidence,
      auto_accept: data.auto_accept,
      subject_at: data.subject_at,
      _meta: data._meta,
    };
  })
  .refine((data) => data.claims.length > 0, {
    message: "At least one claim must be provided (provide 'claims' array or 'claim' string)",
  })
  .refine(
    (data) =>
      typeof data.evidence === "string" ? data.evidence.length > 0 : data.evidence.length > 0,
    {
      message: "Evidence text cannot be empty (provide 'evidence' or 'context')",
    },
  );

export const screenSchema = z
  .object({
    text: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    input: z.string().min(1).optional(),
    purpose: z.string().max(2_000).optional(),
    block_at: thresholdNumber.optional(),
    review_at: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    text: data.text ?? data.content ?? data.input ?? "",
    purpose: data.purpose,
    block_at: data.block_at,
    review_at: data.review_at,
    _meta: data._meta,
  }))
  .refine((data) => data.text.length > 0, {
    message: "Text content cannot be empty (provide 'text', 'content', or 'input')",
  });
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

export const noulSchema = z
  .object({
    propositions: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    proposition: z.string().min(1).optional(),
    statements: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    claims: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    context: z.string().max(150_000).optional(),
    evidence: z.string().max(150_000).optional(),
    auto_accept: thresholdNumber.optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => {
    const rawProps =
      data.propositions ?? data.proposition ?? data.statements ?? data.claims ?? [];
    const list = Array.isArray(rawProps) ? rawProps : [rawProps];
    return {
      propositions: list,
      context: data.context ?? data.evidence,
      auto_accept: data.auto_accept,
      _meta: data._meta,
    };
  })
  .refine((data) => data.propositions.length > 0, {
    message: "At least one proposition must be provided",
  });

export const judgeSchema = z
  .object({
    state: z.unknown().optional(),
    context: z.unknown().optional(),
    document: z.unknown().optional(),
    question: z.unknown().optional(),
    questions: z.unknown().optional(),
    q: z.unknown().optional(),
    prompt: z.unknown().optional(),
    text: z.unknown().optional(),
    _meta: z.unknown().optional(),
  })
  .transform((data) => ({
    state: data.state ?? data.context ?? data.document ?? "",
    question: data.question ?? data.questions ?? data.q ?? data.prompt ?? data.text,
    _meta: data._meta,
  }))
  .refine((data) => data.question !== undefined, {
    message: "A question, prompt, or question rubric must be provided (provide 'question' or 'questions').",
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
  jev_gate_command: actionGateSchema,
  jev_decide: decideSchema,
  jev_decide_architecture: decideSchema,
  jev_arbitrate_decision: decideSchema,
  jev_find: findSchema,
  jev_find_best: findSchema,
  jev_semantic_select: findSchema,
  jev_rerank: rerankSchema,
  jev_rerank_candidates: rerankSchema,
  jev_rank_relevance: rerankSchema,
  jev_compare: compareSchema,
  jev_compare_passages: compareSchema,
  jev_verify: verifySchema,
  jev_verify_citations: verifySchema,
  jev_fact_check_citations: verifySchema,
  jev_screen: screenSchema,
  jev_screen_content: screenSchema,
  jev_screen_prompt_injection: screenSchema,
  jev_extract: extractSchema,
  jev_extract_fields: extractSchema,
  jev_extract_verbatim_regex: extractSchema,
  jev_audit: auditSchema,
  jev_audit_records: auditSchema,
  jev_audit_extracted_records: auditSchema,
  jev_noul: noulSchema,
  jev_check_probability: noulSchema,
  jev_truth_probability: noulSchema,
  jev_judge: judgeSchema,
  jev_decision_primitive: judgeSchema,
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
