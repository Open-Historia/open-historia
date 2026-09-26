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
//
// Host: app server A (engine handle stubbed as in electron/main.cjs), with a
//   tab on engine.html (the hidden engine window) and a tab on the game (the
//   host's screen). Guest: app server B, its own origin, library and storage.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRelay } from "./relay.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
const DEBUG_PORT = 9461;
const HOST_PORT = 3811;
const GUEST_PORT = 3812;
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
const relay = await startRelay();
const RELAY = `ws://127.0.0.1:${relay.port}/relay`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oh-mp-e2e-"));
const serverLogs = [];
const startApp = (name, port, role) => {
  const child = spawn(process.execPath, [path.join(HERE, "app-server.mjs"), path.join(scratch, name), String(port), role], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
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
const openTab = async (url) => {
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const tab = await cdp(target.webSocketDebuggerUrl);
  await tab.send("Runtime.enable");
  tab.logs = [];
  tab.on("Runtime.consoleAPICalled", (params) => tab.logs.push(`${params.type}: ${params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`.slice(0, 400)));
  tab.on("Runtime.exceptionThrown", (params) => tab.logs.push(`exception: ${JSON.stringify(params.exceptionDetails).slice(0, 400)}`));
  return tab;
};
const until = async (tab, expression, ms = 30000) => {
  const deadline = Date.now() + ms;
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

let answeredJumps = 0;
let engineTab = null;
const sentTools = [];
try {
  // The engine window: this device's settings first (a local relay, and a
  // Gemini key the stand-in answers for), then the stand-in model.
  const engine = await openTab(`${HOST}/engine.html`);
  engineTab = engine;
  await until(engine, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await engine.eval(`localStorage.setItem("oh:mp:relays", ${JSON.stringify(JSON.stringify([RELAY]))});
    localStorage.setItem("api_provider", "gemini"); localStorage.setItem("gemini_api_key", "e2e-dummy-key"); localStorage.setItem("ai_limit_generation", "1"); true`);
  const TARGET = jumpTargetDate(ORIGIN, 30);
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  let GUEST_COUNTRY = "";
  let lastJumpBody = "";
  // Each order's id, as the prompt lists it under its owner: "[id] (Country) text".
  const orderIdIn = (body, country) => {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\[([^\\]\\s]+)\\] \\(${escaped}\\) `).exec(body)?.[1] ?? "";
  };
  const jumpAnswer = (body) => {
    const guestOrder = orderIdIn(body, GUEST_COUNTRY);
    const hostOrder = orderIdIn(body, HOST_COUNTRY);
    return {
      stopDate: TARGET,
      summary: "Tension in the east; markets wobble.",
      events: [
        { date: addDays(ORIGIN, 3), title: "E2E: Oil prices slide further as the supply glut persists", description: "Brent falls again as producers keep pumping.", importance: "moderate", kind: "world", playerRelated: false },
        { date: addDays(ORIGIN, 7), title: `E2E: ${GUEST_COUNTRY} declares war on Ukraine`, description: `The government of ${GUEST_COUNTRY} declares war on Ukraine.`, importance: "critical", kind: "world", playerRelated: true },
        { date: addDays(ORIGIN, 9), title: `E2E: ${GUEST_COUNTRY} holds snap drills near the Estonian border`, description: `Units of ${GUEST_COUNTRY} run the snap drills near the Estonian border that Moscow ordered.`, importance: "major", kind: "world", playerRelated: true, impacts: { actionIds: guestOrder ? [guestOrder] : [] } },
        { date: addDays(ORIGIN, 11), title: "E2E: Storms batter the North Sea coast", description: "A winter storm floods ports along the North Sea.", importance: "minor", kind: "world", playerRelated: false },
        { date: addDays(ORIGIN, 14), title: `E2E: A trade mission from ${HOST_COUNTRY} arrives in Hanoi`, description: `The trade mission ${HOST_COUNTRY} sent to Vietnam opens talks on expanding exports.`, importance: "moderate", kind: "world", playerRelated: true, impacts: { actionIds: hostOrder ? [hostOrder] : [] } },
        { date: addDays(ORIGIN, 24), title: "E2E: Brazil's central bank raises rates", description: "The central bank of Brazil raises its benchmark rate to fight inflation.", importance: "minor", kind: "world", playerRelated: false },
      ],
    };
  };
  await engine.send("Fetch.enable", { patterns: [{ urlPattern: "*generativelanguage.googleapis.com*", requestStage: "Request" }] });
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
  engine.on("Fetch.requestPaused", async ({ requestId, request }) => {
    if (request.method === "OPTIONS") {
      await engine.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: cors, body: "" });
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
    if (tool === "submit_jump_result") {
      answeredJumps += 1;
      lastJumpBody = text;
      const frames = [{ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: tool, args: jumpAnswer(text) } }] }, finishReason: "STOP" }] }];
      const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
      await engine.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [...cors, { name: "content-type", value: "text/event-stream" }], body: Buffer.from(sse).toString("base64") });
    } else {
      await engine.send("Fetch.fulfillRequest", { requestId, responseCode: 400, responseHeaders: [...cors, { name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify({ error: { code: 400, message: "stand-in" } })).toString("base64") });
    }
  });

  // The host's screen.
  const host = await openTab(`${HOST}/`);
  await until(host, `location.origin === ${JSON.stringify(HOST)} && document.readyState === 'complete'`, 30000);
  await withHelpers(host);
  check("the host's game loads with the Multiplayer tab", await until(host, "(window.__e2e || false) && window.__e2e.buttons('Multiplayer').length > 0", 60000));
  await host.eval("window.__e2e.click('Multiplayer')");
  await until(host, "window.__e2e.buttons('Open to players').length > 0", 15000);
  await host.eval("window.__e2e.click('Open to players')");
  const hosting = await until(host, "Boolean(document.querySelector('code') && document.querySelector('code').textContent.startsWith('oh1-'))", 45000);
  const token = hosting ? await host.eval("document.querySelector('code').textContent") : "";
  check("hosting shows an invite token", hosting, token ? `${token.slice(0, 24)}…` : host.logs.slice(-6).join(" | "));

  // The guest.
  const guest = await openTab(`${GUEST}/`);
  await until(guest, `location.origin === ${JSON.stringify(GUEST)} && document.readyState === 'complete'`, 30000);
  await guest.eval(`localStorage.setItem("oh:mp:relays", ${JSON.stringify(JSON.stringify([RELAY]))}); true`);
  await withHelpers(guest);
  await until(guest, "window.__e2e.buttons('Multiplayer').length > 0", 60000);
  await guest.eval("window.__e2e.click('Multiplayer')");
  await until(guest, "Boolean(document.querySelector('input[placeholder=\"oh1-…\"]'))", 15000);
  await guest.eval(`(() => { const e = window.__e2e; e.type(document.querySelector('input[placeholder="oh1-…"]'), ${JSON.stringify(token)}); const name = [...document.querySelectorAll('input[placeholder="Player"]')][0]; if (name) e.type(name, "Guest"); return true; })()`);
  await sleep(300);
  await guest.eval(`(() => {
    window.__seen = { loading: [], apiPrompt: false };
    const look = () => {
      const screen = document.querySelector('.oh-loading-screen');
      if (screen && window.__seen.loading.at(-1) !== screen.textContent) window.__seen.loading.push(screen.textContent);
      if (document.querySelector('[aria-label="Set up your AI provider"]')) window.__seen.apiPrompt = true;
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
    return true;
  })()`);
  await guest.eval("window.__e2e.click('Join')");
  const lobby = await until(guest, "[...document.querySelectorAll('select')].some((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country'))", 90000);
  check("the guest finds the host through the relay and reaches the lobby", lobby, lobby ? "" : guest.logs.slice(-8).join(" | "));
  await withHelpers(guest);
  GUEST_COUNTRY = await guest.eval(`(() => { const select = [...document.querySelectorAll('select')].find((s) => s.options[0] && s.options[0].textContent.startsWith('Choose your country')); const names = [...select.options].map((o) => o.value).filter(Boolean); return names.find((n) => /^Russia/.test(n)) || names.find((n) => n !== ${JSON.stringify(HOST_COUNTRY)}); })()`);
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

  // Each queues an order through the game's own Actions panel.
  const queueOrder = async (tab, text) => {
    await tab.eval("(() => { const launcher = document.querySelector('[title=\"Actions\"]'); if (launcher) launcher.click(); return Boolean(launcher); })()");
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
  const shots = path.join(HERE, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const shoot = async (tab, name) => {
    const reply = await tab.send("Page.captureScreenshot", { format: "png" });
    if (reply.result?.data) fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(reply.result.data, "base64"));
  };
  await shoot(guest, "1-guest-planning");
  await shoot(host, "1-host-planning");

  await host.eval("window.__e2e.click('Ready')");
  await guest.eval("window.__e2e.click('Ready')");
  const resolved = await until(guest, "window.__e2e.view('events').then((events) => events.some((e) => String(e.title).startsWith('E2E: Oil prices')))", 240000);
  check("everyone ready: the host runs the round and its events reach the guest", resolved, `jump answers: ${answeredJumps}; tools asked: ${[...new Set(sentTools)].join(", ")}`);
  check("the model is told who plays what, and whose each order is",
    lastJumpBody.includes("[Shared Game") && lastJumpBody.includes(`(action, ${GUEST_COUNTRY})`) && lastJumpBody.includes(`(action, ${HOST_COUNTRY})`),
    lastJumpBody.split("\n").filter((line) => line.includes("(action,") || line.startsWith("People play")).slice(0, 4).join(" | "));
  const guestEvents = resolved ? await guest.eval("window.__e2e.view('events')") : [];
  const hostEvents = resolved ? await host.eval("window.__e2e.view('events')") : [];
  const war = (events) => events.some((event) => String(event.title).includes("declares war on Ukraine"));
  check("the world never chose for the guest: its unordered declaration of war was withheld", resolved && !war(guestEvents) && !war(hostEvents),
    `guest ${guestEvents.filter((e) => String(e.title).startsWith("E2E")).map((e) => e.title).join(" / ")}`);
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
  check("the guest's view holds none of the narrator's own", !guestWorld.lastJumpSummary && !(guestWorld.storylines ?? []).length && !(guestWorld.simulationHistory ?? []).length,
    JSON.stringify({ summary: Boolean(guestWorld.lastJumpSummary), storylines: (guestWorld.storylines ?? []).length, history: (guestWorld.simulationHistory ?? []).length }));
  const phase = await guest.eval("document.body.textContent.includes('What happened') || document.body.textContent.includes('Round 2')");
  check("the round moves on to its reveal", phase);

  await host.eval("window.__e2e.click('Stop')");
  const ended = await until(guest, "document.body.textContent.includes('The shared game ended')", 30000);
  check("when the host stops, the guest is told", ended);
} catch (error) {
  check("the run itself", false, String(error?.stack || error));
} finally {
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} passed; relay events ${relay.stats.events}`);
  if (passed < results.length) {
    console.log("--- engine console (tail) ---");
    console.log((engineTab?.logs ?? []).slice(-40).join(String.fromCharCode(10)));
    console.log("--- server logs (tail) ---");
    console.log(serverLogs.join("").split("\n").slice(-25).join("\n"));
  }
  chrome.kill();
  hostServer.kill();
  guestServer.kill();
  relay.close();
  setTimeout(() => process.exit(passed === results.length ? 0 : 1), 500);
}
