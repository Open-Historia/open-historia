/*! Open Historia — the orders a player has given this round, in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A shared game holds each player to a number of orders a round
// (gameHost.js MAX_ORDERS_PER_ROUND), so that no one player fills the round's
// one request. It counted every order still queued, and an order the last time
// skip left without an outcome stays queued, marked overdue, to be answered
// first by the next (AI/playerFocus.js settleOrders). So a player whose orders
// the engine had not answered had that many fewer to give, for a shortfall
// that was the engine's, and nothing on screen said why (the gap audit of
// 2026-11-18). An overdue order is still the skip's to answer, and still on
// the player's screen to withdraw; it is not one of this round's.
//
// Plain data, so the host's handlers and its forces (host/forces.js) count the
// same way.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();

// The orders `owner` has given since the last round landed: queued, and not
// carried over from an earlier round.
export const ordersThisRound = (actions, owner) => (Array.isArray(actions) ? actions : []).filter((action) =>
  same(action?.ownerCode, owner)
  && clean(action?.status || "planned") === "planned"
  && action?.overdue !== true);
