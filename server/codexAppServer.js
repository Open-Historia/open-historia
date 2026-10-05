import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const REQUEST_TIMEOUT_MS = 30_000;
const GENERATION_TIMEOUT_MS = 5 * 60_000;
const CLIENT_VERSION = "0.1.0";
const BASE_INSTRUCTIONS = [
  "You are the text-generation backend for the Open Historia historical simulation game.",
  "Follow the developer instructions and conversation exactly.",
  "Return only the requested final content, without process commentary.",
  "You may use web search, the shell, and files in the provided workspace when useful.",
].join(" ");

const isWindows = process.platform === "win32";

const executableVersion = (candidate) => {
  try {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    const output = `${result.stdout ?? ""} ${result.stderr ?? ""}`.trim();
    return /codex-cli\s+([\w.-]+)/i.exec(output)?.[1] ?? null;
  } catch {
    return null;
  }
};

function windowsCodexCandidates() {
  const candidates = [];
  const binDir = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin");

  try {
    const nested = fs.readdirSync(binDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binDir, entry.name, "codex.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => ({ candidate, mtime: fs.statSync(candidate).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => entry.candidate);
    candidates.push(...nested);
  } catch {
    // Codex Desktop is optional; fall through to other installations.
  }

  candidates.push(path.join(binDir, "codex.exe"));
  return candidates;
}

export function resolveCodexExecutable() {
  const candidates = [
    process.env.OH_CODEX_PATH,
    process.env.CODEX_CLI_PATH,
    ...(isWindows ? windowsCodexCandidates() : []),
    isWindows ? "codex.exe" : "codex",
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    const version = executableVersion(candidate);
    if (version) return { path: candidate, version };
  }

  throw new Error("Codex CLI was not found. Install Codex or set OH_CODEX_PATH, then run `codex login`.");
}

// Show every non-hidden model from the appropriate catalog; no generation allowlist.
export function getAvailableCodexModels(models) {
  return (models ?? []).filter((model) => !model.hidden);
}

export const getAvailableChatGPTModels = getAvailableCodexModels;

const availableModels = (models, official) => official ? getAvailableChatGPTModels(models) : getAvailableCodexModels(models);

export function selectPreferredModel(models, { official = false } = {}) {
  const visible = availableModels(models, official);
  return visible.find((model) => model.isDefault)
    ?? visible[0]
    ?? null;
}

export function selectCodexModel(models, requestedModel, { official = false } = {}) {
  const available = availableModels(models, official);
  if (requestedModel) {
    const selected = available.find((model) => (model.model || model.id) === requestedModel);
    if (!selected) throw new Error("The selected model is no longer available. Refresh the model list and choose again.");
    return selected;
  }
  return selectPreferredModel(available, { official });
}

export function selectPreferredEffort(model) {
  const efforts = (model?.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);
  if (efforts.includes("medium")) return "medium";
  if (efforts.includes(model?.defaultReasoningEffort)) return model.defaultReasoningEffort;
  return efforts[0] ?? null;
}

export function normalizeGenerationTimeout(timeoutMs) {
  if (timeoutMs === 0) return 0;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) return Math.max(1, Math.floor(timeoutMs));
  return GENERATION_TIMEOUT_MS;
}

// Codex's `codex_output_schema` uses the strict structured-output subset of
// JSON Schema. In that subset every object must declare `additionalProperties:
// false`, and `required` must contain every key in `properties` (there is no
// notion of an omitted optional property). Open Historia's shared schemas are
// intentionally looser because the other providers accept optional fields and
// the normalizers fill sensible defaults. Normalize a private copy only on the
// Codex path so those providers keep their existing response contract.
export function toCodexStrictSchema(schema) {
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    const next = {};
    for (const [key, child] of Object.entries(value)) {
      // Rebuild these below. Keeping a partial `required` array is precisely
      // what makes the app-server reject a schema before generation starts.
      if (key === "required" || key === "additionalProperties") continue;
      if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
        next.properties = Object.fromEntries(
          Object.entries(child).map(([propertyName, propertySchema]) => [propertyName, visit(propertySchema)]),
        );
      } else {
        next[key] = visit(child);
      }
    }

    const propertyNames = next.properties && typeof next.properties === "object" && !Array.isArray(next.properties)
      ? Object.keys(next.properties)
      : null;
    const isObjectSchema = propertyNames !== null
      || next.type === "object"
      || (Array.isArray(next.type) && next.type.includes("object"));
    if (isObjectSchema) {
      next.additionalProperties = false;
      next.required = propertyNames ?? [];
    }
    return next;
  };

  return visit(schema);
}

const compactProgressText = (value, maxLength = 240) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

// Convert the app-server's rich event stream into a small, secrets-safe set of
// UI activities. Command output, tool arguments and file contents deliberately
// never cross the HTTP boundary.
export function codexProgressFromNotification(message) {
  const method = message?.method;
  const params = message?.params ?? {};
  const item = params.item ?? {};
  const state = method === "item/completed" ? "completed" : "started";

  if (method === "turn/started") return { kind: "thinking", state: "started" };
  if (method === "turn/plan/updated") return { kind: "planning", state: "started" };
  if (method === "item/reasoning/summaryTextDelta") {
    const delta = compactProgressText(params.delta, 1000);
    return delta ? { kind: "summary", state: "streaming", delta } : null;
  }
  if (method === "item/agentMessage/delta") {
    const delta = typeof params.delta === "string" ? params.delta : "";
    return { kind: "writing", state: "streaming", ...(delta ? { delta } : {}) };
  }

  if (method !== "item/started" && method !== "item/completed") return null;
  switch (item.type) {
  case "reasoning":
    return { kind: "thinking", state };
  case "plan":
    return { kind: "planning", state };
  case "webSearch":
    return { kind: "web_search", state, detail: compactProgressText(item.query) };
  case "commandExecution":
    return { kind: "shell", state };
  case "fileChange":
    return { kind: "file", state };
  case "mcpToolCall":
    return {
      kind: "tool",
      state,
      detail: compactProgressText([item.server, item.tool].filter(Boolean).join(" / "), 120),
    };
  case "dynamicToolCall":
    return { kind: "tool", state, detail: compactProgressText(item.tool, 120) };
  case "agentMessage":
    return { kind: "writing", state };
  default:
    return null;
  }
}

const maskEmail = (email) => {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
};

const cleanModels = (models, official = false) => availableModels(models, official)
  .map((model) => ({
    id: model.model || model.id,
    displayName: model.displayName || model.model || model.id,
    description: model.description || "",
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map((option) => ({
      value: option.reasoningEffort,
      description: option.description || "",
    })),
    defaultReasoningEffort: model.defaultReasoningEffort ?? null,
    isDefault: Boolean(model.isDefault),
  }));

export const chatgptPlanArguments = (catalogPath) => [
  "app-server", "--listen", "stdio://",
  "-c", 'model_provider="openai_chatgpt_plan"',
  "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
  "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
  "-c", 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
  "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
  "-c", "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
  "-c", "model_providers.openai_chatgpt_plan.supports_websockets=false",
  ...(catalogPath ? ["-c", `model_catalog_json=${JSON.stringify(catalogPath.replaceAll("\\", "/"))}`] : []),
];

// Subscription sharing currently rejects the built-in tool_search tool.
// This is tool discovery, not web_search: shell/files/custom tools remain enabled.
export function chatgptRuntimeCatalog(catalog) {
  return { models: catalog.models.map((model) => ({ ...model, supports_search_tool: false })) };
}

// The HTTP catalog determines which models to show. The app-server catalog is
// used only for reasoning options, never as proof of account entitlement.
export function mergeChatGPTCatalog(accountModels, runtimeModels) {
  return getAvailableChatGPTModels(accountModels).map((entry) => {
    const runtime = runtimeModels.find((candidate) => (candidate.model || candidate.id) === entry.id);
    return { ...runtime, ...entry, supportedReasoningEfforts: entry.supportedReasoningEfforts ?? runtime?.supportedReasoningEfforts ?? [] };
  });
}

const formatConversation = (history) => {
  const entries = Array.isArray(history) ? history : [];
  return entries.map((entry) => {
    const role = entry?.role === "model" ? "ASSISTANT" : "USER";
    const text = entry?.parts?.map((part) => part?.text ?? "").join("") ?? "";
    return `[${role}]\n${text}`;
  }).join("\n\n");
};

export class CodexAppServer {
  constructor({ workspaceDir, officialAuth } = {}) {
    this.workspaceDir = workspaceDir ?? path.join(os.tmpdir(), "open-historia-codex-workspace");
    this.process = null;
    this.reader = null;
    this.pending = new Map();
    this.generations = new Map();
    this.nextId = 0;
    this.startPromise = null;
    this.executable = null;
    this.officialAuth = officialAuth ?? null;
    this.accessToken = null;
    this.generationQueue = Promise.resolve();
    this.accountEpoch = 0;
  }

  async start() {
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      if (this.officialAuth) {
        const token = await this.officialAuth.getCredential();
        if (this.process && token !== this.accessToken) await this.#stopProcess();
        this.accessToken = token;
      }
      if (this.process && !this.process.killed) return;
      await this.#startProcess();
    })().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async #startProcess() {
    this.executable = resolveCodexExecutable();
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    const env = { ...process.env };
    let catalogPath;
    if (this.officialAuth) {
      env.ACCESS_TOKEN = this.accessToken;
      env.CODEX_HOME = path.join(this.officialAuth.storageDir, "runtime");
      delete env.OPENAI_API_KEY;
      fs.mkdirSync(env.CODEX_HOME, { recursive: true });
      catalogPath = path.join(env.CODEX_HOME, "plan-models.json");
      const catalog = chatgptRuntimeCatalog(await this.officialAuth.getModelCatalog());
      fs.writeFileSync(catalogPath, JSON.stringify(catalog), { mode: 0o600 });
    }
    this.process = spawn(this.executable.path, this.officialAuth ? chatgptPlanArguments(catalogPath) : ["app-server"], {
      cwd: this.workspaceDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on("line", (line) => this.#handleLine(line));
    this.process.stderr.on("data", () => {
      // App-server diagnostics can include local paths. Keep them out of game/browser logs.
    });
    const child = this.process;
    child.once("exit", (code) => { if (this.process === child) this.#handleExit(code); });
    child.once("error", (error) => { if (this.process === child) this.#handleExit(error); });

    await this.#request("initialize", {
      clientInfo: {
        name: this.officialAuth ? "Open Historia" : "open_historia",
        title: "Open Historia",
        version: CLIENT_VERSION,
      },
      capabilities: null,
    });
    this.#write({ method: "initialized", params: {} });
  }

  #write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Codex App Server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server timed out during ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#write({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Codex App Server request failed."));
      else pending.resolve(message.result);
      return;
    }

    if (message.id != null && message.method) {
      this.#write({ id: message.id, error: { code: -32601, message: "Interactive client request is unavailable." } });
      return;
    }

    const threadId = message.params?.threadId;
    const generation = threadId ? this.generations.get(threadId) : null;
    if (!generation) return;

    const progress = codexProgressFromNotification(message);
    if (progress) generation.onProgress?.(progress);

    if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
      generation.answer = message.params.item.text ?? generation.answer;
    }

    if (message.method === "turn/completed") {
      clearTimeout(generation.timer);
      this.generations.delete(threadId);
      const turn = message.params?.turn;
      if (turn?.status === "completed" && generation.answer) generation.resolve(generation.answer);
      else generation.reject(new Error(turn?.error?.message || "Codex generation did not return text."));
    }
  }

  #handleExit(reason) {
    const error = reason instanceof Error
      ? reason
      : new Error(`Codex App Server stopped${reason == null ? "" : ` (${reason})`}.`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    for (const generation of this.generations.values()) {
      clearTimeout(generation.timer);
      generation.reject(error);
    }
    this.pending.clear();
    this.generations.clear();
    this.reader?.close();
    this.reader = null;
    this.process = null;
  }

  async #readModels() {
    const result = await this.#request("model/list", { limit: 100 });
    return result?.data ?? [];
  }

  async getStatus() {
    if (this.officialAuth) {
      const publicStatus = await this.officialAuth.getPublicStatus();
      if (!publicStatus.account.planUsageEnabled || publicStatus.pendingLogin) {
        return { ...publicStatus, available: true, models: [], defaultModel: null, defaultReasoningEffort: null, rateLimits: null };
      }
      if (!this.generations.size) await this.start();
      const models = await this.#availableModels();
      const preferred = selectPreferredModel(models, { official: true });
      return { ...publicStatus, available: true, cliVersion: this.executable?.version,
        models: cleanModels(models, true), defaultModel: preferred?.model ?? preferred?.id ?? null,
        defaultReasoningEffort: selectPreferredEffort(preferred), rateLimits: null };
    }
    await this.start();
    const [accountResult, rawModels, limitsResult] = await Promise.all([
      this.#request("account/read", { refreshToken: false }),
      this.#readModels(),
      this.#request("account/rateLimits/read").catch(() => null),
    ]);
    const preferred = selectPreferredModel(rawModels);
    const models = cleanModels(rawModels);
    const defaultModel = preferred?.model || preferred?.id || null;

    return {
      available: true,
      cliVersion: this.executable?.version ?? null,
      account: {
        loggedIn: accountResult?.account?.type === "chatgpt",
        type: accountResult?.account?.type ?? null,
        planType: accountResult?.account?.planType ?? null,
        maskedEmail: maskEmail(accountResult?.account?.email),
        requiresOpenaiAuth: Boolean(accountResult?.requiresOpenaiAuth),
      },
      models,
      defaultModel,
      defaultReasoningEffort: selectPreferredEffort(preferred),
      rateLimits: limitsResult?.rateLimits ?? null,
    };
  }

  async #availableModels() {
    const runtimeModels = await this.#readModels();
    if (!this.officialAuth) return runtimeModels;
    return mergeChatGPTCatalog(await this.officialAuth.listModels(), runtimeModels);
  }

  generate(options) {
    if (!this.officialAuth) return this.#generate(options);
    // A rotated bearer token requires restarting the child. Serialize official
    // turns so renewal cannot interrupt another in-flight generation.
    const epoch = this.accountEpoch;
    const result = this.generationQueue.then(() => {
      if (epoch !== this.accountEpoch) throw new Error("Generation cancelled because the ChatGPT connection changed.");
      return this.#generate(options);
    });
    this.generationQueue = result.catch(() => {});
    return result;
  }

  async #generate({
    systemPrompt,
    history,
    model: requestedModel,
    effort: requestedEffort,
    timeoutMs,
    signal,
    onProgress,
    outputSchema,
  }) {
    if (signal?.aborted) throw signal.reason ?? new Error("Codex generation was cancelled.");
    await this.start();
    const account = this.officialAuth ? null : await this.#request("account/read", { refreshToken: false });
    if (!this.officialAuth && account?.account?.type !== "chatgpt") {
      throw new Error("Codex is not logged in with ChatGPT. Run `codex login` first.");
    }

    const rawModels = await this.#availableModels();
    const selected = selectCodexModel(rawModels, requestedModel, { official: Boolean(this.officialAuth) });
    if (!selected) throw new Error(this.officialAuth
      ? "No supported ChatGPT plan models are available for this account."
      : "No Codex models are available for this ChatGPT account.");

    const supportedEfforts = (selected.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort);
    const effort = supportedEfforts.includes(requestedEffort)
      ? requestedEffort
      : selectPreferredEffort(selected);
    const model = selected.model || selected.id;
    const developerInstructions = typeof systemPrompt === "string" && systemPrompt.trim()
      ? systemPrompt
      : "Continue the conversation as Open Historia's game narrator.";

    const threadResult = await this.#request("thread/start", {
      model,
      cwd: this.workspaceDir,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      config: {
        web_search: "live",
        sandbox_workspace_write: { network_access: true },
        history: { persistence: "none" },
      },
      baseInstructions: BASE_INSTRUCTIONS,
      developerInstructions,
      ephemeral: true,
      experimentalRawEvents: false,
    }, 60_000);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error("Codex did not create a generation thread.");

    const prompt = formatConversation(history) || "Generate the requested Open Historia content now.";
    const generationTimeout = normalizeGenerationTimeout(timeoutMs);
    const answerPromise = new Promise((resolve, reject) => {
      const timer = generationTimeout > 0 ? setTimeout(() => {
        this.generations.delete(threadId);
        reject(new Error("Codex generation timed out."));
        void this.#request("turn/interrupt", { threadId }, 10_000).catch(() => {});
      }, generationTimeout) : null;
      this.generations.set(threadId, { resolve, reject, timer, answer: "", onProgress });
    });
    const abortGeneration = () => {
      const generation = this.generations.get(threadId);
      if (!generation) return;
      if (generation.timer) clearTimeout(generation.timer);
      this.generations.delete(threadId);
      generation.reject(signal?.reason ?? new Error("Codex generation was cancelled."));
      void this.#request("turn/interrupt", { threadId }, 10_000).catch(() => {});
    };
    signal?.addEventListener("abort", abortGeneration, { once: true });

    try {
      const codexOutputSchema = outputSchema && typeof outputSchema === "object"
        ? toCodexStrictSchema(outputSchema)
        : null;
      await this.#request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        model,
        effort,
        summary: "auto",
        ...(codexOutputSchema ? { outputSchema: codexOutputSchema } : {}),
      }, 60_000);
      const text = await answerPromise;
      return { text, model, effort };
    } catch (error) {
      const generation = this.generations.get(threadId);
      if (generation) {
        clearTimeout(generation.timer);
        this.generations.delete(threadId);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortGeneration);
    }
  }

  async #stopProcess() {
    const child = this.process;
    if (!child) return;
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
  }

  stop() {
    this.accountEpoch++;
    this.accessToken = null;
    return this.#stopProcess();
  }
}
