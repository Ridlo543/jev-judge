import { describe, expect, it } from "bun:test";
import { formatToolResult, stripInternalMetadata } from "../src/formatter";

describe("Universal Output Formatter", () => {
  it("strips internal duplicate metadata in JSON mode", () => {
    const raw = {
      verdict: true,
      probability: 0.75,
      answers: {
        workflow_soundness: { type: "noul", noul: 0.75 },
      },
      raw: {
        model: "opencode-free/jev-1.13-free",
        durationMs: 1200,
        answers: {
          workflow_soundness: { type: "noul", noul: 0.75 },
        },
      },
      _meta: { client: "omp" },
    };

    const cleaned = stripInternalMetadata(raw) as any;
    expect(cleaned._meta).toBeUndefined();
    expect(cleaned.raw.model).toBe("opencode-free/jev-1.13-free");
    expect(cleaned.raw.durationMs).toBe(1200);
    expect(cleaned.raw.answers).toBeUndefined(); // stripped!
    expect(cleaned.answers).toBeDefined();

    const jsonStr = formatToolResult("jev_judge", raw, "json");
    expect(jsonStr).not.toContain('"_meta"');
    expect(JSON.parse(jsonStr).verdict).toBe(true);
  });

  it("formats jev_judge multi-question results into crisp Markdown table with detailed breakdowns", () => {
    const data = {
      verdict: true,
      probability: 0.75,
      verdicts: {
        workflow_soundness: true,
        production_distribution: "Dual: npm + GitHub",
        overall_readiness: 1.74,
      },
      probabilities: {
        workflow_soundness: 0.75,
        production_distribution: 0.8,
        overall_readiness: 0.72,
      },
      answers: {
        workflow_soundness: { type: "noul", noul: 0.75 },
        production_distribution: {
          type: "choice",
          choice: "Dual: npm + GitHub",
          confidence: 0.8,
          probabilities: {
            "Dual: npm + GitHub": 0.85,
            "npm only": 0.15,
          },
        },
        overall_readiness: {
          type: "score",
          score: 1.74,
          confidence: 0.72,
          legend: {
            "0": "fragile",
            "1": "viable",
            "2": "production-grade",
            "3": "benchmark",
          },
          probabilities: {
            "2": 0.72,
            "1": 0.27,
            "3": 0.01,
          },
        },
      },
      raw: {
        model: "opencode-free/jev-1.13-free",
        durationMs: 1363,
      },
    };

    const md = formatToolResult("jev_judge", data, "markdown");
    expect(md).toContain("### ⚖️ Jev Judgment: ✅ [TRUE]");
    expect(md).toContain("#### Detailed Breakdown & Semantic Criteria");
    expect(md).toContain("**85.0%** 🏆 (Winner)");
    expect(md).toContain("Scale Legend: `0: fragile → 1: viable → 2: production-grade → 3: benchmark`");
    expect(md).toContain("Level 2 (production-grade): **72.0%**");
    expect(md).toContain("Latency: 1363ms");
    expect(md).toContain("opencode-free/jev-1.13-free");
  });

  it("formats jev_review with rubric metric table and status badge", () => {
    const data = {
      composite: 0.88,
      action: "auto",
      safe_to_apply: true,
      scores: {
        correctness: 1.8,
        spec_match: 1.9,
        test_gap: 0.2,
        blast_radius: 0.3,
      },
    };

    const md = formatToolResult("jev_review", data, "markdown");
    expect(md).toContain("### 🔍 Diff Review: 🟢 [AUTO] (Composite: 0.88 / 1.0)");
    expect(md).toContain("| Rubric Metric    | Score (0..2) |");
    expect(md).toContain("| **Correctness**  |    `1.80`    |");
    expect(md).toContain("- **Safe to Apply:** `true`");
  });

  it("formats jev_gate with checklist and audit count", () => {
    const data = {
      composite: 0.92,
      action: "auto",
      all_claims_verified: true,
      contradicted_count: 0,
      claims: [
        { claim: "Package version was incremented to 1.0.1", verdict: "verified" },
        { claim: "All unit tests pass", verdict: "verified" },
      ],
    };

    const md = formatToolResult("jev_gate", data, "markdown");
    expect(md).toContain("### 🚪 Acceptance Gate: 🟢 [AUTO] (Diff Quality: 0.92)");
    expect(md).toContain("- ✅ **[VERIFIED]** Package version was incremented to 1.0.1");
    expect(md).toContain("- ✅ **[VERIFIED]** All unit tests pass");
  });

  it("formats jev_action_gate with safety banner and risk level", () => {
    const data = {
      action: "rm -rf / --no-preserve-root",
      recommendation: "block",
      risk_score: 2.85,
      is_destructive: true,
      requires_escalation: true,
      reasoning: "Destructive root recursive deletion detected",
    };

    const md = formatToolResult("jev_action_gate", data, "markdown");
    expect(md).toContain("### 🛡️ Action Safety Gate: 🛑 [BLOCK] (Risk: 2.85 / 3.0)");
    expect(md).toContain("- **Action/Command:** `rm -rf / --no-preserve-root`");
    expect(md).toContain("- **Destructive Operation:** `YES`");
    expect(md).toContain("Destructive root recursive deletion detected");
  });

  it("formats jev_decide with selected candidate and requirements matrix", () => {
    const data = {
      recommendation: {
        selected: "postgresql_partitioned",
        escaped: false,
        confidence: 0.92,
      },
      checks: [
        { candidate: "postgresql_partitioned", requirement: 1, status: "supported" },
        { candidate: "sqlite_in_memory", requirement: 1, status: "contradicted" },
      ],
      warnings: [],
    };

    const md = formatToolResult("jev_decide", data, "markdown");
    expect(md).toContain("### 🎯 Technical Decision: `postgresql_partitioned` (92.0% confidence)");
    expect(md).toContain("| Candidate                  | Requirement # |      Status       |");
    expect(md).toContain("| **postgresql_partitioned** |     Req 1     |  🟢 [SUPPORTED]   |");
    expect(md).toContain("| **sqlite_in_memory**       |     Req 1     | ❌ [CONTRADICTED] |");
  });

  it("formats jev_verify with citation checklist", () => {
    const data = {
      claims: [
        { claim: "Bun is an all-in-one JavaScript runtime", verdict: "verified" },
        { claim: "Python conceived in 1880s", verdict: "contradicted" },
      ],
      summary: { verified: 1, contradicted: 1, unsupported: 0 },
    };

    const md = formatToolResult("jev_verify", data, "markdown");
    expect(md).toContain("### 📋 Citation Verification: 1 Verified · 1 Contradicted · 0 Unsupported");
    expect(md).toContain("- ✅ **[VERIFIED]** Bun is an all-in-one JavaScript runtime");
    expect(md).toContain("- ❌ **[CONTRADICTED]** Python conceived in 1880s");
  });

  it("gracefully falls back to clean JSON if formatting encounters unexpected shapes (fail-closed)", () => {
    const circular: any = { a: 1 };
    circular.b = circular; // circular reference

    const res = formatToolResult("unknown_tool", { valid: true });
    expect(res).toContain("### 🔧 unknown_tool");
    expect(res).toContain('"valid": true');
  });
});
