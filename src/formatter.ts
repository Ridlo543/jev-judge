/**
 * Universal Jev Output Formatter Engine (Component-Based Clean Architecture)
 *
 * Implements reusable layout primitives:
 * - TableBuilder: Clean, auto-aligned Markdown tables
 * - BadgeEngine: Unified semantic status badges (Success, Warning, Danger, Info)
 * - CardLayout: Standardized visual card hierarchy (Banner, Summary, Table, Checklist, Footer)
 *
 * Zero hardcoded magic strings or thresholds: displays actual metric keys,
 * calibrated numbers, and real model explanations.
 */

export type OutputFormat = "markdown" | "markdown-verbose" | "json";

// --------------------------------------------------------------------------
// 1. Reusable TUI / Markdown Layout Primitives
// --------------------------------------------------------------------------

export interface TableColumn {
  header: string;
  align?: "left" | "center" | "right";
}

export interface TableOptions {
  columns: TableColumn[];
  rows: (string | number | boolean | null | undefined)[][];
}

/**
 * Calculates visual display width of a string in monospace terminals.
 * Emojis and full-width symbols occupy 2 terminal columns.
 */
function visualWidth(str: string): number {
  const stripped = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
  let width = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x1f300 && code <= 0x1faff) || (code >= 0x2600 && code <= 0x27bf)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padCell(str: string, targetWidth: number, align: "left" | "center" | "right" = "left"): string {
  const w = visualWidth(str);
  const diff = Math.max(0, targetWidth - w);
  if (align === "center") {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return " ".repeat(left) + str + " ".repeat(right);
  }
  if (align === "right") {
    return " ".repeat(diff) + str;
  }
  return str + " ".repeat(diff);
}

/**
 * Builds an aligned Markdown table with per-column padding for terminal TUI and CLI.
 */
export function renderTable(options: TableOptions): string {
  const { columns, rows } = options;
  if (columns.length === 0 || rows.length === 0) return "";

  const formattedRows = rows.map((row) =>
    columns.map((_, i) => {
      const val = row[i];
      if (val === null || val === undefined) return "—";
      return escapeCell(String(val));
    })
  );

  const colWidths = columns.map((col, i) => {
    const headerW = visualWidth(col.header);
    const maxRowW = Math.max(0, ...formattedRows.map((r) => visualWidth(r[i] ?? "")));
    return Math.max(headerW, maxRowW, 3);
  });

  const headerLine = `| ${columns
    .map((c, i) => padCell(c.header, colWidths[i], c.align || "left"))
    .join(" | ")} |`;

  const separatorLine = `| ${columns
    .map((c, i) => {
      const w = colWidths[i];
      switch (c.align) {
        case "center":
          return `:${"-".repeat(Math.max(1, w - 2))}:`;
        case "right":
          return `${"-".repeat(Math.max(2, w - 1))}:`;
        default:
          return `:${"-".repeat(Math.max(2, w - 1))}`;
      }
    })
    .join(" | ")} |`;

  const bodyLines = formattedRows.map(
    (row) =>
      `| ${row
        .map((cell, i) => padCell(cell, colWidths[i], columns[i].align || "left"))
        .join(" | ")} |`
  );

  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

/**
 * Universal Semantic Badge Engine.
 * Converts raw domain values into standardized visual badges without magic copy.
 */
export function renderBadge(value: unknown): string {
  const noEmoji = process.env.NO_EMOJI === "1";

  if (typeof value === "boolean") {
    if (noEmoji) return value ? "[TRUE]" : "[FALSE]";
    return value ? "✅ [TRUE]" : "🛑 [FALSE]";
  }

  if (typeof value === "number") {
    if (value >= 0 && value <= 1) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return value.toFixed(2);
  }

  const str = String(value ?? "").trim();
  const lower = str.toLowerCase();
  const tag = str.toUpperCase();

  // Success states
  if (["auto", "allow", "pass", "ok", "verified", "supported", "same_fact", "answered"].includes(lower)) {
    if (noEmoji) return `[${tag}]`;
    const icon = lower === "allow" ? "🛡️" : lower === "verified" || lower === "ok" ? "✅" : "🟢";
    return `${icon} [${tag}]`;
  }

  // Danger / Escalation states
  if (["escalate", "block", "contradicted", "wrong", "hallucinated", "unanswerable"].includes(lower)) {
    if (noEmoji) return `[${tag}]`;
    const icon = lower === "contradicted" || lower === "wrong" ? "❌" : "🛑";
    return `${icon} [${tag}]`;
  }

  // Warning / Review states
  if (["review", "confirm", "unsupported", "uncertain", "missing", "different_facts"].includes(lower)) {
    if (noEmoji) return `[${tag}]`;
    const icon = lower === "confirm" || lower === "unsupported" ? "⚠️" : "🟡";
    return `${icon} [${tag}]`;
  }

  // Neutral / Code label
  return `\`${str}\``;
}

export interface CardSection {
  title: string;
  lines: string[];
}

export interface CardOptions {
  icon: string;
  title: string;
  badge?: string;
  summary?: Array<{ label: string; value: string | number | boolean }>;
  table?: TableOptions;
  checklist?: Array<{ status: "verified" | "contradicted" | "unsupported" | string; text: string }>;
  details?: string[];
  sections?: CardSection[];
  footer?: { latencyMs?: number; model?: string };
}
/**
 * Standardized Visual Card Renderer for Terminal TUI & Markdown.
 */
export function renderCard(card: CardOptions): string {
  const lines: string[] = [];

  // Header Banner
  const badgePart = card.badge ? `: ${card.badge}` : "";
  lines.push(`### ${card.icon} ${card.title}${badgePart}`.trim());

  // Summary Metrics
  if (card.summary && card.summary.length > 0) {
    const summaryParts = card.summary.map(
      (s) => `**${s.label}:** ${typeof s.value === "boolean" ? (s.value ? "`true`" : "`false`") : s.value}`
    );
    lines.push(summaryParts.join(" · "));
  }

  lines.push("");

  // Detailed Key-Value lines
  if (card.details && card.details.length > 0) {
    for (const d of card.details) {
      lines.push(d.startsWith("-") ? d : `- ${d}`);
    }
    lines.push("");
  }

  // Checklist
  if (card.checklist && card.checklist.length > 0) {
    for (const item of card.checklist) {
      const lower = item.status.toLowerCase();
      const icon = lower === "verified" || lower === "ok" || lower === "supported" ? "✅" : lower === "contradicted" || lower === "wrong" ? "❌" : "⚠️";
      lines.push(`- ${icon} **[${item.status.toUpperCase()}]** ${item.text}`);
    }
    lines.push("");
  }

  // Table
  if (card.table && card.table.rows.length > 0) {
    lines.push(renderTable(card.table));
    lines.push("");
  }

  // Structured Detail Sections
  if (card.sections && card.sections.length > 0) {
    for (const sec of card.sections) {
      lines.push(`#### ${sec.title}`);
      lines.push("");
      for (const line of sec.lines) {
        lines.push(line);
      }
      lines.push("");
    }
  }

  // Subdued Execution Footer
  if (card.footer) {
    const parts: string[] = [];
    if (card.footer.latencyMs !== undefined) parts.push(`Latency: ${card.footer.latencyMs}ms`);
    if (card.footer.model) parts.push(`Model: ${card.footer.model}`);
    if (parts.length > 0) {
      lines.push(`⏱️ *${parts.join(" · ")}*`);
    }
  }

  return lines.join("\n").trim();
}

// --------------------------------------------------------------------------
// 2. Data Cleaner (Zero Duplication in JSON Mode)
// --------------------------------------------------------------------------

/**
 * Strips duplicate and bloated internal fields from JSON results before output.
 */
export function stripInternalMetadata(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(stripInternalMetadata);
  }

  const record = { ...(obj as Record<string, unknown>) };

  // Remove redundant raw.answers that duplicates top-level answers
  if (record.raw && typeof record.raw === "object") {
    const rawObj = { ...(record.raw as Record<string, unknown>) };
    delete rawObj.answers;
    record.raw = rawObj;
  }

  // Remove client metadata
  delete record._meta;

  for (const [key, val] of Object.entries(record)) {
    if (typeof val === "object" && val !== null) {
      record[key] = stripInternalMetadata(val);
    }
  }

  return record;
}

// --------------------------------------------------------------------------
// 3. Declarative View Adapters
// --------------------------------------------------------------------------

/**
 * Main dispatcher to format any Jev tool result.
 */
export function formatToolResult(
  toolName: string,
  data: unknown,
  format: OutputFormat = "markdown",
): string {
  if (format === "json") {
    const cleaned = stripInternalMetadata(data);
    return JSON.stringify(cleaned, null, 2);
  }

  try {
    switch (toolName) {
      case "jev_judge":
        return formatJudgeResult(data, format);
      case "jev_judge_batch":
        return formatBatchJudgeResult(data);
      case "jev_noul":
        return formatNoulResult(data);
      case "jev_review":
      case "jev_review_patch":
        return formatReviewResult(data);
      case "jev_gate":
      case "jev_gate_acceptance":
        return formatGateResult(data);
      case "jev_action_gate":
      case "jev_gate_command":
        return formatActionGateResult(data);
      case "jev_decide":
      case "jev_arbitrate_decision":
        return formatDecideResult(data, format);
      case "jev_find":
      case "jev_semantic_select":
        return formatFindResult(data);
      case "jev_rerank":
      case "jev_rank_relevance":
        return formatRerankResult(data);
      case "jev_compare":
      case "jev_compare_passages":
        return formatCompareResult(data);
      case "jev_verify":
      case "jev_fact_check_citations":
        return formatVerifyResult(data);
      case "jev_screen":
      case "jev_screen_prompt_injection":
        return formatScreenResult(data);
      case "jev_extract":
      case "jev_extract_verbatim_regex":
        return formatExtractResult(data);
      case "jev_audit":
      case "jev_audit_extracted_records":
        return formatAuditResult(data);
      default:
        return formatGenericResult(toolName, data);
    }
  } catch {
    // Fail-closed fallback: return clean JSON if markdown formatting encounters unexpected shapes
    return JSON.stringify(stripInternalMetadata(data), null, 2);
  }
}

function formatJudgeResult(res: any, format: OutputFormat = "markdown"): string {
  if (!res || typeof res !== "object") return String(res);

  const verdict = res.verdict;
  const isBool = typeof verdict === "boolean";
  const badge = renderBadge(verdict);

  const probText =
    res.probability !== undefined
      ? `(${(res.probability * 100).toFixed(1)}% probability)`
      : res.confidence !== undefined
        ? `(${(res.confidence * 100).toFixed(1)}% confidence)`
        : "";

  const verdicts = res.verdicts && typeof res.verdicts === "object" ? res.verdicts : {};
  const keys = Object.keys(verdicts);

  let table: TableOptions | undefined;
  const details: string[] = [];
  const sections: CardSection[] = [];
  const answers = res.answers && typeof res.answers === "object" ? res.answers : {};

  if (keys.length > 1) {
    table = {
      columns: [
        { header: "Question / Metric", align: "left" },
        { header: "Verdict", align: "center" },
        { header: "Conf / Score", align: "center" },
        { header: "Meaning / Level", align: "left" },
      ],
      rows: keys.map((key) => {
        const v = verdicts[key];
        const p = res.probabilities?.[key];
        const ans = answers[key] as any;
        const pStr = p !== undefined ? `${(p * 100).toFixed(1)}%` : "—";

        let meaning = "—";
        if (ans?.type === "score") {
          const rounded = Math.round(ans.score);
          const desc = ans.legend?.[String(rounded)] || ans.legend?.[rounded];
          meaning = desc ? `${desc} (${ans.score.toFixed(2)})` : `${ans.score.toFixed(2)}`;
        } else if (ans?.type === "choice" && ans.probabilities) {
          const sorted = Object.entries(ans.probabilities as Record<string, number>).sort(([, a], [, b]) => b - a);
          if (sorted.length > 1) {
            meaning = `${(sorted[0][1] * 100).toFixed(0)}% vs ${(sorted[1][1] * 100).toFixed(0)}% runner-up`;
          } else {
            meaning = "Clear choice";
          }
        } else if (typeof v === "boolean") {
          meaning = v ? "High confidence" : "Rejected";
        }

        return [`**${key}**`, renderBadge(v), pStr, meaning];
      }),
    };
  } else if (keys.length === 1) {
    const key = keys[0];
    const ans = answers[key] as any;
    const qObj = res.questions?.[key] as any;
    if (qObj?.instructions) {
      details.push(`- **Prompt:** *"${escapeCell(qObj.instructions)}"*`);
    }
    details.push(`- **Criterion:** \`${key}\``);
    details.push(`- **Verdict:** \`${String(verdicts[key])}\``);
    if (res.probability !== undefined) {
      details.push(`- **Calibrated Probability:** ${(res.probability * 100).toFixed(1)}%`);
    } else if (res.confidence !== undefined) {
      details.push(`- **Confidence Score:** ${(res.confidence * 100).toFixed(1)}%`);
    }
    if (ans?.type === "score" && ans.legend) {
      const legendStr = Object.entries(ans.legend)
        .map(([lvl, desc]) => `${lvl}: ${desc}`)
        .join(" → ");
      details.push(`- **Scale Legend:** \`${legendStr}\``);
    }
  }

  // Detailed Distribution Breakdown (Zero Information Loss)
  const breakdownLines: string[] = [];
  for (const [key, ans] of Object.entries(answers)) {
    if (!ans || typeof ans !== "object") continue;
    const answer = ans as any;
    const qObj = res.questions?.[key] as any;

    breakdownLines.push(`- **${key}:**`);
    if (qObj?.instructions) {
      breakdownLines.push(`  - Prompt: *"${escapeCell(qObj.instructions)}"*`);
    }

    if (answer.type === "choice") {
      breakdownLines.push(`  - Selected: **${answer.choice}** (Confidence: ${(answer.confidence * 100).toFixed(1)}%)`);
      if (answer.probabilities && typeof answer.probabilities === "object") {
        breakdownLines.push(`  - Candidate Probability Spread:`);
        const sorted = Object.entries(answer.probabilities as Record<string, number>).sort(
          ([, a], [, b]) => b - a
        );
        for (const [opt, p] of sorted) {
          const isWinner = opt === answer.choice ? " 🏆 (Winner)" : "";
          breakdownLines.push(`    * \`${opt}\`: **${(p * 100).toFixed(1)}%**${isWinner}`);
        }
      }
    } else if (answer.type === "score") {
      const maxScore = answer.legend ? Object.keys(answer.legend).length - 1 : undefined;
      const scaleStr = maxScore !== undefined ? ` / ${maxScore}.0` : "";
      const confStr = answer.confidence !== undefined ? `${(answer.confidence * 100).toFixed(1)}%` : "—";
      breakdownLines.push(`  - Score: **\`${answer.score.toFixed(2)}\`${scaleStr}** (Confidence: ${confStr})`);
      if (answer.legend && typeof answer.legend === "object") {
        const legendStr = Object.entries(answer.legend)
          .map(([lvl, desc]) => `${lvl}: ${desc}`)
          .join(" → ");
        breakdownLines.push(`  - Scale Legend: \`${legendStr}\``);
      }
      if (answer.probabilities && typeof answer.probabilities === "object") {
        breakdownLines.push(`  - Rating Distribution:`);
        const sorted = Object.entries(answer.probabilities as Record<string, number>).sort(
          ([, a], [, b]) => b - a
        );
        for (const [lvl, p] of sorted) {
          const desc = answer.legend?.[lvl] ? ` (${answer.legend[lvl]})` : "";
          breakdownLines.push(`    * Level ${lvl}${desc}: **${(p * 100).toFixed(1)}%**`);
        }
      }
    } else if (answer.type === "noul") {
      const prob = answer.noul !== undefined ? `${(answer.noul * 100).toFixed(1)}%` : "—";
      const lbl = answer.noul >= 0.7 ? "Likely true" : answer.noul <= 0.3 ? "Unlikely" : "Uncertain";
      if (qObj?.criteria && typeof qObj.criteria === "object") {
        if (qObj.criteria.true || qObj.criteria.false) {
          breakdownLines.push(`  - Evaluated Criteria:`);
          if (qObj.criteria.true) breakdownLines.push(`    * [TRUE]: *"${escapeCell(qObj.criteria.true)}"*`);
          if (qObj.criteria.false) breakdownLines.push(`    * [FALSE]: *"${escapeCell(qObj.criteria.false)}"*`);
        }
      }
      breakdownLines.push(`  - Result: **${renderBadge(answer.noul >= 0.5)}** (Calibrated Probability: \`${prob}\` · ${lbl})`);
    }
  }

  if (breakdownLines.length > 0) {
    sections.push({
      title: "Detailed Breakdown & Semantic Criteria",
      lines: breakdownLines,
    });
  }

  if (res.state) {
    const stateStr = typeof res.state === "string" ? res.state : JSON.stringify(res.state);
    details.unshift(`- **Evaluated Subject:** *"${escapeCell(truncate(stateStr, 140))}"*`);
  }

  return renderCard({
    icon: "⚖️",
    title: "Jev Judgment",
    badge: `${badge} ${probText}`.trim(),
    table,
    details: details.length > 0 ? details : undefined,
    sections: format === "markdown-verbose" && sections.length > 0 ? sections : undefined,
    footer: {
      latencyMs: res.raw?.durationMs,
      model: res.raw?.model,
    },
  });
}

function formatBatchJudgeResult(res: any): string {
  if (!Array.isArray(res)) return formatGenericResult("jev_judge_batch", res);

  const total = res.length;
  const successful = res.filter((item) => item.success).length;

  return renderCard({
    icon: "⚖️",
    title: "Jev Batch Judgment",
    badge: `${successful}/${total} Succeeded`,
    table: {
      columns: [
        { header: "ID", align: "left" },
        { header: "Verdict", align: "center" },
        { header: "Prob / Conf", align: "center" },
        { header: "Status", align: "center" },
      ],
      rows: res.map((item) => {
        const id = item.id || "—";
        if (!item.success) {
          return [`**${id}**`, "—", "—", `❌ ${item.error || "Failed"}`];
        }
        const r = item.response;
        const v = r?.verdict;
        const p = r?.probability ?? r?.confidence;
        const pStr = p !== undefined ? `${(p * 100).toFixed(1)}%` : "—";
        return [`**${id}**`, renderBadge(v), pStr, "✅ OK"];
      }),
    },
  });
}

function formatNoulResult(res: any): string {
  const results = Array.isArray(res?.results) ? res.results : [];

  return renderCard({
    icon: "🎲",
    title: "Jev Probability Calibration",
    badge: `${results.length} Proposition(s)`,
    table: {
      columns: [
        { header: "Proposition", align: "left" },
        { header: "Probability", align: "center" },
        { header: "Likelihood", align: "center" },
      ],
      rows: results.map((item: any) => {
        const prob = typeof item.probability === "number" ? `${(item.probability * 100).toFixed(1)}%` : "—";
        const label = item.label || (item.probability >= 0.7 ? "likely" : item.probability <= 0.3 ? "unlikely" : "uncertain");
        return [item.proposition || "—", `**${prob}**`, renderBadge(label)];
      }),
    },
  });
}

function formatReviewResult(res: any): string {
  if (Array.isArray(res?.claims) && res.claims.length > 0) {
    return formatGateResult(res);
  }

  const action = (res?.action || "review").toUpperCase();
  const badge = renderBadge(res?.action || "review");
  const composite = typeof res?.composite === "number" ? res.composite.toFixed(2) : "—";
  const scores = res?.scores || {};
  const scoreKeys = Object.keys(scores);

  const table: TableOptions | undefined =
    scoreKeys.length > 0
      ? {
          columns: [
            { header: "Rubric Metric", align: "left" },
            { header: "Score (0..2)", align: "center" },
          ],
          rows: scoreKeys.map((k) => {
            const val = scores[k];
            const num = typeof val === "number" ? val.toFixed(2) : String(val);
            const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return [`**${label}**`, `\`${num}\``];
          }),
        }
      : undefined;

  return renderCard({
    icon: "🔍",
    title: "Diff Review",
    badge: `${badge} (Composite: ${composite} / 1.0)`,
    details: [
      `**Safe to Apply:** \`${res?.safe_to_apply ? "true" : "false"}\``,
      `**Decision Recommendation:** \`${action.toLowerCase()}\``,
    ],
    table,
  });
}

function formatGateResult(res: any): string {
  const badge = renderBadge(res?.action || "review");
  const composite = typeof res?.composite === "number" ? res.composite.toFixed(2) : "—";
  const claims = Array.isArray(res?.claims) ? res.claims : [];
  const verifiedCount = claims.filter((c: any) => c.verdict === "verified").length;
  const contradictedCount = res?.contradicted_count ?? claims.filter((c: any) => c.verdict === "contradicted").length;

  return renderCard({
    icon: "🚪",
    title: "Acceptance Gate",
    badge: `${badge} (Diff Quality: ${composite})`,
    summary: [
      { label: "Claims Audit", value: `${verifiedCount}/${claims.length} Verified` },
      { label: "Contradicted", value: contradictedCount },
      { label: "All Verified", value: res?.all_claims_verified ? "YES" : "NO" },
    ],
    checklist: claims.map((c: any) => ({
      status: c.verdict || "unsupported",
      text: c.claim,
    })),
  });
}

function formatActionGateResult(res: any): string {
  const rec = (res?.recommendation || "confirm").toUpperCase();
  const badge = renderBadge(res?.recommendation || "confirm");
  const risk = typeof res?.risk_score === "number" ? res.risk_score.toFixed(2) : "—";

  const details = [
    `**Action/Command:** \`${res?.action || "unknown"}\``,
    `**Recommendation:** **${rec}**`,
    `**Destructive Operation:** \`${res?.is_destructive ? "YES" : "NO"}\``,
    `**Requires Human Escalation:** \`${res?.requires_escalation ? "YES" : "NO"}\``,
  ];

  if (res?.reasoning) {
    details.push(`**Safety Analysis:** ${res.reasoning}`);
  }

  return renderCard({
    icon: "🛡️",
    title: "Action Safety Gate",
    badge: `${badge} (Risk: ${risk} / 3.0)`,
    details,
  });
}

function formatDecideResult(res: any, format: OutputFormat = "markdown"): string {
  const rec = res?.recommendation;
  const selected = rec?.selected || "none";
  const confidence = typeof rec?.confidence === "number" ? `${(rec.confidence * 100).toFixed(1)}%` : "—";
  const escaped = rec?.escaped ? "⚠️ ESCAPED" : "🎯 DECIDED";

  const checks = Array.isArray(res?.checks) ? res.checks : [];

  const table: TableOptions | undefined =
    checks.length > 0
      ? {
          columns: [
            { header: "Candidate", align: "left" },
            { header: "Requirement #", align: "center" },
            { header: "Status", align: "center" },
          ],
          rows: checks.map((ch: any) => [
            `**${ch.candidate}**`,
            `Req ${ch.requirement}`,
            renderBadge(ch.status),
          ]),
        }
      : undefined;

  const details = [`**Status:** ${escaped} · Selected: **${selected}**`];
  if (Array.isArray(res?.warnings) && res.warnings.length > 0) {
    details.push(`*Warnings: ${res.warnings.join("; ")}*`);
  }

  const sections: CardSection[] = [];
  if (rec?.probabilities && typeof rec.probabilities === "object") {
    const probLines: string[] = [];
    const sorted = Object.entries(rec.probabilities as Record<string, number>).sort(
      ([, a], [, b]) => b - a
    );
    for (const [cand, p] of sorted) {
      const isWinner = cand === selected ? " 🏆 (Winner)" : "";
      probLines.push(`- \`${cand}\`: **${(p * 100).toFixed(1)}%**${isWinner}`);
    }
    sections.push({
      title: "Candidate Probability Spread",
      lines: probLines,
    });
  }

  return renderCard({
    icon: "🎯",
    title: "Technical Decision",
    badge: `\`${selected}\` (${confidence} confidence)`,
    details,
    table,
    sections: format === "markdown-verbose" && sections.length > 0 ? sections : undefined,
  });
}

function formatFindResult(res: any): string {
  const top = Array.isArray(res?.top) ? res.top : [];
  const verdict = res?.exists_verdict || (res?.exists >= (res?.threshold ?? 0.5) ? "answered" : "unanswerable");
  const existsScore = typeof res?.exists === "number" ? `${(res.exists * 100).toFixed(1)}%` : "—";

  return renderCard({
    icon: "🔎",
    title: "Semantic Find",
    badge: `\`${top[0]?.id || "None"}\` (Verdict: ${verdict.toUpperCase()})`,
    summary: [
      { label: "Answerability", value: existsScore },
      { label: "Matches", value: top.length },
    ],
    table: {
      columns: [
        { header: "Rank", align: "center" },
        { header: "Candidate ID", align: "left" },
        { header: "Score", align: "center" },
        { header: "Content Snippet", align: "left" },
      ],
      rows: top.map((item: any, idx: number) => {
        const rawScore = typeof item.score === "number" ? item.score : item.probability;
        const score = typeof rawScore === "number" ? `${(rawScore * 100).toFixed(1)}%` : "—";
        const snippet = item.text ? truncate(item.text, 60) : "—";
        return [`#${idx + 1}`, `**${item.id}**`, score, snippet];
      }),
    },
  });
}

function formatRerankResult(res: any): string {
  const ranked = Array.isArray(res?.ranked) ? res.ranked : [];

  return renderCard({
    icon: "📊",
    title: "Relevance Rerank",
    badge: `Top ${ranked.length} Candidates`,
    table: {
      columns: [
        { header: "Rank", align: "center" },
        { header: "Candidate ID", align: "left" },
        { header: "Relevance", align: "center" },
        { header: "Content Preview", align: "left" },
      ],
      rows: ranked.map((item: any, idx: number) => {
        const rank = item.rank ?? idx + 1;
        const rel = typeof item.relevance === "number" ? `${(item.relevance * 100).toFixed(1)}%` : "—";
        const preview = item.text ? truncate(item.text, 60) : "—";
        return [`#${rank}`, `**${item.id}**`, rel, preview];
      }),
    },
  });
}

function formatCompareResult(res: any): string {
  const rel = res?.relation || "different_facts";
  const badge = renderBadge(rel);
  const conf = typeof res?.confidence === "number" ? `${(res.confidence * 100).toFixed(1)}%` : "—";

  const aspects = res?.aspects && typeof res.aspects === "object" ? res.aspects : {};
  const aspectKeys = Object.keys(aspects);

  const table: TableOptions | undefined =
    aspectKeys.length > 0
      ? {
          columns: [
            { header: "Aspect", align: "left" },
            { header: "Relation", align: "center" },
            { header: "Confidence", align: "center" },
          ],
          rows: aspectKeys.map((key) => {
            const a = aspects[key];
            const aConf = typeof a.confidence === "number" ? `${(a.confidence * 100).toFixed(1)}%` : "—";
            return [`**${key}**`, renderBadge(a.relation), aConf];
          }),
        }
      : undefined;

  return renderCard({
    icon: "⚖️",
    title: "Passage Comparison",
    badge: `${badge} (${conf} confidence)`,
    details: aspectKeys.length === 0 ? [`**Overall Relation:** \`${rel}\``, `**Calibrated Confidence:** ${conf}`] : undefined,
    table,
  });
}

function formatVerifyResult(res: any): string {
  const summary = res?.summary || {};
  const verified = summary.verified ?? 0;
  const contradicted = summary.contradicted ?? 0;
  const unsupported = summary.unsupported ?? 0;
  const claims = Array.isArray(res?.claims) ? res.claims : [];

  return renderCard({
    icon: "📋",
    title: "Citation Verification",
    badge: `${verified} Verified · ${contradicted} Contradicted · ${unsupported} Unsupported`,
    checklist: claims.map((c: any) => ({
      status: c.verdict || c.relation_verdict || "unsupported",
      text: c.claim,
    })),
  });
}

function formatScreenResult(res: any): string {
  const badge = renderBadge(res?.recommendation?.action || "review");
  const probs = res?.probabilities || {};

  const probKeys = Object.keys(probs).filter((k) => probs[k] !== undefined);
  const table: TableOptions | undefined =
    probKeys.length > 0
      ? {
          columns: [
            { header: "Security Metric", align: "left" },
            { header: "Probability", align: "center" },
          ],
          rows: probKeys.map((k) => {
            const p = probs[k];
            const pStr = typeof p === "number" ? `${(p * 100).toFixed(1)}%` : String(p);
            const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return [`**${label}**`, pStr];
          }),
        }
      : undefined;

  return renderCard({
    icon: "🛡️",
    title: "Text Screen",
    badge,
    table,
  });
}

function formatExtractResult(res: any): string {
  const results = res?.results && typeof res.results === "object" ? res.results : {};
  const keys = Object.keys(results);

  return renderCard({
    icon: "📝",
    title: "Verbatim Field Extraction",
    badge: `${keys.length} Field(s)`,
    table: {
      columns: [
        { header: "Field ID", align: "left" },
        { header: "Extracted Value", align: "left" },
        { header: "Status", align: "center" },
      ],
      rows: keys.map((key) => {
        const f = results[key];
        const val = f?.value ? `\`${f.value}\`` : "—";
        return [`**${key}**`, val, renderBadge(f?.status || "auto")];
      }),
    },
  });
}

function formatAuditResult(res: any): string {
  const badge = renderBadge(res?.action || "review");
  const records = Array.isArray(res?.records) ? res.records : [];

  return renderCard({
    icon: "🔍",
    title: "Extraction Audit",
    badge: `${badge} (${records.length} Records)`,
    table: {
      columns: [
        { header: "Record ID", align: "left" },
        { header: "Audit Action", align: "center" },
        { header: "Extracted Value", align: "left" },
      ],
      rows: records.map((r: any) => {
        const val = r.value ? `\`${r.value}\`` : "—";
        return [`**${r.id || "—"}**`, renderBadge(r.action || "ok"), val];
      }),
    },
  });
}

function formatGenericResult(name: string, data: any): string {
  if (data === null || data === undefined) {
    return `### 🔧 ${name}\n\n*No output returned.*`;
  }

  if (typeof data === "string") {
    return `### 🔧 ${name}\n\n${data}`;
  }

  const cleaned = stripInternalMetadata(data);
  return `### 🔧 ${name}\n\n\`\`\`json\n${JSON.stringify(cleaned, null, 2)}\n\`\`\``;
}

// --------------------------------------------------------------------------
// Helper Utilities
// --------------------------------------------------------------------------

function escapeCell(str: string): string {
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 3)}...` : str;
}
