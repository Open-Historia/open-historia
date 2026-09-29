/*! Open Historia — only the latest request may land © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A panel that loads its content after it opens (the Workshop's map, the new
// game picker's countries and borders) can be closed and opened on something
// else before the first load finishes. The late answer must not land in the
// panel that is open now. `begin()` starts a load and hands back its check,
// true only while no later begin() or cancel() has happened; `cancel()` is the
// panel closing.
export const createLatestRequest = () => {
  let current = 0;
  return {
    begin() {
      current += 1;
      const mine = current;
      return () => mine === current;
    },
    cancel() {
      current += 1;
    },
  };
};
