#!/usr/bin/env bun
// @bun

// src/cli.ts
import * as fs3 from "fs";

// src/config.ts
import * as fs from "node:fs";
import * as path from "node:path";
var DEFAULT_PROTOCOL = "chat-completions";
var DEFAULT_TIMEOUT_MS = 20000;
var DEFAULT_THRESHOLD = 0.5;
function redactApiKey(key) {
  if (!key)
    return "(unset)";
  const trimmed = key.trim();
  if (trimmed.length <= 8)
    return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
function loadDotenv(cwd = process.cwd()) {
  const loaded = {};
  try {
    let dir = cwd;
    let foundPath = null;
    for (let i = 0;i < 5; i++) {
      const candidate = path.join(dir, ".env");
      if (fs.existsSync(candidate)) {
        foundPath = candidate;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
    if (foundPath) {
      const content = fs.readFileSync(foundPath, "utf8");
      for (const rawLine of content.split(`
`)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
          continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
            val = val.slice(1, -1);
          }
          loaded[key] = val;
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {}
  return loaded;
}
function loadConfigFile(cwd = process.cwd()) {
  try {
    let dir = cwd;
    for (let i = 0;i < 5; i++) {
      for (const name of ["jev.config.json", ".jevrc", ".jev.json"]) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
          const content = fs.readFileSync(candidate, "utf8");
          return JSON.parse(content);
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir)
        break;
      dir = parent;
    }
  } catch {}
  return null;
}
function resolveConfig(explicit = {}) {
  loadDotenv();
  const fileConfig = loadConfigFile() || {};
  const env = process.env;
  let source = "env";
  let protocol = DEFAULT_PROTOCOL;
  const rawProto = (explicit.protocol || fileConfig.protocol || env.JEV_PROTOCOL || "").toLowerCase();
  if (rawProto === "typesafe-direct" || rawProto === "direct") {
    protocol = "typesafe-direct";
  } else {
    protocol = "chat-completions";
  }
  let baseUrl = (explicit.baseUrl || fileConfig.baseUrl || env.JEV_BASE_URL || env.OPENAI_BASE_URL || "").trim();
  baseUrl = baseUrl.replace(/\/+$/, "");
  const apiKey = (explicit.apiKey || fileConfig.apiKey || env.JEV_API_KEY || env.OPENAI_API_KEY || "").trim();
  const model = (explicit.model || fileConfig.model || env.JEV_MODEL || env.OPENAI_MODEL || "").trim();
  const rawTimeout = env.JEV_TIMEOUT_MS || env.OPENAI_TIMEOUT_MS;
  const timeoutMs = explicit.timeoutMs ?? fileConfig.timeoutMs ?? (rawTimeout ? Number.parseInt(rawTimeout, 10) : DEFAULT_TIMEOUT_MS);
  const defaultThreshold = explicit.defaultThreshold ?? fileConfig.defaultThreshold ?? DEFAULT_THRESHOLD;
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
    source
  };
}
function requireConfig(explicit = {}) {
  const config = resolveConfig(explicit);
  if (!config.baseUrl) {
    throw new Error("Missing Jev Base URL. Please configure it manually in your MCP config (env.JEV_BASE_URL or env.OPENAI_BASE_URL), in jev.config.json, or pass --base-url.");
  }
  if (!config.apiKey) {
    throw new Error("Missing Jev API Key. Please configure it manually in your MCP config (env.JEV_API_KEY or env.OPENAI_API_KEY), in jev.config.json, or pass --api-key.");
  }
  if (!config.model) {
    throw new Error("Missing Jev Model. Please configure it manually in your MCP config (env.JEV_MODEL or env.OPENAI_MODEL), in jev.config.json, or pass --model.");
  }
  return config;
}

// src/client.ts
var RETRYABLE_STATUS_CODES = {
  408: true,
  409: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true
};
function sleep(ms, signal) {
  const { promise, resolve, reject } = Promise.withResolvers();
  if (signal?.aborted) {
    reject(new Error("Request aborted during retry wait"));
    return promise;
  }
  const timer = setTimeout(() => resolve(), ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new Error("Request aborted during retry wait"));
  }, { once: true });
  return promise;
}
async function rawJevJudgment(state, questions, options = {}) {
  const config = requireConfig({
    protocol: options.protocol,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    timeoutMs: options.timeoutMs
  });
  const protocol = config.protocol;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const timeoutMs = config.timeoutMs;
  const maxRetries = options.maxRetries ?? 2;
  let targetUrl = baseUrl;
  if (protocol === "chat-completions") {
    if (!targetUrl.endsWith("/chat/completions")) {
      targetUrl = `${targetUrl}/chat/completions`;
    }
  }
  const payload = {
    model,
    state,
    questions
  };
  const t0 = performance.now();
  let lastError = null;
  let attempt = 0;
  while (attempt <= maxRetries) {
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const shouldRetry = attempt < maxRetries && Boolean(RETRYABLE_STATUS_CODES[res.status]);
        if (shouldRetry) {
          attempt++;
          const jitter = Math.random() * 100;
          const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
          await sleep(delay);
          continue;
        }
        throw new Error(`Jev provider returned HTTP ${res.status} (${res.statusText}) at ${targetUrl}: ${errorText || "(empty body)"}`);
      }
      const rawJson = await res.json();
      const durationMs = Math.round(performance.now() - t0);
      let parsedAnswers = null;
      let returnedModel = model;
      let usage;
      if (protocol === "chat-completions") {
        const choices = rawJson.choices;
        const contentRaw = choices?.[0]?.message?.content;
        if (!contentRaw) {
          throw new Error(`Invalid OpenAI-compatible response: missing message.content in choices[0]. Raw: ${JSON.stringify(rawJson).slice(0, 300)}`);
        }
        try {
          const parsed = JSON.parse(contentRaw);
          parsedAnswers = parsed.answers || parsed;
          if (parsed.model)
            returnedModel = parsed.model;
        } catch (err) {
          throw new Error(`Failed to parse Jev JSON content: "${contentRaw.slice(0, 300)}" (${String(err)})`);
        }
        const rawUsage = rawJson.usage;
        if (rawUsage) {
          usage = rawUsage;
        }
      } else {
        parsedAnswers = rawJson.answers || rawJson;
        if (typeof rawJson.model === "string")
          returnedModel = rawJson.model;
        if (rawJson.usage && typeof rawJson.usage === "object") {
          usage = rawJson.usage;
        }
      }
      if (!parsedAnswers || typeof parsedAnswers !== "object") {
        throw new Error(`Jev response missing 'answers' object. Endpoint: ${targetUrl}, Protocol: ${protocol}`);
      }
      for (const key of Object.keys(parsedAnswers)) {
        const ans = parsedAnswers[key];
        if (ans && ans.type === "noul") {
          ans.bool = ans.noul;
        }
      }
      return {
        model: returnedModel,
        answers: parsedAnswers,
        usage,
        durationMs
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Jev request timed out after ${timeoutMs}ms (endpoint: ${targetUrl}, key: ${redactApiKey(config.apiKey)})`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 100;
        const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
        await sleep(delay);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Jev request failed after ${maxRetries + 1} attempts at ${targetUrl}`);
}
function normalizeQuestion(input) {
  if (typeof input === "string") {
    return {
      type: "noul",
      instructions: input
    };
  }
  if (typeof input === "object" && input !== null) {
    const raw = input;
    const type = typeof raw.type === "string" ? raw.type.toLowerCase() : undefined;
    if (type === "choice") {
      const rawOpts = raw.criteria ?? raw.options;
      let criteria;
      if (Array.isArray(rawOpts)) {
        criteria = Object.fromEntries(rawOpts.map((k) => [String(k), String(k)]));
      } else if (typeof rawOpts === "object" && rawOpts !== null) {
        criteria = rawOpts;
      } else {
        criteria = { yes: "yes", no: "no" };
      }
      return {
        type: "choice",
        instructions: String(raw.instructions || "Select the most appropriate option"),
        criteria
      };
    }
    if (type === "score") {
      const rawLevels = raw.criteria ?? raw.levels ?? raw.options;
      let criteria;
      if (Array.isArray(rawLevels)) {
        criteria = rawLevels.map(String);
      } else if (typeof rawLevels === "object" && rawLevels !== null) {
        criteria = Object.values(rawLevels).map(String);
      } else {
        criteria = ["1", "2", "3", "4", "5"];
      }
      return {
        type: "score",
        instructions: String(raw.instructions || "Rate the level"),
        criteria
      };
    }
    const noulCriteria = raw.criteria && typeof raw.criteria === "object" ? raw.criteria : undefined;
    return {
      type: "noul",
      instructions: String(raw.instructions || "Is this valid and true?"),
      ...noulCriteria ? { criteria: noulCriteria } : {}
    };
  }
  return {
    type: "noul",
    instructions: String(input)
  };
}
function normalizeQuestions(input) {
  if (typeof input === "string") {
    return {
      verdict: normalizeQuestion(input)
    };
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((q, idx) => [`q${idx + 1}`, normalizeQuestion(q)]));
  }
  if (typeof input === "object" && input !== null) {
    const raw = input;
    if (typeof raw.type === "string" && ["noul", "bool", "boolean", "choice", "score"].includes(raw.type.toLowerCase())) {
      return {
        verdict: normalizeQuestion(raw)
      };
    }
    const result = {};
    for (const [key, val] of Object.entries(input)) {
      result[key] = normalizeQuestion(val);
    }
    return result;
  }
  return {
    verdict: {
      type: "noul",
      instructions: "Is this valid?"
    }
  };
}
async function judge(state, questionInput, options = {}) {
  const questions = normalizeQuestions(questionInput);
  const result = await rawJevJudgment(state, questions, options);
  const keys = Object.keys(result.answers);
  const firstKey = keys[0];
  const firstAnswer = firstKey ? result.answers[firstKey] : undefined;
  const verdicts = {};
  const probabilities = {};
  for (const [key, ans] of Object.entries(result.answers)) {
    if (ans.type === "noul") {
      verdicts[key] = ans.noul >= (options.defaultThreshold ?? 0.5);
      probabilities[key] = ans.noul;
    } else if (ans.type === "choice") {
      verdicts[key] = ans.choice;
      probabilities[key] = ans.confidence;
    } else if (ans.type === "score") {
      verdicts[key] = ans.score;
      probabilities[key] = ans.confidence ?? 1;
    }
  }
  let verdict = false;
  let probability;
  let confidence;
  if (firstAnswer) {
    verdict = verdicts[firstKey] ?? false;
    if (firstAnswer.type === "noul") {
      probability = firstAnswer.noul;
    } else if (firstAnswer.type === "choice") {
      confidence = firstAnswer.confidence;
    } else if (firstAnswer.type === "score") {
      confidence = firstAnswer.confidence;
    }
  }
  return {
    verdict,
    probability,
    confidence,
    verdicts,
    probabilities,
    answers: result.answers,
    raw: result
  };
}

// src/setup.ts
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as path2 from "node:path";
import * as readline from "node:readline/promises";
async function runSetupWizard(options = {}) {
  const isInteractive = process.stdin.isTTY && !options.baseUrl && !options.apiKey;
  let rl;
  if (isInteractive) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  const ask = async (prompt, defaultValue = "") => {
    if (!rl)
      return defaultValue;
    const answer = await rl.question(prompt);
    return answer.trim() || defaultValue;
  };
  try {
    console.log(`
\x1B[1m\x1B[36m=== Jev MCP Interactive Setup Wizard ===\x1B[0m`);
    console.log(`Configure Jev Decision Model Runner for your agent without manual JSON editing.
`);
    let client = options.client;
    if (!client && isInteractive) {
      console.log("Select target agent platform:");
      console.log("  [1] Claude Code (creates or updates .mcp.json / ~/.claude.json)");
      console.log("  [2] Oh My Pi (OMP) (creates .omp/mcp.json)");
      console.log("  [3] Cursor / Windsurf / Cline (creates .cursor/mcp.json)");
      console.log("  [4] Current Workspace (.mcp.json in current directory)");
      console.log(`  [5] Standalone Config (jev.config.json)
`);
      const choice = await ask("Choose option (1-5) [1]: ", "1");
      if (choice === "2")
        client = "omp";
      else if (choice === "3")
        client = "cursor";
      else if (choice === "4")
        client = "workspace";
      else if (choice === "5")
        client = "config";
      else
        client = "claude";
    } else if (!client) {
      client = "workspace";
    }
    let baseUrl = options.baseUrl;
    if (!baseUrl && isInteractive) {
      baseUrl = await ask("Enter Base URL (e.g. https://api.openai.com/v1, OpenRouter, or your proxy): ");
    }
    if (!baseUrl) {
      throw new Error("Base URL is required. Provide --base-url or enter one in the wizard.");
    }
    baseUrl = baseUrl.trim().replace(/\/+$/, "");
    let apiKey = options.apiKey;
    if (!apiKey && isInteractive) {
      apiKey = await ask("Enter API Key (will be saved in your local client config): ");
    }
    if (!apiKey) {
      throw new Error("API Key is required. Provide --api-key or enter one in the wizard.");
    }
    apiKey = apiKey.trim();
    let model = options.model;
    if (!model && isInteractive) {
      const defaultModel = baseUrl.includes("ainything") ? "opencode-free/jev-1.13-free" : "jev-latest";
      model = await ask(`Enter Model ID [${defaultModel}]: `, defaultModel);
    }
    if (!model) {
      model = "jev-latest";
    }
    model = model.trim();
    const execCommand = options.command || (fs2.existsSync(path2.resolve(process.cwd(), "jev-mcp.exe")) ? path2.resolve(process.cwd(), "jev-mcp.exe") : "npx");
    const execArgs = execCommand === "npx" ? ["-y", "jev-judge", "mcp"] : undefined;
    let targetPath = "";
    const isGlobal = Boolean(options.global);
    if (client === "config") {
      targetPath = path2.resolve(process.cwd(), "jev.config.json");
      const configData = {
        protocol: "chat-completions",
        baseUrl,
        apiKey,
        model,
        timeoutMs: 20000,
        defaultThreshold: 0.5
      };
      fs2.writeFileSync(targetPath, JSON.stringify(configData, null, 2) + `
`);
    } else {
      if (client === "claude" && isGlobal) {
        targetPath = path2.resolve(os.homedir(), ".claude.json");
      } else if (client === "omp") {
        const dir = isGlobal ? path2.resolve(os.homedir(), ".omp") : path2.resolve(process.cwd(), ".omp");
        fs2.mkdirSync(dir, { recursive: true });
        targetPath = path2.resolve(dir, "mcp.json");
      } else if (client === "cursor") {
        const dir = path2.resolve(process.cwd(), ".cursor");
        fs2.mkdirSync(dir, { recursive: true });
        targetPath = path2.resolve(dir, "mcp.json");
      } else {
        targetPath = path2.resolve(process.cwd(), ".mcp.json");
      }
      let existingConfig = {};
      if (fs2.existsSync(targetPath)) {
        try {
          existingConfig = JSON.parse(fs2.readFileSync(targetPath, "utf8"));
        } catch {
          existingConfig = {};
        }
      }
      const mcpServers = existingConfig.mcpServers || {};
      mcpServers.jev = {
        command: execCommand,
        ...execArgs ? { args: execArgs } : {},
        env: {
          JEV_BASE_URL: baseUrl,
          JEV_API_KEY: apiKey,
          JEV_MODEL: model
        }
      };
      existingConfig.mcpServers = mcpServers;
      fs2.writeFileSync(targetPath, JSON.stringify(existingConfig, null, 2) + `
`);
    }
    console.log(`
\x1B[32m✔ Success! Jev MCP configuration written to:\x1B[0m`);
    console.log(`  \x1B[1m${targetPath}\x1B[0m
`);
    console.log(`Agent Platform: \x1B[36m${client.toUpperCase()}\x1B[0m`);
    console.log(`Endpoint:       \x1B[36m${baseUrl}\x1B[0m`);
    console.log(`Model:          \x1B[36m${model}\x1B[0m`);
    console.log(`API Key:        \x1B[36m${apiKey.slice(0, 4)}...${apiKey.slice(-4)}\x1B[0m
`);
    console.log(`Your agent is ready to call Jev decision tools immediately!
`);
  } finally {
    rl?.close();
  }
}

// src/client.ts
var RETRYABLE_STATUS_CODES2 = {
  408: true,
  409: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true
};
function sleep2(ms, signal) {
  const { promise, resolve, reject } = Promise.withResolvers();
  if (signal?.aborted) {
    reject(new Error("Request aborted during retry wait"));
    return promise;
  }
  const timer = setTimeout(() => resolve(), ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new Error("Request aborted during retry wait"));
  }, { once: true });
  return promise;
}
async function rawJevJudgment2(state, questions, options = {}) {
  const config = requireConfig({
    protocol: options.protocol,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    timeoutMs: options.timeoutMs
  });
  const protocol = config.protocol;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const timeoutMs = config.timeoutMs;
  const maxRetries = options.maxRetries ?? 2;
  let targetUrl = baseUrl;
  if (protocol === "chat-completions") {
    if (!targetUrl.endsWith("/chat/completions")) {
      targetUrl = `${targetUrl}/chat/completions`;
    }
  }
  const payload = {
    model,
    state,
    questions
  };
  const t0 = performance.now();
  let lastError = null;
  let attempt = 0;
  while (attempt <= maxRetries) {
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const shouldRetry = attempt < maxRetries && Boolean(RETRYABLE_STATUS_CODES2[res.status]);
        if (shouldRetry) {
          attempt++;
          const jitter = Math.random() * 100;
          const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
          await sleep2(delay);
          continue;
        }
        throw new Error(`Jev provider returned HTTP ${res.status} (${res.statusText}) at ${targetUrl}: ${errorText || "(empty body)"}`);
      }
      const rawJson = await res.json();
      const durationMs = Math.round(performance.now() - t0);
      let parsedAnswers = null;
      let returnedModel = model;
      let usage;
      if (protocol === "chat-completions") {
        const choices = rawJson.choices;
        const contentRaw = choices?.[0]?.message?.content;
        if (!contentRaw) {
          throw new Error(`Invalid OpenAI-compatible response: missing message.content in choices[0]. Raw: ${JSON.stringify(rawJson).slice(0, 300)}`);
        }
        try {
          const parsed = JSON.parse(contentRaw);
          parsedAnswers = parsed.answers || parsed;
          if (parsed.model)
            returnedModel = parsed.model;
        } catch (err) {
          throw new Error(`Failed to parse Jev JSON content: "${contentRaw.slice(0, 300)}" (${String(err)})`);
        }
        const rawUsage = rawJson.usage;
        if (rawUsage) {
          usage = rawUsage;
        }
      } else {
        parsedAnswers = rawJson.answers || rawJson;
        if (typeof rawJson.model === "string")
          returnedModel = rawJson.model;
        if (rawJson.usage && typeof rawJson.usage === "object") {
          usage = rawJson.usage;
        }
      }
      if (!parsedAnswers || typeof parsedAnswers !== "object") {
        throw new Error(`Jev response missing 'answers' object. Endpoint: ${targetUrl}, Protocol: ${protocol}`);
      }
      for (const key of Object.keys(parsedAnswers)) {
        const ans = parsedAnswers[key];
        if (ans && ans.type === "noul") {
          ans.bool = ans.noul;
        }
      }
      return {
        model: returnedModel,
        answers: parsedAnswers,
        usage,
        durationMs
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Jev request timed out after ${timeoutMs}ms (endpoint: ${targetUrl}, key: ${redactApiKey(config.apiKey)})`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < maxRetries) {
        attempt++;
        const jitter = Math.random() * 100;
        const delay = Math.min(2000, 200 * Math.pow(2, attempt) + jitter);
        await sleep2(delay);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Jev request failed after ${maxRetries + 1} attempts at ${targetUrl}`);
}
function normalizeQuestion2(input) {
  if (typeof input === "string") {
    return {
      type: "noul",
      instructions: input
    };
  }
  if (typeof input === "object" && input !== null) {
    const raw = input;
    const type = typeof raw.type === "string" ? raw.type.toLowerCase() : undefined;
    if (type === "choice") {
      const rawOpts = raw.criteria ?? raw.options;
      let criteria;
      if (Array.isArray(rawOpts)) {
        criteria = Object.fromEntries(rawOpts.map((k) => [String(k), String(k)]));
      } else if (typeof rawOpts === "object" && rawOpts !== null) {
        criteria = rawOpts;
      } else {
        criteria = { yes: "yes", no: "no" };
      }
      return {
        type: "choice",
        instructions: String(raw.instructions || "Select the most appropriate option"),
        criteria
      };
    }
    if (type === "score") {
      const rawLevels = raw.criteria ?? raw.levels ?? raw.options;
      let criteria;
      if (Array.isArray(rawLevels)) {
        criteria = rawLevels.map(String);
      } else if (typeof rawLevels === "object" && rawLevels !== null) {
        criteria = Object.values(rawLevels).map(String);
      } else {
        criteria = ["1", "2", "3", "4", "5"];
      }
      return {
        type: "score",
        instructions: String(raw.instructions || "Rate the level"),
        criteria
      };
    }
    const noulCriteria = raw.criteria && typeof raw.criteria === "object" ? raw.criteria : undefined;
    return {
      type: "noul",
      instructions: String(raw.instructions || "Is this valid and true?"),
      ...noulCriteria ? { criteria: noulCriteria } : {}
    };
  }
  return {
    type: "noul",
    instructions: String(input)
  };
}
function normalizeQuestions2(input) {
  if (typeof input === "string") {
    return {
      verdict: normalizeQuestion2(input)
    };
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((q, idx) => [`q${idx + 1}`, normalizeQuestion2(q)]));
  }
  if (typeof input === "object" && input !== null) {
    const raw = input;
    if (typeof raw.type === "string" && ["noul", "bool", "boolean", "choice", "score"].includes(raw.type.toLowerCase())) {
      return {
        verdict: normalizeQuestion2(raw)
      };
    }
    const result = {};
    for (const [key, val] of Object.entries(input)) {
      result[key] = normalizeQuestion2(val);
    }
    return result;
  }
  return {
    verdict: {
      type: "noul",
      instructions: "Is this valid?"
    }
  };
}
async function judge2(state, questionInput, options = {}) {
  const questions = normalizeQuestions2(questionInput);
  const result = await rawJevJudgment2(state, questions, options);
  const keys = Object.keys(result.answers);
  const firstKey = keys[0];
  const firstAnswer = firstKey ? result.answers[firstKey] : undefined;
  const verdicts = {};
  const probabilities = {};
  for (const [key, ans] of Object.entries(result.answers)) {
    if (ans.type === "noul") {
      verdicts[key] = ans.noul >= (options.defaultThreshold ?? 0.5);
      probabilities[key] = ans.noul;
    } else if (ans.type === "choice") {
      verdicts[key] = ans.choice;
      probabilities[key] = ans.confidence;
    } else if (ans.type === "score") {
      verdicts[key] = ans.score;
      probabilities[key] = ans.confidence ?? 1;
    }
  }
  let verdict = false;
  let probability;
  let confidence;
  if (firstAnswer) {
    verdict = verdicts[firstKey] ?? false;
    if (firstAnswer.type === "noul") {
      probability = firstAnswer.noul;
    } else if (firstAnswer.type === "choice") {
      confidence = firstAnswer.confidence;
    } else if (firstAnswer.type === "score") {
      confidence = firstAnswer.confidence;
    }
  }
  return {
    verdict,
    probability,
    confidence,
    verdicts,
    probabilities,
    answers: result.answers,
    raw: result
  };
}
async function judgeBool(state, instructions, options = {}) {
  const threshold = options.threshold ?? options.defaultThreshold ?? 0.5;
  const res = await judge2(state, instructions, options);
  return (res.probability ?? (res.verdict === true ? 1 : 0)) >= threshold;
}
async function judgeProbability(state, instructions, options = {}) {
  const res = await judge2(state, instructions, options);
  return res.probability ?? (res.verdict === true ? 1 : 0);
}
async function judgeChoice(state, instructions, options, clientOptions = {}) {
  const res = await judge2(state, {
    type: "choice",
    instructions,
    options
  }, clientOptions);
  return String(res.verdict);
}
async function judgeScore(state, instructions, levels, clientOptions = {}) {
  const res = await judge2(state, {
    type: "score",
    instructions,
    levels
  }, clientOptions);
  return Number(res.verdict);
}
async function judgeMulti(state, questionsMap, clientOptions = {}) {
  return judge2(state, questionsMap, clientOptions);
}
async function judgeBatch(items, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const results = new Array(items.length);
  let currentIndex = 0;
  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      const item = items[idx];
      try {
        const response = await judge2(item.state, item.question, options);
        results[idx] = { id: item.id, success: true, response };
      } catch (err) {
        results[idx] = {
          id: item.id,
          success: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// src/tools/coding.ts
var MAX_DOC_CHARS = 50000;
var MAX_CLAIMS = 16;
var MAX_CLAIM_CHARS = 2000;
var MAX_EVIDENCE_CHARS = 200000;
var REVIEW_WEIGHTS = {
  correctness: 0.4,
  spec_match: 0.3,
  test_gap: 0.15,
  blast_radius: 0.15
};
function truncate(text, maxChars) {
  if (text.length <= maxChars)
    return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)} […truncated]`, truncated: true };
}
function reviewComposite(scores) {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const clamp02 = (v) => Math.min(2, Math.max(0, v));
  const correctness = clamp01(clamp02(scores.correctness) / 2);
  const specMatch = clamp01(clamp02(scores.specMatch) / 2);
  const tests = clamp01(1 - clamp02(scores.testGap) / 2);
  const blast = clamp01(1 - clamp02(scores.blastRadius) / 2);
  return REVIEW_WEIGHTS.correctness * correctness + REVIEW_WEIGHTS.spec_match * specMatch + REVIEW_WEIGHTS.test_gap * tests + REVIEW_WEIGHTS.blast_radius * blast;
}
function reviewAction(input) {
  if (input.minConfidence < input.reviewAt || input.safeToApply < input.reviewAt) {
    return "escalate";
  }
  if (input.safeToApply >= input.autoAccept && input.composite >= input.compositeFloor && input.minConfidence >= input.autoAccept) {
    return "auto";
  }
  return "review";
}
async function reviewDiff(input, context) {
  const diffTrunc = truncate(input.diff, MAX_DOC_CHARS);
  const reqTrunc = truncate(input.request, MAX_DOC_CHARS);
  const testsTrunc = input.tests ? truncate(input.tests, MAX_DOC_CHARS) : undefined;
  const isTruncated = diffTrunc.truncated || reqTrunc.truncated || (testsTrunc?.truncated ?? false);
  const autoAccept = input.auto_accept ?? 0.8;
  const reviewAt = input.review_at ?? Math.min(0.5, autoAccept);
  const compositeFloor = input.composite_floor ?? 0.7;
  let state = `TASK REQUEST:
${reqTrunc.text}

PROPOSED DIFF / PATCH:
${diffTrunc.text}`;
  if (testsTrunc) {
    state += `

TEST RESULTS / VERIFICATION EVIDENCE:
${testsTrunc.text}`;
  }
  const questions = {
    correctness: {
      type: "score",
      instructions: "Rate the correctness and bug-freeness of this patch (0 = broken/buggy, 1 = plausible with issues, 2 = correct and complete).",
      criteria: ["broken or buggy", "plausible with non-blocking issues", "correct and complete"]
    },
    spec_match: {
      type: "score",
      instructions: "Does this patch fulfill the task request? (0 = diverges, 1 = partial match, 2 = exact specification match).",
      criteria: ["diverges from request", "partial match", "exact specification match"]
    },
    test_gap: {
      type: "score",
      instructions: "Assess test coverage or gap for critical paths (0 = well tested/safe or non-executable documentation/styling, 1 = partial tests, 2 = untested critical path). For non-code changes (documentation, markdown, comments), rate 0.",
      criteria: ["well tested/safe or non-code docs", "partial test coverage", "untested critical path"]
    },
    blast_radius: {
      type: "score",
      instructions: "Assess regression risk or blast radius (0 = tight localized changes or non-code docs, 1 = moderate, 2 = wide unconstrained blast radius).",
      criteria: ["tight localized changes or non-code docs", "moderate blast radius", "wide unconstrained blast radius"]
    },
    safe_to_apply: {
      type: "noul",
      instructions: "Is this patch safe to apply and merge without breaking production?"
    }
  };
  const raw = await rawJevJudgment2(state, questions, context?.options);
  const ans = raw.answers;
  const correctness = ans.correctness?.score ?? 0;
  const specMatch = ans.spec_match?.score ?? 0;
  const testGap = ans.test_gap?.score ?? 2;
  const blastRadius = ans.blast_radius?.score ?? 2;
  const safeToApply = ans.safe_to_apply?.noul ?? 0;
  const minConf = Math.min(ans.correctness?.confidence ?? 1, ans.spec_match?.confidence ?? 1, ans.test_gap?.confidence ?? 1, ans.blast_radius?.confidence ?? 1);
  const composite = reviewComposite({
    correctness,
    specMatch,
    testGap,
    blastRadius
  });
  let action = reviewAction({
    composite,
    safeToApply,
    minConfidence: minConf,
    autoAccept,
    reviewAt,
    compositeFloor
  });
  if (isTruncated && action === "auto") {
    action = "review";
  }
  return {
    scores: {
      correctness,
      spec_match: specMatch,
      test_gap: testGap,
      blast_radius: blastRadius
    },
    composite: Math.round(composite * 100) / 100,
    safe_to_apply: safeToApply,
    safe_to_apply_verdict: safeToApply >= autoAccept,
    action,
    truncated: isTruncated,
    thresholds: {
      auto_accept: autoAccept,
      review_at: reviewAt,
      composite_floor: compositeFloor
    }
  };
}
async function gatePatch(input, context) {
  const reviewRes = await reviewDiff(input, context);
  const claims = (input.claims || []).slice(0, MAX_CLAIMS).map((c) => truncate(c, MAX_CLAIM_CHARS).text);
  let evidenceText = "";
  if (typeof input.evidence === "string") {
    evidenceText = truncate(input.evidence, MAX_EVIDENCE_CHARS).text;
  } else if (Array.isArray(input.evidence)) {
    evidenceText = input.evidence.map((item, idx) => `[Evidence ${item.id ?? idx + 1}]:
${item.text}`).join(`

`);
    evidenceText = truncate(evidenceText, MAX_EVIDENCE_CHARS).text;
  }
  if (claims.length === 0) {
    return {
      ...reviewRes,
      claims: [],
      all_claims_verified: true,
      contradicted_count: 0
    };
  }
  const claimQuestions = {};
  for (let i = 0;i < claims.length; i++) {
    claimQuestions[`claim_${i}`] = {
      type: "choice",
      instructions: `Evaluate whether the evidence supports, contradicts, or says nothing about this claim: "${claims[i]}"`,
      criteria: {
        supports: "The evidence clearly supports and confirms the claim",
        contradicts: "The evidence contradicts, disproves, or shows failure for the claim",
        says_nothing: "The evidence neither supports nor contradicts the claim (or is silent)"
      }
    };
  }
  const state = `EVIDENCE FOR COMPLETION CLAIMS:
${evidenceText}`;
  const rawClaims = await rawJevJudgment2(state, claimQuestions, context?.options);
  const claimResults = [];
  let contradictedCount = 0;
  let allVerified = true;
  const autoAccept = input.auto_accept ?? 0.8;
  const reviewAt = input.review_at ?? Math.min(0.5, autoAccept);
  for (let i = 0;i < claims.length; i++) {
    const ans = rawClaims.answers[`claim_${i}`];
    const choice = ans?.choice ?? "says_nothing";
    const confidence = ans?.confidence ?? 0;
    const probs = ans?.probabilities ?? {};
    let verdict = "unsupported";
    if (choice === "supports")
      verdict = "verified";
    else if (choice === "contradicts")
      verdict = "contradicted";
    else
      verdict = "unsupported";
    if (verdict === "contradicted") {
      contradictedCount++;
      allVerified = false;
    } else if (verdict !== "verified") {
      allVerified = false;
    }
    const action = confidence >= autoAccept && verdict === "verified" ? "auto" : "review";
    claimResults.push({
      claim: claims[i],
      verdict,
      probabilities: probs,
      confidence,
      action
    });
  }
  let finalAction = reviewRes.action;
  if (contradictedCount > 0) {
    finalAction = "escalate";
  } else if (!allVerified && finalAction === "auto") {
    finalAction = "review";
  }
  return {
    ...reviewRes,
    action: finalAction,
    claims: claimResults,
    all_claims_verified: allVerified,
    contradicted_count: contradictedCount
  };
}
async function screenAction(input, context) {
  const state = `Action an autonomous agent is about to execute:
${input.action}` + (input.context ? `

Task Context:
${input.context}` : "");
  const questions = {
    risk: {
      type: "score",
      instructions: "How risky is it to run this action automatically? (0 = safe/read-only, 1 = low, 2 = needs review, 3 = high/destructive).",
      criteria: [
        "safe and read-only",
        "low risk",
        "needs human review",
        "high risk — could destroy data, drop tables, or break production"
      ]
    },
    touches_prod: {
      type: "noul",
      instructions: "Does this action touch production environments or delete/overwrite important data?"
    },
    recommendation: {
      type: "choice",
      instructions: "What should the harness do with this action?",
      criteria: {
        allow: "safe to run automatically without prompting",
        confirm: "pause and ask human operator to confirm",
        block: "block execution and require a safer alternative"
      }
    }
  };
  const raw = await rawJevJudgment2(state, questions, context?.options);
  const ans = raw.answers;
  const recAns = ans.recommendation;
  const riskAns = ans.risk;
  const prodAns = ans.touches_prod;
  const recChoice = recAns?.choice ?? "confirm";
  const recommendation = recChoice === "allow" || recChoice === "block" ? recChoice : "confirm";
  return {
    recommendation,
    confidence: recAns?.confidence ?? 0.5,
    risk_score: riskAns?.score ?? 1.5,
    touches_prod: (prodAns?.noul ?? 0) >= 0.5,
    touches_prod_probability: prodAns?.noul ?? 0
  };
}
var jevReviewTool = {
  name: "jev_review",
  aliases: ["jev_review_patch"],
  description: `Score a proposed git diff / patch against the task request without confirmation bias.
` + `USE WHEN: Reviewing code changes to evaluate correctness, spec conformance, test coverage gaps, and blast radius.
` + `SKIP WHEN: You only have completion claims to verify without a code diff (use jev_verify).
` + "RETURNS: Rubric scores (0..2), composite score (0..1), safe_to_apply probability, and action (auto | review | escalate).",
  inputSchema: {
    type: "object",
    properties: {
      diff: { type: "string", description: "The git diff or patch text to evaluate." },
      request: { type: "string", description: "The original task request or acceptance specification." },
      tests: { type: "string", description: "Optional output log from executed tests." },
      auto_accept: { type: "number", description: "Threshold for auto-approval (default: 0.8)." },
      review_at: { type: "number", description: "Threshold below which to escalate to human (default: min(0.5, auto_accept))." },
      composite_floor: { type: "number", description: "Minimum weighted composite score required for auto (default: 0.7)." }
    },
    required: ["diff", "request"]
  },
  handler: async (args, context) => {
    return reviewDiff(args, context);
  }
};
var jevGateTool = {
  name: "jev_gate",
  aliases: ["jev_gate_acceptance"],
  description: `Acceptance gate before declaring a task done: reviews patch diff AND audits developer completion claims against evidence logs.
` + `USE WHEN: Calling a feature done, closing an issue, or creating a final PR to prevent fake done claims.
` + `SKIP WHEN: Only scoring a diff without checking test/log assertions (use jev_review).
` + "RETURNS: Review scores and claim verdicts (verified | contradicted | unsupported). Strictly escalates if any claim is contradicted.",
  inputSchema: {
    type: "object",
    properties: {
      diff: { type: "string", description: "The git diff or patch text to evaluate." },
      request: { type: "string", description: "The original task request." },
      claims: {
        type: "array",
        items: { type: "string" },
        description: "List of completion claims to verify against evidence (e.g. ['all unit tests pass', 'no secrets committed'])."
      },
      evidence: {
        type: "string",
        description: "The evidence text or logs (e.g. terminal test runner output, curl response)."
      },
      tests: { type: "string", description: "Optional test log output." },
      auto_accept: { type: "number", description: "Threshold for auto-approval (default: 0.8)." },
      review_at: { type: "number", description: "Threshold for escalation (default: min(0.5, auto_accept))." },
      composite_floor: { type: "number", description: "Minimum composite score (default: 0.7)." }
    },
    required: ["diff", "request", "claims", "evidence"]
  },
  handler: async (args, context) => {
    return gatePatch(args, context);
  }
};
var jevActionGateTool = {
  name: "jev_action_gate",
  aliases: ["jev_screen_command"],
  description: `Pre-execution safety screening before running autonomous shell commands or file operations.
` + `USE WHEN: About to execute a potentially destructive or production-affecting action (e.g. rm, drop, alter, restart, overwrite).
` + `SKIP WHEN: The action is a routine read-only command (e.g. ls, cat, git status, reading files).
` + "RETURNS: Risk score (0..3), touches_prod boolean, and recommendation (allow | confirm | block).",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "The shell command or action about to run." },
      context: { type: "string", description: "Optional context describing what the agent is attempting to accomplish." }
    },
    required: ["action"]
  },
  handler: async (args, context) => {
    return screenAction(args, context);
  }
};

// src/cli.ts
function printHelp() {
  console.log(`
\x1B[1m\x1B[36mjev (Universal TypeSafe Jev Decision CLI)\x1B[0m
Fast, calibrated decision model runner for coding gating, diff reviews, research decisions, and verification.

\x1B[1mUSAGE:\x1B[0m
  jev <state> <question>                 Quick yes/no question
  jev review --diff <file> --request <text>   Review git diff / patch quality
  jev gate --diff <file> --request <text> --evidence <log> --claim <claim> Gating before done
  jev [options]                          Advanced structured judgment

\x1B[1mSUBCOMMANDS:\x1B[0m
  setup                      Interactive wizard to configure MCP for Claude Code, OMP, Cursor, or workspace
  review                     Evaluate git diff / patch (correctness, spec match, test gap, blast radius)
  gate                       Gating verification: diff review + developer claims vs evidence (Anti-Fake Done)
\x1B[1mOPTIONS:\x1B[0m
  -s, --state <text>         State/content/code to evaluate
  -f, --file <path>          Read state from a file (e.g. diff, log, source)
  -q, --question <text>      Yes/No question to answer
  -c, --choice <options>     Comma-separated list of choice options (e.g. "bug,feature,docs")
  --score <levels>           Comma-separated rating scale (e.g. "trivial,minor,major,critical")
  --questions <json|file>    Multi-question JSON string or path to JSON rubric file
  --request <text>           Task specification / ticket description for review/gate
  --evidence <file|text>     Evidence log / test runner output for gate
  --claim <claim>            Claim to verify in gate (can be repeated)
  --timeout <ms>             Request timeout in milliseconds (default: 20000)
  --json                     Output result as formatted JSON to stdout
  --raw                      Output raw unformatted JSON
  --quiet                    Output only the bare verdict (e.g. "true", "auto", "0.95")
  --threshold <float>        Probability threshold (default: 0.5). Exits 0 if >=, 1 if <
  --stdin                    Read state or diff from standard input
  --protocol <name>          Protocol: chat-completions (default) or typesafe-direct
  --model <name>             Model ID (defaults to JEV_MODEL or OPENAI_MODEL)
  --base-url <url>           Endpoint URL (defaults to JEV_BASE_URL or OPENAI_BASE_URL)
  --api-key <key>            API key (defaults to JEV_API_KEY or OPENAI_API_KEY)
  -h, --help                 Show this help message

\x1B[1mEXAMPLES:\x1B[0m
  # Quick check (exit code 0 if yes, 1 if no):
  jev "rm -rf /var/log/*" "Is this safe to run automatically?" --threshold 0.5

  # Pipe git diff for patch review:
  git diff | jev review --stdin --request "Refactor auth middleware"

  # Acceptance gate before committing:
  git diff | jev gate --stdin --request "Fix race condition" --evidence test.log --claim "unit tests pass"

  # Multi-choice categorization:
  jev -s "PostgreSQL connection timeout" -c "network,database,client"
`);
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }
  const subCommand = args[0] === "review" || args[0] === "gate" || args[0] === "setup" ? args[0] : null;
  const filteredArgs = subCommand ? args.slice(1) : args;
  let state;
  let question;
  let choice;
  let score;
  let questionsArg;
  let filePath;
  let requestText;
  let evidenceText;
  const claims = [];
  let jsonOutput = false;
  let rawOutput = false;
  let quietOutput = false;
  let threshold = 0.5;
  let useStdin = false;
  let batchMode = false;
  let explicitApiKey;
  let explicitBaseUrl;
  let explicitModel;
  let explicitProtocol;
  let explicitTimeout;
  const positional = [];
  for (let i = 0;i < filteredArgs.length; i++) {
    const arg = filteredArgs[i];
    if (arg === "-s" || arg === "--state") {
      state = filteredArgs[++i];
    } else if (arg === "-f" || arg === "--file") {
      filePath = filteredArgs[++i];
    } else if (arg === "-q" || arg === "--question") {
      question = filteredArgs[++i];
    } else if (arg === "-c" || arg === "--choice") {
      choice = filteredArgs[++i];
    } else if (arg === "--score") {
      score = filteredArgs[++i];
    } else if (arg === "--questions") {
      questionsArg = filteredArgs[++i];
    } else if (arg === "--request") {
      requestText = filteredArgs[++i];
    } else if (arg === "--evidence") {
      const ev = filteredArgs[++i];
      if (fs3.existsSync(ev)) {
        evidenceText = fs3.readFileSync(ev, "utf8");
      } else {
        evidenceText = ev;
      }
    } else if (arg === "--claim") {
      claims.push(filteredArgs[++i]);
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--raw") {
      rawOutput = true;
    } else if (arg === "--quiet") {
      quietOutput = true;
    } else if (arg === "--threshold") {
      threshold = Number.parseFloat(filteredArgs[++i]);
    } else if (arg === "--timeout") {
      explicitTimeout = Number.parseInt(filteredArgs[++i], 10);
    } else if (arg === "--stdin") {
      useStdin = true;
    } else if (arg === "--batch") {
      batchMode = true;
    } else if (arg === "--api-key") {
      explicitApiKey = filteredArgs[++i];
    } else if (arg === "--base-url") {
      explicitBaseUrl = filteredArgs[++i];
    } else if (arg === "--model") {
      explicitModel = filteredArgs[++i];
    } else if (arg === "--protocol") {
      explicitProtocol = filteredArgs[++i];
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  if (useStdin || !state && !filePath && positional.length === 0 && !process.stdin.isTTY) {
    const piped = await readStdin();
    if (piped.trim().length > 0) {
      state = piped;
    }
  } else if (filePath) {
    if (!fs3.existsSync(filePath)) {
      console.error(`\x1B[31mError: File not found: ${filePath}\x1B[0m`);
      process.exit(1);
    }
    state = fs3.readFileSync(filePath, "utf8");
  }
  const clientOptions = {
    apiKey: explicitApiKey,
    baseUrl: explicitBaseUrl,
    model: explicitModel,
    protocol: explicitProtocol,
    timeoutMs: explicitTimeout,
    defaultThreshold: threshold
  };
  if (subCommand === "setup") {
    let targetClient;
    let isGlobal = false;
    for (let i = 0;i < filteredArgs.length; i++) {
      if (filteredArgs[i] === "--client" && filteredArgs[i + 1]) {
        targetClient = filteredArgs[++i];
      } else if (filteredArgs[i] === "--global") {
        isGlobal = true;
      }
    }
    await runSetupWizard({
      client: targetClient,
      baseUrl: explicitBaseUrl,
      apiKey: explicitApiKey,
      model: explicitModel,
      global: isGlobal
    });
    process.exit(0);
  }
  if (subCommand === "review") {
    const diff = state || positional[0];
    const req = requestText || positional[1] || "Review code patch for correctness, security, and quality";
    if (!diff) {
      console.error("\x1B[31mError: Missing diff for review. Pipe via --stdin or provide --file.\x1B[0m");
      process.exit(1);
    }
    const res = await reviewDiff({ diff, request: req }, { options: clientOptions });
    if (jsonOutput || rawOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else if (quietOutput) {
      console.log(res.action);
    } else {
      console.log(`
\x1B[1mPatch Review Verdict:\x1B[0m \x1B[36m${res.action.toUpperCase()}\x1B[0m (Composite: ${res.composite}/1.0)`);
      console.log(`  - Correctness: ${res.scores.correctness}/2.0`);
      console.log(`  - Spec Match:  ${res.scores.spec_match}/2.0`);
      console.log(`  - Test Gap:    ${res.scores.test_gap}/2.0`);
      console.log(`  - Blast Radius:${res.scores.blast_radius}/2.0`);
      console.log(`  - Safe to Apply: ${res.safe_to_apply >= res.thresholds.auto_accept ? "YES" : "NO"} (${(res.safe_to_apply * 100).toFixed(0)}%)`);
    }
    process.exit(res.action === "escalate" ? 1 : 0);
  }
  if (subCommand === "gate") {
    const diff = state || positional[0];
    const req = requestText || positional[1] || "Verify acceptance criteria";
    const evidence = evidenceText || positional[2] || "";
    if (!diff) {
      console.error("\x1B[31mError: Missing diff for gate. Pipe via --stdin or provide --file.\x1B[0m");
      process.exit(1);
    }
    const res = await gatePatch({ diff, request: req, claims, evidence }, { options: clientOptions });
    if (jsonOutput || rawOutput) {
      console.log(JSON.stringify(res, null, 2));
    } else if (quietOutput) {
      console.log(res.action);
    } else {
      console.log(`
\x1B[1mAcceptance Gate Verdict:\x1B[0m \x1B[36m${res.action.toUpperCase()}\x1B[0m (Composite: ${res.composite}/1.0)`);
      console.log(`  - Claims Verified: ${res.all_claims_verified ? "YES" : "NO"} (${res.claims.length - res.contradicted_count}/${res.claims.length})`);
      if (res.claims.length > 0) {
        for (const c of res.claims) {
          const color = c.verdict === "verified" ? "\x1B[32m" : c.verdict === "contradicted" ? "\x1B[31m" : "\x1B[33m";
          console.log(`    * [${color}${c.verdict.toUpperCase()}\x1B[0m] ${c.claim}`);
        }
      }
    }
    process.exit(res.action === "escalate" ? 1 : 0);
  }
  if (!state && positional.length > 0) {
    state = positional[0];
    if (positional.length > 1 && !question && !choice && !score && !questionsArg) {
      question = positional.slice(1).join(" ");
    }
  }
  if (!state) {
    console.error("\x1B[31mError: Missing state to evaluate. Use -s, -f, or --stdin.\x1B[0m");
    process.exit(1);
  }
  let questionInput = "Is this true and valid?";
  if (questionsArg) {
    if (fs3.existsSync(questionsArg)) {
      questionInput = JSON.parse(fs3.readFileSync(questionsArg, "utf8"));
    } else {
      try {
        questionInput = JSON.parse(questionsArg);
      } catch {
        questionInput = questionsArg;
      }
    }
  } else if (choice) {
    const options = choice.split(",").map((s) => s.trim()).filter(Boolean);
    questionInput = {
      type: "choice",
      instructions: question || "Choose the best option:",
      options
    };
  } else if (score) {
    const levels = score.split(",").map((s) => s.trim()).filter(Boolean);
    questionInput = {
      type: "score",
      instructions: question || "Rate the level:",
      levels
    };
  } else if (question) {
    questionInput = question;
  }
  const res = await judge(state, questionInput, clientOptions);
  if (rawOutput) {
    console.log(JSON.stringify(res.raw));
    process.exit(0);
  }
  if (jsonOutput) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }
  if (quietOutput) {
    console.log(String(res.verdict));
    if (typeof res.verdict === "boolean") {
      process.exit(res.verdict ? 0 : 1);
    }
    process.exit(0);
  }
  console.log(`
\x1B[1mVerdict:\x1B[0m \x1B[36m${String(res.verdict)}\x1B[0m`);
  if (res.probability !== undefined) {
    console.log(`\x1B[1mProbability:\x1B[0m ${(res.probability * 100).toFixed(1)}%`);
  }
  if (res.confidence !== undefined) {
    console.log(`\x1B[1mConfidence:\x1B[0m ${(res.confidence * 100).toFixed(1)}%`);
  }
  if (typeof res.verdict === "boolean") {
    process.exit(res.verdict ? 0 : 1);
  }
}
main().catch((err) => {
  console.error(`\x1B[31mExecution error: ${err instanceof Error ? err.message : String(err)}\x1B[0m`);
  process.exit(1);
});
