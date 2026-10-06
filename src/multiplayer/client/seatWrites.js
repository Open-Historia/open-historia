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
//   not sent, and said    orders to units and to agents. They are not requests
//                         yet, and the player is told so rather than left
//                         watching a unit they placed disappear.
//
// Everything else in the document stays as the host's view has it.
//
// Import-free: plain data in, a plan out, tested under bare node.

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const differs = (left, right) => JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

export const DEVICE_WORLD_KEYS = Object.freeze(["actionSuggestions"]);

// What stands for a list when asking whether the player changed it. The page
// saves through the game's own normalizer, which may reorder a field or fill a
// default the host's copy left out, so only what a player's order would change
// is compared.
const unitsSignature = (units) => list(units)
  .map((unit) => [unit?.id, unit?.ownerCode, unit?.status, Number(unit?.lng).toFixed(3), Number(unit?.lat).toFixed(3), unit?.orderId ?? ""].join("|"))
  .sort()
  .join(";");
const idsSignature = (rows) => list(rows).map((row) => `${row?.id ?? ""}|${row?.status ?? ""}`).sort().join(";");

const UNSENT = Object.freeze([
  { key: "units", signature: unitsSignature, what: "units" },
  { key: "pendingUnitOrders", signature: idsSignature, what: "units" },
  { key: "spies", signature: idsSignature, what: "agents" },
]);

export const UNSENT_NOTICES = Object.freeze({
  units: "Orders to units cannot be given in a shared game yet, so that one was not sent. Write it as an order in the Actions panel instead.",
  agents: "Orders to agents cannot be given in a shared game yet, so that one was not sent.",
});

// What a world the page wants to save would change, against the one it holds:
//   device   fields kept on this device (field → value)
//   board    the player's Projects board to ask the host to keep, or null
//   unsent   what the player tried that cannot be asked of the host yet
export const planWorldWrite = (held, wanted) => {
  const plan = { device: {}, board: null, unsent: [] };
  if (!isRecord(wanted)) return plan;
  const before = isRecord(held) ? held : {};
  for (const key of DEVICE_WORLD_KEYS) {
    if (key in wanted && differs(before[key], wanted[key])) plan.device[key] = wanted[key];
  }
  if (Array.isArray(wanted.projects) && differs(list(before.projects), wanted.projects)) plan.board = wanted.projects;
  for (const { key, signature, what } of UNSENT) {
    if (key in wanted && signature(before[key]) !== signature(wanted[key]) && !plan.unsent.includes(what)) plan.unsent.push(what);
  }
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
