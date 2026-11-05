/*! Open Historia — a country's military figures, as a scenario and the game keep them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. Each country's own military figures (what each one
// does in a war: runtime/fronts/military.js), kept in two places:
//
//   polityOverrides[key].military   what the scenario's author gave it (the
//                                   Workshop's country panel), or a group's
//                                   in groups[key].military
//   countryStats[key].military      what the game holds it to now, in its
//                                   backend sheet: the AI rates a country it
//                                   has no figures for when it goes to war,
//                                   and a turn may move them
//
// The sheet's figures stand over the author's, field by field, and a field
// neither gives is the country's neutral (50, or the scenario's own).
//
//   quality, technology, land, sea, air   0 to 100, 50 neutral; an arm at 0 it cannot use at all
//   spending                              0 to 100: what its forces have to spend, against the other
//                                         countries' (50 the middle; militaryFunding.js forcesFunding)
//   weariness                             0 to 100: how weary of war it is when it first goes to one
//   manpowerShare                         % of its people who can fight (1 to 100)
//   cavalryShare, siegeShare              0 to 1: its unit mix
//   menPerCounter                         the men one of its counters stands for
//   muster                                its own mustering curve (warSettings.js normalizeMusterPoints)

import { normalizeMusterPoints, warSettingsOf } from "./warSettings.js";

export const MILITARY_STAT_FIELDS = Object.freeze(["quality", "technology", "land", "sea", "air", "spending", "weariness", "manpowerShare", "cavalryShare", "siegeShare", "menPerCounter", "muster"]);
const RANGES = Object.freeze({
  quality: [0, 100, 1],
  technology: [0, 100, 1],
  land: [0, 100, 1],
  sea: [0, 100, 1],
  air: [0, 100, 1],
  spending: [0, 100, 1],
  weariness: [0, 100, 1],
  manpowerShare: [0.1, 100, 10],
  cavalryShare: [0, 1, 1000],
  siegeShare: [0, 1, 1000],
  menPerCounter: [1, 1000000, 1],
});

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// The figures as they are kept: only those given and in range; null for none.
export const normalizeMilitaryStats = (value) => {
  if (!isRecord(value)) return null;
  const out = {};
  for (const [key, [least, most, places]] of Object.entries(RANGES)) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const number = Number(raw);
    if (!Number.isFinite(number)) continue;
    const kept = number < least ? least : number > most ? most : number;
    out[key] = Math.round(kept * places) / places;
  }
  const muster = normalizeMusterPoints(value.muster);
  if (muster) out.muster = muster;
  return Object.keys(out).length > 0 ? out : null;
};

// Every country's and group's figures in a world, by name (any name it goes by
// in the world's records): the sheet's over the author's. (name) => figures | null.
export const militaryLookup = (world) => {
  const found = new Map();
  const add = (name, figures) => {
    const key = fold(name);
    if (!key || !figures) return;
    found.set(key, { ...(found.get(key) ?? {}), ...figures });
  };
  for (const [key, record] of Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {})) {
    const figures = normalizeMilitaryStats(record?.military);
    add(key, figures);
    if (record?.name) add(record.name, figures);
  }
  for (const [key, record] of Object.entries(isRecord(world?.groups) ? world.groups : {})) add(key, normalizeMilitaryStats(record?.military));
  for (const [key, sheet] of Object.entries(isRecord(world?.countryStats) ? world.countryStats : {})) add(key, normalizeMilitaryStats(sheet?.military));
  return (name) => found.get(fold(name)) ?? null;
};

// A turn's lasting change to how a country makes war (a time skip's
// polityChanges[].military, Game/AI/gameplaySchemas.js): by how much each of
// its figures moves, the share of its people under arms in points of that
// share (the model calls it `manpower`). Null for none. The model is shown
// the figures it changes (militaryStanding.js): "i spent a decade as ukraine
// to prepare against russia ... AND IT DIDNT MOVE" (a player, 2026-10-17).
export const MILITARY_SHIFT_FIELDS = Object.freeze(["quality", "technology", "land", "sea", "air", "spending", "manpowerShare"]);
// The most of its people a country can keep under arms, in percent.
export const MANPOWER_SHARE_MOST = 50;
export const normalizeMilitaryShift = (value) => {
  if (!isRecord(value)) return null;
  const out = {};
  for (const field of MILITARY_SHIFT_FIELDS) {
    const raw = field === "manpowerShare" ? value.manpowerShare ?? value.manpower : value[field];
    if (raw === null || raw === undefined || raw === "") continue;
    const number = Number(raw);
    if (!Number.isFinite(number) || number === 0) continue;
    out[field] = Math.round(number < -100 ? -100 : number > 100 ? 100 : number);
  }
  return Object.keys(out).length > 0 ? out : null;
};

// A country's figures after a turn's change: each moved from what it counts
// as now (its sheet's, else its author's, else 50) and held between 0 and
// 100; only those that change. Null for none.
export const shiftedMilitary = (world, name, shift) => {
  const moves = normalizeMilitaryShift(shift);
  if (!moves) return null;
  const now = militaryLookup(world)(name) ?? {};
  const out = {};
  for (const [field, by] of Object.entries(moves)) {
    const has = now[field] !== null && now[field] !== undefined && Number.isFinite(Number(now[field]));
    if (field === "manpowerShare") {
      // (From the scenario's share, or the game's twelve, where it has none of its own.)
      const from = has ? Number(now[field]) : warSettingsOf(world).manpowerShare ?? 12;
      const to = Math.round((from + by) * 10) / 10;
      out[field] = to < 0.1 ? 0.1 : to > MANPOWER_SHARE_MOST ? MANPOWER_SHARE_MOST : to;
      continue;
    }
    const from = has ? Number(now[field]) : 50;
    const to = from + by;
    out[field] = to < 0 ? 0 : to > 100 ? 100 : to;
  }
  return out;
};

// How weary of war each country goes to war (warWeariness.js wearinessGoingIn),
// where the scenario weighs its countries' military figures (warSettings.js):
// (name) => 0 to 100, or null where nobody gave it one. Null when it has them off.
export const startingWearinessOf = (world) => {
  if (warSettingsOf(world).mechanics.military !== true) return null;
  const lookup = militaryLookup(world);
  return (name) => lookup(name)?.weariness ?? null;
};
