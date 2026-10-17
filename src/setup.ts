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
    console.log("\n\x1b[1m\x1b[36m=== Jev MCP Interactive Setup Wizard ===\x1b[0m");
    console.log("Configure Jev Decision Model Runner for your agent without manual JSON editing.\n");

    // 1. Select Client Platform
    let client = options.client;
    if (!client && isInteractive) {
      console.log("Select target agent platform:");
      console.log("  [1] Claude Code (creates or updates .mcp.json / ~/.claude.json)");
      console.log("  [2] Oh My Pi (OMP) (creates .omp/mcp.json)");
      console.log("  [3] Cursor / Windsurf / Cline (creates .cursor/mcp.json)");
      console.log("  [4] Current Workspace (.mcp.json in current directory)");
      console.log("  [5] Standalone Config (jev.config.json)\n");

      const choice = await ask("Choose option (1-5) [1]: ", "1");
      if (choice === "2") client = "omp";
      else if (choice === "3") client = "cursor";
      else if (choice === "4") client = "workspace";
      else if (choice === "5") client = "config";
      else client = "claude";
    } else if (!client) {
      client = "workspace";
    }

    // 2. Base URL
    let baseUrl = options.baseUrl;
    if (!baseUrl && isInteractive) {
      baseUrl = await ask(
        "Enter Base URL (e.g. https://api.openai.com/v1, OpenRouter, or your proxy): ",
      );
    }
    if (!baseUrl) {
      throw new Error("Base URL is required. Provide --base-url or enter one in the wizard.");
    }
    baseUrl = baseUrl.trim().replace(/\/+$/, "");

    // 3. API Key
    let apiKey = options.apiKey;
    if (!apiKey && isInteractive) {
      apiKey = await ask("Enter API Key (will be saved in your local client config): ");
    }
    if (!apiKey) {
      throw new Error("API Key is required. Provide --api-key or enter one in the wizard.");
    }
    apiKey = apiKey.trim();

    // 4. Model ID
    let model = options.model;
    if (!model && isInteractive) {
      const defaultModel = "jev-latest";
      model = await ask(`Enter Model ID [${defaultModel}]: `, defaultModel);
    }
    if (!model) {
      model = "jev-latest";
    }
    model = model.trim();

    // 5. Execution Command
    const execCommand = options.command || (fs.existsSync(path.resolve(process.cwd(), "jev-mcp.exe")) ? path.resolve(process.cwd(), "jev-mcp.exe") : "npx");
    const execArgs = execCommand === "npx" ? ["-y", "jev-judge", "mcp"] : undefined;

    // 6. Write Configuration
    let targetPath = "";
    const isGlobal = Boolean(options.global);

    if (client === "config") {
      targetPath = path.resolve(process.cwd(), "jev.config.json");
      const configData = {
        protocol: "chat-completions",
        baseUrl,
        apiKey,
        model,
        timeoutMs: 20000,
        defaultThreshold: 0.5,
      };
      fs.writeFileSync(targetPath, JSON.stringify(configData, null, 2) + "\n");
    } else {
      if (client === "claude" && isGlobal) {
        targetPath = path.resolve(os.homedir(), ".claude.json");
      } else if (client === "omp") {
        const dir = isGlobal ? path.resolve(os.homedir(), ".omp") : path.resolve(process.cwd(), ".omp");
        fs.mkdirSync(dir, { recursive: true });
        targetPath = path.resolve(dir, "mcp.json");
      } else if (client === "cursor") {
        const dir = path.resolve(process.cwd(), ".cursor");
        fs.mkdirSync(dir, { recursive: true });
        targetPath = path.resolve(dir, "mcp.json");
      } else {
        // workspace or default claude local
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
      mcpServers.jev = {
        command: execCommand,
        ...(execArgs ? { args: execArgs } : {}),
        env: {
          JEV_BASE_URL: baseUrl,
          JEV_API_KEY: apiKey,
          JEV_MODEL: model,
        },
      };
      existingConfig.mcpServers = mcpServers;

      fs.writeFileSync(targetPath, JSON.stringify(existingConfig, null, 2) + "\n");
    }

    console.log(`\n\x1b[32m✔ Success! Jev MCP configuration written to:\x1b[0m`);
    console.log(`  \x1b[1m${targetPath}\x1b[0m\n`);
    console.log(`Agent Platform: \x1b[36m${client.toUpperCase()}\x1b[0m`);
    console.log(`Endpoint:       \x1b[36m${baseUrl}\x1b[0m`);
    console.log(`Model:          \x1b[36m${model}\x1b[0m`);
    console.log(`API Key:        \x1b[36m${apiKey.slice(0, 4)}...${apiKey.slice(-4)}\x1b[0m\n`);
    console.log("Your agent is ready to call Jev decision tools immediately!\n");
  } finally {
    rl?.close();
  }
}
