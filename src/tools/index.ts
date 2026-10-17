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
 * 1. jev_action_gate  - Terminal shell safety gate (allow | confirm | block)
 * 2. jev_screen       - Untrusted text / prompt injection screening
 * 3. jev_decide       - Architecture candidate arbitration (2-6 options)
 * 4. jev_verify       - Fact-checking & citation verification (claim vs evidence)
 * 5. jev_compare      - Passage / specification agreement & contradiction check
 * 6. jev_review       - Patch review + Final Definition-of-Done Gating (unified)
 * 7. jev_find         - Semantic search & candidate ranking (unified)
 * 8. jev_judge        - Universal decision & proposition probability primitive
 */
export const coreTools: ToolDefinition[] = [
  // 1. Coding & Terminal Safety
  allTools.find((t) => t.name === "jev_action_gate")!,
  allTools.find((t) => t.name === "jev_screen")!,
  // 2. Planning & Research
  allTools.find((t) => t.name === "jev_decide")!,
  allTools.find((t) => t.name === "jev_verify")!,
  allTools.find((t) => t.name === "jev_compare")!,
  // 3. Execution & Gating
  allTools.find((t) => t.name === "jev_review")!,
  allTools.find((t) => t.name === "jev_find")!,
  // 4. Universal Primitive
  allTools.find((t) => t.name === "jev_judge")!,
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
if (toolsByName.jev_review && !toolsByName.jev_gate) {
  toolsByName.jev_gate = toolsByName.jev_review;
}
if (toolsByName.jev_find && !toolsByName.jev_rerank) {
  toolsByName.jev_rerank = toolsByName.jev_find;
}
if (toolsByName.jev_judge && !toolsByName.jev_noul) {
  toolsByName.jev_noul = toolsByName.jev_judge;
}
