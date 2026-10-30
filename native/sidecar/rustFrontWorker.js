import { workerData } from "node:worker_threads";
import { fightAway } from "../../src/Game/AI/frontWorkerCore.js";
import { createRehearsers, rehearserCount } from "../../src/runtime/fronts/mind/rehearsers.js";
import { createFrontsHost, firstDifference } from "./rustFronts.mjs";
import { fightInRust } from "./rustFrontsFight.js";

const SLICE_MS = 150;
const fronts = workerData?.fronts ?? {};
const mode = ["shadow", "js"].includes(fronts.mode) ? fronts.mode : "on";
const timed = process.env.OH_FRONTS_TIMING === "1" || mode === "shadow";

const runs = new Map();
const asks = new Map();
let asked = 0;
let host = null;
let hostGone = null;
let warned = false;

let rehearsers = null;
const rehearsersOf = () => {
  if (rehearsers === null) {
    const size = rehearserCount(self.navigator?.hardwareConcurrency);
    rehearsers = size > 0 && typeof Worker !== "undefined"
      ? createRehearsers({ size, spawn: () => new Worker(new URL("./rehearserWorker.js", import.meta.url), { type: "module", name: "openhistoria-rehearser" }) })
      : false;
  }
  return rehearsers || null;
};

const hostOf = () => {
  if (hostGone) return null;
  if (host && !host.dead) return host;
  try {
    host = createFrontsHost({ file: fronts.host, log: (text) => console.warn(`[fronts] ${text}`) });
  } catch (error) {
    hostGone = error instanceof Error ? error : new Error(String(error));
    return null;
  }
  return host;
};

const warnOnce = (error) => {
  if (warned) return;
  warned = true;
  console.warn("[fronts] the Rust front engine could not fight a turn; it is fought in JavaScript.", String(error?.message ?? error));
};

const ask = (run, name, value) => new Promise((resolve, reject) => {
  asked += 1;
  asks.set(asked, { resolve, reject });
  self.postMessage({ kind: "ask", run, id: asked, name, value });
});

const isAbort = (error) => error?.name === "AbortError";

const inJs = (message, run) => fightAway(message.data, { ask: (name, value) => ask(message.id, name, value), pause: run.pause, rehearsers: rehearsersOf() });

const inRust = (message, run) => {
  const engine = hostOf();
  if (!engine) return Promise.reject(hostGone || new Error("no Rust front engine"));
  return fightInRust(engine, message.data, {
    ask: (name, value) => ask(message.id, name, value),
    pause: run.pause,
    onRuns: (maker) => {
      run.makers.add(maker);
      if (run.aborted) maker.cancel();
    },
  });
};

const clock = async (fight) => {
  const began = performance.now();
  const result = await fight();
  return { result, ms: performance.now() - began };
};

const fight = async (message, run) => {
  if (mode === "shadow") {
    const js = await clock(() => inJs(message, run));
    try {
      const rust = await clock(() => inRust(message, run));
      const differs = firstDifference(rust.result, js.result);
      console.warn(differs
        ? `[fronts] shadow: the Rust front engine differs at ${differs} (JavaScript ${js.ms.toFixed(0)} ms, Rust ${rust.ms.toFixed(0)} ms)`
        : `[fronts] shadow: the Rust front engine agrees (JavaScript ${js.ms.toFixed(0)} ms, Rust ${rust.ms.toFixed(0)} ms)`);
    } catch (error) {
      if (run.aborted || isAbort(error)) throw error;
      console.warn("[fronts] shadow: the Rust front engine failed.", String(error?.message ?? error));
    }
    return js.result;
  }
  if (mode === "on") {
    try {
      const rust = await clock(() => inRust(message, run));
      if (timed) console.warn(`[fronts] fought in Rust in ${rust.ms.toFixed(0)} ms`);
      return rust.result;
    } catch (error) {
      if (run.aborted || isAbort(error)) throw error;
      warnOnce(error);
    }
  }
  const js = await clock(() => inJs(message, run));
  if (timed) console.warn(`[fronts] fought in JavaScript in ${js.ms.toFixed(0)} ms`);
  return js.result;
};

self.onmessage = async (event) => {
  const message = event?.data ?? {};
  if (message.kind === "answer") {
    const waiting = asks.get(message.id);
    if (!waiting) return;
    asks.delete(message.id);
    if (message.error) waiting.reject(new Error(String(message.error)));
    else waiting.resolve(message.value);
    return;
  }
  if (message.kind === "abort") {
    const run = runs.get(message.id);
    if (run) {
      run.aborted = true;
      for (const maker of run.makers) maker.cancel();
    }
    return;
  }
  if (message.kind !== "run") return;
  const run = { aborted: false, since: performance.now(), makers: new Set() };
  run.pause = async () => {
    if (!run.aborted && performance.now() - run.since < SLICE_MS) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.since = performance.now();
    if (run.aborted) throw new DOMException("The land war's run was called off.", "AbortError");
  };
  runs.set(message.id, run);
  try {
    const result = await fight(message, run);
    self.postMessage({ kind: "done", id: message.id, result });
  } catch (error) {
    self.postMessage({ kind: "failed", id: message.id, error: String(error?.message ?? error), aborted: isAbort(error) });
  } finally {
    runs.delete(message.id);
  }
};
