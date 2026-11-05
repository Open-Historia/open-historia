/*! Open Historia — the worker a turn's land war is fought in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A Web Worker of its own (frontWorkerClient.js makes it): each "run" message is
// a turn's land war to fight (frontWorkerCore.js fightAway); what it needs of
// the page it asks for ("ask"), and the page answers ("answer"); an "abort"
// stops a run at its next pause. Runs may overlap (a rehearsal in the War Room
// while the next turn is being thought through): each has its own.

import { fightAway } from "./frontWorkerCore.js";
import { createRehearsers, rehearserCount } from "../../runtime/fronts/mind/rehearsers.js";

// How long a run works on between the moments it stops to hear an abort. Nothing is drawn here: long slices.
const SLICE_MS = 150;

const runs = new Map();
const asks = new Map();
let asked = 0;

// The cores the staff's plans are fought on, together (runtime/fronts/mind/rehearsers.js: "do the multi-core
// rehearsals too", the owner, 2026-10-16): workers of this one's own, made when a staff first looks, shared by
// every run fought here and let go when nothing has been weighed for a while. None on a machine of few cores.
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

const ask = (run, name, value) => new Promise((resolve, reject) => {
  asked += 1;
  asks.set(asked, { resolve, reject });
  self.postMessage({ kind: "ask", run, id: asked, name, value });
});

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
    if (run) run.aborted = true;
    return;
  }
  if (message.kind !== "run") return;
  const run = { aborted: false, since: performance.now() };
  runs.set(message.id, run);
  const pause = async () => {
    if (!run.aborted && performance.now() - run.since < SLICE_MS) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    run.since = performance.now();
    if (run.aborted) throw new DOMException("The land war's run was called off.", "AbortError");
  };
  try {
    const result = await fightAway(message.data, { ask: (name, value) => ask(message.id, name, value), pause, rehearsers: rehearsersOf() });
    self.postMessage({ kind: "done", id: message.id, result });
  } catch (error) {
    self.postMessage({ kind: "failed", id: message.id, error: String(error?.message ?? error), aborted: error?.name === "AbortError" });
  } finally {
    runs.delete(message.id);
  }
};
