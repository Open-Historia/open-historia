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
// But an overdue order never lapses, and every queued order rides in the
// round's one request, overdue ones first: with only the round's own counted,
// a player whose orders the AI kept leaving unanswered put twelve more in
// every round's request on top of all of those, and a long queue makes the
// AI leave more unanswered (the review of 2026-11-18, wars 3). So the whole
// queue is held too: at most twice a round's orders wait at once
// (MAX_ORDERS_QUEUED), the overdue ones among them. Within that, a round's
// own twelve are never taken by the engine's shortfall; past it, the player
// is told why and withdraws one. Nothing lapses by itself: an order is the
// player's until it is answered or withdrawn, as in single player.
//
// Plain data, so the host's handlers and its forces (host/forces.js) count the
// same way.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (left, right) => Boolean(clean(left)) && clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase();
const planned = (action) => clean(action?.status || "planned") === "planned";

// The orders `owner` has queued, this round's and those carried over.
export const ordersQueued = (actions, owner) => (Array.isArray(actions) ? actions : []).filter((action) =>
  same(action?.ownerCode, owner) && planned(action));

// The orders `owner` has given since the last round landed: queued, and not
// carried over from an earlier round.
export const ordersThisRound = (actions, owner) => ordersQueued(actions, owner).filter((action) => action?.overdue !== true);

// How many of a player's orders may wait at once, for `maxOrders` a round.
export const queuedMostFor = (maxOrders) => 2 * maxOrders;

// Why `owner` may not give another order now, or "": the round's own are
// held to `maxOrders`, and the whole queue to twice that.
export const orderCapRefusal = (actions, owner, maxOrders) => {
  if (!Number.isFinite(maxOrders)) return "";
  if (ordersThisRound(actions, owner).length >= maxOrders) return `At most ${maxOrders} orders a round.`;
  const maxQueued = queuedMostFor(maxOrders);
  if (ordersQueued(actions, owner).length >= maxQueued) {
    return `At most ${maxQueued} of your orders wait at once, those carried over unanswered among them: withdraw one to give another.`;
  }
  return "";
};
