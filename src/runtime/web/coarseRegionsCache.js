/*! Open Historia — web-mode coarse regions cache © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The coarse copy of a scenario's regions that the desktop server keeps beside
// the upload, which the web store computes on demand. Building it is the slow
// part (parse, coarsen, serialise several MB), so the result is kept against
// the stored value it was built from: the same value never builds twice, and a
// re-upload (a new value) rebuilds.
//
// One slot, not one per scenario. It used to be a map by scenario id that
// nothing emptied, so every scenario the picker had shown kept its regions
// source and its coarse text alive for the whole session, deleted ones
// included. The source is re-read from IndexedDB on every request anyway, so
// only the scenario being looked at gains from the cache.

export const createCoarseRegionsCache = (build) => {
  let slot = null; // { id, source, text }
  return {
    text: (id, source) => {
      if (slot && slot.id === id && slot.source === source) return slot.text;
      const text = build(source);
      slot = { id, source, text };
      return text;
    },
    // A deleted scenario lets its copy go at once.
    forget: (id) => {
      if (slot?.id === id) slot = null;
    },
    clear: () => {
      slot = null;
    },
  };
};
