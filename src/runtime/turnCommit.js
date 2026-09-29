/*! Open Historia — what a turn's commit keeps © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A turn reads the campaign when it starts and writes it back minutes later.
// What that write keeps of what happened meanwhile lives here, apart from the
// simulation, so it can be tested without loading it.
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
