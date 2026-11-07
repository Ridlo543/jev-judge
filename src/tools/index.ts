import { codingTools } from "./coding";
import { guardrailsTools } from "./guardrails";
import { primitiveTools } from "./primitives";
import { researchTools } from "./research";
import type { ToolDefinition } from "./types";

export * from "./types";
export * from "./coding";
export * from "./research";
export * from "./guardrails";
export * from "./primitives";

export const allTools: ToolDefinition[] = [
  ...codingTools,
  ...researchTools,
  ...guardrailsTools,
  ...primitiveTools,
];

/**
 * 8 Core Orthogonal Tools for LLM Coding Agents:
 * 1. systemone_action_gate  - Terminal shell safety gate (allow | confirm | block)
 * 2. systemone_screen       - Untrusted text / prompt injection screening
 * 3. systemone_decide       - Architecture candidate arbitration (2-6 options)
 * 4. systemone_verify       - Fact-checking & citation verification (claim vs evidence)
 * 5. systemone_compare      - Passage / specification agreement & contradiction check
 * 6. systemone_review       - Patch review + Final Definition-of-Done Gating (unified)
 * 7. systemone_find         - Semantic search & candidate ranking (unified)
 * 8. systemone_judge        - Universal decision & proposition probability primitive
 */
export const coreTools: ToolDefinition[] = [
  // 1. Coding & Terminal Safety
  allTools.find((t) => t.name === "systemone_action_gate" || t.name === "jev_action_gate")!,
  allTools.find((t) => t.name === "systemone_screen" || t.name === "jev_screen")!,
  // 2. Planning & Research
  allTools.find((t) => t.name === "systemone_decide" || t.name === "jev_decide")!,
  allTools.find((t) => t.name === "systemone_verify" || t.name === "jev_verify")!,
  allTools.find((t) => t.name === "systemone_compare" || t.name === "jev_compare")!,
  // 3. Execution & Gating
  allTools.find((t) => t.name === "systemone_review" || t.name === "jev_review")!,
  allTools.find((t) => t.name === "systemone_find" || t.name === "jev_find")!,
  // 4. Universal Primitive
  allTools.find((t) => t.name === "systemone_judge" || t.name === "jev_judge")!,
];

export const toolsByName: Record<string, ToolDefinition> = {};
for (const tool of allTools) {
  toolsByName[tool.name] = tool;
  if (tool.aliases) {
    for (const alias of tool.aliases) {
      toolsByName[alias] = tool;
    }
  }
}

// Transparent backward-compatible aliases for legacy / merged tools:
const registerAliasPair = (base: string, alias: string) => {
  if (toolsByName[base] && !toolsByName[alias]) {
    toolsByName[alias] = toolsByName[base];
  }
};

for (const [s1Name, jevName, cleanName] of [
  ["systemone_review", "jev_review", "review"],
  ["systemone_gate", "jev_gate", "gate"],
  ["systemone_action_gate", "jev_action_gate", "action_gate"],
  ["systemone_decide", "jev_decide", "decide"],
  ["systemone_verify", "jev_verify", "verify"],
  ["systemone_screen", "jev_screen", "screen"],
  ["systemone_compare", "jev_compare", "compare"],
  ["systemone_find", "jev_find", "find"],
  ["systemone_rerank", "jev_rerank", "rerank"],
  ["systemone_judge", "jev_judge", "judge"],
  ["systemone_noul", "jev_noul", "noul"],
]) {
  const tool = toolsByName[s1Name] || toolsByName[jevName];
  if (tool) {
    toolsByName[s1Name] = tool;
    toolsByName[jevName] = tool;
    toolsByName[cleanName] = tool;
  }
}
