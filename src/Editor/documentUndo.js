/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Document-side halves of map undo steps. The map's undo stack (OlMap) holds
// region commands; an edit that also changes the document — a group's record,
// a city or unit the Delete tool removed, a shape a war tool drew or reshaped —
// hands it these closures so Ctrl+Z reverses both sides. Each takes the
// document's functional setter, so it works on whatever the document is when
// the step runs. Pure; tested in documentUndo.test.js.

// Remove the row with `id` from a list (cities and features, units). Returns
// the undo step, or null when there was no such row: undo puts the row back
// where it was, unless one with its id has come back meanwhile.
export const removeRowStep = (list, setList, id) => {
  const rows = Array.isArray(list) ? list : [];
  const index = rows.findIndex((row) => row?.id === id);
  const remove = () => setList((current) => (current || []).filter((row) => row?.id !== id));
  remove();
  if (index < 0) return null;
  const row = rows[index];
  return {
    undo: () => setList((current) => {
      const now = current || [];
      if (now.some((other) => other?.id === id)) return now;
      const at = Math.min(index, now.length);
      return [...now.slice(0, at), row, ...now.slice(at)];
    }),
    redo: remove,
  };
};

// Remove every row `shouldRemove` picks at once (the Features panel's Delete
// All and Delete selected). Returns the undo step, or null when it picked none:
// undo puts each removed row back where it was, except one whose id has come
// back meanwhile, and redo removes those rows again, not whatever was added
// since. A row without an id is matched by the row itself.
export const removeRowsStep = (list, setList, shouldRemove) => {
  const rows = Array.isArray(list) ? list : [];
  const removed = [];
  rows.forEach((row, index) => {
    if (shouldRemove(row)) removed.push({ index, row });
  });
  const keyOf = (row) => row?.id ?? row;
  const keys = new Set(removed.map(({ row }) => keyOf(row)));
  const remove = () => setList((current) => (current || []).filter((row) => !keys.has(keyOf(row))));
  remove();
  if (!removed.length) return null;
  return {
    undo: () => setList((current) => {
      const next = [...(current || [])];
      const present = new Set(next.map(keyOf));
      for (const { index, row } of removed) {
        if (present.has(keyOf(row))) continue;
        next.splice(Math.min(index, next.length), 0, row);
      }
      return next;
    }),
    redo: remove,
  };
};

// Add a row to a list (a terrain area, a fortified line or a climate zone the
// Workshop's war tools drew). Returns the undo step, the row already added:
// undo takes it out again, and redo puts it back at the end unless one with
// its id has come back meanwhile.
export const addRowStep = (setList, row) => {
  const add = () => setList((current) => {
    const now = current || [];
    return now.some((other) => other?.id === row.id) ? now : [...now, row];
  });
  add();
  return {
    undo: () => setList((current) => (current || []).filter((other) => other?.id !== row.id)),
    redo: add,
  };
};

// Change some fields of the row with `id` (a shape reshaped on the map).
// Returns the undo step, the change already made, or null when there is no
// such row: undo gives the row back the values those fields had, redo the new
// ones, and a field changed since in the panel keeps its change either way.
export const patchRowStep = (list, setList, id, patch) => {
  const row = (Array.isArray(list) ? list : []).find((other) => other?.id === id);
  if (!row) return null;
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, row[key]]));
  const apply = (fields) => () => setList((current) => (current || []).map((other) => {
    if (other?.id !== id) return other;
    const next = { ...other, ...fields };
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
    return next;
  }));
  apply(patch)();
  return { undo: apply(before), redo: apply(patch) };
};

// Put ids into a list of ids, or take them out (`on`): the water regions that
// can freeze. Returns the undo step, the change already made, or null when
// every id was already where it was asked to be. Undo touches only the ids
// this step moved.
export const membershipStep = (list, setList, ids, on) => {
  const current = new Set(Array.isArray(list) ? list : []);
  const moved = [...new Set(ids || [])].filter((id) => id !== "" && id != null && current.has(id) !== on);
  if (!moved.length) return null;
  const put = (inside) => () => setList((now) => {
    const next = new Set(now || []);
    for (const id of moved) {
      if (inside) next.add(id);
      else next.delete(id);
    }
    return [...next];
  });
  put(on)();
  return { undo: put(!on), redo: put(on) };
};

// A group renamed: its record moves from `from` to `to` (`fallback` is the
// record a group named only on regions is given). Undo moves it back, with any
// change made to it since.
export const groupRenameSteps = (setGroups, from, to, fallback = {}) => {
  const move = (a, b, base = {}) => (registry) => {
    const next = { ...(registry || {}) };
    const record = { ...base, ...(registry?.[a] ?? {}), name: b };
    delete next[a];
    next[b] = record;
    return next;
  };
  return {
    redo: () => setGroups(move(from, to, fallback)),
    undo: () => setGroups(move(to, from)),
  };
};

// A group erased: its record (as it was, `record`, if it had one) leaves the
// registry. Undo puts it back, description and colour with it.
export const groupEraseSteps = (setGroups, name, record = null) => ({
  redo: () => setGroups((registry) => {
    const next = { ...(registry || {}) };
    delete next[name];
    return next;
  }),
  undo: () => setGroups((registry) => (record && !registry?.[name] ? { ...(registry || {}), [name]: record } : registry)),
});
