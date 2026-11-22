/*! Open Historia — a scenario's own unit types © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "add custom units types that have their own custom stats for scenarios so like a dragon troop that is an air troop
// and super strong and very tough" (the owner, 2026-11-13).
//
// The kinds every unit is (UNIT_TYPES), and the unit types a scenario names of its own (world.unitTypes), set in the
// Scenario Editor's Wars card (GameUI/ScenarioUnitTypes.jsx) and inherited by every game made from it:
//
//   { id, name, base, attack, toughness, speed, icon, note, owners }
//
//   id         a slug, by which a unit names its type (unit.unitType); never shown
//   name       what the player and the AI call it: "Dragon"
//   base       which of UNIT_TYPES it IS. A dragon's is "air": it flies, and fights in the sky. A unit of the type
//              takes its base as its `type`, so everything that reads a unit's type reads it as that
//   attack     how much harder it hits than an ordinary unit of its base, FIGURE_LEAST to FIGURE_MOST
//   toughness  how much less it loses, FIGURE_LEAST to FIGURE_MOST
//   speed      how much faster it moves on the map, FIGURE_LEAST to SPEED_MOST
//              (each 1 where the scenario says nothing: an ordinary unit of its base)
//   icon       a mark of its own, at most ICON_MOST characters ("🐉"); "" for its base's
//   note       a line on what it is, at most NOTE_MOST characters
//   owners     the countries that may field it, by name; [] for any
//
// A unit of no such type fights, wears and moves as it always did: its figures are exactly 1 (ORDINARY).
//
// Import-free: the front engine, the naval engine, the stores and the prompts read it alike.

export const UNIT_TYPES = ["infantry", "armor", "air", "naval", "artillery", "garrison"];
export const UNIT_TYPES_MOST = 32;
export const FIGURE_LEAST = 0.1;
export const FIGURE_MOST = 10;
export const SPEED_MOST = 5;
export const ICON_MOST = 4;
export const NOTE_MOST = 240;
export const NAME_MOST = 60;
export const OWNERS_MOST = 64;
const ID_MOST = 48;
const UNIT_TYPE_REF_MOST = 64;

// What a unit of no type of the scenario's does: as an ordinary unit of its kind.
export const ORDINARY = Object.freeze({ attack: 1, toughness: 1, speed: 1 });

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A slug of letters and digits of any script: "Red Dragon" is "red-dragon", "龙" stays "龙".
export const unitTypeSlug = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, ID_MOST)
  .replace(/-+$/g, "");

// A figure as kept: within its bounds, to the hundredth; 1 where none is given or it is no number.
export const unitTypeFigure = (value, most = FIGURE_MOST) => {
  if (value === null || value === undefined || value === "") return 1;
  const number = Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
  if (!Number.isFinite(number)) return 1;
  const held = number < FIGURE_LEAST ? FIGURE_LEAST : number > most ? most : number;
  return Math.round(held * 100) / 100;
};

// A mark of at most ICON_MOST characters as the eye counts them (an emoji of several code points is one).
let graphemes = null;
export const unitTypeIcon = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (graphemes === null) {
    graphemes = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : false;
  }
  const pieces = graphemes ? Array.from(graphemes.segment(text), (part) => part.segment) : Array.from(text);
  return pieces.slice(0, ICON_MOST).join("").slice(0, ICON_MOST * 8).trim();
};

// The unit types as a world keeps them: each with a unique id, its base one of UNIT_TYPES, its figures within their
// bounds, at most UNIT_TYPES_MOST. One with neither a name nor an id is no type. `resolveOwner` folds an owner's name
// onto the one the world keys it by (gameState.js normalizeWorldState passes its own).
export const normalizeUnitTypes = (value, { resolveOwner = null } = {}) => {
  const kept = [];
  const ids = new Set();
  for (const [index, entry] of list(value).entries()) {
    if (kept.length >= UNIT_TYPES_MOST) break;
    if (!isRecord(entry)) continue;
    const name = clean(entry.name, NAME_MOST);
    let id = unitTypeSlug(entry.id) || unitTypeSlug(name);
    if (!id && !name) continue;
    if (!id) id = `type-${index + 1}`;
    if (ids.has(id)) {
      let count = 2;
      while (ids.has(`${id}-${count}`)) count += 1;
      id = `${id}-${count}`;
    }
    ids.add(id);
    const base = fold(entry.base || entry.type);
    const owners = [];
    for (const owner of list(entry.owners)) {
      const named = clean(typeof resolveOwner === "function" ? resolveOwner(clean(owner, 120)) : owner, 120);
      if (named && !owners.some((other) => fold(other) === fold(named))) owners.push(named);
      if (owners.length >= OWNERS_MOST) break;
    }
    kept.push({
      id,
      name: name || id,
      base: UNIT_TYPES.includes(base) ? base : "infantry",
      attack: unitTypeFigure(entry.attack),
      toughness: unitTypeFigure(entry.toughness),
      speed: unitTypeFigure(entry.speed, SPEED_MOST),
      icon: unitTypeIcon(entry.icon),
      note: clean(entry.note, NOTE_MOST),
      owners,
    });
  }
  return kept;
};

// A unit's own unitType as a unit keeps it: the id (or, as the AI writes it, the name) of one of the scenario's
// types, or "" for none.
export const unitTypeRef = (value) => clean(value, UNIT_TYPE_REF_MOST);

// One of the types by its id or its name, as a model or a person may write either; null for none of them.
export const findUnitType = (types, ref) => {
  const wanted = clean(ref, UNIT_TYPE_REF_MOST);
  if (!wanted) return null;
  const all = list(types);
  return all.find((type) => type?.id === wanted)
    ?? all.find((type) => fold(type?.name) === fold(wanted))
    ?? all.find((type) => type?.id === unitTypeSlug(wanted))
    ?? null;
};

// The type a unit is, by the id it keeps; null for an ordinary unit.
export const unitTypeOf = (types, unit) => {
  const id = clean(unit?.unitType, UNIT_TYPE_REF_MOST);
  return id ? list(types).find((type) => type?.id === id) ?? null : null;
};

// How a unit fights and moves against an ordinary unit of its kind: its type's three figures, ORDINARY for a unit of
// no type of the scenario's. (The figures are read through their bounds, so a list nobody normalized cannot stretch them.)
export const unitFigures = (types, unit) => {
  const type = unitTypeOf(types, unit);
  if (!type) return ORDINARY;
  return { attack: unitTypeFigure(type.attack), toughness: unitTypeFigure(type.toughness), speed: unitTypeFigure(type.speed, SPEED_MOST) };
};

// Whether `owner` may field a type: anyone where it names nobody.
export const mayFieldUnitType = (type, owner) => {
  const owners = list(type?.owners);
  return owners.length === 0 || owners.some((name) => fold(name) === fold(owner));
};

// The units as a world keeps them: one of a type of the scenario's takes that type's base as its kind (and keeps the
// type by its id); one naming a type the scenario does not have keeps its own kind and loses the name. The same list
// back when nothing changes.
export const withUnitTypesApplied = (units, types) => {
  const all = list(units);
  if (!all.some((unit) => unit?.unitType)) return all;
  let changed = false;
  const next = all.map((unit) => {
    if (!unit?.unitType) return unit;
    const type = findUnitType(types, unit.unitType);
    if (!type) {
      changed = true;
      const { unitType: _gone, ...rest } = unit;
      return rest;
    }
    if (unit.unitType === type.id && unit.type === type.base) return unit;
    changed = true;
    return { ...unit, unitType: type.id, type: type.base };
  });
  return changed ? next : all;
};

// ---- for the AI ----------------------------------------------------------------------------------------------

const ORDINARY_OF = Object.freeze({
  infantry: "an ordinary infantry unit",
  armor: "an ordinary armor unit",
  air: "an ordinary air unit",
  naval: "an ordinary naval unit",
  artillery: "an ordinary artillery unit",
  garrison: "an ordinary garrison",
});
const times = (value, quality) => (value === 1 ? `as ${quality}` : value === 2 ? `twice as ${quality}` : value === 0.5 ? `half as ${quality}` : `${value} times as ${quality}`);

// What a type is, in a line the AI reads: its name, its base, its three figures in words, who may field it, its note.
export const describeUnitType = (type) => {
  const owners = list(type?.owners);
  return `- ${type.name}: ${type.base}; attacks ${times(type.attack, "hard")}, is ${times(type.toughness, "tough")} and moves ${times(type.speed, "fast")} as ${ORDINARY_OF[type.base] ?? "an ordinary unit"}; `
    + `${owners.length ? `fielded only by ${owners.join(", ")}` : "any country may field it"}${type.note ? `. ${type.note}` : ""}`;
};

// The scenario's unit types as a block for a prompt, under the units; "" when it has none.
export const describeUnitTypesForPrompt = (types) => {
  const all = list(types);
  if (all.length === 0) return "";
  return [
    "Unit types of this scenario (a unit of one is listed with its type's name; to raise one, give its name as unitType):",
    ...all.map(describeUnitType),
  ].join("\n");
};
