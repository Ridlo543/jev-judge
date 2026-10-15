# Jev: Decision Model Runner and MCP Server

Model Context Protocol (MCP) server, CLI runner, and TypeScript SDK for TypeSafe Jev decision models. Designed for Claude Code, Oh My Pi (OMP), Cursor, Windsurf, Cline, and terminal workflows.

Compatible with any OpenAI-compatible endpoint or direct decision gateway.

---

## Architecture

Autoregressive chat models predict token sequences. When evaluating diffs, checking security boundaries, or choosing between architectural alternatives, chat models present specific failure modes:

- **Sycophancy and self-confirmation:** Models tend to approve changes they or similar models generated.
- **Uncalibrated confidence:** Models express certainty through tone rather than calibrated probability.
- **Latency and token overhead:** Writing paragraphs of rationale consumes context tokens and takes several seconds.

Jev models isolate classification and scoring into single-pass inferences:
- **Calibrated probabilities:** Returns numeric confidence intervals ($0.0 \dots 1.0$) mapped to historical test distributions.
- **Typed structs:** Returns structured decision objects without markdown preambles or conversational filler.
- **Latency:** Typical round trips complete in 400ms to 900ms.
- **Token density:** Tool responses average 120 tokens, reducing prompt token consumption by roughly 80% compared to chat responses.

---

## Terminal and TUI Output

Standard MCP servers often return raw JSON dumps that terminal interfaces format as deep collapsible trees. Jev includes a terminal card formatter that outputs aligned Markdown tables, clear badges (`✅`, `🟢`, `🟡`, `🛑`, `⚠️`), and execution timing.

### `jev_judge` (Multi-Criteria Evaluation)
```markdown
### ⚖️ Jev Judgment: ✅ TRUE (75.0% probability)

| Question / Metric  |      Verdict       | Prob / Conf |
| :----------------- | :----------------: | :---------: |
| **is_clean_code**  |      ✅ true       |    74.0%    |
| **quality_tier**   | `production_ready` |    82.0%    |

⏱️ *Latency: 1273ms · Model: opencode-free/jev-1.13-free*
```

### `jev_review` (Patch and Diff Review)
```markdown
### 🔍 Diff Review: 🟢 AUTO (Composite: 0.88 / 1.0)

- **Safe to Apply:** `true`
- **Decision Recommendation:** `auto`

| Rubric Metric    | Score (0..2) |
| :--------------- | :----------: |
| **Correctness**  |    `1.80`    |
| **Spec Match**   |    `1.90`    |
| **Test Gap**     |    `0.20`    |
| **Blast Radius** |    `0.30`    |
```

### `jev_gate` (Acceptance Verification)
```markdown
### 🚪 Acceptance Gate: 🟢 AUTO (Diff Quality: 0.92)
**Claims Audit:** 2/2 Verified · **Contradicted:** 0 · **All Verified:** YES

- ✅ **[VERIFIED]** Package version was incremented to 1.0.1
- ✅ **[VERIFIED]** All unit tests pass
```

### `jev_action_gate` (Command Safety Screening)
```markdown
### 🛡️ Action Safety Gate: 🛑 BLOCK (Risk: 2.85 / 3.0)

- **Action/Command:** `rm -rf / --no-preserve-root`
- **Recommendation:** **BLOCK**
- **Destructive Operation:** `YES`
- **Requires Human Escalation:** `YES`
- **Safety Analysis:** Destructive root recursive deletion detected
```

### `jev_decide` (Candidate Selection)
```markdown
### 🎯 Technical Decision: `postgresql_partitioned` (92.0% confidence)

- **Status:** 🎯 DECIDED · Selected: **postgresql_partitioned**

| Candidate                  | Requirement # |     Status      |
| :------------------------- | :-----------: | :-------------: |
| **postgresql_partitioned** |     Req 1     |  🟢 SUPPORTED   |
| **sqlite_in_memory**       |     Req 1     | 🛑 CONTRADICTED |
```

### `jev_verify` (Citation and Claim Verification)
```markdown
### 📋 Citation Verification: 2 Verified · 1 Contradicted · 0 Unsupported

- ✅ **[VERIFIED]** Bun is an all-in-one JavaScript runtime
- ❌ **[CONTRADICTED]** Python was conceived in the late 1880s
- ⚠️ **[UNSUPPORTED]** Rust was created by Graydon Hoare
```

---

## Tool Reference

### Coding and Gating
- `jev_review`: Scores git diffs against task requirements across four metrics (`correctness`, `spec_match`, `test_gap`, `blast_radius`), producing a composite score ($0.0 \dots 1.0$) and action (`auto | review | escalate`). Non-code diffs (markdown, CSS) automatically receive zero test gap penalty.
- `jev_gate`: Compares cumulative git diffs and test execution logs against declared completion claims. Contradicted claims trigger an `escalate` status.
- `jev_action_gate`: Screens terminal commands and file operations before execution, returning a risk score ($0 \dots 3$) and execution action (`allow | confirm | block`).

### Technical Research
- `jev_decide`: Evaluates 2 to 6 technical options against prioritized requirements and evidence, with escape hatches (`ask_user`, `investigate`, `none`).
- `jev_find`: Locates the most relevant candidate from a list and verifies whether a valid answer exists (`answered | unanswerable`).
- `jev_rerank`: Reorders candidate text items by semantic relevance without external vector databases.
- `jev_compare`: Compares two passages or specifications for agreement, contradiction, or independent facts, both overall and per aspect.

### Guardrails and Verification
- `jev_verify`: Verifies factual claims line by line against cited evidence text.
- `jev_screen`: Detects prompt injection, hidden instructions, and low-substance content in external input.
- `jev_extract`: Extracts verbatim field values from source text using regex candidate matching.
- `jev_audit`: Audits extracted field values against source documents for hallucinated, wrong, or missing data.

### Primitives
- `jev_judge`: Flexible evaluator accepting boolean questions, choices, numeric scores, or criteria maps.
- `jev_judge_batch`: Concurrent batch execution with rate limiting.
- `jev_noul`: Evaluates calibrated proposition probabilities ($0.0 \dots 1.0$).

---

## Setup and Integration

### Setup Wizard

Run the interactive setup command to configure client settings:

```bash
npx -y jev-judge setup
```

The command prompts for target client (Claude Code, Oh My Pi, Cursor, or workspace config), endpoint URL, model name, and API key.

### Oh My Pi (OMP)

Add to global configuration (`~/.omp/agent/mcp.json`):

```json
{
  "mcpServers": {
    "jev": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:Ridlo543/jev-judge", "mcp"],
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.com/v1",
        "JEV_MODEL": "opencode-free/jev-1.13-free",
        "JEV_API_KEY": "${ROUTER_API_KEY}"
      }
    }
  }
}
```

For sub-second startup without network checks, set `command` directly to the compiled binary (`jev-mcp.exe` or `jev-mcp-linux-x64`).

### Claude Code

Add via CLI:

```bash
claude mcp add jev -- npx -y github:Ridlo543/jev-judge mcp
```

Or add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "jev": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:Ridlo543/jev-judge", "mcp"],
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.com/v1",
        "JEV_MODEL": "opencode-free/jev-1.13-free",
        "JEV_API_KEY": "${ROUTER_API_KEY}"
      }
    }
  }
}
```

### Cursor and Windsurf

Add to `.cursor/mcp.json` or `.cline/mcp.json`:

```json
{
  "mcpServers": {
    "jev": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:Ridlo543/jev-judge", "mcp"],
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.com/v1",
        "JEV_MODEL": "opencode-free/jev-1.13-free",
        "JEV_API_KEY": "${ROUTER_API_KEY}"
      }
    }
  }
}
```

---

## CLI Usage

The standalone binary `jev` accepts direct CLI arguments and piped input:

```bash
# Boolean check (exit code 0 if true, 1 if false)
jev "rm -rf /tmp/cache/*" "Is this safe to run automatically?" --threshold 0.5

# Git diff review
git diff | jev review --stdin --request "Refactor auth middleware to use JWT"

# Acceptance gating before commit
git diff | jev gate --stdin \
  --request "Fix race condition in payment ledger" \
  --evidence test-results.log \
  --claim "All payment tests pass" \
  --claim "No uncommitted secrets"

# Categorization
jev -s "PostgreSQL connection pool exhausted" -c "network,database,client"

# JSON output for scripts
jev "SELECT * FROM users;" "Is this SQL?" --json
```

---

## Configuration Reference

Settings resolve in order of priority:
1. CLI flags (`--base-url`, `--api-key`, `--model`, `--protocol`, `--json`)
2. MCP client environment variables (`env` object in `.mcp.json`)
3. Project configuration file (`jev.config.json`)
4. Local environment file (`.env`)
5. System shell environment variables

| Variable | Description | Default |
|---|---|---|
| `JEV_BASE_URL` or `OPENAI_BASE_URL` | Provider endpoint URL | None |
| `JEV_API_KEY` or `OPENAI_API_KEY` | Provider API key | None |
| `JEV_MODEL` or `OPENAI_MODEL` | Decision model identifier | None |
| `JEV_PROTOCOL` | `chat-completions` or `typesafe-direct` | `chat-completions` |
| `JEV_OUTPUT_FORMAT` | `markdown` (formatted card) or `json` (clean JSON) | `markdown` |
| `JEV_TIMEOUT_MS` | Request deadline in milliseconds | `20000` |

---

## Binaries

Compiled standalone executables are published with each [GitHub Release](https://github.com/Ridlo543/jev-judge/releases):

| Platform | CLI (`jev`) | MCP Server (`jev-mcp`) |
|---|---|---|
| Windows x64 | `jev-windows-x64.exe` | `jev-mcp-windows-x64.exe` |
| Linux x64 | `jev-linux-x64` | `jev-mcp-linux-x64` |
| macOS Apple Silicon (arm64) | `jev-darwin-arm64` | `jev-mcp-darwin-arm64` |

---

## Test Suite

Run the automated test suite:

```bash
bun test
```

The suite covers 36 tests across 6 files:
- `test/formatter.test.ts`: Markdown card rendering, table alignment, badge mappings, and JSON cleanup
- `test/validation.test.ts`: Zod schema validation, argument type checks, and threshold boundary rules
- `test/coding.test.ts`: Review composite formulas, acceptance gating, and action screening
- `test/research.test.ts`: Option arbitration, semantic search, candidate reranking, and passage comparisons
- `test/guardrails.test.ts`: Citation verification, prompt injection detection, regex extraction, and record audits
- `test/judge.test.ts`: Core client normalization, multi-question rubrics, and concurrent batch evaluation

---

## License

MIT License. Copyright (c) 2026 TypeSafe Jev Decision Runner Contributors.
