import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";

export interface SetupOptions {
  client?: "claude" | "omp" | "cursor" | "workspace" | "config";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  command?: string;
  global?: boolean;
}

export async function runSetupWizard(options: SetupOptions = {}): Promise<void> {
  const isInteractive = process.stdin.isTTY && !options.baseUrl && !options.apiKey;

  let rl: readline.Interface | undefined;
  if (isInteractive) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  const ask = async (prompt: string, defaultValue = ""): Promise<string> => {
    if (!rl) return defaultValue;
    const answer = await rl.question(prompt);
    return answer.trim() || defaultValue;
  };

  try {
    console.log("\n\x1b[1m\x1b[36m=== SystemOne MCP Interactive Setup Wizard ===\x1b[0m");
    console.log("Configure System One Decision Model Runner for your agent without manual JSON editing.\n");

    // 1. Select Client Platform
    let client = options.client;
    if (!client && isInteractive) {
      console.log("Select target agent platform:");
      console.log("  [1] Claude Code (creates or updates .mcp.json / ~/.claude.json)");
      console.log("  [2] Oh My Pi (OMP) (creates .omp/mcp.json)");
      console.log("  [3] Cursor / Windsurf / Cline (creates .cursor/mcp.json)");
      console.log("  [4] Current Workspace (.mcp.json in current directory)");
      console.log("  [5] Standalone Config (systemone.config.json)\n");

      const choice = await ask("Choose option (1-5) [1]: ", "1");
      if (choice === "2") client = "omp";
      else if (choice === "3") client = "cursor";
      else if (choice === "4") client = "workspace";
      else if (choice === "5") client = "config";
      else client = "claude";
    } else if (!client) {
      client = "workspace";
    }

    let isGlobal = Boolean(options.global);
    if (isInteractive && client !== "workspace" && client !== "config" && !options.global) {
      console.log(`\nSelect configuration scope for ${client.toUpperCase()}:`);
      console.log("  [1] Global / User-wide (recommended: available across all your projects)");
      console.log("  [2] Local Workspace (stored in current directory)\n");
      const scopeChoice = await ask("Choose scope (1-2) [1]: ", "1");
      isGlobal = scopeChoice !== "2";
    }

    // 2. Select Decision Engine
    let engineChoice = "1";
    if (isInteractive && !options.baseUrl && !options.model) {
      console.log("\nSelect decision engine preset:");
      console.log("  [1] Cloud / Router (OpenAI-compatible endpoint, OpenRouter, or custom proxy)");
      console.log("  [2] Laya Local CPU Server (100% offline, free, no API key needed, port 20130)\n");
      engineChoice = await ask("Choose engine (1-2) [1]: ", "1");
    }

    let baseUrl = options.baseUrl;
    let apiKey = options.apiKey;
    let model = options.model;

    if (engineChoice === "2") {
      baseUrl = (baseUrl || "http://127.0.0.1:20130/v1").trim().replace(/\/+$/, "");
      apiKey = (apiKey || "none").trim();
      model = (model || "laya").trim();
      console.log(`\nUsing Laya Local CPU engine preset: ${baseUrl} (model: ${model})`);

      try {
        const probe = await fetch("http://127.0.0.1:20130/health", { signal: AbortSignal.timeout(1000) });
        if (probe.ok) {
          console.log("\x1b[32m✔ Local Laya server detected and responding on port 20130!\x1b[0m\n");
        }
      } catch {
        console.log("\x1b[33mℹ Local Laya server is currently offline.\x1b[0m");
        console.log("  You can start it anytime with 'laya start' or 'node server.mjs' in your laya folder.\n");
      }
    } else {
      console.log("\n--- Cloud / Router Configuration ---");
      console.log("Enter your OpenAI-compatible router or proxy endpoint details.\n");

      if (!baseUrl && isInteractive) {
        baseUrl = await ask(
          "Enter Base URL (e.g. https://api.openai.com/v1, OpenRouter, or your proxy) [https://api.openai.com/v1]: ",
          "https://api.openai.com/v1",
        );
      }
      baseUrl = (baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");

      if (!apiKey && isInteractive) {
        apiKey = await ask(
          "Enter API Key (press Enter for 'none' if using a local/free router): ",
          "none",
        );
      }
      apiKey = (apiKey || "none").trim();

      if (!model && isInteractive) {
        const defaultModel = "systemone";
        model = await ask(`Enter Model ID [${defaultModel}]: `, defaultModel);
      }
      model = (model || "systemone").trim();
    }
    // 5. Execution Command
    const localExe = fs.existsSync(path.resolve(process.cwd(), "systemone-mcp.exe"))
      ? path.resolve(process.cwd(), "systemone-mcp.exe")
      : fs.existsSync(path.resolve(process.cwd(), "jev-mcp.exe"))
        ? path.resolve(process.cwd(), "jev-mcp.exe")
        : "npx";
    const execCommand = options.command || localExe;
    const execArgs = execCommand === "npx" ? ["-y", "-p", "systemone-judge", "systemone-mcp"] : undefined;

    // 6. Write Configuration
    let targetPath = "";

    if (client === "config") {
      targetPath = path.resolve(process.cwd(), "systemone.config.json");
      const configData = {
        protocol: "chat-completions",
        baseUrl,
        apiKey,
        model,
        timeoutMs: 35000,
        defaultThreshold: 0.5,
      };
      fs.writeFileSync(targetPath, JSON.stringify(configData, null, 2) + "\n");
    } else {
      if (client === "claude") {
        targetPath = isGlobal
          ? path.resolve(os.homedir(), ".claude.json")
          : path.resolve(process.cwd(), ".mcp.json");
      } else if (client === "omp") {
        const dir = isGlobal
          ? path.resolve(os.homedir(), ".omp", "agent")
          : path.resolve(process.cwd(), ".omp");
        fs.mkdirSync(dir, { recursive: true });
        targetPath = path.resolve(dir, "mcp.json");
      } else if (client === "cursor") {
        const dir = isGlobal
          ? path.resolve(os.homedir(), ".cursor")
          : path.resolve(process.cwd(), ".cursor");
        fs.mkdirSync(dir, { recursive: true });
        targetPath = path.resolve(dir, "mcp.json");
      } else {
        targetPath = path.resolve(process.cwd(), ".mcp.json");
      }

      let existingConfig: Record<string, unknown> = {};
      if (fs.existsSync(targetPath)) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(targetPath, "utf8"));
        } catch {
          existingConfig = {};
        }
      }

      const mcpServers = (existingConfig.mcpServers as Record<string, unknown>) || {};
      mcpServers.systemone = {
        command: execCommand,
        ...(execArgs ? { args: execArgs } : {}),
        env: {
          SYSTEMONE_BASE_URL: baseUrl,
          SYSTEMONE_API_KEY: apiKey,
          SYSTEMONE_MODEL: model,
        },
      };
      existingConfig.mcpServers = mcpServers;

      fs.writeFileSync(targetPath, JSON.stringify(existingConfig, null, 2) + "\n");
    }

    console.log(`\n\x1b[32m✔ Success! SystemOne MCP configuration written to:\x1b[0m`);
    console.log(`  \x1b[1m${targetPath}\x1b[0m\n`);
    console.log(`Agent Platform: \x1b[36m${client.toUpperCase()} (${isGlobal ? "Global" : "Workspace"})\x1b[0m`);
    console.log(`Endpoint:       \x1b[36m${baseUrl}\x1b[0m`);
    console.log(`Model:          \x1b[36m${model}\x1b[0m`);
    const displayKey = apiKey === "none" ? "none" : `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
    console.log(`API Key:        \x1b[36m${displayKey}\x1b[0m\n`);
    console.log("Your agent is ready to call SystemOne decision tools immediately!\n");
    return;
  } finally {
    rl?.close();
  }
}
