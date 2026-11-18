/*! Open Historia — what a player has only ordered, kept from the others until the skip © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's decision 6 (2026-11-18, "just do A only"): units and structures
// that exist are seen by everyone; what a country has only ordered stays its
// own until the time skip carries it out. No fog of war, ever: what is hidden
// is the order, never the thing.
//
// One rule for every view and every request (projection.js, gameHost.js):
//
//   - Whose an order is: its ownerCode, and an order with none is the host's,
//     as single player's always are (runtime/humanPolities.js orderOwner). The
//     projection read a blank owner as another country's in one place and as
//     the host's in another, so the host's own view showed a formation it had
//     stood down before sharing as still standing (the review of 2026-11-18,
//     wars 12).
//   - What another sees of a thing a player changed by an order since the last
//     skip is the thing as it stood before the order, kept beside it by the
//     host with the game's DATE it was ordered on. A skip always moves the date
//     on, so a record of another date is the world's already, whatever
//     happened meanwhile: a session taken up after the host played alone, a
//     fleet ordered in the lobby, a round that landed. Before, the fleets' "as
//     seen" was a snapshot of every fleet taken when a round landed and when
//     sharing began: taking up a saved session or the Game Master's command
//     left every fleet as the last shared round had it, and an order given in
//     the lobby was counted seen at the start (wars 5, views 10).
//   - A request may act only on what its asker's view holds: a hunt names a
//     convoy the hunter can see (wars 4). A convoy only ordered was hidden from
//     the view but huntable by id, so probing ids found it.
//   - What a player's request makes is given an id that says nothing of
//     anything else (rule 8, host-made ids): the engine's own ids are the
//     smallest number free, so a player's new convoy or line named how many
//     hidden ones held the numbers below it (wars 4).
//
// Plain data in, plain data out.

import { orderOwner } from "../../runtime/humanPolities.js";
import { blindFraction } from "../../runtime/blindIds.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// --- Whose an order is ------------------------------------------------------------

// Whether an order is `viewer`'s, in a game whose host plays `host`.
export const isOwnOrder = (action, viewer, host = "") => same(orderOwner(action, { country: host }), viewer);

// --- Convoys --------------------------------------------------------------------

// Whether `viewer` sees a transporter: its own, or one under way or ended. A
// convoy only ordered is its owner's until it sets out.
export const transportSeenBy = (entry, viewer) => same(entry?.owner, viewer) || same(entry?.by, viewer) || clean(entry?.status) !== "ordered";

// A war room op as the host may apply it for `viewer`: a hunt for a convoy the
// hunter does not see names none, and the engine answers as it does for any id
// that is no quarry (warRoomOps.js), so the answer gives nothing away either.
export const huntSeenBy = (op, transports, viewer) => {
  if (op?.op !== "hunt") return op;
  const target = list(transports).find((entry) => clean(entry?.id) === clean(op.id));
  return target && transportSeenBy(target, viewer) ? op : { ...op, id: "" };
};

// --- Ids the host makes ---------------------------------------------------------

// An id that tells nothing: random, from the platform's cryptographic source
// (runtime/blindIds.js: Math.random's draws can be counted once its state is
// worked out from ids seen), or `random` in tests, and none of `taken`. Short
// enough for a transporter's (24).
export const opaqueId = (prefix, taken = [], random = blindFraction) => {
  const held = new Set(list(taken).map(clean));
  for (;;) {
    const id = `${prefix}${Math.floor(random() * 36 ** 8).toString(36).padStart(8, "0")}`;
    if (!held.has(id)) return id;
  }
};

// A list with the entry `from` names renamed `to`.
export const withRenamed = (entries, from, to) => list(entries).map((entry) => (clean(entry?.id) === clean(from) ? { ...entry, id: to } : entry));

// --- Fleets -----------------------------------------------------------------------

const asSeenFields = (unit) => ({ posture: clean(unit?.posture), status: clean(unit?.status), updatedAt: clean(unit?.updatedAt) });
const sameFleetState = (left, right) => clean(left?.posture) === clean(right?.posture) && clean(left?.status) === clean(right?.status);

// The world after a player's fleet order (runtime/naval/fleetOps.js), with what
// the others see of that fleet kept beside it (world.seenFleetPostures, the
// host's alone): as it stood before the first order given it on `date`, and
// what the orders made of it, so that anything else that changes it meanwhile
// (the Game Master's command, told to everyone) is seen as it is. Records of
// other dates are the world's already, and are let go.
//   before, after   the world as it was and as the order left it
export const withFleetOrdered = (before, after, unitId, date) => {
  const id = clean(unitId);
  const day = clean(date);
  const was = list(before?.units).find((unit) => clean(unit?.id) === id);
  const now = list(after?.units).find((unit) => clean(unit?.id) === id);
  if (!after || !id || !day || !was) return after;
  const kept = Object.fromEntries(Object.entries(isRecord(before?.seenFleetPostures) ? before.seenFleetPostures : {})
    .filter(([key, entry]) => key !== id && isRecord(entry) && clean(entry.since) === day));
  const prior = isRecord(before?.seenFleetPostures) ? before.seenFleetPostures[id] : null;
  // Already ordered today, and nothing else has changed it since: it is still
  // seen as it stood before that first order.
  const seen = isRecord(prior) && clean(prior.since) === day && sameFleetState(prior.ordered, was) ? prior : asSeenFields(was);
  if (now && !sameFleetState(now, seen)) {
    kept[id] = { posture: clean(seen.posture), status: clean(seen.status), updatedAt: clean(seen.updatedAt), since: day, ordered: { posture: clean(now.posture), status: clean(now.status) } };
  }
  return { ...after, seenFleetPostures: kept };
};

// A fleet as `viewer`'s view shows it, on `date`: another's as it stood before
// the orders given it that day, unless something else has changed it since.
export const fleetAsSeen = (unit, world, date) => {
  const was = isRecord(world?.seenFleetPostures) ? world.seenFleetPostures[clean(unit?.id)] : null;
  if (!isRecord(was) || !clean(date) || clean(was.since) !== clean(date) || !sameFleetState(was.ordered, unit)) return unit;
  return { ...unit, posture: clean(was.posture), status: clean(was.status), ...(clean(was.updatedAt) ? { updatedAt: clean(was.updatedAt) } : {}) };
};

// --- Lines given up -----------------------------------------------------------------

// The world after a player gave up a line still being built (runtime/fronts/
// fortifyOps.js "unfortify", which takes it off the map at once), with the
// line kept for the others (world.linesGivenUp, the host's alone) when they had
// seen it: one ordered on an earlier date. A stand-down of a formation is seen
// as it stood until the skip (disbandFor); a line given up is the same kind of
// order, and the enemy saw it go the moment it was given (wars 6).
export const withLineGivenUp = (world, line, date) => {
  const day = clean(date);
  if (!world || !isRecord(line) || !clean(line.id) || !day) return world;
  const kept = list(world.linesGivenUp).filter((entry) => isRecord(entry?.line) && clean(entry.since) === day);
  const seen = clean(line.building?.since) !== day;
  return { ...world, linesGivenUp: seen ? [...kept, { line, since: day }] : kept };
};

// The lines `viewer` still sees though their owners gave them up on `date`.
export const linesGivenUpSeenBy = (world, viewer, date) => list(world?.linesGivenUp)
  .filter((entry) => isRecord(entry?.line) && clean(date) && clean(entry.since) === clean(date) && !same(entry.line.owner, viewer))
  .map((entry) => entry.line);

// --- The skip ---------------------------------------------------------------------

// Once a round has landed, what was ordered before it is the world's: the
// records kept for the views go. (They are of an earlier date already, and
// read as nothing; this only keeps the world small.)
export const withOrdersSeen = (world) => {
  const fleets = isRecord(world?.seenFleetPostures) && Object.keys(world.seenFleetPostures).length > 0;
  const lines = list(world?.linesGivenUp).length > 0;
  if (!fleets && !lines) return null;
  const next = { ...world };
  if (fleets) next.seenFleetPostures = {};
  if (lines) next.linesGivenUp = [];
  return next;
};
