---
name: jev
description: Conventions for the Jev decision tools. Use for non-biased technical decisions (jev_decide), pre-execution command screening (jev_action_gate), git patch reviews (jev_review), final acceptance gating (jev_gate), claim verification (jev_verify), prompt injection screening (jev_screen), and calibrated truth probabilities (jev_noul).
mcpServers:
  jev:
    command: bun
    args: ["src/mcp.ts"]
---

# Jev Decision Tools

Fourteen tools built on TypeSafe's Jev model. They return typed judgments, ordinal rubric scores, and calibrated probabilities in ~400–800ms. The tools advise; you enforce engineering policy.

## The Three-Gate Cadence (Preventing Agent Paralysis)

Do NOT call Jev on every micro-edit, file read, or routine thought. Follow the Three-Gate Cadence:

```
[Agent Thinking / Planning]
       │
       ▼
[2+ Non-Trivial Architectural Choices?] ──(Yes)──► Call jev_decide (once)
       │ (No)
       ▼
[Agent Writes / Edits Code] (Run uninterrupted)
       │
       ▼
[About to Run Destructive Shell Command?] ─(Yes)──► Call jev_action_gate (rm, drop, git reset --hard)
       │ (Safe / Read-only)
       ▼
[Run Real Verification Checks / Tests] (bun test / npm test / cargo test)
       │
       ▼
[Definition of Done / Task Completion] ──────────► Call jev_gate (ONCE on cumulative diff vs test logs)
```

## Tool Selection Matrix

| Tool | When to USE | When to SKIP |
|---|---|---|
| `jev_decide` | Facing 2–6 architectural alternatives with empirical evidence and trade-offs | The choice is routine, trivial, or already specified by user |
| `jev_action_gate` | Before running potentially destructive commands (`rm`, `drop table`, `git reset --hard`) | Routine read-only checks (`ls`, `git status`, `cat`, reading files) |
| `jev_gate` | **Calling a task done:** evaluating git diff PLUS developer claims vs test logs | Routine work in progress where tests have not been executed |
| `jev_review` | Scoring a git diff on correctness, spec match, test gap, and blast radius | No code diff exists (use `jev_verify`) |
| `jev_verify` | A report, PR brief, or summary makes claims with cited document text | No evidence document exists to cross-check against |
| `jev_screen` | Placing fetched web text or pasted untrusted content into context window | Text is from trusted local project files |
| `jev_extract` | Extracting structured atoms (prices, versions, dates, IDs) with zero hallucination | Free-form prose that cannot be matched by candidate regex |
| `jev_audit` | Verifying model-extracted key-value pairs against source text | Value was already bounded verbatim by `jev_extract` |
| `jev_find` | Finding the single best hit by semantic meaning (files, lines, notes) | Exact regex or keyword match decides it deterministically (use grep/rg) |
| `jev_rerank` | Full ordering matters across a retrieval set | Only the single best hit is needed (use `jev_find`) |
| `jev_compare` | Comparing two passages for factual agreement, conflict, or different facts | Relationship between passages is already known |
| `jev_noul` | Calibrated probability (0.0 to 1.0) for a standalone proposition | Testing claims strictly against supplied evidence (use `jev_verify`) |
| `jev_judge` | Universal flexible decision primitive (Yes/No, choice, ordinal scale) | A specialized domain tool exists |
| `jev_judge_batch` | Concurrently evaluating multiple independent items in a queue | Single item judgment (use `jev_judge`) |

## Operational Policies & Fail-Closed Rules

1. **Verify Before Presenting:** Correct contradicted claims. Add real evidence logs for unsupported claims.
2. **Anti-Fake Done:** Never invent test logs or mock output to pass `jev_gate`. A contradicted claim (`verdict: "contradicted"`) is an immediate stop and escalate, not a footnote.
3. **Decide Once:** An `escaped: true` recommendation (`ask_user`, `investigate`, `none`) means pause and gather missing facts or ask the user—do not rephrase and retry.
4. **Documentation Diffs:** For non-code changes (markdown, docs, styling), test coverage gap is treated as negligible (0) so documentation updates are not falsely rejected.
