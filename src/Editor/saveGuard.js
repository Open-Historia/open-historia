/*! Open Historia Map Editor — Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE). */

// The rules for not losing the open map. Pure so they can be tested without the
// editor: MapEditor passes in its own save and its own window.confirm.

// May the open document be swapped for another (New / Open / close)? Only a
// document that is saved, or that saves now, may go quietly. After a failed save —
// or one still in flight — the player decides; `confirm(reason)` gets "failed",
// "saving", or "edited" when the map is dirty again after the save — an edit
// landed while it was written. That last one is found by reading `getStatus`
// again, since React state would still show the status from before the save. It is asked, not saved again: the caller's
// save closure predates the edit and would write the map without it.
export async function mayReplaceDocument({ getStatus, save, confirm }) {
  const status = getStatus();
  if (status === "saved") return true;
  if (status === "saving") return confirm("saving");
  if (await save()) return true;
  return confirm(getStatus() === "dirty" ? "edited" : "failed");
}

// Failed saves in a row after which the automatic retry gives up and only Retry
// now is left — a store that is full or gone would otherwise be hammered forever.
export const MAX_SAVE_FAILURES = 6;

// How long to wait before the next automatic retry after `failures` failed saves
// in a row: 2 s, doubling, never more than 30 s; null once MAX_SAVE_FAILURES is reached.
export const retryDelayMs = (failures) =>
  failures >= MAX_SAVE_FAILURES ? null : Math.min(30000, 2000 * 2 ** Math.max(0, failures - 1));

// What a save that landed leaves behind, given the status at that moment. Still
// "saving" means nothing changed meanwhile. An edit made it "dirty", which stays
// and asks for another save: that edit's autosave timer may have run out while
// this save was in flight and only joined it, so nothing else would write it.
export const settleSave = (statusNow) =>
  statusNow === "saving" ? { status: "saved", resave: false } : { status: statusNow, resave: statusNow === "dirty" };

// How long one write may take before it counts as failed. A store that never
// answers would otherwise hold the gate below shut, and every later save with it.
export const SAVE_TIMEOUT_MS = 30000;

export function withTimeout(promise, ms = SAVE_TIMEOUT_MS) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The save did not finish within ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// One save at a time. A call while a save is in flight gets that save's promise
// rather than writing again: Retry now, Save now and the retry timer racing on a
// map that has no id yet would each create a document of their own. replace()
// (New / Open) starts a new generation — a save still in flight for the old map
// then sees isCurrent() false, must leave the new one alone, and no longer blocks
// the new map's own saves.
export function createSaveGate() {
  let generation = 0;
  let pending = null;
  return {
    replace() {
      generation += 1;
      pending = null;
    },
    run(write) {
      if (pending) return pending;
      const mine = generation;
      const p = write(() => mine === generation).finally(() => {
        if (pending === p) pending = null;
      });
      pending = p;
      return p;
    },
  };
}
