/*!
 * Open Historia Map Editor — a country's military figures, as the Workshop edits them
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Wars and Fronts Pt.2: "advanced customisability for scenario editors". A
// country's or a group's own military figures (runtime/militaryStats.js) are
// kept on its record as `military`, which the Countries and Groups panels edit
// (MilitaryFields.jsx) and the export writes with the record
// (exportPreset.js: world.polityOverrides, world.groups). Every field may be
// left empty, and an empty field is what every country has, so a record the
// author never opened carries no `military` at all.
//
// This turns what an author types into figures as the game keeps them
// (normalizeMilitaryStats: in range and rounded) and back, and works out what an
// empty field stands for in the scenario at hand. Plain JS, so node can test the
// round trip (militaryForm.test.js).

import { ARMOUR_SHARE_BY_ERA, ARTILLERY_SHARE_BY_ERA, MANPOWER_SHARE, MEN_PER_FORMATION_BY_ERA } from "../runtime/fronts/constants.js";
import { normalizeMilitaryStats } from "../runtime/militaryStats.js";
import { DEFAULT_MUSTER } from "../runtime/mustering.js";
import { formatPopulationFigure, populationFigureOf, readPopulationFigure } from "../runtime/populationFigure.js";
import { eraOf } from "../runtime/unitMotion.js";
import { normalizeWarSettings } from "../runtime/warSettings.js";

// How each field is written: a figure from 0 to 100; a percentage kept as one
// (the share of people who can fight); a percentage kept as a share from 0 to 1
// (the unit mix); a count of men.
export const MILITARY_FIELD_KINDS = Object.freeze({
  quality: "figure",
  technology: "figure",
  land: "figure",
  sea: "figure",
  air: "figure",
  spending: "figure",
  weariness: "figure",
  manpowerShare: "percent",
  cavalryShare: "share",
  siegeShare: "share",
  menPerCounter: "count",
});

const given = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const places = (value, digits) => String(Math.round(Number(value) * 10 ** digits) / 10 ** digits);

// What a field shows of a record's figures: "" for none.
export const militaryFieldText = (military, field) => {
  const value = military?.[field];
  if (!given(value)) return "";
  switch (MILITARY_FIELD_KINDS[field]) {
    case "share":
      return places(Number(value) * 100, 1);
    case "count":
      return formatPopulationFigure(value);
    case "percent":
      return places(value, 1);
    default:
      return places(value, 0);
  }
};

// A number as an author types it in a figure or a percentage: "72", "60%",
// "12.5" or "12,5". NaN for what is no number.
const readFigure = (text) => Number(String(text).trim().replace(/\s*%$/, "").replace(",", "."));

// The figures after an author typed `text` into `field`. { military, ok }:
// military is what the record keeps (null when nothing is left of it), and ok
// is false when the text was no number, the figures then left as they were.
// An empty field takes the figure away: the default again.
export const withMilitaryField = (military, field, text) => {
  const kept = normalizeMilitaryStats(military);
  const kind = MILITARY_FIELD_KINDS[field];
  if (!kind) return { military: kept, ok: false };
  const raw = String(text ?? "").trim();
  const next = { ...(kept ?? {}) };
  if (raw === "") {
    delete next[field];
  } else if (kind === "count") {
    const men = readPopulationFigure(raw);
    if (!(men > 0)) return { military: kept, ok: false };
    next[field] = men;
  } else {
    const number = readFigure(raw);
    if (!Number.isFinite(number)) return { military: kept, ok: false };
    next[field] = kind === "share" ? number / 100 : number;
  }
  return { military: normalizeMilitaryStats(next), ok: true };
};

// The figures with a mustering curve of the country's own (two points,
// warSettings.js normalizeMusterPoints), or with none (null: the scenario's).
export const withMilitaryMuster = (military, points) => {
  const next = { ...(normalizeMilitaryStats(military) ?? {}) };
  if (points) next.muster = points;
  else delete next.muster;
  return normalizeMilitaryStats(next);
};

// What a field left empty stands for in a scenario, from its war settings
// (world.warSettings) and its date: the era its wars are fought in (the one it
// set, else read off the date as the engine reads it: unitMotion.js eraOf), the
// men a counter stands for and the share of people who can fight (its own, else
// the era's and the game's), the era's unit mix, and its mustering curve (its
// own default, else the game's). The Workshop is given this when it opens a
// scenario's map (libraryBar.jsx); a map opened on its own has none (null).
//   rules   the scenario's own rules of its world, for the AI that fills a country's figures in (Game/AI/militaryRating.js)
export const militaryDefaultsFor = (warSettings, gameDate, { rules = "" } = {}) => {
  const settings = normalizeWarSettings(warSettings) ?? { era: null, menPerCounter: null, manpowerShare: null, muster: null };
  const era = eraOf(gameDate, settings.era);
  return {
    era,
    gameDate: String(gameDate ?? ""),
    rules: String(rules ?? ""),
    menPerCounter: settings.menPerCounter ?? MEN_PER_FORMATION_BY_ERA[era],
    manpowerShare: settings.manpowerShare ?? Math.round(MANPOWER_SHARE * 1000) / 10,
    cavalryShare: ARMOUR_SHARE_BY_ERA[era],
    siegeShare: ARTILLERY_SHARE_BY_ERA[era],
    muster: settings.muster ?? DEFAULT_MUSTER,
    scenarioMuster: Boolean(settings.muster),
  };
};

// The figures of every country and group of the scenario that has any, as the AI that fills one in is shown them,
// to rate it against the others (Game/AI/militaryRating.js: "when this stuff is generated, it should be relative to
// other countries", the owner, 2026-10-16): [{ name, military, population }].
export const militaryScaleOf = (polities = {}, groups = {}) => {
  const out = [];
  for (const [key, record] of [...Object.entries(polities ?? {}), ...Object.entries(groups ?? {})]) {
    const military = normalizeMilitaryStats(record?.military);
    if (military) out.push({ name: String(record?.name || key), military, population: populationFigureOf(record) || 0 });
  }
  return out;
};

// Whether a scenario's troops on horseback are horse or armour: armour from the
// era of 1850 to 1945 on, horse before it, and either for a map with no
// scenario to say ("both").
export const unitMixEra = (defaults) => {
  const era = defaults?.era;
  if (!Number.isInteger(era)) return "both";
  return era >= 2 ? "modern" : "old";
};
