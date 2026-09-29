/*! Open Historia — what a turn's commit keeps, and which restore points are real © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A turn reads the campaign when it starts and writes it back minutes later.
// What that write keeps of what happened meanwhile lives here, apart from the
// simulation, so it can be tested without loading it, and so do the rules for
// which restore points the turns left behind may be restored.
import { campaignChanged } from "./campaignGuard.js";

const idOf = (entry) => String(entry?.id ?? "").trim();

// The queued orders a turn writes. The turn settles the orders it READ, but the
// player keeps using the Actions panel, the advisor and the unit card while it
// runs, and actions.json is written whole: the list from the start of the turn
// used to go back on top, so an order queued meanwhile vanished and one deleted
// meanwhile came back. Now the stored list is read again at the write:
//   - an order the turn started with keeps the turn's version of it (settled,
//     marked overdue, renamed);
//   - one deleted while the turn ran stays deleted;
//   - one queued while the turn ran is kept, after the rest, for the next turn.
// `stored` is null when the re-read failed; the turn's list is written, as before.
export const mergeActionsAtCommit = ({ base = [], turn = [], stored = null } = {}) => {
  if (!Array.isArray(stored)) return turn;
  const baseIds = new Set(base.map(idOf).filter(Boolean));
  const storedIds = new Set(stored.map(idOf).filter(Boolean));
  const kept = turn.filter((action) => {
    const id = idOf(action);
    return !id || !baseIds.has(id) || storedIds.has(id);
  });
  const keptIds = new Set(kept.map(idOf).filter(Boolean));
  const queued = stored.filter((action) => {
    const id = idOf(action);
    return id && !baseIds.has(id) && !keptIds.has(id);
  });
  return queued.length ? [...kept, ...queued] : kept;
};

// The stored list as read again at the write (raw, before normalizeActions), or
// null when the merge cannot trust it and the turn's list is written, as before:
// the read failed, or an entry was saved without an id. normalizeActions gives
// such an entry a new id on every read, so it could never be matched with the
// turn's copy and would be kept as an order queued meanwhile: written twice.
// The read must not carry a defaultValue either: a failed read served as []
// would look like every order deleted while the turn ran.
export const storedActionsForMerge = (raw) =>
  (Array.isArray(raw) && raw.every((entry) => idOf(entry)) ? raw : null);

// A turn held for the player (a failed segment, the Projects board) was
// generated from the campaign as it stood when it was read, and may only land on
// that. While it waits the world is locked to the player's edits and the
// background writers wait for it, and the queued orders and the chat list are
// read again when it is written. What is left is a write that moves the round
// (an Undo), after which the held turn describes a moment that is gone and would
// put the old world back over the new one. Every turn moves the round by one,
// so the round is the whole test.
export const HELD_TURN_STALE_NOTE = "The campaign has changed since this turn was held, so it was discarded. Run the turn again.";

export const heldTurnOutdated = (storedGame, baseGame) =>
  Number(storedGame?.round || 1) !== Number(baseGame?.round || 1);

// Restore points (gameplay.js captureRollbackSnapshot), newest first. Each
// records the round its turn STARTED on, and a turn always moves the round on
// by one, so the newest real one is one round behind the game, the next two
// behind, and so on. One at or past the current round belongs to a turn that
// never landed (its write failed after the restore point was saved) and is left
// out. A restore point with no round (never written without one, but the file
// is the player's) cannot be checked and is taken on trust.
const roundOf = (value) => {
  const round = Number(value);
  return Number.isFinite(round) ? round : null;
};

export const restorePointsFor = (snapshots, { round } = {}) => {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const current = roundOf(round);
  if (current === null) return list;
  return list.filter((snapshot) => {
    const at = roundOf(snapshot?.round);
    return at === null || at < current;
  });
};

export const NO_RESTORE_POINT_NOTE = "The last turn has no restore point.";

// Said with the turn when its restore point could not be saved, so the player
// hears it now rather than when an Undo is refused.
export const RESTORE_POINT_NOT_SAVED_NOTE = "This turn was saved, but its restore point was not, so it cannot be undone.";

// Why the restore point at `index` of restorePointsFor's list may not be
// restored, or "" when it may: it is not the start of the turn `index + 1`
// turns ago (a turn in between saved none, so restoring it would take back
// more turns than the player asked), or it was captured in another campaign.
export const restorePointProblem = (snapshots, { round, campaignId = "", index = 0 } = {}) => {
  const snapshot = Array.isArray(snapshots) ? snapshots[index] : null;
  if (!snapshot) return NO_RESTORE_POINT_NOTE;
  if (campaignChanged(snapshot.campaignId, campaignId)) return NO_RESTORE_POINT_NOTE;
  const current = roundOf(round);
  const at = roundOf(snapshot.round);
  if (current !== null && at !== null && at !== (current || 1) - 1 - index) return NO_RESTORE_POINT_NOTE;
  return "";
};

// How many turns can be undone one after another from where the game stands:
// the unbroken run of restore points from the last turn back. Counts the index
// entries (the server's projection, id/round/dates only) as well as the list.
export const undoableTurns = (snapshots, { round, campaignId = "" } = {}) => {
  const list = restorePointsFor(snapshots, { round });
  let count = 0;
  while (count < list.length && !restorePointProblem(list, { round, campaignId, index: count })) count += 1;
  return count;
};
