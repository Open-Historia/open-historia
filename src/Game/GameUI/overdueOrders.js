/*! Open Historia — what the Actions panel says of an order the last time skip did not answer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/GameUI/overdueOrders.test.js
//
// An order the last time skip gave no outcome stays queued, marked overdue, and
// the next skip is told to answer it first (AI/playerFocus.js settleOrders).
// Nothing on screen said so: the order sat in the list as if it had just been
// given, and when its event had been written and then refused by the engine's
// checks, the reason was only in the Events panel's folded cards (single
// player) or nowhere at all (a shared game; the gap audit of 2026-11-18).
// The panel now marks it, and says why its event was refused where the player
// gave the order: the newest time skip's cards that cite it
// (runtime/filedEvents.js), matched by the order's id, never by words.
//
// Import-free but for the cards' own reader, so it runs under bare node.

import { normalizeFiledEvents } from "../../runtime/filedEvents.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const JUMP_MODES = new Set(["jump", "auto"]);

// The newest turn a time skip wrote (a Game Master's intervention or a scene
// writes turns of its own, which answer no order).
const newestSkip = (world) => (Array.isArray(world?.simulationHistory) ? world.simulationHistory : [])
  .find((entry) => entry && typeof entry === "object" && JUMP_MODES.has(clean(entry.mode || "jump").toLowerCase())) ?? null;

// { [order id]: { fate, note } }: why the newest skip's event for each order
// cited was kept off the timeline. A shared game's view holds only the cards
// for the viewer's own orders (multiplayer/host/projection.js).
export const refusedOrdersOf = (world) => {
  const out = {};
  for (const card of normalizeFiledEvents(newestSkip(world)?.filedEvents)) {
    for (const id of Array.isArray(card.actionIds) ? card.actionIds : []) {
      const key = clean(id);
      if (key && !out[key]) out[key] = { fate: card.fate, note: card.note };
    }
  }
  return out;
};

// For a useRuntimeState selector: a string, so the panel renders again only
// when the reasons themselves change.
export const refusedOrdersKey = (world) => JSON.stringify(refusedOrdersOf(world));
