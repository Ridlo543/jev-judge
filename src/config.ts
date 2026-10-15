import * as fs from "node:fs";
import * as path from "node:path";

export type JevProtocol = "chat-completions" | "typesafe-direct";
export type JevOutputFormat = "markdown" | "json";

export interface JevResolvedConfig {
  protocol: JevProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  defaultThreshold: number;
  outputFormat: JevOutputFormat;
  source: "cli" | "config-file" | "env";
}

export interface JevConfigInput {
  protocol?: JevProtocol | string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  defaultThreshold?: number;
  outputFormat?: JevOutputFormat | string;
}
export const DEFAULT_PROTOCOL: JevProtocol = "chat-completions";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_THRESHOLD = 0.5;

/** Redacts sensitive API keys for safe logging and error messages. */
export function redactApiKey(key?: string): string {
  if (!key) return "(unset)";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/** Finds and loads .env from cwd or parent directories without throwing. */
export function loadDotenv(cwd: string = process.cwd()): Record<string, string> {
  const loaded: Record<string, string> = {};
  try {
    let dir = cwd;
    let foundPath: string | null = null;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, ".env");
      if (fs.existsSync(candidate)) {
        foundPath = candidate;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (foundPath) {
      const content = fs.readFileSync(foundPath, "utf8");
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          loaded[key] = val;
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore .env read errors
  }
  return loaded;
}

/** Looks for jev.config.json or .jevrc in cwd or parent directories. */
export function loadConfigFile(cwd: string = process.cwd()): JevConfigInput | null {
  try {
    let dir = cwd;
    for (let i = 0; i < 5; i++) {
      for (const name of ["jev.config.json", ".jevrc", ".jev.json"]) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
          const content = fs.readFileSync(candidate, "utf8");
          return JSON.parse(content) as JevConfigInput;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Ignore config file read/parse errors
  }
  return null;
}

/**
 * Resolves configuration strictly from user manual input:
 * 1. Explicit arguments (CLI flags: --base-url, --api-key, --model, --protocol)
 * 2. Configuration file (jev.config.json / .jevrc)
 * 3. Environment variables (set in MCP client config or .env: JEV_* or standard OPENAI_*)
 *
 * NO vendor hardcoding, NO URL guessing, NO provider heuristics.
 */
export function resolveConfig(explicit: JevConfigInput = {}): JevResolvedConfig {
  loadDotenv();
  const fileConfig = loadConfigFile() || {};
  const env = process.env;

  let source: JevResolvedConfig["source"] = "env";

  // 1. Protocol: chat-completions (OpenAI compatible) or typesafe-direct
  let protocol: JevProtocol = DEFAULT_PROTOCOL;
  const rawProto = (
    explicit.protocol ||
    fileConfig.protocol ||
    env.JEV_PROTOCOL ||
    ""
  ).toLowerCase();

  if (rawProto === "typesafe-direct" || rawProto === "direct") {
    protocol = "typesafe-direct";
  } else {
    protocol = "chat-completions";
  }

  // 2. Base URL: Pure manual input from user
  let baseUrl = (
    explicit.baseUrl ||
    fileConfig.baseUrl ||
    env.JEV_BASE_URL ||
    env.OPENAI_BASE_URL ||
    ""
  ).trim();

  baseUrl = baseUrl.replace(/\/+$/, "");

  // 3. API Key: Pure manual input from user
  const apiKey = (
    explicit.apiKey ||
    fileConfig.apiKey ||
    env.JEV_API_KEY ||
    env.OPENAI_API_KEY ||
    ""
  ).trim();

  // 4. Model: Pure manual input from user
  const model = (
    explicit.model ||
    fileConfig.model ||
    env.JEV_MODEL ||
    env.OPENAI_MODEL ||
    ""
  ).trim();

  // 5. Timeout & Threshold
  const rawTimeout = env.JEV_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS;
  const timeoutMs =
    explicit.timeoutMs ??
    fileConfig.timeoutMs ??
    (rawTimeout ? Number.parseInt(rawTimeout, 10) : DEFAULT_TIMEOUT_MS);

  const defaultThreshold =
    explicit.defaultThreshold ??
    fileConfig.defaultThreshold ??
    DEFAULT_THRESHOLD;
  // 6. Output format: markdown (default for human/TUI) or json
  const rawFormat = (
    explicit.outputFormat ||
    fileConfig.outputFormat ||
    env.JEV_OUTPUT_FORMAT ||
    "markdown"
  ).toLowerCase();
  const outputFormat: JevOutputFormat = rawFormat === "json" ? "json" : "markdown";

  if (explicit.apiKey || explicit.baseUrl || explicit.model) {
    source = "cli";
  } else if (fileConfig.apiKey || fileConfig.baseUrl || fileConfig.model) {
    source = "config-file";
  } else {
    source = "env";
  }

  return {
    protocol,
    baseUrl,
    apiKey,
    model,
    timeoutMs,
    defaultThreshold,
    outputFormat,
    source,
  };
}

/** Asserts that required manual config parameters are provided by the user. */
export function requireConfig(explicit: JevConfigInput = {}): JevResolvedConfig {
  const config = resolveConfig(explicit);

  if (!config.baseUrl) {
    throw new Error(
      "Missing Jev Base URL. Please configure it manually in your MCP config (env.JEV_BASE_URL or env.OPENAI_BASE_URL), in jev.config.json, or pass --base-url.",
    );
  }

  if (!config.apiKey) {
    throw new Error(
      "Missing Jev API Key. Please configure it manually in your MCP config (env.JEV_API_KEY or env.OPENAI_API_KEY), in jev.config.json, or pass --api-key.",
    );
  }

  if (!config.model) {
    throw new Error(
      "Missing Jev Model. Please configure it manually in your MCP config (env.JEV_MODEL or env.OPENAI_MODEL), in jev.config.json, or pass --model.",
    );
  }

  return config;
}
