import { describe, expect, it } from "bun:test";
import { validateToolCall } from "../src/tools/validation";

describe("Fail-closed argument validation", () => {
  it("rejects non-object arguments", () => {
    const res = validateToolCall("jev_review", "not an object");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("must be a valid JSON object");
    }
  });

  it("rejects missing required parameters", () => {
    const res = validateToolCall("jev_review", { diff: "+ code" }); // missing request
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("request");
    }
  });

  it("rejects empty string required parameters", () => {
    const res = validateToolCall("jev_review", { diff: "", request: "task" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("diff cannot be empty");
    }
  });

  it("rejects empty claims array in jev_gate", () => {
    const res = validateToolCall("jev_gate", {
      diff: "+ valid",
      request: "task",
      claims: [],
      evidence: "evidence text",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("claims must contain at least 1 claim");
    }
  });

  it("rejects non-string items in claims array", () => {
    const res = validateToolCall("jev_gate", {
      diff: "+ valid",
      request: "task",
      claims: [12345], // not a string
      evidence: "evidence text",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("claims.0");
    }
  });

  it("rejects less than 2 candidates in jev_decide", () => {
    const res = validateToolCall("jev_decide", {
      decision: "choose",
      candidates: [{ id: "c1", description: "single" }],
      evidence: "evidence",
      priorities: "priorities",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("at least 2 options");
    }
  });

  it("rejects invalid thresholds > 1.0 or review_at > auto_accept", () => {
    const res1 = validateToolCall("jev_review", {
      diff: "+ code",
      request: "task",
      auto_accept: 1.5,
    });
    expect(res1.ok).toBe(false);

    const res2 = validateToolCall("jev_review", {
      diff: "+ code",
      request: "task",
      auto_accept: 0.5,
      review_at: 0.8, // review_at exceeds auto_accept
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.message).toContain("review_at cannot exceed auto_accept");
    }
  });

  it("permits standard MCP client metadata without error", () => {
    const res = validateToolCall("jev_review", {
      diff: "+ valid diff",
      request: "valid request",
      _meta: { client: "claude-code", traceId: "xyz" },
    });
    expect(res.ok).toBe(true);
  });

  it("resiliently accepts LLM argument synonyms and normalizes them", () => {
    // 1. jev_action_gate with command instead of action
    const actionRes = validateToolCall("jev_action_gate", { command: "rm -rf /tmp" });
    expect(actionRes.ok).toBe(true);
    if (actionRes.ok) expect(actionRes.data.action).toBe("rm -rf /tmp");

    // 2. jev_verify with single string claim and context instead of evidence
    const verifyRes = validateToolCall("jev_verify", {
      claim: "Only fryum is flagged",
      context: "Fryum flag = true",
    });
    expect(verifyRes.ok).toBe(true);
    if (verifyRes.ok) {
      expect(verifyRes.data.claims).toEqual(["Only fryum is flagged"]);
      expect(verifyRes.data.evidence).toBe("Fryum flag = true");
    }

    // 3. jev_compare with a and b instead of passage_a and passage_b
    const compareRes = validateToolCall("jev_compare", { a: "HTTP 80", b: "Port 80" });
    expect(compareRes.ok).toBe(true);
    if (compareRes.ok) {
      expect(compareRes.data.passage_a).toBe("HTTP 80");
      expect(compareRes.data.passage_b).toBe("Port 80");
    }

    // 4. jev_find with string candidates and q instead of query
    const findRes = validateToolCall("jev_find", {
      q: "find token",
      candidates: ["token handler", "db pool"],
    });
    expect(findRes.ok).toBe(true);
    if (findRes.ok) {
      expect(findRes.data.query).toBe("find token");
      expect(findRes.data.candidates).toHaveLength(2);
    }

    // 5. jev_judge with questions (plural) and no state
    const judgeRes = validateToolCall("jev_judge", {
      questions: { q1: "is this valid?" },
    });
    expect(judgeRes.ok).toBe(true);
    if (judgeRes.ok) {
      expect(judgeRes.data.state).toBe("");
      expect(judgeRes.data.question).toBeDefined();
    }
  });
});
