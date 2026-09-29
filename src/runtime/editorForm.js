/*! Open Historia — the scenario and game editor's form against what is saved © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The library's editor drawer (GameUI/libraryBar.jsx) holds a form built from
// the record as it was loaded. The record can move on underneath it (a
// Workshop save, turns played while the drawer stays open), so the form is
// read against the snapshot it was built from, never written over the record
// whole.

// The form after something else saved the record: each of `keys` the author
// has not touched (still what `before` held) takes the value `after` holds;
// a field they changed keeps their value.
export const followSavedFields = (form, before, after, keys) => {
  if (!form) return form;
  const next = { ...form };
  for (const key of keys) {
    if (form[key] === (before?.[key] ?? "")) next[key] = after?.[key] ?? "";
  }
  return next;
};

// The fields among `keys` the author changed in the form since it was built
// from `baseline`, as a patch. A game's editor saves only these: the game
// moves on while its drawer is open (turns change its date, borders and
// polities), and writing the whole snapshot back rolled all of that back.
export const changedFields = (form, baseline, keys) => {
  const patch = {};
  for (const key of keys) {
    if (form?.[key] !== baseline?.[key]) patch[key] = form?.[key];
  }
  return patch;
};
