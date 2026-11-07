#!/usr/bin/env node
/*! Open Historia — what a time skip sends the AI, measured © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Usage:
//   node scripts/prompt-size.mjs <save> [--task jumpForward|autoJumpForward] [--days 30]
//        [--regions regions.geojson] [--cities cities.geojson] [--json out.json] [--dump prompt.txt]
//
// <save> is a Game export (the game.json inside the zip, or the folder it was
// unpacked into) or a folder holding game.json / world.json / events.json and
// the other runtime files a game keeps.
//
// The skip is built by the game itself: the save is served to the real engine
// from memory (no server, nothing written to disk), the skip runs through
// simulateTimelineJump / simulateAutoJump, and the request it would send is
// caught at the provider's door instead of being sent. Nothing leaves the
// machine: the provider is Anthropic with a dummy key, and its URL is answered
// here. The report is the request as built: the system prompt by [Section],
// the user message, the output function's schema (as Anthropic and as Gemini
// get it), and the share of the system prompt the provider can cache.
//
// Tokens are an estimate (characters / 4, the usual figure for English prose
// and JSON); use it to compare runs, not to bill one.

import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ---- Arguments -----------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const savePath = args.find((arg, index) => !arg.startsWith("--") && !String(args[index - 1] || "").startsWith("--"));
if (!savePath) {
  console.error("Usage: node scripts/prompt-size.mjs <save> [--task jumpForward|autoJumpForward] [--days 30] [--regions file] [--cities file] [--json out] [--dump out]");
  process.exit(2);
}
const taskKey = flag("task", "jumpForward");
const days = Number(flag("days", taskKey === "autoJumpForward" ? 365 : 30));

// ---- The save, as the runtime JSON assets the game reads ---------------------------
const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const loadSave = (target) => {
  const stat = fs.statSync(target);
  const dir = stat.isDirectory() ? target : path.dirname(target);
  const gameFile = stat.isDirectory() ? path.join(dir, "game.json") : target;
  const top = fs.existsSync(gameFile) ? readJsonFile(gameFile) : {};
  // A Game export keeps every asset under `data`; a game folder keeps one file each.
  if (top && typeof top === "object" && top.data && typeof top.data === "object" && top.data.game) {
    return { assets: { ...top.data }, dir };
  }
  const assets = { game: top };
  for (const name of fs.readdirSync(dir)) {
    const match = /^([A-Za-z]+)\.json$/.exec(name);
    if (!match || match[1] === "game") continue;
    try { assets[match[1]] = readJsonFile(path.join(dir, name)); } catch { /* not an asset */ }
  }
  return { assets, dir };
};
const { assets, dir: saveDir } = loadSave(path.resolve(savePath));
const findSibling = (name) => {
  for (const candidate of [path.join(saveDir, name), path.join(saveDir, "assets", name)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};
const regionsFile = flag("regions") || findSibling("regions.geojson");
const citiesFile = flag("cities") || findSibling("cities.geojson");
if (regionsFile) assets.regionsGeojson = readJsonFile(regionsFile);
if (citiesFile) assets.citiesGeojson = readJsonFile(citiesFile);

// ---- Running the game's source under Node ---------------------------------------
// gameplay.js imports ./main.jsx (no JSX in it, but Node refuses the extension),
// defaultPrompts.json without an import attribute, and a few modules read
// import.meta.env, which only Vite defines.
const srcUrl = pathToFileURL(path.join(root, "src") + path.sep).href;
const ENV_GLOBAL = "__OH_PROMPT_SIZE_ENV__";
globalThis[ENV_GLOBAL] = { MODE: "production", DEV: false, PROD: true };
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith(srcUrl) && result.url.endsWith(".json")) {
      result.importAttributes = { ...result.importAttributes, type: "json" };
    }
    return result;
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(srcUrl) || url.endsWith(".json")) return nextLoad(url, context);
    const result = nextLoad(url, { ...context, format: "module" });
    const source = String(result.source);
    return {
      ...result,
      format: "module",
      source: source.includes("import.meta.env") ? source.replaceAll("import.meta.env", `globalThis.${ENV_GLOBAL}`) : source,
    };
  },
});

class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(String(key)) ? this.#map.get(String(key)) : null; }
  setItem(key, value) { this.#map.set(String(key), String(value)); }
  removeItem(key) { this.#map.delete(String(key)); }
  clear() { this.#map.clear(); }
  key(index) { return [...this.#map.keys()][index] ?? null; }
  get length() { return this.#map.size; }
}
const ORIGIN = "http://127.0.0.1:9";
const storage = new MemoryStorage();
for (const [key, value] of Object.entries({
  api_provider: "anthropic",
  anthropic_api_key: "prompt-size-dummy-key",
  anthropic_model: "claude-sonnet-4-5",
  ai_reasoning_enabled: "0",
  // A skip asks once (requestBudget.js); the setting decides only the retry.
  ...JSON.parse(process.env.PROMPT_SIZE_STORAGE || "{}"),
})) storage.setItem(key, value);

// ---- Fetch: the save from memory, the provider caught at the door --------------------
let captured = null;
const OPTIONAL_ASSETS = new Set(["colors", "flags", "tags", "stats", "institutionLogos", "intercepts"]);
const LIST_ASSETS = new Set(["actions", "advisor", "chat", "events", "snapshots"]);
const writes = {};
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value ?? null), {
  status,
  headers: { "Content-Type": "application/json" },
});
const fetchStandIn = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input);
  const absolute = new URL(url, ORIGIN);
  const method = String(init?.method || "GET").toUpperCase();
  if (process.env.PROMPT_SIZE_TRACE) process.stderr.write(`fetch ${method} ${absolute.href.slice(0, 160)}\n`);
  if (absolute.origin === ORIGIN) {
    const runtime = /^\/api\/runtime\/json\/([^/?]+)/.exec(absolute.pathname);
    if (runtime) {
      const key = runtime[1];
      if (method === "GET") {
        if (key in writes) return jsonResponse(writes[key]);
        if (key in assets) return jsonResponse(assets[key]);
        // What the game's server answers for a file the game does not keep (server/libraryStore.js).
        if (OPTIONAL_ASSETS.has(key)) return jsonResponse({});
        if (LIST_ASSETS.has(key)) return jsonResponse([]);
        return new Response("", { status: 404 });
      }
      try { writes[key] = JSON.parse(String(init?.body ?? "null")); } catch { /* not JSON */ }
      return jsonResponse({ ok: true });
    }
    // The turn's commit, the skip's agent queue: taken and ignored.
    if (method !== "GET") return jsonResponse({ ok: true });
    return new Response("", { status: 404 });
  }
  if (absolute.hostname === "api.anthropic.com") {
    captured = JSON.parse(String(init?.body ?? "{}"));
    report();
    process.exit(0);
  }
  // Anything else (a hub, a font, a model list) is refused: nothing leaves the machine.
  throw new Error(`prompt-size: no network (${absolute.host})`);
};

const windowShim = Object.assign(new EventTarget(), {
  location: { origin: ORIGIN, href: `${ORIGIN}/`, protocol: "http:", host: "127.0.0.1:9", hostname: "127.0.0.1", port: "9", pathname: "/", search: "", hash: "", toString: () => `${ORIGIN}/` },
  localStorage: storage,
  fetch: fetchStandIn,
});
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:prompt-size/never-fetched";
  URL.revokeObjectURL = () => {};
}
windowShim.URL = URL;
windowShim.Blob = globalThis.Blob;
globalThis.window = windowShim;
globalThis.self = windowShim;
globalThis.localStorage = storage;
globalThis.fetch = fetchStandIn;
// The engine logs freely; the report is what this script prints.
const quiet = process.env.PROMPT_SIZE_VERBOSE ? null : console;
if (quiet) {
  for (const level of ["log", "info", "warn", "debug"]) console[level] = () => {};
}
const say = (...parts) => process.stdout.write(`${parts.join(" ")}\n`);

// ---- Measuring ---------------------------------------------------------------------
const tokens = (chars) => Math.round(chars / 4);
// The same sections a Detailed log's prompt fingerprint names (contextDiagnostics.js
// measurePromptSections). A heading the campaign wrote (a scenario's lore, an
// event's text) is counted in the section it sits in, as the template's own.
let measurePromptSections = null;
let template = "";
const sectionsOf = (text) => {
  const sections = [];
  for (const section of measurePromptSections(text, { template })) {
    const chars = section.chars + 1;
    if (section.name === "(campaign section)" && sections.length) sections.at(-1).chars += chars;
    else sections.push({ name: section.name, chars });
  }
  return sections;
};
const schemaSizes = (tools) => {
  const list = Array.isArray(tools) ? tools : [];
  const output = list[0] || null;
  return {
    toolCount: list.length,
    outputTool: output?.name || "",
    outputSchemaChars: output ? JSON.stringify(output.input_schema).length : 0,
    allToolsChars: JSON.stringify(list).length,
  };
};

let toGeminiSchema = null;
function report() {
  const body = captured || {};
  const output = Array.isArray(body.tools) ? body.tools[0] : null;
  const geminiChars = output && toGeminiSchema ? JSON.stringify(toGeminiSchema(output.input_schema)).length : null;
  const blocks = Array.isArray(body.system) ? body.system : [{ type: "text", text: String(body.system ?? "") }];
  const systemText = blocks.map((block) => block.text).join("");
  // The system prompt goes out as blocks when it has a cacheable opening
  // (main.jsx buildAnthropicSystemContent): every block but the last is the
  // part that opens identically on every call; the last is this turn's.
  const cachedChars = blocks.length > 1
    ? blocks.slice(0, -1).reduce((sum, block) => sum + block.text.length, 0)
    : 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userText = messages.map((message) => (Array.isArray(message.content)
    ? message.content.map((part) => part.text || "").join("")
    : String(message.content ?? ""))).join("\n");
  const schema = schemaSizes(body.tools);
  const sections = sectionsOf(systemText);
  const result = {
    save: path.basename(saveDir === path.resolve(savePath) ? saveDir : path.resolve(savePath)),
    task: taskKey,
    days,
    round: Number(assets.game?.round) || null,
    events: Array.isArray(assets.events) ? assets.events.length : null,
    systemChars: systemText.length,
    userChars: userText.length,
    cacheablePrefixChars: cachedChars,
    cacheableShare: systemText.length ? cachedChars / systemText.length : 0,
    cacheBreakpoints: blocks.filter((block) => block.cache_control).length,
    cacheTtl: blocks.find((block) => block.cache_control)?.cache_control?.ttl || "5m",
    systemBlocks: blocks.map((block) => ({ chars: block.text.length, cache: block.cache_control ? (block.cache_control.ttl || "5m") : "" })),
    ...schema,
    geminiSchemaChars: geminiChars,
    totalChars: systemText.length + userText.length + schema.allToolsChars,
    sections,
  };
  const dumpFile = flag("dump");
  if (dumpFile) fs.writeFileSync(dumpFile, `${systemText}\n\n===== USER =====\n${userText}\n\n===== TOOLS =====\n${JSON.stringify(body.tools, null, 1)}`);
  const jsonFile = flag("json");
  if (jsonFile) fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));
  const pad = (value, width) => String(value).padStart(width);
  say(`${result.save}: ${taskKey}, round ${result.round ?? "?"}, ${result.events ?? "?"} events, ${days} days`);
  say(`  system prompt ${pad(result.systemChars, 8)} chars ~${pad(tokens(result.systemChars), 6)} tokens`);
  say(`  cacheable     ${pad(result.cacheablePrefixChars, 8)} chars ~${pad(tokens(result.cacheablePrefixChars), 6)} tokens (${(result.cacheableShare * 100).toFixed(1)}%; blocks ${result.systemBlocks.map((block) => `${block.chars}${block.cache ? ` [${block.cache}]` : ""}`).join(" + ")})`);
  say(`  user message  ${pad(result.userChars, 8)} chars ~${pad(tokens(result.userChars), 6)} tokens`);
  say(`  tools (${result.toolCount}) ${pad(result.allToolsChars, 8)} chars ~${pad(tokens(result.allToolsChars), 6)} tokens; output schema ${result.outputSchemaChars}${result.geminiSchemaChars != null ? `, as Gemini gets it ${result.geminiSchemaChars}` : ""}`);
  say(`  total         ${pad(result.totalChars, 8)} chars ~${pad(tokens(result.totalChars), 6)} tokens`);
  say("  sections:");
  for (const section of sections) say(`    ${pad(section.chars, 7)} ~${pad(tokens(section.chars), 6)}  ${section.name}`);
}

// ---- Run the skip ------------------------------------------------------------------
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const gameplay = await load("src/Game/AI/gameplay.js");
// Loaded now: the capture ends the process from inside a fetch.
({ toGeminiSchema } = await load("src/Game/AI/geminiSchema.js"));
({ measurePromptSections } = await load("src/Game/AI/contextDiagnostics.js"));
template = JSON.parse(fs.readFileSync(path.join(root, "src/Game/AI/defaultPrompts.json"), "utf8")).tasks[taskKey] || "";
const originalExit = process.exit.bind(process);

const run = taskKey === "autoJumpForward"
  ? () => gameplay.simulateAutoJump({ days })
  : () => gameplay.simulateTimelineJump({ days });
try {
  const result = await run();
  say(`prompt-size: the skip finished without asking the provider (nothing to measure): ${JSON.stringify(result?.generation ?? result ?? null).slice(0, 2000)}`);
  originalExit(1);
} catch (error) {
  if (quiet) quiet.error?.(error);
  say(`prompt-size: the skip failed before its request: ${error?.stack || error}`);
  originalExit(1);
}
