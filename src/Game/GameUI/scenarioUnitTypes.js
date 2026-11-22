/*! Open Historia — the Scenario Editor's unit types, as its form holds them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The scenario's own unit types (runtime/unitTypes.js: world.unitTypes) are set in the Scenario Editor's Features tab,
// under Wars (ScenarioUnitTypes.jsx), and saved with the rest of its form (libraryBar.jsx buildScenarioEditorState,
// handleSave). The form holds the list as the author writes it, each type with the id it was made with, and reads it
// through normalizeUnitTypes only when it is saved or handed to the Workshop: a name being typed keeps its spaces.
//
// No React here, so node can test it.

import { UNIT_TYPES_MOST, normalizeUnitTypes, unitTypeFigure, unitTypeSlug } from "../../runtime/unitTypes.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// The types as the form opens with them: as the world keeps them.
export const formUnitTypes = (world) => normalizeUnitTypes(world?.unitTypes);

// The types as they are saved and as the Workshop is handed them.
export const savedUnitTypes = (types) => normalizeUnitTypes(types);

// A new type of that name, an ordinary infantry unit until the author says otherwise. Its id is made from its name and
// kept when it is renamed, so the units of it stay of it. null for no name, or with UNIT_TYPES_MOST already.
export const newUnitType = (types, name) => {
  const named = clean(name);
  const kept = list(types);
  if (!named || kept.length >= UNIT_TYPES_MOST) return null;
  const ids = new Set(kept.map((type) => type?.id));
  const stem = unitTypeSlug(named) || "type";
  let id = stem;
  for (let count = 2; ids.has(id); count += 1) id = `${stem}-${count}`;
  return { id, name: named, base: "infantry", attack: 1, toughness: 1, speed: 1, icon: "", note: "", owners: [] };
};

// The list with a type added at its end, or as it was.
export const withNewUnitType = (types, name) => {
  const made = newUnitType(types, name);
  return made ? [...list(types), made] : list(types);
};

// The list with one type changed, or taken out.
export const withUnitType = (types, id, patch) => list(types).map((type) => (type?.id === id ? { ...type, ...patch } : type));
export const withoutUnitType = (types, id) => list(types).filter((type) => type?.id !== id);

// A figure an author typed into a field: { value, ok }, held to its bounds (unitTypes.js unitTypeFigure); ok false for
// text that is no figure, and an empty field is 1, an ordinary unit's.
export const typedUnitTypeFigure = (text, most) => {
  const raw = clean(text).replace(/^[x×]\s*/i, "");
  if (raw === "") return { value: 1, ok: true };
  const number = Number(raw.replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return { value: 1, ok: false };
  return { value: unitTypeFigure(number, most), ok: true };
};

// The countries that may field a type: one added (not twice), or one taken off.
export const withUnitTypeOwner = (types, id, owner) => {
  const named = clean(owner);
  if (!named) return list(types);
  return list(types).map((type) => (type?.id === id && !list(type.owners).some((other) => fold(other) === fold(named))
    ? { ...type, owners: [...list(type.owners), named] }
    : type));
};
export const withoutUnitTypeOwner = (types, id, owner) => list(types).map((type) => (type?.id === id
  ? { ...type, owners: list(type.owners).filter((other) => fold(other) !== fold(owner)) }
  : type));

// The form's types after the Workshop renamed countries ([{ from, to }], in order, as it replays them on the
// scenario's world: playerCountryAfterSave.js scenarioAfterWorkshopRenames), so its next Save does not write the old
// names back.
export const withRenamedUnitTypeOwners = (types, renames) => {
  let next = list(types);
  for (const rename of list(renames)) {
    const from = clean(rename?.from);
    const to = clean(rename?.to);
    if (!from || !to || fold(from) === fold(to)) continue;
    next = next.map((type) => (list(type?.owners).some((owner) => fold(owner) === fold(from))
      ? { ...type, owners: [...new Set(list(type.owners).map((owner) => (fold(owner) === fold(from) ? to : owner)))] }
      : type));
  }
  return next;
};
