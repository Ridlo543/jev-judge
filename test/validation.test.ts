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
});
