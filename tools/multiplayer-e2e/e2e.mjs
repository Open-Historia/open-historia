/*! Open Historia — a shared game, end to end in two browsers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// End to end: a shared game hosted, joined with an invite token, and played for a
// round, in real browsers, with the real game built (this repo's dist/), real
// WebRTC between them, real Nostr signaling over a local relay, and the game's
// own time skip on the host with a stand-in model answering it. Nothing leaves
// this machine: the relay is local and the model's API is answered in the
// browser. See README.md.
//   npm run build            (at the repo root: the run serves dist/)
//   npm install              (here, once: the relay's WebSocket server)
//   node e2e.mjs             (CHROME=<path to chrome> if it is somewhere else)
//   RELAYS=public node e2e.mjs   signals over the game's own public Nostr relays
//                                instead (they see this machine's address)
//
// Host: app server A (engine handle stubbed as in electron/main.cjs), with a
//   tab on engine.html (the hidden engine window) and a tab on the game (the
//   host's screen). Guest: app server B, its own origin, library and storage.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRelay } from "./relay.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The engine window's credential (server/oneWriter.js), as the desktop app
// mints one when it opens the window: given to the host's server, and to the
// engine tab alone, in its address.
const ENGINE_CREDENTIAL = crypto.randomBytes(18).toString("base64url");
const REPO = path.join(HERE, "..", "..");
const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => fs.existsSync(candidate));
if (!CHROME) throw new Error("No Chrome found: set CHROME to its path.");
if (!fs.existsSync(path.join(REPO, "dist", "engine.html"))) throw new Error("No build: run `npm run build` at the repo root first.");
// Another run on this machine (another checkout's, another session's) may hold
// the usual ports, and its browser would be driven instead of this one's:
// E2E_PORT_BASE=10 moves all three together.
const PORT_BASE = Math.max(0, Math.trunc(Number(process.env.E2E_PORT_BASE) || 0));
const DEBUG_PORT = 9461 + PORT_BASE;
const HOST_PORT = 3811 + PORT_BASE;
const GUEST_PORT = 3812 + PORT_BASE;
const HOST = `http://localhost:${HOST_PORT}`;
const GUEST = `http://localhost:${GUEST_PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { jumpTargetDate } = await import(pathToFileURL(path.join(REPO, "src", "runtime", "jumpDates.js")).href);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${String(detail).slice(0, 600)}` : ""}`);
};

// --- servers ---------------------------------------------------------------------
// RELAYS=public: the game's own relays (signaling/nostr.js DEFAULT_RELAYS), as
// a player's would be. They carry only encrypted signaling, but they see this
// machine's address.
const PUBLIC_RELAYS = process.env.RELAYS === "public";
const relay = PUBLIC_RELAYS ? null : await startRelay();
const RELAY = relay ? `ws://127.0.0.1:${relay.port}/relay` : "";
const RELAY_SETTING = RELAY
  ? `localStorage.setItem("oh:mp:relays", ${JSON.stringify(JSON.stringify([RELAY]))});`
  : `localStorage.removeItem("oh:mp:relays");`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oh-mp-e2e-"));
const serverLogs = [];

// The map, copied in from a desktop install (MAP_FROM, by default the official
// app's or the multiplayer app's own folder): a game without its tiles does not
// finish loading. One copy of the tiles serves both servers; each gets its own
// stock world. Without a local copy the run goes on, and says so.
const MAP_ASSETS = path.join(scratch, "assets");
const mapSource = [
  process.env.MAP_FROM,
  path.join(process.env.APPDATA || "", "open-historia"),
  path.join(process.env.APPDATA || "", "Open Historia Multiplayer"),
].filter(Boolean).find((root) => fs.existsSync(path.join(root, "public", "assets", "regions.pmtiles")));
const seedMap = (dataDirs) => {
  if (!mapSource) {
    console.log("NOTE  no local map files (set MAP_FROM to a desktop install's data folder): the screens load without a map");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "map-assets.json"), "utf8"));
  for (const asset of manifest.assets ?? []) {
    const source = path.join(mapSource, asset.path);
    if (!fs.existsSync(source)) continue;
    const targets = asset.path.startsWith("public/assets/")
      ? [path.join(MAP_ASSETS, asset.path.slice("public/assets/".length))]
      : asset.path.startsWith("server/data/")
        ? dataDirs.map((dataDir) => path.join(dataDir, asset.path.slice("server/data/".length)))
        : [];
    for (const target of targets) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
};
seedMap([path.join(scratch, "host"), path.join(scratch, "guest")]);

const startApp = (name, port, role) => {
  const child = spawn(process.execPath, [path.join(HERE, "app-server.mjs"), path.join(scratch, name), String(port), role], {
    cwd: REPO,
    env: { ...process.env, ...(mapSource ? { OH_E2E_ASSETS: MAP_ASSETS } : {}), ...(role === "host" ? { OH_E2E_ENGINE_CREDENTIAL: ENGINE_CREDENTIAL } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => serverLogs.push(`[${name}] ${data}`));
  child.stderr.on("data", (data) => serverLogs.push(`[${name}!] ${data}`));
  return child;
};
const hostServer = startApp("host", HOST_PORT, "host");
const guestServer = startApp("guest", GUEST_PORT, "");
const waitFor = async (url, ms = 60000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`${url} never answered`);
};
await waitFor(`${HOST}/api/library`);
await waitFor(`${GUEST}/api/library`);

// The host's game: a new one on the built-in scenario, which the guest has too.
const created = await (await fetch(`${HOST}/api/games`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "E2E shared game", scenarioId: "default", setActive: true }),
})).json();
const hostGame = await waitFor(`${HOST}/api/runtime/json/game`);
const HOST_COUNTRY = hostGame.country;
const ORIGIN = hostGame.gameDate;
check("the host's game is open", Boolean(created?.id || created?.game?.id) && HOST_COUNTRY, `${HOST_COUNTRY}, ${ORIGIN}`);

// --- browser -----------------------------------------------------------------------
const profile = path.join(scratch, "chrome");
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
  "--disable-extensions", "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--window-size=1400,900", "about:blank",
], { stdio: "ignore" });

const cdp = async (url) => {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const waiting = new Map();
  const handlers = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else if (message.method && handlers.has(message.method)) {
      for (const handler of handlers.get(message.method)) handler(message.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    on: (method, handler) => handlers.set(method, [...(handlers.get(method) ?? []), handler]),
    eval: async (expression) => {
      const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
      return reply.result?.result?.value;
    },
    close: () => socket.close(),
  };
};
for (let i = 0; i < 50; i += 1) {
  try {
    await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    break;
  } catch {
    await sleep(200);
  }
}
const instrument = async (tab) => {
  await tab.send("Runtime.enable");
  tab.logs = [];
  tab.on("Runtime.consoleAPICalled", (params) => tab.logs.push(`${params.type}: ${params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`.slice(0, 400)));
  tab.on("Runtime.exceptionThrown", (params) => tab.logs.push(`exception: ${JSON.stringify(params.exceptionDetails).slice(0, 400)}`));
  return tab;
};
const openTab = async (url) => {
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  return instrument(await cdp(target.webSocketDebuggerUrl));
};
// PATIENCE=4 waits four times as long for everything: for a machine that is
// busy with something else, where a page can take a minute to do a second's work.
const PATIENCE = Math.max(1, Number(process.env.PATIENCE) || 1);
const until = async (tab, expression, ms = 30000) => {
  const deadline = Date.now() + ms * PATIENCE;
  while (Date.now() < deadline) {
    try {
      if (await tab.eval(expression)) return true;
    } catch {
      // loading
    }
    await sleep(300);
  }
  return false;
};
// Page helpers, evaluated in the page.
const HELPERS = `
  window.__e2e = {
    buttons: (text) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === text && !b.disabled),
    click: (text) => { const b = window.__e2e.buttons(text)[0]; if (!b) return false; b.click(); return true; },
    type: (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    choose: (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    view: async (key) => (await fetch("/api/runtime/json/" + key + "?v=e2e")).json(),
  };
  true;`;
const withHelpers = (tab) => tab.eval(HELPERS);
// The vault door stands over the menu on every page load until its wheel is
// clicked (GameUI/VaultDoor.jsx). The game's own buttons answer under it, so
// the checks never needed it open, but every screenshot was of the door.
const openVaultDoor = async (tab) => {
  if (!(await until(tab, "Boolean(document.querySelector('.oh-vault-knob:not([disabled])'))", 20000))) return false;
  await tab.eval("document.querySelector('.oh-vault-knob').click(); true");
  return until(tab, "!document.querySelector('.oh-vault-knob')", 20000);
};

let answeredJumps = 0;
let engineTab = null;
const sentTools = [];
// The host's AI settings: a Gemini key only the stand-in model ever sees.
const AI_SETTING = `localStorage.setItem("api_provider", "gemini"); localStorage.setItem("gemini_api_key", "e2e-dummy-key"); localStorage.setItem("ai_limit_generation", "1");`;
// A device's first opening is behind it: the first-time setup is done
// (runtime/firstSetupDue.js), the question about counting visits is answered,
// with a no (public/consent.js), and the newest update's notice has been seen
// (GameUI/updates/updateNotices.js), so none is shown behind the vault door.
// Each of the three sat over every screenshot (the door itself is opened by
// its wheel, openVaultDoor below).
const { NOTICE_UPDATES } = await import(pathToFileURL(path.join(REPO, "src", "Game", "GameUI", "updates", "notes.js")).href);
const FIRST_OPENING_DONE = `localStorage.setItem("oh-first-setup", "1"); localStorage.setItem("oh:analytics-consent", JSON.stringify({ choice: "no", at: new Date().toISOString() })); localStorage.setItem("oh-update-note-seen", ${JSON.stringify(String(NOTICE_UPDATES[0]?.id ?? ""))});`;
try {
  const TARGET = jumpTargetDate(ORIGIN, 30);
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let GUEST_COUNTRY = "";
  // A country nobody plays, for a table with an AI government at it.
  let AI_COUNTRY = "";
  let lastJumpBody = "";
  const chatBodies = [];
  const LINE_FROM_AI = "Paris will host the conference, if both powers attend.";
  const SUGGESTED_TOPIC = "Steady the budget before the summer";
  // Each order's id, as the prompt lists it under its owner: "[id] (action, Country) title"
  // (promptContext.js buildActionHistoryText).
  const orderIdIn = (body, country) => {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\[([^\\]\\s]+)\\] \\(action, ${escaped}\\) `).exec(body)?.[1] ?? "";
  };
  // The round the stand-in model writes. Whose decision an event is, the guard
  // reads from what the answer carries and never from its words: the war the
  // guest's country "declares" is its own choice by the answer's war record
  // (nativeWarLedger.js: id~op~actors~opponents~event numbers~note).
  const STAGED_TITLES = ["Oil prices slide further", "declares war on Ukraine", "snap drills near the Estonian border", "Storms batter the North Sea coast", "arrives in Hanoi", "central bank raises rates"];
  const jumpAnswer = (body) => {
    const guestOrder = orderIdIn(body, GUEST_COUNTRY);
    const hostOrder = orderIdIn(body, HOST_COUNTRY);
    return {
      stopDate: TARGET,
      summary: "Tension in the east; markets wobble.",
      warUpdates: `war-e2e-ukraine~start~${GUEST_COUNTRY}~Ukraine~2~Title: The Ukraine War`,
      events: [
        { date: addDays(ORIGIN, 3), title: "Oil prices slide further as the supply glut persists", description: "Brent falls again as producers keep pumping.", importance: "moderate", kind: "world", playerRelated: false },
        { date: addDays(ORIGIN, 7), title: `${GUEST_COUNTRY} declares war on Ukraine`, description: `The government of ${GUEST_COUNTRY} declares war on Ukraine.`, importance: "critical", kind: "world", playerRelated: true },
        { date: addDays(ORIGIN, 9), title: `${GUEST_COUNTRY} holds snap drills near the Estonian border`, description: `Units of ${GUEST_COUNTRY} run the snap drills near the Estonian border that Moscow ordered.`, importance: "major", kind: "world", playerRelated: true, impacts: { actionIds: guestOrder ? [guestOrder] : [] } },
        { date: addDays(ORIGIN, 11), title: "Storms batter the North Sea coast", description: "A winter storm floods ports along the North Sea.", importance: "minor", kind: "world", playerRelated: false },
        { date: addDays(ORIGIN, 14), title: `A trade mission from ${HOST_COUNTRY} arrives in Hanoi`, description: `The trade mission ${HOST_COUNTRY} sent to Vietnam opens talks on expanding exports.`, importance: "moderate", kind: "world", playerRelated: true, impacts: { actionIds: hostOrder ? [hostOrder] : [] } },
        { date: addDays(ORIGIN, 24), title: "Brazil's central bank raises rates", description: "The central bank of Brazil raises its benchmark rate to fight inflation.", importance: "minor", kind: "world", playerRelated: false },
      ],
    };
  };
  // The model's API is cross-origin to the page: the stand-in answers the
  // browser's preflight, and every answer carries the CORS headers a real one does.
  const cors = [
    { name: "access-control-allow-origin", value: "*" },
    { name: "access-control-allow-methods", value: "POST, GET, OPTIONS" },
    { name: "access-control-allow-headers", value: "*" },
  ];
  const bodyOf = (request) => {
    if (request.postData) return request.postData;
    const entries = request.postDataEntries ?? [];
    return entries.map((entry) => Buffer.from(entry.bytes ?? "", "base64").toString("utf8")).join("");
  };
  // Every page on the host's origin reads the same key, so each one's calls to
  // the model are answered here, and none leaves this machine. Only the
  // engine's time skip is answered with a round.
  const standInModel = async (page) => {
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*generativelanguage.googleapis.com*", requestStage: "Request" }] });
    page.on("Fetch.requestPaused", (paused) => answerModel(page, paused));
  };
  const answerModel = async (page, { requestId, request }) => {
    if (request.method === "OPTIONS") {
      await page.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: cors, body: "" });
      return;
    }
    let tool = "(unknown)";
    let text = "";
    try {
      text = bodyOf(request) || "{}";
      const body = JSON.parse(text);
      tool = (body.tools?.[0]?.functionDeclarations ?? []).find((d) => d.name.startsWith("submit_"))?.name ?? "(text)";
      // What the model is told, as plain text.
      const parts = [...(body.system_instruction?.parts ?? []), ...(body.contents ?? []).flatMap((entry) => entry.parts ?? [])];
      text = parts.map((part) => part.text ?? "").join("\n");
    } catch {
      // no body
    }
    sentTools.push(tool);
    // Which page asked: the engine (the host's key) or a player's own screen.
    (page.asked ??= []).push(tool);
    // A round for the time skip, a line for an AI government at a table, a
    // list for the suggestions button; anything else is refused.
    let args = null;
    if (tool === "submit_jump_result") {
      answeredJumps += 1;
      lastJumpBody = text;
      args = jumpAnswer(text);
    } else if (tool === "submit_chat_actions") {
      chatBodies.push(text);
      (page.chatBodies ??= []).push(text);
      // A page's own model may be out (`aiDown`), and says its own line (`aiLine`).
      // More than words is tried too, so a reply written on a player's device
      // is seen to keep the words alone.
      args = page.aiDown ? null : {
        actions: page.aiLine
          ? [{ type: "rename_chat", actorName: AI_COUNTRY, title: "A table the model renamed" }, { type: "send_message", actorName: AI_COUNTRY, content: page.aiLine }]
          : [{ type: "send_message", actorName: AI_COUNTRY, content: LINE_FROM_AI }],
      };
    } else if (tool === "submit_actions") {
      args = { topics: [{ title: SUGGESTED_TOPIC, description: "Shore up the position at home.", actions: [{ title: "Convene the cabinet", text: "Convene the cabinet on the budget." }] }] };
    }
    if (!args) {
      await page.send("Fetch.fulfillRequest", { requestId, responseCode: 400, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify({ error: { code: 400, message: "stand-in" } })).toString("base64") });
      return;
    }
    const frame = { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: tool, args } }] }, finishReason: "STOP" }] };
    const streamed = String(request.url).includes("streamGenerateContent");
    await page.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [...cors, { name: "content-type", value: streamed ? "text/event-stream" : "application/json" }],
      body: Buffer.from(streamed ? `data: ${JSON.stringify(frame)}\n\n` : JSON.stringify(frame)).toString("base64"),
    });
  };

  const shots = path.join(HERE, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const shoot = async (tab, name) => {
    const reply = await tab.send("Page.captureScreenshot", { format: "png" });
    if (reply.result?.data) fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(reply.result.data, "base64"));
  };

  // The engine and the host's screen: the run opens engine.html itself, with
  // this device's settings (the relay, and the key) and the stand-in model
  // before anything can call it.
  const ENGINE_PAGE = `${HOST}/engine.html#credential=${ENGINE_CREDENTIAL}`;
  const engine = await openTab(ENGINE_PAGE);
  engineTab = engine;
  await until(engine, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await standInModel(engine);
  await engine.eval(`${RELAY_SETTING} ${AI_SETTING} ${FIRST_OPENING_DONE} true`);
  const host = await openTab(`${HOST}/`);
  await standInModel(host);
  await until(host, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  // What the engine says to the host's screen, kept for a failed run's report:
  // a second listener on the two windows' channel, there from the page's start.
  await host.send("Page.enable");
  await host.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__loopback = []; try { const channel = new BroadcastChannel("oh-mp-host"); channel.onmessage = (event) => { const data = event.data || {}; window.__loopback.push(data.type === "status" ? "status open=" + Boolean(data.status && data.status.open) + (data.status && data.status.error ? " error=" + data.status.error : "") : data.type === "message" ? "message " + (data.message && data.message.t) : String(data.type)); if (window.__loopback.length > 400) window.__loopback.shift(); }; } catch (error) { window.__loopback.push("no channel: " + error); }` });
  await host.send("Page.reload");
  await sleep(500);
  await until(host, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await withHelpers(host);
  check("the host's game loads with the Lobbies tab", await until(host, "(window.__e2e || false) && window.__e2e.buttons('Lobbies').length > 0", 60000));
  await openVaultDoor(host);
  await host.eval("window.__e2e.click('Lobbies')");
  await until(host, "window.__e2e.buttons('Host a lobby').length > 0", 15000);
  await host.eval("window.__e2e.click('Host a lobby')");
  const hostPanel = await until(host, "window.__e2e.buttons('Open the lobby').length > 0", 15000);
  check("the Lobbies tab's \"Host a lobby\" opens the host's settings", hostPanel);
  await shoot(host, "0-host-a-lobby");
  await host.eval("window.__e2e.click('Open the lobby')");
  const hosting = await until(host, "Boolean(document.querySelector('code') && document.querySelector('code').textContent.startsWith('oh1-'))", 45000);
  const token = hosting ? await host.eval("document.querySelector('code').textContent") : "";
  // What the screen itself says when hosting fails, beside its console.
  const hostSays = hosting ? "" : await host.eval(`document.body.innerText.split("\\n").map((line) => line.trim()).filter((line) => /engine|could not|did not|error|failed|needs/i.test(line)).slice(0, 6).join(" / ")`);
  const heardFromEngine = hosting ? "" : await host.eval(`(() => { const counts = {}; for (const entry of window.__loopback || []) counts[entry] = (counts[entry] || 0) + 1; return JSON.stringify(counts); })()`);
  check("hosting shows an invite token", hosting, token ? `${token.slice(0, 24)}…` : `${hostSays} || heard on the loopback: ${heardFromEngine} || ${host.logs.slice(-6).join(" | ")} || engine: ${engine.logs.slice(-6).join(" | ")}`);
  const relaysUp = await until(host, "/Relays: [1-9]/.test(document.body.textContent)", 30000);
  const relayLine = await host.eval("(document.body.textContent.match(/Relays: [^A-Z]*?connected/) || [''])[0]");
  check("the host reaches its signaling relays", relaysUp, `${PUBLIC_RELAYS ? "public" : "local"}: ${relayLine}`);

  // A second window on the host's own computer: this same server's page, in
  // another tab. Joining makes a game of the page's own and opens it, and one
  // server has one open game, so it would take the hosted game's place and
  // every save the host made afterwards would be refused. It is told why
  // instead, and the server refuses the switch whoever asks.
  const hostedGame = await host.eval("fetch('/api/library').then((r) => r.json()).then((c) => c.activeGameId)");
  const twin = await openTab(`${HOST}/`);
  await standInModel(twin);
  await until(twin, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await withHelpers(twin);
  await until(twin, "(window.__e2e || false) && window.__e2e.buttons('Lobbies').length > 0", 60000);
  await twin.eval("window.__e2e.click('Lobbies')");
  await until(twin, "Boolean(document.querySelector('input[placeholder=\"oh1-…\"]'))", 15000);
  await twin.eval(`(() => { window.__e2e.type(document.querySelector('input[placeholder="oh1-…"]'), ${JSON.stringify(token)}); return true; })()`);
  await sleep(300);
  await twin.eval("window.__e2e.click('Join')");
  const toldWhy = await until(twin, "document.body.textContent.includes('This computer is hosting a shared game')", 15000);
  const forced = await twin.eval(`fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A game of the second window', setActive: true }) }).then((r) => r.status)`);
  const stillHosted = await host.eval("fetch('/api/library').then((r) => r.json()).then((c) => c.activeGameId)");
  check("a second window on the host's own computer cannot join, and the hosted game stays the open one",
    toldWhy && forced === 400 && hostedGame && stillHosted === hostedGame, JSON.stringify({ toldWhy, forced, hostedGame, stillHosted }));
  await twin.send("Page.close");
  twin.close();

  // The guest.
  // Opened on a plain page of its own origin first, so its storage says its
  // first opening is behind it before the game itself starts.
  const guest = await openTab(`${GUEST}/api/library`);
  await until(guest, `location.origin === ${JSON.stringify(GUEST)} && document.readyState === 'complete'`, 30000);
  await guest.eval(`${FIRST_OPENING_DONE} true`);
  await guest.send("Page.enable");
  await guest.send("Page.navigate", { url: `${GUEST}/` });
  await sleep(500);
  await until(guest, `location.origin === ${JSON.stringify(GUEST)} && location.pathname === '/' && document.readyState === 'complete'`, 30000);
  await guest.eval(`${RELAY_SETTING} true`);
  await withHelpers(guest);
  await until(guest, "window.__e2e.buttons('Lobbies').length > 0", 60000);
  await openVaultDoor(guest);
  await guest.eval("window.__e2e.click('Lobbies')");
  await until(guest, "Boolean(document.querySelector('input[placeholder=\"oh1-…\"]'))", 15000);
  // The invite code heads the tab, above the public list under "Coming soon".
  const layout = await guest.eval(`(() => {
    const code = document.querySelector('input[placeholder="oh1-…"]');
    const list = document.querySelector('section[aria-label="Public lobbies"]');
    const soon = Boolean(list && list.textContent.includes("Coming soon"));
    return { codeFirst: Boolean(code && list && (code.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)), soon };
  })()`);
  check("the Lobbies tab: an invite code at the top, the public lobbies under \"Coming soon\"", layout?.codeFirst && layout?.soon, JSON.stringify(layout));
  await shoot(guest, "0-lobbies-tab");
  await guest.eval(`(() => { const e = window.__e2e; e.type(document.querySelector('input[placeholder="oh1-…"]'), ${JSON.stringify(token)}); const name = [...document.querySelectorAll('input[placeholder="Player"]')][0]; if (name) e.type(name, "Guest"); return true; })()`);
  await sleep(300);
  await guest.eval(`(() => {
    window.__seen = { loading: [], apiPrompt: false, steps: [] };
    const look = () => {
      // The lobby box's line for the step of joining this is (client/joinProgress.js).
      const step = /(Found the host[^.…]*|Connected to the host. [^.…]*)/.exec(document.body.textContent)?.[1];
      if (step && !window.__seen.steps.includes(step)) window.__seen.steps.push(step);
      const screen = document.querySelector('.oh-loading-screen');
      if (screen && window.__seen.loading.at(-1) !== screen.textContent) window.__seen.loading.push(screen.textContent);
      if (document.querySelector('[aria-label="Set up your AI provider"]')) window.__seen.apiPrompt = true;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
    return true;
  })()`);
  await guest.eval("window.__e2e.click('Join')");
  const joinedAt = Date.now();
  const lobby = await until(guest, "[...document.querySelectorAll('select')].some((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country'))", 90000);
  check("the guest finds the host through the relay and reaches the lobby", lobby, lobby ? `in ${((Date.now() - joinedAt) / 1000).toFixed(1)} s` : guest.logs.slice(-8).join(" | "));
  await withHelpers(guest);
  // In the lobby with no country yet, the guest is in nobody's player list: the
  // host's screen names them all the same, and both diagnostics logs have the
  // steps of the joining (client/joinProgress.js).
  const hostSeesWaiting = await until(host, "/choosing a country: (Guest|Player)/.test(document.body.textContent)", 15000);
  check("the host's lobby names a player who is in and has not taken a country yet", hostSeesWaiting);
  const logged = (tab, pattern) => tab.eval(`(() => { try { return (JSON.parse(localStorage.getItem('oh_debug_log_v1') || '{}').entries || []).filter((entry) => entry.category === 'shared game' && ${pattern}.test(String(entry.message))).length; } catch { return 0; } })()`);
  await sleep(1500);
  const guestSteps = { looking: await logged(guest, "/looking for the host/"), answered: await logged(guest, "/the host answered/"), connected: await logged(guest, "/connected to the host's computer/"), letIn: await logged(guest, "/let us in/") };
  const hostSteps = { asked: await logged(host, "/(Guest|Player) is asking to join/"), joined: await logged(host, "/player (Guest|Player) joined/") };
  const stepsShown = (await guest.eval("window.__seen.steps")) ?? [];
  check("the guest's lobby box said which step of joining it was on, not only that it was finding the host", stepsShown.length > 0, JSON.stringify(stepsShown));
  check("each step of the joining is in the diagnostics log, on the guest's screen and on the host's",
    Object.values(guestSteps).every(Boolean) && Object.values(hostSteps).every(Boolean), JSON.stringify({ guestSteps, hostSteps }));
  const offered = await guest.eval(`(() => { const select = [...document.querySelectorAll('select')].find((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country')); return select ? [...select.options].map((o) => o.value).filter(Boolean) : []; })()`);
  if (!offered.length) throw new Error("the guest was offered no country: the lobby never opened");
  GUEST_COUNTRY = offered.find((n) => /^Russia/.test(n)) || offered.find((n) => n !== HOST_COUNTRY);
  AI_COUNTRY = offered.find((n) => /^France$/.test(n)) || offered.find((n) => /^(France|Germany|Japan|Brazil)/.test(n) && n !== HOST_COUNTRY && n !== GUEST_COUNTRY) || offered.find((n) => n !== HOST_COUNTRY && n !== GUEST_COUNTRY);
  await guest.eval(`(() => { const select = [...document.querySelectorAll('select')].find((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country')); window.__e2e.choose(select, ${JSON.stringify(GUEST_COUNTRY)}); return true; })()`);
  await sleep(300);
  await guest.eval("window.__e2e.click('Take it')");
  const seated = await until(guest, `document.body.textContent.includes("You play ${GUEST_COUNTRY}")`, 20000);
  check("the guest takes a country", seated, GUEST_COUNTRY);
  // The page reads the host's view once its stand-in game is ready.
  await until(guest, `window.__e2e.view('game').then((game) => game.country === ${JSON.stringify(GUEST_COUNTRY)})`, 20000);
  const guestGame = seated ? await guest.eval("window.__e2e.view('game')") : null;
  check("the guest's view says it plays that country", guestGame?.country === GUEST_COUNTRY, JSON.stringify({ country: guestGame?.country, humans: guestGame?.humanCountries }));
  // The stand-in's own country is a placeholder the page must never show.
  const standIn = await guest.eval("fetch('/api/library').then((r) => r.json()).then((c) => (c.games || []).find((g) => String(g.name).startsWith('Shared game:')) || null)");
  const seenAtPick = await guest.eval("window.__seen");
  check("the guest's loading screen never names the stand-in's placeholder country",
    standIn?.country && standIn.country !== GUEST_COUNTRY && seenAtPick.loading.length && seenAtPick.loading.every((text) => !text.includes(standIn.country)),
    JSON.stringify({ placeholder: standIn?.country, loading: seenAtPick.loading.map((text) => text.slice(0, 90)) }));
  const barNamesGuest = await until(guest, `document.body.textContent.includes(${JSON.stringify(`Shared game: E2E shared game / ${GUEST_COUNTRY} /`)})`, 10000);
  check("the guest's menu bar names the country it took", barNamesGuest);
  const hostSeesGuest = await until(host, `document.body.textContent.includes(${JSON.stringify(GUEST_COUNTRY)})`, 15000);
  check("the host's lobby shows the guest's country", hostSeesGuest);

  // The game starts; both are ready; the round resolves on the host.
  await host.eval("window.__e2e.click('Start the game')");
  const barBoth = (await Promise.all([host, guest].map((tab) => until(tab, "document.body.textContent.includes('Round 1')", 20000)))).every(Boolean);
  check("the game starts: both see round 1", barBoth);
  await withHelpers(host);
  await withHelpers(guest);
  // Who plays what, during the game too ("how can I see who is playing?").
  await guest.eval("window.__e2e.click('Players')");
  const playersShown = await until(guest, `(() => { const open = [...document.querySelectorAll('button[aria-expanded="true"]')].find((b) => b.textContent.trim() === 'Players'); const bar = open && open.parentElement; return Boolean(bar && bar.textContent.includes(${JSON.stringify(GUEST_COUNTRY)}) && bar.textContent.includes(${JSON.stringify(HOST_COUNTRY)})); })()`, 10000);
  check("during the game the round bar's Players shows who plays what", playersShown);
  await guest.eval("window.__e2e.click('Players')");

  // Two people talk. The host opens a thread with the guest's country and
  // writes; nobody answers for the guest but the guest.
  const LINE_FROM_HOST = "Washington proposes talks on arms limits.";
  const LINE_FROM_GUEST = "Moscow is willing to talk, in Geneva.";
  const toggleChats = (tab) => tab.eval(`(() => { const b = document.querySelector('button[title^="Chat"]'); if (!b) return false; b.click(); return true; })()`);
  // A country picked in the country picker (chat.jsx CountrySelectorModal): its
  // tile is looked for inside the picker, never as the first button of that
  // name anywhere on the page, and the pick is checked on the tile. What the
  // page showed is said when it was not picked.
  const pickCountry = async (tab, name) => {
    // The picker: the search box's nearest box that also holds its Cancel button.
    const PICKER = `(() => { let node = document.querySelector('input[placeholder="Search countries..."]'); while (node && !(node.querySelectorAll && [...node.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Cancel'))) node = node.parentElement; return node; })()`;
    await tab.eval(`(() => { window.__e2e.type(document.querySelector('input[placeholder="Search countries..."]'), ${JSON.stringify(name)}); return true; })()`);
    // The list filters as the search changes, which on a busy machine takes a
    // while: the tile is waited for, then clicked.
    const TILE = `[...picker.querySelectorAll('button[aria-pressed]')].find((b) => b.title === ${JSON.stringify(name)})`;
    await until(tab, `(() => { const picker = ${PICKER}; return Boolean(picker) && Boolean(${TILE}); })()`, 15000);
    const clicked = await tab.eval(`(() => { const picker = ${PICKER}; const tile = picker && ${TILE}; if (tile) tile.click(); return Boolean(tile); })()`);
    // A picked tile says so (chat.jsx CountryTile, aria-pressed).
    const picked = await until(tab, `(() => { const picker = ${PICKER}; const tile = picker && ${TILE}; return Boolean(tile) && tile.getAttribute('aria-pressed') === 'true'; })()`, 10000);
    if (!picked) {
      await shoot(tab, "x-country-not-picked");
      const named = await tab.eval(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${JSON.stringify(name)}).map((b) => (b.closest('[class], [style]')?.parentElement?.textContent || '').replace(/\\s+/g, ' ').slice(0, 120))`).catch(() => []);
      const picker = await tab.eval(`(() => { const picker = ${PICKER}; return picker ? { buttons: [...picker.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12), selected: (picker.textContent.match(/Selected[^:]*:[^A-Z]*/) || [''])[0].slice(0, 80) } : null; })()`).catch((error) => String(error));
      const diagnostics = await tab.eval(`(() => { try { return (JSON.parse(localStorage.getItem('oh_debug_log_v1') || '{}').entries || []).filter((entry) => entry.category === 'shared game' || entry.problem).slice(-15).map((entry) => String(entry.category) + ': ' + String(entry.message).slice(0, 160)); } catch (error) { return [String(error)]; } })()`).catch(() => []);
      throw new Error(`${name} was not picked (tile found: ${clicked}); the picker: ${JSON.stringify(picker)}; buttons named so on the page: ${JSON.stringify(named)}; its console: ${JSON.stringify(tab.logs.slice(-15))}; its log: ${JSON.stringify(diagnostics)}`);
    }
    await sleep(300);
  };
  // The picker's confirm button: "Start conversation", with an arrow after it.
  const startConversation = (tab) => tab.eval("(() => { const button = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.textContent.trim().startsWith('Start conversation')); if (button) button.click(); return Boolean(button); })()");
  const SEND = `document.querySelector('button[aria-label="Send message"]')`;
  const sayInOpenThread = async (tab, line) => {
    // A thread that never opened is said, with what the screen showed then.
    if (!(await until(tab, `Boolean(${SEND})`, 15000))) {
      await shoot(tab, "x-no-send-button");
      const showing = await tab.eval(`document.body.innerText.split("
").map((text) => text.trim()).filter(Boolean).slice(0, 40).join(" | ")`).catch(() => "");
      throw new Error(`no thread open to write ${JSON.stringify(line)} in; the screen showed: ${String(showing).slice(0, 1200)}`);
    }
    await tab.eval(`(() => { window.__e2e.type(${SEND}.parentElement.querySelector('textarea'), ${JSON.stringify(line)}); return true; })()`);
    await sleep(300);
    await tab.eval(`${SEND}.click(); true`);
  };
  const threadRows = (tab) => tab.eval("[...document.querySelectorAll('[data-diplomacy-thread-row]')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim())");
  const toolsBeforeTalk = sentTools.length;
  await toggleChats(host);
  await until(host, "window.__e2e.buttons('+ New diplomatic channel').length > 0", 15000);
  await host.eval("window.__e2e.click('+ New diplomatic channel')");
  await until(host, `Boolean(document.querySelector('input[placeholder="Search countries..."]'))`, 15000);
  await pickCountry(host, GUEST_COUNTRY);
  await startConversation(host);
  await sayInOpenThread(host, LINE_FROM_HOST);
  const holds = (line) => `window.__e2e.view('chat').then((chats) => JSON.stringify(chats).includes(${JSON.stringify(line)}))`;
  const lineReached = await until(guest, holds(LINE_FROM_HOST), 20000);
  await toggleChats(guest);
  await until(guest, "document.querySelectorAll('[data-diplomacy-thread-row]').length > 0", 15000);
  const guestRows = await threadRows(guest);
  check("a line the host writes to the guest's country reaches the guest as a thread with the host",
    lineReached && guestRows.some((row) => row.includes(HOST_COUNTRY) && !row.startsWith(GUEST_COUNTRY)),
    JSON.stringify({ guestRows }));
  await sleep(4000);
  check("nobody answers for a country a person plays: the model is not asked", sentTools.length === toolsBeforeTalk,
    `asked: ${sentTools.slice(toolsBeforeTalk).join(", ") || "nothing"}`);
  // The guest answers in the same thread.
  await guest.eval("document.querySelector('[data-diplomacy-thread-row]').click(); true");
  await sayInOpenThread(guest, LINE_FROM_GUEST);
  const answerReached = await until(host, holds(LINE_FROM_GUEST), 20000);
  const guestPanel = await guest.eval("document.body.textContent");
  const lineOf = (chats, line) => chats.flatMap((chat) => chat.messages ?? []).find((message) => message.text === line);
  const hostChats = await host.eval("window.__e2e.view('chat')");
  const guestChats = await guest.eval("window.__e2e.view('chat')");
  check("the guest answers in that thread, and each reads the other's line as the other's",
    answerReached && !guestPanel.includes("You are not in that conversation")
      && lineOf(hostChats, LINE_FROM_GUEST)?.speaker === GUEST_COUNTRY && lineOf(hostChats, LINE_FROM_GUEST)?.role !== "user"
      && lineOf(guestChats, LINE_FROM_GUEST)?.role === "user"
      && lineOf(guestChats, LINE_FROM_HOST)?.speaker === HOST_COUNTRY && lineOf(guestChats, LINE_FROM_HOST)?.role !== "user"
      && lineOf(hostChats, LINE_FROM_HOST)?.role === "user",
    JSON.stringify({
      refused: guestPanel.includes("You are not in that conversation"),
      host: hostChats.map((chat) => ({ with: (chat.countries ?? []).map((c) => c.name), lines: (chat.messages ?? []).map((m) => `${m.role}/${m.speaker}: ${m.text}`) })),
      guest: guestChats.map((chat) => ({ with: (chat.countries ?? []).map((c) => c.name), lines: (chat.messages ?? []).map((m) => `${m.role}/${m.speaker}: ${m.text}`) })),
    }));
  await shoot(guest, "1-guest-thread-with-host");

  // A table with an AI government at it: the host opens a thread with the
  // guest's country and one nobody plays. That government answers for itself,
  // and the model is told who at the table is a person, whoever is writing.
  const LINE_TO_TABLE = "Washington proposes a conference on the arms talks.";
  const LINE_AT_TABLE = "Moscow will attend the conference.";
  const backToList = (tab) => tab.eval(`(() => { const b = document.querySelector('button[aria-label="Back to diplomacy"]'); if (b) b.click(); return Boolean(b); })()`);
  const rosterOf = (body) => body.split("\n").filter((line) => line.includes("-controlled")).map((line) => line.trim());
  await backToList(host);
  await until(host, "window.__e2e.buttons('+ New diplomatic channel').length > 0", 15000);
  await host.eval("window.__e2e.click('+ New diplomatic channel')");
  await until(host, `Boolean(document.querySelector('input[placeholder="Search countries..."]'))`, 15000);
  await pickCountry(host, GUEST_COUNTRY);
  await pickCountry(host, AI_COUNTRY);
  await startConversation(host);
  const askedBeforeTable = chatBodies.length;
  await sayInOpenThread(host, LINE_TO_TABLE);
  const aiAnswered = await until(guest, holds(LINE_FROM_AI), 45000);
  const tableOf = (chats) => chats.find((chat) => (chat.messages ?? []).some((message) => message.text === LINE_TO_TABLE));
  const guestTable = tableOf(await guest.eval("window.__e2e.view('chat')"));
  const hostTable = tableOf(await host.eval("window.__e2e.view('chat')"));
  const namesOf = (chat) => (chat?.countries ?? []).map((country) => country.name).sort();
  const firstRoster = rosterOf(chatBodies[askedBeforeTable] ?? "");
  check("an AI government at a table of people answers for itself, and the model is told who the people are",
    aiAnswered && chatBodies.length === askedBeforeTable + 1
      && JSON.stringify(namesOf(guestTable)) === JSON.stringify([AI_COUNTRY, HOST_COUNTRY].sort())
      && JSON.stringify(namesOf(hostTable)) === JSON.stringify([AI_COUNTRY, GUEST_COUNTRY].sort())
      && (guestTable?.messages ?? []).find((message) => message.text === LINE_FROM_AI)?.speaker === AI_COUNTRY
      && firstRoster.some((line) => line.startsWith(`- ${AI_COUNTRY} — AI-controlled`))
      && firstRoster.some((line) => line.startsWith(`- ${HOST_COUNTRY} — HUMAN-controlled (the player)`))
      && firstRoster.some((line) => line.startsWith(`- ${GUEST_COUNTRY} — HUMAN-controlled (another player)`)),
    JSON.stringify({ ai: AI_COUNTRY, asked: chatBodies.length - askedBeforeTable, guestSees: namesOf(guestTable), hostSees: namesOf(hostTable), roster: firstRoster }));
  // The guest speaks at the same table, which is the host's thread.
  await backToList(guest);
  await until(guest, "document.querySelectorAll('[data-diplomacy-thread-row]').length > 1", 15000);
  await guest.eval(`(() => { const row = [...document.querySelectorAll('[data-diplomacy-thread-row]')].find((entry) => entry.textContent.includes(${JSON.stringify(AI_COUNTRY)})); if (row) row.click(); return Boolean(row); })()`);
  await sayInOpenThread(guest, LINE_AT_TABLE);

  // An institution founded from a guest's screen: the host founds it for the
  // guest's country (host/institutions.js). From any screen of a shared game
  // that write was refused ("409"), and run for a guest the game's own
  // institution functions would have dropped the host's thread with that guest.
  const INSTITUTION = "E2E Concord";
  const hostThreadsBefore = (await host.eval("window.__e2e.view('chat')")).length;
  // The panel's tabs are over its list, not over an open thread.
  await backToList(guest);
  await until(guest, "window.__e2e.buttons('Institutions').length > 0", 15000);
  await guest.eval("window.__e2e.click('Institutions')");
  await until(guest, "window.__e2e.buttons('＋ Found institution').length > 0", 15000);
  await guest.eval("window.__e2e.click('＋ Found institution')");
  const formOpen = await until(guest, `Boolean(document.querySelector('input[placeholder="Baltic Union"]'))`, 15000);
  if (!formOpen) {
    const seen = await guest.eval("[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 40)");
    throw new Error(`the founding form did not open; buttons: ${JSON.stringify(seen)}`);
  }
  await guest.eval(`(() => { window.__e2e.type(document.querySelector('input[placeholder="Baltic Union"]'), ${JSON.stringify(INSTITUTION)}); return true; })()`);
  await sleep(300);
  await guest.eval("window.__e2e.click('Found institution')");
  const founded = await until(host, `window.__e2e.view('world').then((world) => Object.values(world?.institutions?.byId || {}).some((entry) => entry?.name === ${JSON.stringify(INSTITUTION)} && (entry.members || []).some((member) => member?.polity === ${JSON.stringify(GUEST_COUNTRY)})))`, 30000);
  const guestSeesIt = await until(guest, `document.body.textContent.includes(${JSON.stringify(INSTITUTION)})`, 15000);
  const refusal = await guest.eval("(document.body.textContent.match(/409|resolves every round|this is done there/) || [''])[0]");
  const hostThreadsAfter = (await host.eval("window.__e2e.view('chat')")).length;
  check("a guest founds an institution: the host founds it for the guest's country, and the host's threads are untouched",
    founded && guestSeesIt && !refusal && hostThreadsAfter >= hostThreadsBefore,
    JSON.stringify({ founded, guestSeesIt, refusal, hostThreadsBefore, hostThreadsAfter }));
  const guestHeard = await until(host, holds(LINE_AT_TABLE), 20000);
  for (const deadline = Date.now() + 45000 * PATIENCE; Date.now() < deadline && chatBodies.length < askedBeforeTable + 2;) await sleep(300);
  const askedAgain = chatBodies.length >= askedBeforeTable + 2;
  const secondBody = chatBodies[askedBeforeTable + 1] ?? "";
  const secondRoster = rosterOf(secondBody);
  check("a guest's line at the host's table is the guest's own, and the model still answers for nobody but the AI",
    guestHeard && askedAgain
      && secondRoster.some((line) => line.startsWith(`- ${GUEST_COUNTRY} — HUMAN-controlled (the player)`))
      && secondRoster.some((line) => line.startsWith(`- ${HOST_COUNTRY} — HUMAN-controlled (another player)`))
      && secondBody.includes(`${HOST_COUNTRY}: ${LINE_TO_TABLE}`) && secondBody.includes(`${GUEST_COUNTRY} has just said: ${LINE_AT_TABLE}`),
    JSON.stringify({ guestHeard, asked: chatBodies.length - askedBeforeTable, roster: secondRoster, hostLineNamed: secondBody.includes(`${HOST_COUNTRY}: ${LINE_TO_TABLE}`) }));
  await shoot(guest, "1-guest-conference");

  // A vote at the table (game/messages.js "say" `poll` and "vote"): the host
  // calls it from its panel, and the guest votes in it from its own screen.
  // Until 2026-11-16 neither was offered in a shared game.
  const QUESTION = "Shall the conference meet in Tallinn?";
  const pollAtTable = `window.__e2e.view('chat').then((chats) => ((chats.find((chat) => (chat.messages || []).some((message) => message.text === ${JSON.stringify(LINE_TO_TABLE)})) || {}).polls || []).find((poll) => poll.question === ${JSON.stringify(QUESTION)}) || null)`;
  const voteOffered = await host.eval("window.__e2e.click('Vote')");
  const composerOpen = await until(host, `Boolean(document.querySelector('input[placeholder="What should this group decide?"]'))`, 10000);
  await host.eval(`(() => { window.__e2e.type(document.querySelector('input[placeholder="What should this group decide?"]'), ${JSON.stringify(QUESTION)}); return true; })()`);
  await sleep(300);
  await host.eval("window.__e2e.click('Open vote')");
  const called = await until(host, `${pollAtTable}.then(Boolean)`, 30000);
  const guestSeesVote = await until(guest, `${pollAtTable}.then(Boolean)`, 30000);
  // The guest is on its Institutions tab: back to its conversations, into the table.
  await guest.eval("(() => { const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Contacts')); if (tab) tab.click(); return Boolean(tab); })()");
  await until(guest, "document.querySelectorAll('[data-diplomacy-thread-row]').length > 1", 15000);
  await guest.eval(`(() => { const row = [...document.querySelectorAll('[data-diplomacy-thread-row]')].find((entry) => entry.textContent.includes(${JSON.stringify(AI_COUNTRY)})); if (row) row.click(); return Boolean(row); })()`);
  const VOTE_CARD = `[...document.querySelectorAll('div')].find((box) => [...box.children].some((child) => child.textContent === ${JSON.stringify(QUESTION)}))`;
  const ballot = await until(guest, `Boolean(${VOTE_CARD})`, 15000);
  const cast = await guest.eval(`(() => { const card = ${VOTE_CARD}; const option = card && [...card.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('No') && !b.disabled); if (option) option.click(); return Boolean(option); })()`);
  const counted = await until(host, `${pollAtTable}.then((poll) => Boolean(poll && Object.keys(poll.votes || {}).includes(${JSON.stringify(GUEST_COUNTRY)})))`, 20000);
  const heldVote = await host.eval(pollAtTable);
  const guestChose = heldVote?.options?.find((option) => option.id === heldVote?.votes?.[GUEST_COUNTRY])?.label ?? "";
  check("a vote is called at a shared game's table from the host's panel, and the guest votes in it from its own screen",
    voteOffered && composerOpen && called && guestSeesVote && ballot && cast && counted && guestChose === "No" && heldVote?.openedBy === HOST_COUNTRY,
    JSON.stringify({ voteOffered, composerOpen, called, guestSeesVote, ballot, cast, counted, guestChose, openedBy: heldVote?.openedBy ?? "", votes: heldVote?.votes ?? {} }));
  await shoot(guest, "1-guest-vote");
  await toggleChats(host);
  await toggleChats(guest);
  await sleep(400);

  // Each queues an order through the game's own Actions panel.
  const queueOrder = async (tab, text) => {
    // The launcher is "Actions and Projects" since Projects became a tab of Actions.
    await tab.eval("(() => { const launcher = document.querySelector('[title^=\"Actions\"]'); if (launcher) launcher.click(); return Boolean(launcher); })()");
    await until(tab, "Boolean(document.querySelector('textarea[placeholder^=\"Enter your action\"]'))", 15000);
    await tab.eval(`(() => { window.__e2e.type(document.querySelector('textarea[placeholder^="Enter your action"]'), ${JSON.stringify(text)}); return true; })()`);
    await sleep(300);
    await tab.eval("(() => { const button = document.querySelector('button[aria-label=\"Submit action\"]'); if (button) button.click(); return Boolean(button); })()");
  };
  const GUEST_ORDER = "Hold snap drills near the Estonian border";
  const HOST_ORDER = "Send a trade mission to Vietnam to expand exports";
  await queueOrder(guest, GUEST_ORDER);
  await queueOrder(host, HOST_ORDER);
  const guestQueued = await until(guest, `window.__e2e.view('actions').then((actions) => actions.some((a) => a.text === ${JSON.stringify(GUEST_ORDER)}))`, 20000);
  const hostQueued = await until(host, `window.__e2e.view('actions').then((actions) => actions.some((a) => a.text === ${JSON.stringify(HOST_ORDER)}))`, 20000);
  const guestActions = await guest.eval("window.__e2e.view('actions')");
  const hostActions = await host.eval("window.__e2e.view('actions')");
  check("each queues an order through the Actions panel, and sees only its own",
    guestQueued && hostQueued
      && guestActions.every((a) => a.ownerCode === GUEST_COUNTRY) && hostActions.every((a) => a.ownerCode === HOST_COUNTRY),
    JSON.stringify({ guest: guestActions.map((a) => `${a.ownerCode}: ${a.text}`), host: hostActions.map((a) => `${a.ownerCode}: ${a.text}`) }));
  // The suggestions button: asked with the asker's own key, shown on its own
  // screen and kept on that device. (Only the host has a key in this run.)
  const suggestionsAsked = await host.eval("(() => { const button = [...document.querySelectorAll('button')].find((b) => /AI Suggestions/.test(b.textContent)); if (button) button.click(); return Boolean(button); })()");
  const suggested = await until(host, `window.__e2e.view('world').then((world) => (world.actionSuggestions || []).some((topic) => topic.title === ${JSON.stringify(SUGGESTED_TOPIC)}))`, 45000);
  const suggestionShown = await until(host, `document.body.textContent.includes(${JSON.stringify(SUGGESTED_TOPIC)})`, 10000);
  const guestSuggestions = ((await guest.eval("window.__e2e.view('world')")).actionSuggestions || []).length;
  const hostFileAfterSuggestions = await (await fetch(`${HOST}/api/runtime/json/world?v=e2e`)).json();
  check("AI suggestions asked in a shared game are shown, and stay on the device that asked",
    suggestionsAsked && suggested && suggestionShown && guestSuggestions === 0 && !(hostFileAfterSuggestions.actionSuggestions || []).length,
    JSON.stringify({ asked: suggestionsAsked, kept: suggested, shown: suggestionShown, guestSuggestions, inTheHostsGame: (hostFileAfterSuggestions.actionSuggestions || []).length, tools: [...new Set(sentTools)].join(", ") }));
  await shoot(host, "1-host-suggestions");

  // A Projects board of one's own. The guest's screen saves one the way its
  // advisor's reply or the board's own buttons do (the whole world document,
  // through the game's own save path), and the host keeps it for that country
  // alone: not on the game's own board, and in nobody else's view.
  const PROJECT = "Arctic rail link to Murmansk";
  await guest.eval(`(async () => {
    const world = await window.__e2e.view('world');
    const saved = await fetch('/api/runtime/json/world?v=e2e', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...world, projects: [...(world.projects || []), { name: ${JSON.stringify(PROJECT)}, kind: 'project', status: 'active', summary: 'A second track north.' }] }) });
    window.__boardSave = saved.status;
    return true;
  })()`);
  const onGuestBoard = await until(guest, `window.__e2e.view('world').then((world) => (world.projects || []).some((project) => project.name === ${JSON.stringify(PROJECT)}))`, 15000);
  let hostFile = {};
  for (const deadline = Date.now() + 15000 * PATIENCE; Date.now() < deadline;) {
    hostFile = await (await fetch(`${HOST}/api/runtime/json/world?v=e2e`)).json();
    if ((hostFile.seatBoards?.[GUEST_COUNTRY] ?? []).length) break;
    await sleep(300);
  }
  const hostScreenWorld = await host.eval("window.__e2e.view('world')");
  check("a guest's Projects board is saved without an error, and kept by the host for that country alone",
    onGuestBoard && (await guest.eval("window.__boardSave")) === 200
      && (hostFile.seatBoards?.[GUEST_COUNTRY] ?? []).some((project) => project.name === PROJECT)
      && !(hostFile.projects ?? []).some((project) => project.name === PROJECT)
      && !JSON.stringify(hostScreenWorld).includes(PROJECT),
    JSON.stringify({ status: await guest.eval("window.__boardSave"), onGuestBoard, kept: (hostFile.seatBoards?.[GUEST_COUNTRY] ?? []).map((project) => project.name), onTheGamesOwn: (hostFile.projects ?? []).length, onTheHostsScreen: JSON.stringify(hostScreenWorld).includes(PROJECT) }));
  // An agent of the guest's own, placed from the Intelligence tab: the host
  // keeps it, tells nobody else, and it stands on the guest's own board.
  const clickButton = (tab, test) => tab.eval(`(() => { const button = [...document.querySelectorAll('button')].find((b) => !b.disabled && (${test})(b.textContent.replace(/\\s+/g, ' ').trim())); if (button) button.click(); return Boolean(button); })()`);
  await toggleChats(guest);
  await sleep(500);
  await backToList(guest);
  await until(guest, "[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Intelligence'))", 15000);
  await clickButton(guest, "(text) => text.startsWith('Intelligence')");
  await until(guest, "Boolean(document.querySelector('[data-intelligence-workspace]'))", 15000);
  // The button that places one is on the workspace's Operations page, or its first.
  if (!(await clickButton(guest, "(text) => text.includes('Deploy a network')"))) {
    await clickButton(guest, "(text) => text === 'Operations'");
    await sleep(400);
    await clickButton(guest, "(text) => text.includes('Deploy a network')");
  }
  await until(guest, `Boolean(document.querySelector('input[placeholder="Search countries..."]'))`, 15000);
  await pickCountry(guest, AI_COUNTRY);
  const confirmedAgent = await clickButton(guest, "(text) => /^(Deploy|Send|Place)/.test(text) && !text.includes('♟') && !text.includes('a network')");
  const agentPlaced = await until(guest, `window.__e2e.view('world').then((world) => (world.spies || []).some((spy) => spy.target === ${JSON.stringify(AI_COUNTRY)}))`, 20000);
  const guestWorldWithAgent = await guest.eval("window.__e2e.view('world')");
  const hostWorldWithAgent = await host.eval("window.__e2e.view('world')");
  const hostFileWithAgent = await (await fetch(`${HOST}/api/runtime/json/world?v=e2e`)).json();
  check("the guest places an agent from the Intelligence tab: the host keeps it for the guest alone, and it stands on the guest's board",
    agentPlaced
      && (hostFileWithAgent.spies ?? []).some((spy) => spy.owner === GUEST_COUNTRY && spy.target === AI_COUNTRY && spy.status === "active")
      && !(hostWorldWithAgent.spies ?? []).some((spy) => spy.target === AI_COUNTRY)
      && (guestWorldWithAgent.projects ?? []).some((project) => project.name === `Agent in ${AI_COUNTRY}`),
    JSON.stringify({ confirmed: confirmedAgent, placed: agentPlaced, inTheHostsGame: (hostFileWithAgent.spies ?? []).map((spy) => `${spy.owner}>${spy.target}:${spy.status}`), onTheHostsScreen: (hostWorldWithAgent.spies ?? []).length, guestBoard: (guestWorldWithAgent.projects ?? []).map((project) => project.name), guestSays: (await guest.eval("document.body.innerText")).split("\n").filter((line) => /could not|did not|not one|Unknown|at most/i.test(line)).slice(0, 3) }));
  await toggleChats(guest);
  await sleep(300);

  await shoot(guest, "1-guest-planning");
  await shoot(host, "1-host-planning");

  // The host's screen hears of the AI calls its engine makes.
  await host.eval(`(() => { window.__aiDone = []; window.addEventListener('oh:ai-generation-complete', (event) => window.__aiDone.push(event.detail || {})); return true; })()`);
  await host.eval(`window.__e2e.click("I'm ready")`);
  await guest.eval(`window.__e2e.click("I'm ready")`);
  const resolved = await until(guest, "window.__e2e.view('events').then((events) => events.some((e) => String(e.title).startsWith('Oil prices slide further')))", 240000);
  check("everyone ready: the host runs the round and its events reach the guest", resolved, `jump answers: ${answeredJumps}; tools asked: ${[...new Set(sentTools)].join(", ")}`);
  check("the model is told who plays what, and whose each order is",
    lastJumpBody.includes("[Shared Game") && lastJumpBody.includes(`(action, ${GUEST_COUNTRY})`) && lastJumpBody.includes(`(action, ${HOST_COUNTRY})`),
    lastJumpBody.split("\n").filter((line) => line.includes("(action,") || line.startsWith("People play")).slice(0, 4).join(" | "));
  // The guest's own open project stood on the game's board for the skip, so
  // the world could move it, and is home again afterwards: on the guest's
  // board, not the host's.
  const hostFileAfterRound = await (await fetch(`${HOST}/api/runtime/json/world?v=e2e`)).json();
  check("the time skip is shown every player's own projects, and each board is its owner's again afterwards",
    resolved && lastJumpBody.includes(PROJECT)
      && (hostFileAfterRound.seatBoards?.[GUEST_COUNTRY] ?? []).some((project) => project.name === PROJECT)
      && !(hostFileAfterRound.projects ?? []).some((project) => project.name === PROJECT),
    JSON.stringify({ inThePrompt: lastJumpBody.includes(PROJECT), guestBoard: (hostFileAfterRound.seatBoards?.[GUEST_COUNTRY] ?? []).map((project) => project.name), gamesOwn: (hostFileAfterRound.projects ?? []).map((project) => project.name) }));
  const guestEvents = resolved ? await guest.eval("window.__e2e.view('events')") : [];
  const hostEvents = resolved ? await host.eval("window.__e2e.view('events')") : [];
  const war = (events) => events.some((event) => String(event.title).includes("declares war on Ukraine"));
  check("the world never chose for the guest: its unordered declaration of war was withheld", resolved && !war(guestEvents) && !war(hostEvents),
    `guest ${guestEvents.filter((e) => STAGED_TITLES.some((part) => String(e.title).includes(part))).map((e) => e.title).join(" / ")}`);
  const drills = (events) => events.find((event) => String(event.title).includes("snap drills"));
  const mission = (events) => events.find((event) => String(event.title).includes("trade mission"));
  const guestOrderId = guestActions.find((a) => a.text === GUEST_ORDER)?.id;
  const hostOrderId = hostActions.find((a) => a.text === HOST_ORDER)?.id;
  check("each order's answer reached everyone, citing the order only for the player who gave it",
    drills(guestEvents)?.impacts?.actionIds?.includes(guestOrderId) && (drills(hostEvents)?.impacts?.actionIds ?? []).length === 0
      && mission(hostEvents)?.impacts?.actionIds?.includes(hostOrderId) && (mission(guestEvents)?.impacts?.actionIds ?? []).length === 0,
    JSON.stringify({ guestDrills: drills(guestEvents)?.impacts?.actionIds, hostDrills: drills(hostEvents)?.impacts?.actionIds, hostMission: mission(hostEvents)?.impacts?.actionIds, guestMission: mission(guestEvents)?.impacts?.actionIds }));
  await sleep(1500);
  await shoot(guest, "2-guest-after-round");
  await shoot(host, "2-host-after-round");
  const seenAfter = await guest.eval("window.__seen");
  check("the guest is never asked for an AI key (the host's key runs the game)", !seenAfter.apiPrompt && !(await guest.eval("Boolean(document.querySelector('[aria-label=\"Set up your AI provider\"]'))")));
  const newDate = (await guest.eval("window.__e2e.view('game')"))?.gameDate || "";
  const datesMoved = newDate && newDate !== ORIGIN
    && (await Promise.all([host, guest].map((tab) => until(tab, `document.body.textContent.includes(${JSON.stringify(`/ ${newDate}`)})`, 10000)))).every(Boolean);
  check("both menu bars move on to the round's new date", datesMoved, `${ORIGIN} → ${newDate}`);
  const guestWorld = await guest.eval("window.__e2e.view('world')");
  const guestTurn = (guestWorld.simulationHistory ?? [])[0] ?? {};
  check("the guest's view holds none of the narrator's own: the turn is its dates and its events, nothing more",
    !guestWorld.lastJumpSummary && !(guestWorld.storylines ?? []).length
      && (guestTurn.eventIds ?? []).length >= 4 && !guestTurn.summary && !guestTurn.rawResponse && !guestTurn.receipt
      && (guestTurn.plannedActions ?? []).every((action) => action.ownerCode === GUEST_COUNTRY),
    JSON.stringify({ summary: Boolean(guestWorld.lastJumpSummary), storylines: (guestWorld.storylines ?? []).length, turn: Object.keys(guestTurn), events: (guestTurn.eventIds ?? []).length, orders: (guestTurn.plannedActions ?? []).map((action) => action.ownerCode) }));
  const phase = await guest.eval("document.body.textContent.includes('What happened') || document.body.textContent.includes('Round 2')");
  check("the round moves on to its reveal", phase);

  // The round is shown on every screen the way a time skip is: the Events
  // panel opens on it, its first event on screen and the rest to come.
  const panelOpen = (tab) => until(tab, "document.body.textContent.includes('Oil prices slide further') && window.__e2e.buttons('Next event').length > 0", 20000);
  const panels = await Promise.all([panelOpen(host), panelOpen(guest)]);
  const lastTitle = "Brazil's central bank raises rates";
  const hiddenYet = await Promise.all([host, guest].map((tab) => tab.eval(`!document.body.textContent.includes(${JSON.stringify(lastTitle)})`)));
  check("the round opens in the Events panel on every screen, its first event shown and the rest still to come",
    panels.every(Boolean) && hiddenYet.every(Boolean), JSON.stringify({ host: panels[0], guest: panels[1], restHidden: hiddenYet }));
  await shoot(guest, "2-guest-events-panel");
  await shoot(host, "2-host-events-panel");
  // Each reads it through; once everyone has, the next round plans at once,
  // well inside the reveal's own limit.
  const readThrough = async (tab) => {
    for (let step = 0; step < 12 && await tab.eval("window.__e2e.click('Next event')"); step += 1) await sleep(400);
    return tab.eval(`document.body.textContent.includes(${JSON.stringify(lastTitle)})`);
  };
  const readAll = await Promise.all([readThrough(host), readThrough(guest)]);
  const planningAgain = (await Promise.all([host, guest].map((tab) => until(tab, "document.body.textContent.includes('Round 2') && !document.body.textContent.includes('What happened')", 30000)))).every(Boolean);
  check("everyone reads the round through, and the next round's planning begins without waiting out the timer",
    readAll.every(Boolean) && planningAgain, JSON.stringify({ readAll, planningAgain }));

  // The host's own screen knows of the AI calls its engine made: the AI debug
  // console reads the stored record, and the diagnostics log has the engine's lines.
  const announced = await until(host, "(window.__aiDone || []).some((detail) => /jump/i.test(String(detail.taskKey)))", 10000);
  const storedCalls = await host.eval(`new Promise((resolve) => {
    const request = indexedDB.open('oh-debug-telemetry');
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      try {
        const all = request.result.transaction('generations', 'readonly').objectStore('generations').getAll();
        all.onsuccess = () => resolve((all.result || []).map((record) => record.taskKey));
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
  })`);
  await sleep(1200);
  const engineLines = await host.eval(`(() => { try { return (JSON.parse(localStorage.getItem('oh_debug_log_v1') || '{}').entries || []).filter((entry) => String(entry.message).startsWith("(host's engine)")).length; } catch { return 0; } })()`);
  check("the host's AI debug console and diagnostics log cover the calls its engine made",
    announced && storedCalls.some((task) => /jump/i.test(String(task))) && engineLines > 0,
    JSON.stringify({ announced, stored: [...new Set(storedCalls)], engineLines, heard: await host.eval("(window.__aiDone || []).map((detail) => detail.taskKey)") }));

  // Nothing a player's screen saved came back as an error, and nothing was
  // refused out loud for something nobody asked for.
  const complaints = (tab) => tab.logs.filter((line) => /HTTP 409|Failed to save|SharedGameRefusal|not fully updated/i.test(line));
  check("no save was turned away with an error on either screen", complaints(host).length === 0 && complaints(guest).length === 0,
    JSON.stringify({ host: complaints(host).slice(0, 3), guest: complaints(guest).slice(0, 3) }));

  // One door for every change a screen makes (the map's rule 6): a save holding a change no request takes is
  // logged by the page (client/seatWrites.js unroutedChanges), and here it is a failure: it was dropped unheard.
  const unrouted = async (tab) => (await tab.eval(`(() => { try { return (JSON.parse(localStorage.getItem('oh_debug_log_v1') || '{}').entries || []).map((entry) => String(entry.message)).filter((message) => message.includes("a change only this screen made")).slice(0, 4); } catch { return ["the log could not be read"]; } })()`)) ?? [];
  const unroutedHost = await unrouted(host);
  const unroutedGuest = await unrouted(guest);
  check("no screen made a change that no request carries to the host", unroutedHost.length === 0 && unroutedGuest.length === 0,
    JSON.stringify({ host: unroutedHost, guest: unroutedGuest }));

  // Whose AI answers a message to a country the AI plays is the host's choice
  // (host/settings.js `replies`): "build C and D, and the host can choose, but
  // no sending api keys". Until here the host's AI answered (C). The host now
  // changes it from Players, and the guest, with a key of its own from here
  // on, writes to a government the AI plays: the reply is written on the
  // guest's own page with the guest's own key (D), the host's engine is asked
  // nothing, and what reaches the host is the words alone.
  const LINE_TO_AI = "Moscow asks for a meeting in the spring.";
  const LINE_FROM_GUESTS_AI = "A meeting in the spring suits us.";
  const SECOND_LINE_TO_AI = "And where shall it be held?";
  await standInModel(guest);
  guest.aiLine = LINE_FROM_GUESTS_AI;
  // The guest's model list was made when its page started, with no key
  // (providerConfig.js reads the provider's own settings once, to make it): its
  // Gemini connection is given one here, as Settings → AI would.
  await guest.eval(`(() => {
    ${AI_SETTING}
    const connections = JSON.parse(localStorage.getItem("ai_connections") || "[]");
    localStorage.setItem("ai_connections", JSON.stringify(connections.map((connection) => (connection.provider === "gemini" ? { ...connection, apiKey: "e2e-dummy-key" } : connection))));
    localStorage.removeItem("ai_fallback_states");
    return true;
  })()`);
  const repliesSelect = `[...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'own'))`;
  await host.eval("window.__e2e.click('Players')");
  await until(host, `Boolean(${repliesSelect})`, 10000);
  await host.eval(`(() => { window.__e2e.choose(${repliesSelect}, 'own'); return true; })()`);
  await guest.eval("window.__e2e.click('Players')");
  const guestTold = await until(guest, "document.body.textContent.includes('Countries the AI plays answer your messages with your own AI key.')", 15000);
  const hostShows = await until(host, `(() => { const select = ${repliesSelect}; return Boolean(select) && select.value === 'own'; })()`, 10000);
  await shoot(host, "3-host-whose-ai-answers");
  await host.eval("window.__e2e.click('Players')");
  await guest.eval("window.__e2e.click('Players')");
  check("the host changes whose AI answers while the game runs, and the guest is told it is now its own", guestTold && hostShows, JSON.stringify({ guestTold, hostShows }));

  const engineAskedBefore = (engine.asked ?? []).length;
  const guestAskedBefore = (guest.asked ?? []).length;
  const chatsOf = async () => (await fetch(`${HOST}/api/runtime/json/chat?v=e2e`)).json();
  const tableWith = (chats, line) => chats.find((chat) => (chat.messages ?? []).some((message) => message.text === line));
  await toggleChats(guest);
  await sleep(500);
  await backToList(guest);
  await clickButton(guest, "(text) => text.startsWith('Contacts')");
  await until(guest, "window.__e2e.buttons('+ New diplomatic channel').length > 0", 15000);
  await guest.eval("window.__e2e.click('+ New diplomatic channel')");
  await until(guest, `Boolean(document.querySelector('input[placeholder="Search countries..."]'))`, 15000);
  await pickCountry(guest, AI_COUNTRY);
  await startConversation(guest);
  await sayInOpenThread(guest, LINE_TO_AI);
  const ownReplyShown = await until(guest, `document.body.textContent.includes(${JSON.stringify(LINE_FROM_GUESTS_AI)})`, 60000);
  const ownTable = tableWith(await chatsOf(), LINE_TO_AI);
  const ownLines = (ownTable?.messages ?? []).map((message) => [message.role, message.speaker, message.text, Boolean(message.time)]);
  const guestBody = (guest.chatBodies ?? []).at(-1) ?? "";
  const guestRoster = rosterOf(guestBody);
  const hostScreenHolds = await host.eval(holds(LINE_FROM_GUESTS_AI));
  check("with each player's own AI, the guest's own page writes the AI government's reply with its own key: the host's engine is asked nothing, and keeps the words",
    ownReplyShown
      && (guest.asked ?? []).slice(guestAskedBefore).filter((tool) => tool === "submit_chat_actions").length === 1
      && (engine.asked ?? []).length === engineAskedBefore
      && JSON.stringify(ownLines) === JSON.stringify([["user", GUEST_COUNTRY, LINE_TO_AI, true], ["leader", AI_COUNTRY, LINE_FROM_GUESTS_AI, true]])
      && ownTable?.player === GUEST_COUNTRY && !ownTable?.title
      && !hostScreenHolds
      && guestBody.includes("[What this reply is]") && guestBody.includes(`${GUEST_COUNTRY} has just said: ${LINE_TO_AI}`)
      && guestRoster.some((line) => line.startsWith(`- ${AI_COUNTRY} — AI-controlled`))
      && guestRoster.some((line) => line.startsWith(`- ${GUEST_COUNTRY} — HUMAN-controlled (the player)`)),
    JSON.stringify({
      shown: ownReplyShown, guestAsked: (guest.asked ?? []).slice(guestAskedBefore), engineAsked: (engine.asked ?? []).slice(engineAskedBefore), lines: ownLines, title: ownTable?.title ?? "", onTheHostsScreen: hostScreenHolds, roster: guestRoster, toldItIsWordsAlone: guestBody.includes("[What this reply is]"),
      // What the guest's screen and its log say, when the reply never came.
      ...(ownReplyShown ? {} : {
        guestSays: await guest.eval(`document.body.innerText.split("\\n").map((line) => line.trim()).filter((line) => /could not|did not|not waiting|Error|Retry|Thinking|Considering/i.test(line)).slice(0, 8)`),
        guestLog: await guest.eval(`(() => { try { return (JSON.parse(localStorage.getItem('oh_debug_log_v1') || '{}').entries || []).filter((entry) => /reply|device|chatActions|Chat #/i.test(String(entry.message))).slice(-8).map((entry) => String(entry.category) + ": " + String(entry.message).slice(0, 200)); } catch (error) { return [String(error)]; } })()`),
        guestConsole: guest.logs.slice(-8),
      }),
    }));
  await shoot(guest, "3-guest-own-ai-reply");

  // The guest's own AI is out for its next line: the thread says so, and Retry
  // asks again for the same line, which is not said a second time.
  const RETRY_CHECK = "when a player's own AI cannot be reached the thread says so, and Retry answers the same line without saying it twice";
  if (!ownReplyShown) check(RETRY_CHECK, false, "not tried: the first reply never came");
  else {
  guest.aiDown = true;
  await sayInOpenThread(guest, SECOND_LINE_TO_AI);
  const toldUnreachable = await until(guest, "document.body.textContent.includes('The AI could not be reached, so nobody at the table answered.') && window.__e2e.buttons('Retry').length > 0", 90000);
  await shoot(guest, "3-guest-own-ai-unreachable");
  const beforeRetry = tableWith(await chatsOf(), LINE_TO_AI);
  guest.aiDown = false;
  await guest.eval("window.__e2e.click('Retry')");
  let afterRetry = beforeRetry;
  for (const deadline = Date.now() + 60000 * PATIENCE; Date.now() < deadline;) {
    afterRetry = tableWith(await chatsOf(), LINE_TO_AI);
    if ((afterRetry?.messages ?? []).length >= 4) break;
    await sleep(300);
  }
  const retried = (afterRetry?.messages ?? []).map((message) => `${message.speaker}: ${message.text}`);
  const bubbleGone = await until(guest, "!document.body.textContent.includes('The AI could not be reached, so nobody at the table answered.')", 15000);
  check(RETRY_CHECK,
    toldUnreachable && (beforeRetry?.messages ?? []).length === 3 && bubbleGone
      && JSON.stringify(retried) === JSON.stringify([`${GUEST_COUNTRY}: ${LINE_TO_AI}`, `${AI_COUNTRY}: ${LINE_FROM_GUESTS_AI}`, `${GUEST_COUNTRY}: ${SECOND_LINE_TO_AI}`, `${AI_COUNTRY}: ${LINE_FROM_GUESTS_AI}`])
      && (engine.asked ?? []).length === engineAskedBefore,
    JSON.stringify({ toldUnreachable, before: (beforeRetry?.messages ?? []).length, bubbleGone, lines: retried, engineAsked: (engine.asked ?? []).slice(engineAskedBefore) }));
  }
  await toggleChats(guest);

  // Once the game is under way a player changes country only with the host's
  // yes (the owner's decision 12): the guest asks under Players, the host is
  // shown who asks, with its hand on the guest's seat beside it (Release, Ban),
  // and refuses.
  await guest.eval("window.__e2e.click('Players')");
  const askPicker = `[...document.querySelectorAll('select')].find((s) => s.options[0] && s.options[0].textContent.startsWith('Ask to play another country'))`;
  const canAsk = await until(guest, `Boolean(${askPicker})`, 10000);
  if (canAsk) {
    await guest.eval(`(() => { window.__e2e.choose(${askPicker}, ${JSON.stringify(AI_COUNTRY)}); return true; })()`);
    await sleep(300);
    await guest.eval("window.__e2e.click('Ask the host')");
  }
  const guestAsked = await until(guest, `document.body.textContent.includes(${JSON.stringify(`You asked the host to let you play ${AI_COUNTRY}.`)})`, 20000);
  const hostAsked = await until(host, "window.__e2e.buttons('Players (1 asking)').length > 0", 20000);
  await host.eval("window.__e2e.click('Players (1 asking)')");
  const askShown = await until(host, `document.body.textContent.includes(${JSON.stringify(`(${GUEST_COUNTRY}) asks to play ${AI_COUNTRY}.`)}) && window.__e2e.buttons('Allow').length > 0 && window.__e2e.buttons('Refuse').length > 0`, 10000);
  const handOnSeat = await host.eval("window.__e2e.buttons('Release').length > 0 && window.__e2e.buttons('Ban').length > 0");
  await shoot(host, "4-host-change-request");
  await shoot(guest, "4-guest-asks-to-change");
  await host.eval("window.__e2e.click('Refuse')");
  const keptAs = await until(guest, `document.body.textContent.includes(${JSON.stringify(`The host keeps you as ${GUEST_COUNTRY}.`)})`, 20000);
  const stillPlays = (await guest.eval("window.__e2e.view('game')"))?.country === GUEST_COUNTRY;
  const askGone = await until(host, "window.__e2e.buttons('Allow').length === 0", 10000);
  await host.eval("window.__e2e.click('Players')");
  await guest.eval("window.__e2e.click('Players')");
  check("once the game is under way the guest asks the host to change country, and the host, shown who asks beside Release and Ban, refuses",
    canAsk && guestAsked && hostAsked && askShown && handOnSeat && keptAs && stillPlays && askGone,
    JSON.stringify({ canAsk, guestAsked, hostAsked, askShown, handOnSeat, keptAs, stillPlays, askGone }));

  // One writer (server/oneWriter.js): while the game is shared, its server
  // takes a write to it only from the engine window. Anything else (the host's
  // page after a reload, a second window, another device) is refused with why.
  const refusedWrite = await fetch(`${HOST}/api/runtime/json/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ written: "by someone other than the engine" }) });
  const refusedWords = (await refusedWrite.json().catch(() => ({}))).error ?? "";
  const refusedTurn = (await fetch(`${HOST}/api/runtime/turn-commit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status;
  const forgedWrite = (await fetch(`${HOST}/api/runtime/json/world`, { method: "PUT", headers: { "Content-Type": "application/json", "X-OH-Engine": "not-the-engines-credential" }, body: "{}" })).status;
  // And the shared world is as it was: the refused write left no trace.
  const worldKept = !(await (await fetch(`${HOST}/api/runtime/json/world?v=e2e`)).json())?.written;
  check("while the game is shared only its engine window writes it: anyone else's write, or a forged credential, is refused with why",
    refusedWrite.status === 423 && /being shared/.test(refusedWords) && refusedTurn === 423 && forgedWrite === 423 && worldKept,
    JSON.stringify({ world: refusedWrite.status, words: refusedWords, turn: refusedTurn, forged: forgedWrite }));

  // The host's page reloads (F5, the update banner, a crash's Reload): it comes
  // back to its shared game as the host's screen, and the round waits for it
  // meanwhile, as every player is told.
  await guest.eval(`(() => { window.__hostAway = { away: false, back: false }; new MutationObserver(() => { const text = document.body.textContent; if (text.includes("The host's screen is away")) window.__hostAway.away = true; if (text.includes("The host is back")) window.__hostAway.back = true; }).observe(document.body, { childList: true, subtree: true, characterData: true }); return true; })()`);
  const roundBeforeReload = Number(await host.eval("(document.body.textContent.match(/Round (\\d+) ·/) || [])[1] || 0"));
  await host.send("Page.reload");
  await sleep(1000);
  await until(host, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await sleep(500);
  await withHelpers(host);
  const hostBack = await until(host, `document.body.textContent.includes(${JSON.stringify(`Round ${roundBeforeReload} · `)}) && (window.__e2e.buttons('Pause').length > 0 || window.__e2e.buttons('Resume').length > 0)`, 90000);
  const guestToldOfHost = await until(guest, "window.__hostAway && window.__hostAway.away && window.__hostAway.back", 30000);
  const hostView = await host.eval("window.__e2e.view('game')").catch(() => null);
  const reloadComplaints = host.logs.filter((line) => /HTTP 423|Failed to save/i.test(line));
  // Back in the game, as hosting goes into it: the main menu is not left up.
  await openVaultDoor(host).catch(() => false);
  const hostInGame = await until(host, "window.__e2e.buttons('Lobbies').length === 0", 60000);
  await shoot(host, "5-host-back-after-reload");
  check("the host's page reloads and comes back to its shared game as the host's screen; the round waited for it, every player was told, and the page wrote nothing meanwhile",
    hostBack && guestToldOfHost && hostView?.country === HOST_COUNTRY && reloadComplaints.length === 0 && hostInGame,
    JSON.stringify({ hostBack, guestTold: await guest.eval("window.__hostAway"), country: hostView?.country, complaints: reloadComplaints.slice(0, 3), inGame: hostInGame }));

  // Where the rounds are when the host stops sharing: the round read through
  // is done, so the one being planned is the one a game shared again plans.
  const roundAtStop = Number(await host.eval("(document.body.textContent.match(/Round (\\d+) ·/) || [])[1] || 0"));
  await host.eval("window.__e2e.click('Stop')");
  const ended = await until(guest, "document.body.textContent.includes('The shared game ended')", 30000);
  check("when the host stops, the guest is told", ended);
  check("and told why: the host closed the game", await until(guest, "document.body.textContent.includes('The host closed the game')", 5000));

  // The session is part of the game (host/sessionRecord.js): it is in the
  // campaign, with the guest's seat bound to its device.
  const saved = await (await fetch(`${HOST}/api/runtime/json/shared?v=e2e`)).json();
  const savedSeat = (saved?.seats ?? []).find((seat) => seat.country === GUEST_COUNTRY);
  check("the shared game's session is saved with the game: the guest's seat is its device's, and the round to plan next",
    saved?.started === true && Boolean(savedSeat?.device) && saved?.round === roundAtStop,
    JSON.stringify({ started: saved?.started, seat: savedSeat, round: saved?.round, roundAtStop }));

  // Shared again another day, in a new engine window, as the desktop app opens
  // one: every player has their own country back, without choosing, at the
  // round the game was at, which waits paused for the host.
  // (A new window: its credential comes in its address, which the old page
  // took out of its own on opening.)
  await engine.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await engine.send("Page.navigate", { url: ENGINE_PAGE });
  await sleep(500);
  await until(engine, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await until(host, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await sleep(1000);
  await withHelpers(host);
  await until(host, "(window.__e2e || false) && window.__e2e.buttons('Lobbies').length > 0", 60000);
  await openVaultDoor(host);
  await host.eval("window.__e2e.click('Lobbies')");
  await until(host, "window.__e2e.buttons('Host a lobby').length > 0", 15000);
  await host.eval("window.__e2e.click('Host a lobby')");
  await until(host, "window.__e2e.buttons('Open the lobby').length > 0", 15000);
  await host.eval("window.__e2e.click('Open the lobby')");
  const resumedPaused = await until(host, `document.body.textContent.includes(${JSON.stringify(`Round ${roundAtStop} · `)}) && window.__e2e.buttons('Resume').length > 0`, 45000);
  const codeAgain = await until(host, "Boolean(document.querySelector('code') && document.querySelector('code').textContent === " + JSON.stringify(token) + ")", 15000);
  check("shared again, the game goes on at the round it was at, paused for the host, with the same invite code under Players",
    resumedPaused && codeAgain, JSON.stringify({ resumedPaused, codeAgain, roundAtStop }));
  await until(host, "window.__e2e.buttons('Lobbies').length === 0", 60000);
  await shoot(host, "5-host-shared-again-paused");

  await guest.eval("window.__e2e.click('Back to my games')");
  await sleep(1000);
  await until(guest, `location.origin === ${JSON.stringify(GUEST)} && document.readyState === 'complete'`, 30000);
  await withHelpers(guest);
  await until(guest, "window.__e2e.buttons('Lobbies').length > 0", 60000);
  await openVaultDoor(guest);
  await guest.eval("window.__e2e.click('Lobbies')");
  await until(guest, "Boolean(document.querySelector('input[placeholder=\"oh1-…\"]'))", 15000);
  await guest.eval(`(() => { const e = window.__e2e; e.type(document.querySelector('input[placeholder="oh1-…"]'), ${JSON.stringify(token)}); const name = [...document.querySelectorAll('input[placeholder="Player"]')][0]; if (name) e.type(name, "Guest"); return true; })()`);
  await sleep(300);
  await guest.eval("window.__e2e.click('Join')");
  const backInBar = await until(guest, `document.body.textContent.includes(${JSON.stringify(`Round ${roundAtStop} · `)}) && window.__e2e.buttons('Players').length > 0`, 120000);
  await until(guest, `window.__e2e.view('game').then((game) => game.country === ${JSON.stringify(GUEST_COUNTRY)})`, 30000);
  const backAs = (await guest.eval("window.__e2e.view('game')"))?.country;
  const neverChose = !(await guest.eval("[...document.querySelectorAll('select')].some((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country'))"));
  check("the guest joins again with the same code and plays its own country again without choosing it",
    backInBar && backAs === GUEST_COUNTRY && neverChose, JSON.stringify({ backInBar, backAs, neverChose }));
  await until(guest, "!document.querySelector('.oh-loading-screen')", 90000);
  await shoot(guest, "5-guest-back-in-its-country");
  await host.eval("window.__e2e.click('Resume')");
  const resumed = await until(host, "window.__e2e.buttons('Pause').length > 0", 15000);
  check("the host resumes the game once its players are back", resumed);

  await host.eval("window.__e2e.click('Stop')");
  await until(guest, "document.body.textContent.includes('The shared game ended')", 30000);
} catch (error) {
  check("the run itself", false, String(error?.stack || error));
} finally {
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} passed; ${relay ? `local relay events ${relay.stats.events}` : "over the public relays"}`);
  if (passed < results.length) {
    console.log("--- engine console (tail) ---");
    console.log((engineTab?.logs ?? []).slice(-40).join(String.fromCharCode(10)));
    console.log("--- server logs (tail) ---");
    console.log(serverLogs.join("").split("\n").slice(-25).join("\n"));
  }
  // E2E_HOLD=<seconds>: a failed run leaves its browser and servers up that
  // long, to be looked at over the DevTools port, before it cleans up.
  if (passed < results.length && Number(process.env.E2E_HOLD) > 0) {
    console.log(`holding for ${Number(process.env.E2E_HOLD)} s: DevTools on port ${DEBUG_PORT}, host ${HOST}, guest ${GUEST}`);
    await sleep(Number(process.env.E2E_HOLD) * 1000);
  }
  chrome.kill();
  hostServer.kill();
  guestServer.kill();
  relay?.close();
  setTimeout(() => process.exit(passed === results.length ? 0 : 1), 500);
}
