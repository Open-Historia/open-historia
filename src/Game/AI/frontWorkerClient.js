/*! Open Historia — a turn's land war sent away from the page, and what the page answers it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page's side of frontWorker.js: one worker for the whole sitting, made the
// first time a land war is fought, and every run sent to it. While a run is
// fought there the page answers what it asks for (frontWorkerCore.js
// pageAnswersOf). A worker that cannot be made, or that fails, is given up for
// the sitting; a run that cannot be sent (something in it is not data) is
// fought on the page instead: the caller does that (frontApply.js).

import { awayInputOf, pageAnswersOf } from "./frontWorkerCore.js";

let worker = null;
let broken = false;
let sent = 0;
const pending = new Map();

const giveUp = (reason) => {
  broken = true;
  for (const run of pending.values()) run.reject(Object.assign(new Error(reason), { offPage: true }));
  pending.clear();
  try {
    worker?.terminate();
  } catch { /* gone */ }
  worker = null;
};

const workerOf = () => {
  if (worker || broken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./frontWorker.js", import.meta.url), { type: "module", name: "openhistoria-land-war" });
  } catch (error) {
    broken = true;
    console.warn("[fronts] the land war's worker could not be made; wars are fought on the page.", error);
    return null;
  }
  worker.onmessage = async (event) => {
    const message = event?.data ?? {};
    const run = pending.get(message.kind === "ask" ? message.run : message.id);
    if (message.kind === "ask") {
      if (!run) return;
      try {
        const value = await run.answer(message.name, message.value);
        worker?.postMessage({ kind: "answer", id: message.id, value });
      } catch (error) {
        worker?.postMessage({ kind: "answer", id: message.id, error: String(error?.message ?? error) });
      }
      return;
    }
    if (!run) return;
    pending.delete(message.id);
    run.off();
    if (message.kind === "done") run.resolve(message.result);
    else if (message.aborted) run.reject(new DOMException("The land war's run was called off.", "AbortError"));
    else run.reject(Object.assign(new Error(String(message.error ?? "the land war's worker failed")), { offPage: true }));
  };
  worker.onerror = (event) => {
    event?.preventDefault?.();
    giveUp(String(event?.message || "the land war's worker failed"));
  };
  return worker;
};

// Whether a run may be fought away from the page in this sitting.
export const offPageAvailable = () => !broken && typeof Worker !== "undefined";

// Fights a turn's land war in the worker: what frontTurn.js runTurnFronts gives, for the same arguments. Rejects with
// an AbortError once `signal` is aborted, and with an error marked `offPage` where it could not be fought there (the
// caller then fights it on the page).
export const fightOffPage = (args, { signal = null } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException("The land war's run was called off.", "AbortError"));
    return;
  }
  const target = workerOf();
  if (!target) {
    reject(Object.assign(new Error("no worker for the land war"), { offPage: true }));
    return;
  }
  sent += 1;
  const id = sent;
  const onAbort = () => {
    if (!pending.has(id)) return;
    pending.delete(id);
    target.postMessage({ kind: "abort", id });
    reject(new DOMException("The land war's run was called off.", "AbortError"));
  };
  const off = () => signal?.removeEventListener?.("abort", onAbort);
  pending.set(id, { resolve, reject, answer: pageAnswersOf(args), off });
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    target.postMessage({ kind: "run", id, data: awayInputOf(args) });
  } catch (error) {
    // (Something in it could not be sent: it is fought on the page.)
    pending.delete(id);
    off();
    reject(Object.assign(error instanceof Error ? error : new Error(String(error)), { offPage: true }));
  }
});
