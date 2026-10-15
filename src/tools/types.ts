import type { JevClientOptions } from "../types";

export interface ToolContext {
  options?: JevClientOptions;
}

export interface ToolDefinition {
  name: string;
  aliases?: string[];
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, context?: ToolContext) => Promise<unknown>;
}
