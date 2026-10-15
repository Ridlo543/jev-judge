#!/usr/bin/env bun
import { resolveConfig } from "./config";
import { allTools, toolsByName } from "./tools";
import { validateToolCall } from "./tools/validation";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function sendJson(message: unknown): void {
  const line = JSON.stringify(message);
  process.stdout.write(line + "\n");
}

function sendError(id: string | number | null | undefined, code: number, message: string): void {
  sendJson({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function sendResult(id: string | number | null | undefined, result: unknown): void {
  sendJson({
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const { id, method, params } = req;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "jev",
        version: "1.0.0",
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    sendResult(id, {
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }

  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    const tool = toolsByName[name];
    if (!tool) {
      sendError(id, -32601, `Unknown tool: ${name}`);
      return;
    }
    const validation = validateToolCall(name, args);
    if (!validation.ok) {
      sendResult(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: validation.message,
          },
        ],
      });
      return;
    }

    try {
      const output = await tool.handler(validation.data);
      sendResult(id, {
        content: [
          {
            type: "text",
            text: typeof output === "string" ? output : JSON.stringify(output, null, 2),
          },
        ],
      });
    } catch (err) {
      sendResult(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
    }
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  sendError(id, -32601, `Method not found: ${method}`);
}

async function main(): Promise<void> {
  const config = resolveConfig();
  console.error(
    `[jev-mcp] Server running · endpoint=${config.baseUrl || "(unconfigured)"} · model=${config.model || "(unconfigured)"} · tools=${allTools.length}`,
  );

  let buffer = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const req = JSON.parse(line) as JsonRpcRequest;
        await handleRequest(req);
      } catch (err) {
        sendError(null, -32700, `Parse error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[jev-mcp] Fatal error:", err);
  process.exit(1);
});
