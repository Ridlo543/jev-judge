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

export const toolsByName: Record<string, ToolDefinition> = {};
for (const tool of allTools) {
  toolsByName[tool.name] = tool;
  if (tool.aliases) {
    for (const alias of tool.aliases) {
      toolsByName[alias] = tool;
    }
  }
}
