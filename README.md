# SystemOne: Universal Decision Model Runner & MCP Server

[![Release](https://img.shields.io/github/v/release/Ridlo543/jev-judge?style=flat-square)](https://github.com/Ridlo543/jev-judge/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-green?style=flat-square)](https://github.com/Ridlo543/jev-judge/releases)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(29%2F29)-brightgreen?style=flat-square)](https://github.com/Ridlo543/jev-judge/actions)

Model Context Protocol (MCP) server, CLI runner, and TypeScript SDK for **System One Decision Models** (**Laya**, **Jev**, and OpenAI-compatible engines). Built for Claude Code, Oh My Pi (OMP), Cursor, Windsurf, Cline, and terminal workflows.

Works with any OpenAI-compatible endpoint, direct TypeSafe decision gateway, or local offline CPU inference.

---

## ⚡ Quickstart

### 1. Interactive Setup (Zero Install)
Run the setup wizard to configure your agent automatically:
```bash
npx -y -p systemone-judge systemone setup
```
The wizard auto-detects Claude Code, Oh My Pi, Cursor, or local workspaces and configures the connection.

### 2. Run MCP Server Directly
```bash
# In your .mcp.json or agent config:
npx -y -p systemone-judge systemone-mcp
```

### 3. One-Liner System Install (Standalone Binaries)
No Node.js or Bun runtime required.

**Linux & macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/Ridlo543/jev-judge/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/Ridlo543/jev-judge/main/install.ps1 | iex
```

---

## 🧠 Supported Engines: Jev & Laya

`jev-judge` supports two decision engines depending on your latency, privacy, and context length requirements:

| Engine | Execution Environment | Context Window | Typical Latency | Cost / Auth | Best Used For |
|---|---|---|---|---|---|
| **TypeSafe Jev** | Cloud / Router (OpenAI-compatible) | 16k–64k tokens | ~500ms–1.5s | Requires API key | Large diffs, multi-file code reviews, deep logic gating |
| **Laya** | **Local CPU** (via ONNX Runtime) | 512 tokens | **~300ms** | **100% Free & Offline** | Command safety gates, fast triage, assertion checks, offline workflows |

### Running with Laya (Local CPU)
When running locally with Laya, simply pass `--laya` or set `JEV_MODEL=laya`:
```bash
# Boolean assertion on local CPU (300ms, offline)
jev "1 + 1 = 2" "Is 1+1 equal to 2?" --laya

# Screen command before executing
jev "rm -rf /var/log/*" "Is this safe to run automatically?" --laya
```
*Note: If using Laya locally, start the local runner with `laya start` (or `node server.mjs` on port `20130`).*

---

## 🔌 Agent Integration (MCP Configuration)

### Claude Code (`~/.claude.json`)
```json
{
  "mcpServers": {
    "systemone": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "systemone-judge", "systemone-mcp"],
      "env": {
        "SYSTEMONE_BASE_URL": "https://api.openai.com/v1",
        "SYSTEMONE_MODEL": "systemone",
        "SYSTEMONE_API_KEY": "${API_KEY}"
      }
    }
  }
}
```

### Oh My Pi (`~/.omp/agent/mcp.json`)
```json
{
  "mcpServers": {
    "systemone": {
      "type": "stdio",
      "command": "systemone-mcp",
      "args": [],
      "env": {
        "JEV_BASE_URL": "http://127.0.0.1:20130/v1",
        "JEV_MODEL": "laya",
        "JEV_API_KEY": "none"
      }
    }
  }
}
```

### Cursor & Windsurf (`.cursor/mcp.json` or `.cline/mcp.json`)
```json
{
  "mcpServers": {
    "jev": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "systemone-judge", "systemone-mcp"],
      "env": {
        "JEV_BASE_URL": "https://api.openai.com/v1",
        "JEV_MODEL": "jev-latest",
        "JEV_API_KEY": "${JEV_API_KEY}"
      }
    }
  }
}
```

---

## 💻 CLI Usage & Deterministic Contracts

`jev` enforces strict input contracts: **files are strictly read from disk, inline strings are never mistaken for files, and `-` reads from standard input**.

### 1. Code Review (`jev review`)
Evaluates patch correctness, specification alignment, test coverage gaps, and blast radius:
```bash
# From file:
jev review -f path/to/changes.patch --request "Fix division by zero in math module"

# Piped from git:
git diff | jev review - --request "Refactor auth middleware to JWT"
```

### 2. Definition-of-Done Acceptance Gating (`jev gate`)
Verifies diff quality and audits completion claims against test output to prevent fake completion:
```bash
git diff | jev gate - \
  --request "Add connection pooling" \
  --evidence-file test-results.log \
  --claim "Unit tests pass with 100% coverage" \
  --claim "No secret keys logged"
```

### 3. Action Safety Screening
Evaluates command risk with defense-in-depth enforcement:
```bash
jev "rm -rf / --no-preserve-root" "Is this command destructive?" --laya
```

### 4. Categorical Classification
```bash
jev -s "PostgreSQL connection pool exhausted" -c "network,database,client"
```

---

## 🛠️ Tool Reference

By default, `systemone` exposes **8 core orthogonal tools** to eliminate cognitive ambiguity in agents (with `action_gate` and legacy `jev_*` supported as aliases):

| Tool | Category | Input | Output |
|---|---|---|---|
| `systemone_action_gate` | Safety | Action + Context | `allow` \| `confirm` \| `block`, risk score ($0..3$), prod impact |
| `systemone_review` | Coding | Diff + Task (+ Claims) | Rubric scores ($0..2$), composite, safe-to-apply verdict |
| `systemone_screen` | Guardrails | Text content | Prompt injection / jailbreak flags, substance score |
| `systemone_decide` | Research | Candidates + Priorities | Best option, requirement matrix, escape hatches |
| `systemone_verify` | Verification | Claims + Evidence | Verified / Contradicted / Unsupported line-by-line audit |
| `systemone_compare` | Research | Two passages / docs | `same_fact` \| `contradicts` \| `different_facts` |
| `systemone_find` | Research | Query + Candidates | Top relevant candidate, `answered` \| `partial` \| `absent` |
| `systemone_judge` | Universal | State + Questions | Calibrated probabilities, choices, and rubric scores |

*(Set `SYSTEMONE_TOOLS="all"` in environment to expose the extended 14-tool surface including regex field extractors).*

---

## 📊 Formatter Output Examples

### `systemone_review`
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

### `systemone_action_gate`
### 🛡️ Action Safety Gate: 🛑 BLOCK (Risk: 2.85 / 3.0)

- **Action/Command:** `rm -rf / --no-preserve-root`
- **Recommendation:** **BLOCK**
- **Destructive Operation:** `YES`
- **Requires Human Escalation:** `YES`
- **Safety Analysis:** Destructive root recursive deletion detected
```

---

## ⚙️ Configuration Hierarchy

Settings resolve in order of precedence:
1. Explicit CLI flags (`--base-url`, `--api-key`, `--model`, `--protocol`, `--laya`)
2. MCP client environment (`env` block in `.mcp.json`)
3. Local configuration file (`jev.config.json`)
4. Local `.env` file
5. System environment variables

| Environment Variable | Description | Default |
|---|---|---|
| `SYSTEMONE_BASE_URL` | Endpoint URL | `http://127.0.0.1:20130/v1` (if `--laya`), else required |
| `SYSTEMONE_MODEL` | Model ID (`systemone`, `laya`, `jev-latest`) | `laya` (if `--laya`), else required |
| `SYSTEMONE_API_KEY` | Provider API Key | `none` (if `--laya`), else required |
| `SYSTEMONE_PROTOCOL` | `chat-completions` or `typesafe-direct` | `chat-completions` |
| `SYSTEMONE_TIMEOUT_MS` | Request deadline in milliseconds | `35000` |
| `SYSTEMONE_TOOLS` | Exposed tool surface: `core` (8 tools) or `all` (14 tools) | `core` |

---

## 📦 Standalone Binaries

Download precompiled standalone binaries from [GitHub Releases](https://github.com/Ridlo543/jev-judge/releases):

- **Windows x64:** `jev-windows-x64.exe` & `jev-mcp-windows-x64.exe`
- **Linux x64:** `jev-linux-x64` & `jev-mcp-linux-x64`
- **Linux arm64:** `jev-linux-arm64` & `jev-mcp-linux-arm64`
- **macOS Apple Silicon (arm64):** `jev-darwin-arm64` & `jev-mcp-darwin-arm64`

---

## 🧪 Verification & Testing

Run the automated test suite:
```bash
bun test
```
Covers fail-closed Zod schemas, deterministic argument contracts, defensive truncation, calibration normalizations, and live inference regression suites.

---

## 📄 License

MIT License. Copyright (c) 2026 TypeSafe Jev Decision Runner Contributors.
