import { describe, expect, it } from "bun:test";
import {
  judge,
  judgeBatch,
  judgeBool,
  judgeChoice,
  judgeScore,
  normalizeQuestions,
} from "../src/client";
const hasCredentials = Boolean(
  process.env.JEV_API_KEY || process.env.OPENAI_API_KEY
);
const itLive = it.skipIf(!hasCredentials);

describe("jev-judge client", () => {
  itLive("evaluates a simple yes/no question with calibrated probability", async () => {
    const res = await judge("The user typed: echo hello world", "Is this a harmless echo command?");
    expect(typeof res.verdict).toBe("boolean");
    expect(res.verdict).toBe(true);
    expect(res.probability).toBeGreaterThan(0.5);
    expect(res.raw.model).toBeDefined();
    expect(res.raw.durationMs).toBeGreaterThan(0);
  });

  itLive("evaluates multiple choice classification with confidence", async () => {
    const res = await judge("SELECT * FROM users WHERE id = 1;", {
      type: "choice",
      instructions: "What programming language or query language is this?",
      options: ["sql", "python", "rust", "html"],
    });
    expect(res.verdict).toBe("sql");
    expect(res.confidence).toBeGreaterThan(0.5);
    expect(res.answers.verdict.type).toBe("choice");
  });

  itLive("evaluates ordinal score rating", async () => {
    const res = await judge("Refactor thousands of legacy COBOL banking routines into distributed microservices", {
      type: "score",
      instructions: "Rate the difficulty of this refactoring project",
      levels: ["trivial", "moderate", "complex", "extreme"],
    });
    expect(typeof res.verdict).toBe("number");
    expect(Number(res.verdict)).toBeGreaterThan(1.5);
  });

  itLive("handles batch evaluations concurrently", async () => {
    const items = [
      { id: "item-1", state: "fix small typo", question: "Is this simple?" },
      { id: "item-2", state: "build an entire operating system kernel from scratch", question: "Is this simple?" },
    ];

    const results = await judgeBatch(items, { concurrency: 2 });
    expect(results).toHaveLength(2);

    const item1 = results.find((r) => r.id === "item-1");
    const item2 = results.find((r) => r.id === "item-2");

    expect(item1?.success).toBe(true);
    expect(item1?.response?.verdict).toBe(true);
    expect(item2?.success).toBe(true);
    expect(item2?.response?.verdict).toBe(false);
  });

  itLive("evaluates multi-question criteria in a single round-trip", async () => {
    const res = await judge("git reset --hard HEAD~1", {
      is_dangerous: "Is this action dangerous?",
      operation_type: {
        type: "choice",
        instructions: "What type of git operation is this?",
        options: ["inspection", "reset_or_clean", "branch_creation"],
      },
      risk_score: {
        type: "score",
        instructions: "Rate the risk level",
        levels: ["negligible", "low", "medium", "high", "critical"],
      },
    });

    expect(res.verdicts.is_dangerous).toBe(true);
    expect(res.verdicts.operation_type).toBe("reset_or_clean");
    expect(typeof res.verdicts.risk_score).toBe("number");
    expect(Number(res.verdicts.risk_score)).toBeGreaterThan(2);
    expect(res.answers.is_dangerous.type).toBe("noul");
    expect((res.answers.is_dangerous as any).bool).toBeDefined();
  });

  it("accepts prompt and question properties and converts to instructions", () => {
    const normalized = normalizeQuestions({
      q_choice: {
        type: "choice",
        prompt: "Which framework is this?",
        options: ["react", "vue", "svelte"],
      },
      q_prompt_bool: {
        type: "boolean",
        prompt: "Is this valid TypeScript?",
      },
      q_bare_question: {
        question: "Does this return 42?",
      },
    });

    expect(normalized.q_choice.type).toBe("choice");
    expect(normalized.q_choice.instructions).toBe("Which framework is this?");
    expect(normalized.q_choice.criteria).toEqual({
      react: "react",
      vue: "vue",
      svelte: "svelte",
    });
    expect(normalized.q_prompt_bool.type).toBe("noul");
    expect(normalized.q_prompt_bool.instructions).toBe("Is this valid TypeScript?");
    expect(normalized.q_bare_question.type).toBe("noul");
    expect(normalized.q_bare_question.instructions).toBe("Does this return 42?");
  });

  it("accepts Claude Code question format using 'text' property", () => {
    const normalized = normalizeQuestions({
      fryum_only_flag: {
        type: "boolean",
        text: "Under the stated rule, is fryum the only class flagged by gate L?",
      },
      h1_failed: {
        type: "boolean",
        text: "Under the stated rule, did H1 fail?",
      },
    });

    expect(normalized.fryum_only_flag.type).toBe("noul");
    expect(normalized.fryum_only_flag.instructions).toBe(
      "Under the stated rule, is fryum the only class flagged by gate L?",
    );
    expect(normalized.h1_failed.type).toBe("noul");
    expect(normalized.h1_failed.instructions).toBe("Under the stated rule, did H1 fail?");
  });

  itLive("works with convenience helper methods judgeBool, judgeChoice, judgeScore", async () => {
    const [isHarmless, category, difficulty] = await Promise.all([
      judgeBool("console.log('hi')", "Is this a simple logging statement?"),
      judgeChoice("SELECT 1;", "What query language is this?", ["sql", "python", "css"]),
      judgeScore("Print hello world in Python", "Rate difficulty", ["trivial", "hard"]),
    ]);
    expect(isHarmless).toBe(true);
    expect(category).toBe("sql");
    expect(difficulty).toBeLessThan(0.8);
  }, 20_000);
});
