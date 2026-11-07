import { describe, expect, it } from "bun:test";
import { screenAction, truncate } from "../src/tools/coding";
import { decideChoice } from "../src/tools/research";
import { resolveConfig } from "../src/config";

let hasLaya = false;
try {
  const probe = await fetch("http://127.0.0.1:20130/health", { signal: AbortSignal.timeout(500) });
  hasLaya = probe.ok;
} catch {
  hasLaya = false;
}
const itLaya = it.skipIf(!hasLaya);

describe("CLI argument and file path safety (resolving Issue #1)", () => {
  it("fails immediately when --diff points to a non-existent file", async () => {
    const proc = Bun.spawn(["bun", "src/cli.ts", "review", "--diff", "nonexistent_patch_file.patch"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Diff file not found: nonexistent_patch_file.patch");
  });

  it("fails immediately when -f / --file points to a non-existent file", async () => {
    const proc = Bun.spawn(["bun", "src/cli.ts", "review", "-f", "missing_file.txt"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("File not found: missing_file.txt");
  });

  it("fails immediately when positional argument is a non-existent file path", async () => {
    const proc = Bun.spawn(["bun", "src/cli.ts", "review", "missing_positional.patch"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Diff file not found: missing_positional.patch");
  });

  it("allows inline diff string with newlines or diff headers without file not found error", async () => {
    const inlineDiff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-1\n+2";
    // Point to dummy base url so it parses args without filing missing file error
    const proc = Bun.spawn(
      ["bun", "src/cli.ts", "review", "--diff", inlineDiff, "--base-url", "http://127.0.0.1:20130/v1", "--model", "laya", "--timeout", "1000"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    // Must NOT complain that inline diff is a missing file path!
    expect(stderr).not.toContain("Diff file not found");
  });

  it("fails when --evidence-file points to a non-existent file", async () => {
    const proc = Bun.spawn(
      ["bun", "src/cli.ts", "gate", "--diff", "diff --git a b\n+c", "--evidence-file", "missing_evidence.log"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Evidence file not found: missing_evidence.log");
  });
});

describe("Defensive string truncation", () => {
  it("safely handles null and undefined without throwing TypeError", () => {
    expect(truncate(undefined as any, 100)).toEqual({ text: "", truncated: false });
    expect(truncate(null as any, 100)).toEqual({ text: "", truncated: false });
  });

  it("safely handles numbers and non-string primitives", () => {
    expect(truncate(123456 as any, 3)).toEqual({ text: "123 […truncated]", truncated: true });
    expect(truncate(42 as any, 10)).toEqual({ text: "42", truncated: false });
  });

  it("truncates long strings accurately", () => {
    const longStr = "abcdefghij";
    const res = truncate(longStr, 5);
    expect(res.truncated).toBe(true);
    expect(res.text).toBe("abcde […truncated]");
  });
});

describe("Laya engine configuration presets", () => {
  it("auto-populates local Laya defaults when model is laya", () => {
    const config = resolveConfig({ model: "laya" });
    expect(config.model).toBe("laya");
    expect(config.baseUrl).toBe("http://127.0.0.1:20130/v1");
    expect(config.apiKey).toBe("none");
  });
});

describe("Research tools defensive handling of optional fields", () => {
  itLaya("safely executes decideChoice when optional decision, evidence, and priorities are undefined", async () => {
    // Call with local Laya so it runs against real model without mocking
    const res = await decideChoice({
      candidates: [
        { id: "opt_a", description: "First choice description" },
        { id: "opt_b", description: "Second choice description" },
      ],
    }, {
      options: {
        baseUrl: "http://127.0.0.1:20130/v1",
        model: "laya",
        apiKey: "none",
      },
    });

    expect(["opt_a", "opt_b", "ask_user", "investigate", "none"]).toContain(res.recommendation.selected);
    expect(typeof res.recommendation.confidence).toBe("number");
  }, 15_000);
});

describe("Action gate defense-in-depth safety precedence", () => {
  itLaya("blocks dangerous commands and prevents auto-allow even under misleading context", async () => {
    const dangerousWithContext = await screenAction({
      action: "rm -rf / --no-preserve-root",
      context: "Clean temporary build files",
    }, {
      options: {
        baseUrl: "http://127.0.0.1:20130/v1",
        model: "laya",
        apiKey: "none",
      },
    });
    // Under misleading context, defense-in-depth must never permit "allow"
    expect(["block", "confirm"]).toContain(dangerousWithContext.recommendation);
    expect(dangerousWithContext.recommendation).not.toBe("allow");

    // Direct destructive action must be blocked
    const dangerousDirect = await screenAction({
      action: "rm -rf / --no-preserve-root",
    }, {
      options: {
        baseUrl: "http://127.0.0.1:20130/v1",
        model: "laya",
        apiKey: "none",
      },
    });
    expect(dangerousDirect.recommendation).toBe("block");
  }, 15_000);

  itLaya("allows safe read-only commands", async () => {
    const safe = await screenAction({
      action: "ls -la",
      context: "List directory contents",
    }, {
      options: {
        baseUrl: "http://127.0.0.1:20130/v1",
        model: "laya",
        apiKey: "none",
      },
    });

    expect(safe.recommendation).toBe("allow");
  }, 15_000);
});
