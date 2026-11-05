/*! Open Historia — ownership presentation holds © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// When a region changes hands, canonical ownership advances at once, but the
// map keeps the region on its previous colour until the sovereignty sweep has
// played and the new borders and labels are ready, then hands over in one go.
// This is the bookkeeping behind that (Nations.jsx applies what it says):
//
// - HOLDS: region id -> count. A held region keeps its previous fill. Counts
//   rather than a set, so overlapping rapid changes of the same region stay
//   ordered: an earlier sweep ending cannot release a later change's hold.
// - TRANSITIONS: one entry per ownership revision that has sweep geometry,
//   queued in arrival order for the sweep and indexed by revision so the
//   worker's cartography result, which may arrive before or after the sweep
//   ends, finds it.
//
// Every hold an entry took is released exactly once: when its cartography is
// published, or when its sweep ends without accepted cartography (failed,
// discarded, or not ready yet). A mistake here leaves conquered regions in the
// loser's colour for the session while borders and labels show the winner.

const ids = (list) => (Array.isArray(list) ? list : [])
  .map((raw) => String(raw ?? ""))
  .filter(Boolean);

export const createOwnershipPresentationState = ({ onHoldsChanged = () => {} } = {}) => {
  const holds = new Map();
  const byRevision = new Map();
  let queue = [];

  const hold = (regionIds) => {
    let changed = false;
    for (const id of ids(regionIds)) {
      holds.set(id, (holds.get(id) ?? 0) + 1);
      changed = true;
    }
    if (changed) onHoldsChanged();
    return changed;
  };

  const release = (regionIds) => {
    let changed = false;
    for (const id of ids(regionIds)) {
      if (!holds.has(id)) continue;
      const next = (holds.get(id) ?? 1) - 1;
      if (next > 0) holds.set(id, next);
      else holds.delete(id);
      changed = true;
    }
    if (changed) onHoldsChanged();
    return changed;
  };

  // A stalled or failed worker, or a stock map: every hold goes, including
  // the ones pending sweeps took, which must not come off a later hold when
  // those sweeps end.
  const releaseAll = () => {
    for (const entry of byRevision.values()) entry.holdsReleased = true;
    for (const entry of queue) entry.holdsReleased = true;
    if (!holds.size) return false;
    holds.clear();
    onHoldsChanged();
    return true;
  };

  // An entry's holds go once, whichever path gets there first.
  const releaseEntry = (entry) => {
    if (!entry || entry.holdsReleased) return false;
    entry.holdsReleased = true;
    return release(entry.changedRegionIds);
  };

  const entryFor = ({ revision, transitionData, ownershipOverrides, changedRegionIds }) => ({
    transitionData,
    cartographyResult: null,
    cartographyAccepted: false,
    cartographyDiscarded: false,
    cartographyFailed: false,
    animationDone: false,
    holdsReleased: false,
    ownershipOverrides: ownershipOverrides ?? {},
    changedRegionIds: changedRegionIds ?? [],
    revision: Number(revision),
  });

  // Transition geometry for a revision (the worker's early message, or the
  // accepted result when that message never came). Returns the entry and
  // whether it is new, i.e. whether the sweep queue grew.
  const addTransition = (fields) => {
    const revision = Number(fields.revision);
    const existing = byRevision.get(revision);
    if (existing) return { entry: existing, added: false };
    const entry = entryFor({ ...fields, revision });
    byRevision.set(revision, entry);
    queue.push(entry);
    return { entry, added: true };
  };

  // The worker's accepted cartography for a revision that has a sweep. With
  // the sweep already over, the caller publishes now; otherwise the sweep's
  // end does.
  const acceptCartography = (fields) => {
    const revision = Number(fields.revision);
    const { entry, added } = addTransition(fields);
    entry.cartographyResult = fields.cartographyResult ?? null;
    entry.cartographyAccepted = true;
    entry.ownershipOverrides = fields.ownershipOverrides ?? entry.ownershipOverrides ?? {};
    entry.changedRegionIds = fields.changedRegionIds ?? entry.changedRegionIds ?? [];
    const publishNow = entry.animationDone;
    if (publishNow) byRevision.delete(revision);
    return { entry, added, publishNow };
  };

  // The scheduler dropped this revision's result: a newer desired state
  // superseded it. When the newer state is an ownership change, each of its
  // regions that is held keeps one hold for the surviving revision, plus one
  // while this revision's own sweep is still playing over it. Otherwise
  // A -> B -> C reveals C under the running A -> B sweep.
  const discardCartography = (revision, { supersededByChangedRegionIds = null } = {}) => {
    const key = Number(revision);
    const entry = byRevision.get(key);
    if (entry) {
      entry.cartographyDiscarded = true;
      if (entry.animationDone) byRevision.delete(key);
    }
    if (!supersededByChangedRegionIds) return entry ?? null;
    const sweeping = new Set(entry && !entry.animationDone && !entry.holdsReleased
      ? ids(entry.changedRegionIds)
      : []);
    // Only counts change here, never which regions are held, so there is
    // nothing for the map to redraw. A sweep still playing keeps its own hold
    // (the max(2)) and gives it back when it ends.
    for (const id of ids(supersededByChangedRegionIds)) {
      if (!holds.has(id)) continue;
      holds.set(id, sweeping.has(id) ? Math.max(2, holds.get(id) ?? 0) : 1);
    }
    return entry ?? null;
  };

  // The worker failed this ownership revision. Without a sweep its holds go
  // now; with one they go when the sweep ends.
  const failCartography = (revision, changedRegionIds) => {
    const key = Number(revision);
    const entry = byRevision.get(key);
    if (!entry) {
      release(changedRegionIds);
      return null;
    }
    entry.cartographyFailed = true;
    if (entry.animationDone) {
      byRevision.delete(key);
      releaseEntry(entry);
    }
    return entry;
  };

  // The next sweep to play, or null.
  const nextTransition = () => queue.shift() ?? null;

  // A sweep ended (or could not play). "publish": the caller publishes the
  // accepted cartography, which releases the holds (releaseEntry). "released":
  // the holds went now and the cartography, if it is still coming, publishes
  // on arrival.
  const finishTransition = (entry) => {
    entry.animationDone = true;
    if (entry.cartographyAccepted && entry.cartographyResult) {
      byRevision.delete(entry.revision);
      return "publish";
    }
    releaseEntry(entry);
    if (entry.cartographyDiscarded || entry.cartographyFailed) byRevision.delete(entry.revision);
    return "released";
  };

  // Geometry changed or the map went away: nothing queued survives. The holds
  // go before the entries are forgotten, so a sweep already playing is marked
  // too and its end cannot take a later change's hold.
  const reset = ({ releaseHolds = true } = {}) => {
    if (releaseHolds) releaseAll();
    queue = [];
    byRevision.clear();
  };

  return {
    holds,
    isHeld: (id) => holds.has(String(id ?? "")),
    hold,
    release,
    releaseAll,
    releaseEntry,
    addTransition,
    acceptCartography,
    discardCartography,
    failCartography,
    nextTransition,
    finishTransition,
    reset,
    // For tests and diagnostics.
    pendingRevisions: () => [...byRevision.keys()],
    queuedCount: () => queue.length,
  };
};
