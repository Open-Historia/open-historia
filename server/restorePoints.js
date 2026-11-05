/*! Open Historia — restore points kept one per slot © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A game's restore points (the rollback archive, gameplay.js
// captureRollbackSnapshot) are kept one per slot: a file each on the desktop
// (server/libraryStore.js), an IndexedDB row each on the web
// (src/runtime/web/libraryStore.js), with an index that keeps their order,
// newest first. A turn adds one restore point and drops the oldest, so it writes
// one slot instead of all twelve worlds (8-21 MB on a long game), and a reader
// that wants one restore point reads one.
//
// Pure, with no node imports: the web build bundles it too.

// What the index keeps of a restore point: everything but its `state`.
export const restorePointIndexEntry = (snap) => ({
  id: snap?.id ?? "",
  round: snap?.round ?? null,
  fromDate: snap?.fromDate ?? "",
  toDate: snap?.toDate ?? "",
  capturedAt: snap?.capturedAt ?? "",
});

// A restore point never changes once captured: every writer passes the older
// ones along as they are (a turn puts a new one in front, an undo drops the
// newest). One stored under the same id, captured at the same moment for the
// same span, is therefore the same restore point, and is not written again.
const sameRestorePoint = (stored, entry) =>
  stored.id === entry.id
  && stored.round === entry.round
  && stored.fromDate === entry.fromDate
  && stored.toDate === entry.toDate
  && stored.capturedAt === entry.capturedAt;

// How to store `list` (newest first) over what the index holds now (`prior`:
// index entries, each with its `slot`). `slotFor(id, attempt)` names a slot for a
// restore point, trying the next attempt while the name is taken. Returns the
// new index entries (each with its slot), the restore points to write, and the
// slots nothing uses any more. `reuse: false` writes every one again, for a
// list that comes from outside, such as an imported game's.
export const planRestorePointSlots = (prior, list, { slotFor, reuse = true } = {}) => {
  const snapshots = Array.isArray(list) ? list : [];
  const stored = (Array.isArray(prior) ? prior : [])
    .filter((entry) => entry && typeof entry.slot === "string" && entry.slot);
  const byId = new Map();
  if (reuse) {
    for (const entry of stored) if (entry.id && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const taken = new Set();
  const entries = snapshots.map((snap) => {
    const entry = restorePointIndexEntry(snap);
    const kept = entry.id ? byId.get(entry.id) : null;
    if (kept && !taken.has(kept.slot) && sameRestorePoint(kept, entry)) {
      taken.add(kept.slot);
      return { ...entry, slot: kept.slot };
    }
    return entry;
  });
  const writes = [];
  entries.forEach((entry, index) => {
    if (entry.slot) return;
    let slot = "";
    for (let attempt = 0; !slot || taken.has(slot); attempt += 1) slot = slotFor(String(entry.id ?? ""), attempt);
    taken.add(slot);
    entry.slot = slot;
    writes.push({ slot, snapshot: snapshots[index] });
  });
  const drops = [...new Set(stored.map((entry) => entry.slot))].filter((slot) => !taken.has(slot));
  return { entries, writes, drops };
};

// The index entries a reader sees: the slots are the store's business.
export const publicRestorePointIndex = (entries) =>
  ({ entries: (Array.isArray(entries) ? entries : []).map(restorePointIndexEntry) });
