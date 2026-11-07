#!/usr/bin/env node
import * as fs from "node:fs";
import { judge, judgeBatch, type SimplifiedQuestionInput } from "./client";
import { resolveConfig } from "./config";
import { startMcpServer } from "./mcp";
import { runSetupWizard } from "./setup";
import { gatePatch, reviewDiff } from "./tools/coding";

function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36msystemone / s1 (Universal System One Decision Model CLI & MCP)\x1b[0m
Fast, calibrated decision model runner (Laya, Jev, and OpenAI-Compatible) for coding gating, diff reviews, and verification.

\x1b[1mUSAGE:\x1b[0m
  systemone <state> <question>                     Quick yes/no question
  systemone review -f <file> --request <text>       Review git diff / patch quality
  systemone gate -f <file> --evidence-file <log>   Gating before done (Anti-Fake Done)
  systemone [options]                              Advanced structured judgment
  (Aliases: 's1' and 'jev' are fully supported)

\x1b[1mSUBCOMMANDS:\x1b[0m
  mcp                        Run as Model Context Protocol (MCP) JSON-RPC stdio server
  setup                      Interactive wizard to configure MCP for Claude Code, OMP, Cursor, or workspace
  review                     Evaluate git diff / patch (correctness, spec match, test gap, blast radius)
  gate                       Gating verification: diff review + developer claims vs evidence (Anti-Fake Done)

\x1b[1mOPTIONS:\x1b[0m
  -s, --state <text>         State/content/code to evaluate
  -f, --file <path>          Read state from a file (e.g. diff, log, source)
  -q, --question <text>      Yes/No question to answer
  -c, --choice <options>     Comma-separated list of choice options (e.g. "bug,feature,docs")
  --score <levels>           Comma-separated rating scale (e.g. "trivial,minor,major,critical")
  --questions <json>          Multi-question JSON string or rubric
  --questions-file <path>     Read questions JSON from file
  --request <text>           Task specification / ticket description for review/gate
  --evidence <text>          Evidence log / test runner output for gate (use @path for file)
  --evidence-file <path>     Read evidence log directly from file
  --claim <claim>            Claim to verify in gate (can be repeated)
  --timeout <ms>             Request timeout in milliseconds (default: 35000)
  --laya                     Convenience flag for local Laya engine (http://127.0.0.1:20130)
  --json                     Output result as formatted JSON to stdout
  --raw                      Output raw unformatted JSON
  --quiet                    Output only the bare verdict (e.g. "true", "auto", "0.95")
  --threshold <float>        Probability threshold (default: 0.5). Exits 0 if >=, 1 if <
  --stdin                    Read state or diff from standard input
  --protocol <name>          Protocol: chat-completions (default) or typesafe-direct
  --model <name>             Model ID (defaults to SYSTEMONE_MODEL or JEV_MODEL)
  --base-url <url>           Endpoint URL (defaults to SYSTEMONE_BASE_URL or JEV_BASE_URL)
  --api-key <key>            API key (defaults to SYSTEMONE_API_KEY or JEV_API_KEY)
  -h, --help                 Show this help message

\x1b[1mEXAMPLES:\x1b[0m
  # Quick check (exit code 0 if yes, 1 if no):
  systemone "rm -rf /var/log/*" "Is this safe to run automatically?" --threshold 0.5

  # Pipe git diff for patch review:
  git diff | systemone review --request "Refactor auth middleware"

  # Acceptance gate before committing:
  git diff | systemone gate --request "Fix race condition" --evidence-file test.log --claim "unit tests pass"

  # Multi-choice categorization:
  systemone -s "PostgreSQL connection pool exhausted" -c "network,database,client"
`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const subCommand = args[0] === "review" || args[0] === "gate" || args[0] === "setup" || args[0] === "mcp" ? args[0] : null;
  const filteredArgs = subCommand ? args.slice(1) : args;

  let state: string | undefined;
  let question: string | undefined;
  let choice: string | undefined;
  let score: string | undefined;
  let questionsArg: string | undefined;
  let questionInput: SimplifiedQuestionInput | undefined;
  let filePath: string | undefined;
  let requestText: string | undefined;
  let evidenceText: string | undefined;
  const claims: string[] = [];
  let jsonOutput = false;
  let rawOutput = false;
  let quietOutput = false;
  let threshold = 0.5;
  let useStdin = false;
  let batchMode = false;

  let explicitApiKey: string | undefined;
  let explicitBaseUrl: string | undefined;
  let explicitModel: string | undefined;
  let explicitProtocol: string | undefined;
  let explicitTimeout: number | undefined;

  const positional: string[] = [];

  for (let i = 0; i < filteredArgs.length; i++) {
    const arg = filteredArgs[i];

    if (arg === "-s" || arg === "--state") {
      state = filteredArgs[++i];
    } else if (arg === "-f" || arg === "--file") {
      filePath = filteredArgs[++i];
    } else if (arg === "--diff") {
      const val = filteredArgs[++i];
      if (val === "-") {
        useStdin = true;
      } else if (fs.existsSync(val)) {
        filePath = val;
      } else if (val && (val.includes("\n") || val.startsWith("diff --git") || val.startsWith("Index: ") || val.startsWith("--- "))) {
        state = val;
      } else {
        console.error(`\x1b[31mError: Diff file not found: ${val}\x1b[0m`);
        process.exit(1);
      }
    } else if (arg === "-q" || arg === "--question") {
      question = filteredArgs[++i];
    } else if (arg === "-c" || arg === "--choice") {
      choice = filteredArgs[++i];
    } else if (arg === "--score") {
      score = filteredArgs[++i];
    } else if (arg === "--questions") {
      questionsArg = filteredArgs[++i];
    } else if (arg === "--request") {
      requestText = filteredArgs[++i];
    } else if (arg === "--evidence") {
      const ev = filteredArgs[++i];
      if (ev.startsWith("@")) {
        const evPath = ev.slice(1);
        if (!fs.existsSync(evPath)) {
          console.error(`\x1b[31mError: Evidence file not found: ${evPath}\x1b[0m`);
          process.exit(1);
        }
        evidenceText = fs.readFileSync(evPath, "utf8");
      } else if (fs.existsSync(ev)) {
        evidenceText = fs.readFileSync(ev, "utf8");
      } else if (ev && (ev.endsWith(".log") || ev.endsWith(".txt") || ev.endsWith(".json") || ev.includes("/") || ev.includes("\\"))) {
        console.error(`\x1b[31mError: Evidence file not found: ${ev}\x1b[0m`);
        process.exit(1);
      } else {
        evidenceText = ev;
      }
    } else if (arg === "--evidence-file") {
      const evPath = filteredArgs[++i];
      if (!fs.existsSync(evPath)) {
        console.error(`\x1b[31mError: Evidence file not found: ${evPath}\x1b[0m`);
        process.exit(1);
      }
      evidenceText = fs.readFileSync(evPath, "utf8");
    } else if (arg === "--questions-file") {
      const qPath = filteredArgs[++i];
      if (!fs.existsSync(qPath)) {
        console.error(`\x1b[31mError: Questions file not found: ${qPath}\x1b[0m`);
        process.exit(1);
      }
      try {
        questionInput = JSON.parse(fs.readFileSync(qPath, "utf8"));
      } catch (err) {
        console.error(`\x1b[31mError parsing questions JSON file: ${String(err)}\x1b[0m`);
        process.exit(1);
      }
    } else if (arg === "--laya") {
      explicitModel = "laya";
      if (!explicitBaseUrl) explicitBaseUrl = "http://127.0.0.1:20130/v1";
      if (!explicitApiKey) explicitApiKey = "none";
    } else if (arg === "--claim") {
      claims.push(filteredArgs[++i]);
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--raw") {
      rawOutput = true;
    } else if (arg === "--quiet") {
      quietOutput = true;
    } else if (arg === "--threshold") {
      threshold = Number.parseFloat(filteredArgs[++i]);
    } else if (arg === "--timeout") {
      explicitTimeout = Number.parseInt(filteredArgs[++i], 10);
    } else if (arg === "--stdin") {
      useStdin = true;
    } else if (arg === "--batch") {
      batchMode = true;
    } else if (arg === "--api-key") {
      explicitApiKey = filteredArgs[++i];
    } else if (arg === "--base-url") {
      explicitBaseUrl = filteredArgs[++i];
    } else if (arg === "--model") {
      explicitModel = filteredArgs[++i];
    } else if (arg === "--protocol") {
      explicitProtocol = filteredArgs[++i];
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  // Subcommand: mcp (runs as MCP server, takes ownership of stdin immediately)
  if (subCommand === "mcp") {
    await startMcpServer();
    return;
  }

  // Handle stdin
  if (useStdin || (!state && !filePath && positional.length === 0 && !process.stdin.isTTY)) {
    const piped = await readStdin();
    if (piped.trim().length > 0) {
      state = piped;
    }
  } else if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`\x1b[31mError: File not found: ${filePath}\x1b[0m`);
      process.exit(1);
    }
    state = fs.readFileSync(filePath, "utf8");
  }

  const clientOptions = {
    apiKey: explicitApiKey,
    baseUrl: explicitBaseUrl,
    model: explicitModel,
    protocol: explicitProtocol as any,
    timeoutMs: explicitTimeout,
    defaultThreshold: threshold,
  };

  if (subCommand === "setup") {
    let targetClient: any;
    let isGlobal = false;
    for (let i = 0; i < filteredArgs.length; i++) {
      if (filteredArgs[i] === "--client" && filteredArgs[i + 1]) {
        targetClient = filteredArgs[++i];
      } else if (filteredArgs[i] === "--global") {
        isGlobal = true;
      }
    }
    await runSetupWizard({
      client: targetClient,
      baseUrl: explicitBaseUrl,
      apiKey: explicitApiKey,
      model: explicitModel,
      global: isGlobal,
    });
    process.exit(0);
  }

  // Subcommand: review
  if (subCommand === "review") {
    let diff = state;
    let req = requestText;

    if (!diff && positional.length > 0) {
      const pos = positional[0];
      if (pos === "-") {
        diff = await readStdin();
      } else if (fs.existsSync(pos)) {
        diff = fs.readFileSync(pos, "utf8");
      } else if (pos.includes("\n") || pos.startsWith("diff --git") || pos.startsWith("Index: ") || pos.startsWith("--- ")) {
        diff = pos;
      } else {
        console.error(`\x1b[31mError: Diff file not found: ${pos}\x1b[0m`);
        process.exit(1);
      }
      req = req || positional[1];
    }
    req = req || "Review code patch for correctness, security, and quality";

    if (!diff) {
      console.error("\x1b[31mError: Missing diff for review. Pipe via --stdin, pass as positional argument, or provide --file.\x1b[0m");
      process.exit(1);
    }
    const res = await reviewDiff({ diff, request: req }, { options: clientOptions });
    if (jsonOutput || rawOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else if (quietOutput) {
      console.log(res.action);
    } else {
      console.log(`\n\x1b[1mPatch Review Verdict:\x1b[0m \x1b[36m${res.action.toUpperCase()}\x1b[0m (Composite: ${res.composite}/1.0)`);
      console.log(`  - Correctness: ${res.scores.correctness}/2.0`);
      console.log(`  - Spec Match:  ${res.scores.spec_match}/2.0`);
      console.log(`  - Test Gap:    ${res.scores.test_gap}/2.0`);
      console.log(`  - Blast Radius:${res.scores.blast_radius}/2.0`);
      console.log(`  - Safe to Apply: ${res.safe_to_apply >= res.thresholds.auto_accept ? "YES" : "NO"} (${(res.safe_to_apply * 100).toFixed(0)}%)`);
    }
    process.exit(res.action === "escalate" ? 1 : 0);
  }

  // Subcommand: gate
  if (subCommand === "gate") {
    let diff = state;
    let req = requestText;

    if (!diff && positional.length > 0) {
      const pos = positional[0];
      if (pos === "-") {
        diff = await readStdin();
      } else if (fs.existsSync(pos)) {
        diff = fs.readFileSync(pos, "utf8");
      } else if (pos.includes("\n") || pos.startsWith("diff --git") || pos.startsWith("Index: ") || pos.startsWith("--- ")) {
        diff = pos;
      } else {
        console.error(`\x1b[31mError: Diff file not found: ${pos}\x1b[0m`);
        process.exit(1);
      }
      req = req || positional[1];
    }
    req = req || "Verify acceptance criteria";
    const evidence = evidenceText || "";

    if (!diff) {
      console.error("\x1b[31mError: Missing diff for gate. Pipe via --stdin, pass as positional argument, or provide --file.\x1b[0m");
      process.exit(1);
    }
    const res = await gatePatch({ diff, request: req, claims, evidence }, { options: clientOptions });
    if (jsonOutput || rawOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else if (quietOutput) {
      console.log(res.action);
    } else {
      console.log(`\n\x1b[1mAcceptance Gate Verdict:\x1b[0m \x1b[36m${res.action.toUpperCase()}\x1b[0m (Composite: ${res.composite}/1.0)`);
      console.log(`  - Claims Verified: ${res.all_claims_verified ? "YES" : "NO"} (${res.claims.length - res.contradicted_count}/${res.claims.length})`);
      if (res.claims.length > 0) {
        for (const c of res.claims) {
          const color = c.verdict === "verified" ? "\x1b[32m" : c.verdict === "contradicted" ? "\x1b[31m" : "\x1b[33m";
          console.log(`    * [${color}${c.verdict.toUpperCase()}\x1b[0m] ${c.claim}`);
        }
      }
    }
    process.exit(res.action === "escalate" ? 1 : 0);
  }

  // Positional fallback for quick call: jev <state> <question>
  if (!state && positional.length > 0) {
    state = positional[0];
    if (positional.length > 1 && !question && !choice && !score && !questionsArg) {
      question = positional.slice(1).join(" ");
    }
  }

  if (!state) {
    console.error("\x1b[31mError: Missing state to evaluate. Use -s, -f, or --stdin.\x1b[0m");
    process.exit(1);
  }

  if (!questionInput) {
    if (questionsArg) {
      if (questionsArg.startsWith("@")) {
        const qPath = questionsArg.slice(1);
        if (!fs.existsSync(qPath)) {
          console.error(`\x1b[31mError: Questions file not found: ${qPath}\x1b[0m`);
          process.exit(1);
        }
        try {
          questionInput = JSON.parse(fs.readFileSync(qPath, "utf8"));
        } catch (err) {
          console.error(`\x1b[31mError parsing questions JSON file: ${String(err)}\x1b[0m`);
          process.exit(1);
        }
      } else if (fs.existsSync(questionsArg)) {
        try {
          questionInput = JSON.parse(fs.readFileSync(questionsArg, "utf8"));
        } catch (err) {
          console.error(`\x1b[31mError parsing questions JSON file: ${String(err)}\x1b[0m`);
          process.exit(1);
        }
      } else if (questionsArg.endsWith(".json") || questionsArg.includes("/") || questionsArg.includes("\\")) {
        console.error(`\x1b[31mError: Questions file not found: ${questionsArg}\x1b[0m`);
        process.exit(1);
      } else {
        try {
          questionInput = JSON.parse(questionsArg);
        } catch {
          questionInput = questionsArg;
        }
      }
    } else if (choice) {
      const options = choice.split(",").map((s) => s.trim()).filter(Boolean);
      questionInput = {
        type: "choice",
        instructions: question || "Choose the best option:",
        options,
      };
    } else if (score) {
      const levels = score.split(",").map((s) => s.trim()).filter(Boolean);
      questionInput = {
        type: "score",
        instructions: question || "Rate the level:",
        levels,
      };
    } else if (question) {
      questionInput = question;
    } else {
      questionInput = "Is this true and valid?";
    }
  }

  const res = await judge(state, questionInput || "Is this true and valid?", clientOptions);

  if (rawOutput) {
    console.log(JSON.stringify(res.raw));
    process.exit(0);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (quietOutput) {
    console.log(String(res.verdict));
    if (typeof res.verdict === "boolean") {
      process.exit(res.verdict ? 0 : 1);
    }
    process.exit(0);
  }

  console.log(`\n\x1b[1mVerdict:\x1b[0m \x1b[36m${String(res.verdict)}\x1b[0m`);
  if (res.probability !== undefined) {
    console.log(`\x1b[1mProbability:\x1b[0m ${(res.probability * 100).toFixed(1)}%`);
  }
  if (res.confidence !== undefined) {
    console.log(`\x1b[1mConfidence:\x1b[0m ${(res.confidence * 100).toFixed(1)}%`);
  }

  if (typeof res.verdict === "boolean") {
    process.exit(res.verdict ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(`\x1b[31mExecution error: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});
