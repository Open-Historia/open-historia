/*! Open Historia — battlefields and fronts: a staff's plans fought on other cores © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "do the multi-core rehearsals too" (the owner, 2026-10-16). The staff that
// looks ahead (planner.js) fights each of its plans out on a copy of the battle
// before it orders anything: a look is a score of rehearsals, one after
// another, and they are most of what a war's turn takes. Here they are fought
// on other cores, together. A run is handed a pool of them (its input's
// `rehearsers`); at each look its staff sends the battle and the run as they
// stand (engine.js rehearsalPacket) with the plans it weighs, and each core
// takes the next plan not yet taken as soon as it is free, rebuilds the battle
// once a look (engine.js rehearsalBase) and fights the plan on a copy of it
// exactly as the staff would (planner.js weighRebuilt). The same plan comes out
// the same wherever it is fought, so the war is the same war; what a core could
// not fight, the staff fights itself.
//
//   createRehearsers({ size, spawn, idleMs })
//     size     how many cores (rehearserCount)
//     spawn    (index) => a worker: { postMessage(message), terminate() }, its
//              messages to its onmessage and its failures to its onerror
//              (Game/AI/rehearserWorker.js, a Web Worker; the tests make one
//              of their own)
//     idleMs   how long the cores are kept with nothing to do: their memory is
//              given back after, and they are made again when next needed
//   pool.weigh(look, jobs)   a Promise of each job's value, in order: a number, or null where it was not had
//   pool.close()
//
// And a core's own side: answerRehearsal(state, message) => its reply, or null.

import { rehearsalBase } from "../engine.js";
import { weighRebuilt } from "./planner.js";

// How many cores fight a staff's plans, of the machine's: two are left to the page and the run, and none are used
// on a machine of fewer than four (they would only take turns with the page).
export const REHEARSERS_MOST = 6;
export const rehearserCount = (threads) => {
  const count = Math.floor(Number(threads) || 0);
  return count >= 4 ? Math.min(REHEARSERS_MOST, count - 2) : 0;
};
// Cores that fail this many times are not made again: the run's own core fights everything, as before.
const LOSSES_MOST = 3;

// A core's answer to what it is sent: a "look" (the battle as it stands, and how its plans are weighed) is kept,
// rebuilt on its first "job" (a plan: { bodies, air }), and each job answered with its value (null: not had).
export const answerRehearsal = (state, message) => {
  if (message?.kind === "look") {
    state.look = { id: message.id, look: message.look, base: null };
    return null;
  }
  if (message?.kind !== "job") return null;
  let value = null;
  const kept = state.look;
  if (kept && kept.id === message.id) {
    if (kept.base === null) {
      try {
        kept.base = rehearsalBase(kept.look.packet);
      } catch {
        kept.base = false;
      }
    }
    try {
      if (kept.base) value = weighRebuilt(kept.base, kept.look, message.job);
    } catch {
      value = null;
    }
  }
  return { kind: "value", id: message.id, at: message.at, value: typeof value === "number" ? value : null };
};

export const createRehearsers = ({ size = 2, spawn = null, idleMs = 30000 } = {}) => {
  const most = Math.max(0, Math.floor(Number(size) || 0));
  let cores = [];
  const waiting = [];
  let current = null;
  let looks = 0;
  let losses = 0;
  let resting = null;
  let closed = typeof spawn !== "function" || most < 1;

  const letGo = () => {
    for (const core of cores) {
      try {
        core.worker.terminate();
      } catch {
        // (gone already)
      }
    }
    cores = [];
  };
  // With nothing to do for a while, the cores are let go.
  const rest = () => {
    if (resting) clearTimeout(resting);
    resting = null;
    if (!(idleMs > 0) || cores.length === 0) return;
    resting = setTimeout(() => {
      resting = null;
      if (!current && waiting.length === 0) letGo();
    }, idleMs);
    resting?.unref?.();
  };
  const settle = (batch, at, value) => {
    if (batch.values[at] !== undefined) return;
    batch.values[at] = typeof value === "number" ? value : null;
    batch.left -= 1;
  };
  // The cores, made as they are first needed (and again after they were let go). false where none can be had.
  const ready = () => {
    if (closed) return false;
    if (cores.some((core) => !core.gone)) return true;
    letGo();
    try {
      for (let index = 0; index < most; index += 1) {
        const core = { worker: spawn(index), look: 0, at: -1, gone: false };
        core.worker.onmessage = (event) => heard(core, event?.data);
        core.worker.onerror = () => lost(core);
        core.worker.onmessageerror = () => lost(core);
        cores.push(core);
      }
    } catch {
      // (Workers within this one may not be had here at all.)
      closed = true;
      letGo();
      return false;
    }
    return true;
  };
  // A free core is given the next plan of the look being weighed; one that cannot be sent is not had.
  const give = (core) => {
    const batch = current;
    if (!batch || core.gone || core.at >= 0 || batch.next >= batch.jobs.length) return;
    const at = batch.next;
    batch.next += 1;
    try {
      if (core.look !== batch.id) {
        core.worker.postMessage({ kind: "look", id: batch.id, look: batch.look });
        core.look = batch.id;
      }
      core.worker.postMessage({ kind: "job", id: batch.id, at, job: batch.jobs[at] });
      core.at = at;
    } catch {
      // (A look that is not data throughout cannot be sent at all: none of its plans are had.)
      settle(batch, at, null);
      while (batch.next < batch.jobs.length) {
        settle(batch, batch.next, null);
        batch.next += 1;
      }
    }
  };
  const heard = (core, message) => {
    if (message?.kind !== "value") return;
    const batch = current;
    if (!batch || message.id !== batch.id || core.at !== message.at) return;
    core.at = -1;
    settle(batch, message.at, message.value);
    advance();
  };
  const lost = (core) => {
    if (core.gone) return;
    core.gone = true;
    losses += 1;
    if (losses >= LOSSES_MOST) closed = true;
    if (current && core.at >= 0) settle(current, core.at, null);
    core.at = -1;
    try {
      core.worker.terminate();
    } catch {
      // (gone already)
    }
    advance();
  };
  // The look being weighed: free cores given its next plans; once every plan is answered it is over and the next
  // begins. With nothing waiting, the cores rest.
  const advance = () => {
    for (;;) {
      if (!current) {
        if (waiting.length === 0) {
          rest();
          return;
        }
        current = waiting.shift();
        if (resting) clearTimeout(resting);
        resting = null;
        if (!ready()) {
          while (current.next < current.jobs.length) {
            settle(current, current.next, null);
            current.next += 1;
          }
        }
      }
      const batch = current;
      for (const core of cores) give(core);
      // (Plans no core is left to take are not had.)
      if (!cores.some((core) => !core.gone)) {
        while (batch.next < batch.jobs.length) {
          settle(batch, batch.next, null);
          batch.next += 1;
        }
      }
      if (batch.left > 0) return;
      current = null;
      batch.resolve(batch.values);
    }
  };
  return {
    size: most,
    weigh: (look, jobs) => new Promise((resolve) => {
      const list = Array.isArray(jobs) ? jobs : [];
      looks += 1;
      waiting.push({ id: looks, look, jobs: list, values: new Array(list.length).fill(undefined), next: 0, left: list.length, resolve });
      advance();
    }),
    close: () => {
      closed = true;
      if (resting) clearTimeout(resting);
      resting = null;
      for (const batch of current ? [current, ...waiting] : waiting) {
        while (batch.next < batch.jobs.length) {
          settle(batch, batch.next, null);
          batch.next += 1;
        }
        for (let at = 0; at < batch.jobs.length; at += 1) settle(batch, at, null);
        batch.resolve(batch.values);
      }
      current = null;
      waiting.length = 0;
      letGo();
    },
  };
};
