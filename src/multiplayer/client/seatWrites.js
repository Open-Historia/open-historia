/*! Open Historia — what a player's own screen changes in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's screens save by writing a whole document (runtime/assets.js
// writeJson). In a shared game the documents are the host's view, so a write is
// never sent as it is (client/remoteRuntime.js). It is read here for the few
// things a player's own screen does change, and each travels its own way:
//
//   kept on this device   the AI's suggested orders. They are asked with the
//                         player's own key, are nobody else's business, and are
//                         for one round: the next round clears them.
// Everything else in the document stays as the host's view has it. What a
// player does to the world never comes this way: each screen asks the host
// itself, by the request for what it does ("deploy", "disband", "order",
// "agent", "settle", the Projects board's "projectOps", and the rest). The
// board came this way, whole, until 2026-11-18: the host kept the page's
// entries as they came, their progress and what their plans do included.
//
// Import-free: plain data in, a plan out, tested under bare node.

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const differs = (left, right) => JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

export const DEVICE_WORLD_KEYS = Object.freeze(["actionSuggestions"]);

// What a world the page wants to save would change, against the one it holds:
//   device   fields kept on this device (field → value)
export const planWorldWrite = (held, wanted) => {
  const plan = { device: {} };
  if (!isRecord(wanted)) return plan;
  const before = isRecord(held) ? held : {};
  for (const key of DEVICE_WORLD_KEYS) {
    if (key in wanted && differs(before[key], wanted[key])) plan.device[key] = wanted[key];
  }
  return plan;
};

// WHAT NO DOOR TAKES (the map's rule 6: one door for every change a screen
// makes). A page saves whole documents, and the host never sees a save: what
// of it is the player's own is picked out above, and every other change has a
// request of its own. A change a save holds beyond those is one some screen made
// that the host never heard: it was answered "saved" and dropped, which is how
// each such bug was found, by a player. Listed here, by document and field, so
// it is said (client/sharedGame.js) instead of passing for saved.
//
// Two fields are equal when they hold the same JSON, a missing one counting as
// empty (null, [], {} or ""): a page fills in the empty defaults of fields its
// view leaves out, and those are no change. In `chat`, a bubble the screen shows
// of its own (role "error": a refusal, a failed reply) is the screen's.
const empty = (value) => value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0)
  || (isRecord(value) && Object.keys(value).length === 0);
const same = (left, right) => (empty(left) && empty(right)) || !differs(left, right);
const ROUTED_WORLD_KEYS = new Set(DEVICE_WORLD_KEYS);
const withoutOwnBubbles = (thread) => (isRecord(thread)
  ? { ...thread, messages: list(thread.messages).filter((message) => message?.role !== "error") }
  : thread);
export const unroutedChanges = (key, held, wanted) => {
  if (key === "world") {
    const before = isRecord(held) ? held : {};
    const after = isRecord(wanted) ? wanted : {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => !ROUTED_WORLD_KEYS.has(field) && !same(before[field], after[field]))
      .sort();
  }
  if (key === "chat") {
    const byId = new Map(list(held).map((thread) => [String(thread?.id ?? ""), withoutOwnBubbles(thread)]));
    return list(wanted)
      .map(withoutOwnBubbles)
      .filter((thread) => {
        const was = byId.get(String(thread?.id ?? ""));
        return !was || differs(was, thread);
      })
      .map((thread) => `thread ${String(thread?.id ?? "?")}`);
  }
  return same(held, wanted) ? [] : [key];
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
