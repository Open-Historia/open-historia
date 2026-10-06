/*! Open Historia — what a player's own screen changes in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's screens save by writing a whole document (runtime/assets.js
// writeJson). In a shared game the documents are the host's view, so a write is
// never sent as it is (client/remoteRuntime.js). It is read here for the few
// things a player's own screen does change, and each travels its own way:
//
//   kept on this device   the AI's suggested orders. They are asked with the
//                         player's own key, are nobody else's business, and are
//                         for one round: the next round clears them.
//   asked of the host     the player's own Projects board (request "board"):
//                         what their advisor put on it, or the board's own
//                         buttons changed. The host keeps one for each country.
//
// Everything else in the document stays as the host's view has it. What a
// player does with forces, agents and their own approximately placed
// structures never comes this way: those screens ask the host themselves
// (requests "deploy", "disband", "order", "agent" and "settle").
//
// Import-free: plain data in, a plan out, tested under bare node.

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const differs = (left, right) => JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

export const DEVICE_WORLD_KEYS = Object.freeze(["actionSuggestions"]);

// What a world the page wants to save would change, against the one it holds:
//   device   fields kept on this device (field → value)
//   board    the player's Projects board to ask the host to keep, or null
export const planWorldWrite = (held, wanted) => {
  const plan = { device: {}, board: null };
  if (!isRecord(wanted)) return plan;
  const before = isRecord(held) ? held : {};
  for (const key of DEVICE_WORLD_KEYS) {
    if (key in wanted && differs(before[key], wanted[key])) plan.device[key] = wanted[key];
  }
  if (Array.isArray(wanted.projects) && differs(list(before.projects), wanted.projects)) plan.board = wanted.projects;
  return plan;
};

// The AI's suggestions are for the round they were asked in.
export const suggestionsOutlived = (heldRound, viewRound) => {
  const before = Number(heldRound);
  const now = Number(viewRound);
  return Number.isFinite(before) && Number.isFinite(now) && before !== now;
};

// The newest turn of a world, when it is one the Events panel reveals event by
// event (a time skip): its events in the order they are shown. Null otherwise.
export const revealedTurnOf = (world) => {
  const turn = list(world?.simulationHistory)[0];
  const ids = list(turn?.eventIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  if (!ids.length) return null;
  const mode = String(turn?.mode ?? "jump").trim() || "jump";
  return mode === "jump" || mode === "auto" ? { key: ids[0], eventIds: ids, round: Number(turn?.round) || 0 } : null;
};
