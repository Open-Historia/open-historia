/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Document-side halves of map undo steps. The map's undo stack (OlMap) holds
// region commands; an edit that also changes the document — a group's record,
// a city or unit the Delete tool removed — hands it these closures so Ctrl+Z
// reverses both sides. Each takes the document's functional setter, so it
// works on whatever the document is when the step runs. Pure; tested in
// documentUndo.test.js.

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
