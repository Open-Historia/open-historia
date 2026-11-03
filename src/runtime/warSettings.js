/*! Open Historia — how a scenario's wars are fought (Wars and Fronts Pt.2) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a scenario says of how its wars are fought, kept in world.warSettings
// and set in the Scenario Editor (Fronts):
//
//   mechanics       which of the front engine's newer mechanics are on, each
//                   true or false: troop fatigue, seasons and weather, terrain,
//                   fortified lines, mustering, countries' military stats, air
//                   in battles, supplies (war resources spent by advancing
//                   and building: warResources.js), and attrition (harsh
//                   weather wearing armies down: attrition.js), and marching
//                   (troops raised inside the country march to the line:
//                   fronts/march.js). One the scenario says nothing of is ON.
//   era             the era its wars are fought in, 0 to 3 (before 1500, 1500
//                   to 1850, 1850 to 1945, from 1945), or null to read it off
//                   the date (unitMotion.js eraOf). A calendar of its own
//                   ("Year 12", "1 AC") is read as the present otherwise.
//   menPerCounter   the men a counter on a battlefield stands for, or null for
//                   the era's own (fronts/constants.js MEN_PER_FORMATION_BY_ERA)
//   manpowerShare   the share of a country's people who can fight, in percent
//                   (1 to 100), or null for the game's own twelve
//   muster          how long calling up an army takes: two points [share of
//                   the army, days] the curve goes through besides (0, 0)
//                   (mustering.js), or null for the game's own
//   outcomes        wars meant to end one way: [{ winner, loser }], in any war
//                   between the two (warOutcomes.js); kept only where there are some
//   warfare         how its wars' troops stand where nobody deploys them otherwise
//                   (fronts/swarms.js): "front", along the line where the two
//                   sides meet, or "swarm", in groups each under a general of its
//                   own; null to go by the date (warfareOf): swarms before
//                   FRONTS_FROM_YEAR, fronts from then on
//
// A country may say otherwise for itself: its military stats (militaryStats.js).

import { gameDateYear } from "./gameDates.js";
import { normalizeWarOutcomes } from "./warOutcomes.js";

export const WAR_MECHANICS = Object.freeze(["fatigue", "weather", "terrain", "walls", "muster", "military", "air", "supply", "attrition", "marching"]);
export const ERA_LABELS = Object.freeze(["Before 1500", "1500 to 1850", "1850 to 1945", "From 1945"]);
export const MEN_PER_COUNTER_MOST = 1000000;
export const MUSTER_DAYS_MOST = 3650;
// "war fronts havent always existed" (the owner, 2026-10-16): the year the game's wars are fought along fronts from,
// where a scenario does not say. Before it a war's troops come as swarms.
export const FRONTS_FROM_YEAR = 1900;
export const WARFARE_FORMS = Object.freeze(["front", "swarm"]);

const numberIn = (value, least, most) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= least && number <= most ? number : null;
};

// An era as a scenario keeps it: 0 to 3, or null for "read it off the date".
export const normalizeEra = (value) => {
  const era = numberIn(value, 0, 3);
  return era !== null && Number.isInteger(era) ? era : null;
};

// Two points of a mustering curve, [[share, days], [share, days]] with the
// smaller share first and its days fewer; null for anything else.
export const normalizeMusterPoints = (value) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points = value.slice(0, 2).map((point) => [numberIn(Array.isArray(point) ? point[0] : NaN, 0.001, 1), numberIn(Array.isArray(point) ? point[1] : NaN, 0.1, MUSTER_DAYS_MOST)]);
  if (points.some(([share, days]) => share === null || days === null)) return null;
  points.sort((a, b) => a[0] - b[0]);
  if (points[1][0] - points[0][0] < 0.001 || points[1][1] <= points[0][1]) return null;
  return points.map(([share, days]) => [Math.round(share * 1000) / 1000, Math.round(days * 10) / 10]);
};

// How a scenario's wars are fought as it keeps it: "front", "swarm", or null for "by the date".
export const normalizeWarfare = (value) => (WARFARE_FORMS.includes(value) ? value : null);

// The settings as they are kept: null where a scenario set nothing at all.
export const normalizeWarSettings = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mechanics = {};
  for (const key of WAR_MECHANICS) if (typeof value.mechanics?.[key] === "boolean") mechanics[key] = value.mechanics[key];
  const men = numberIn(value.menPerCounter, 1, MEN_PER_COUNTER_MOST);
  const share = numberIn(value.manpowerShare, 1, 100);
  const outcomes = normalizeWarOutcomes(value.outcomes);
  return {
    mechanics,
    era: normalizeEra(value.era),
    menPerCounter: men === null ? null : Math.round(men),
    manpowerShare: share === null ? null : Math.round(share * 10) / 10,
    muster: normalizeMusterPoints(value.muster),
    ...(outcomes.length > 0 ? { outcomes } : {}),
    ...(normalizeWarfare(value.warfare) ? { warfare: normalizeWarfare(value.warfare) } : {}),
  };
};

// The settings a game's wars are fought under: every mechanic on unless the scenario turned it off.
export const warSettingsOf = (world) => {
  const kept = normalizeWarSettings(world?.warSettings) ?? { mechanics: {}, era: null, menPerCounter: null, manpowerShare: null, muster: null };
  return { ...kept, mechanics: Object.fromEntries(WAR_MECHANICS.map((key) => [key, kept.mechanics[key] !== false])) };
};

// The era a scenario set, 0 to 3, or null: for whatever reads the era off a date (unitMotion.js eraOf).
export const eraSettingOf = (world) => normalizeWarSettings(world?.warSettings)?.era ?? null;

// How a game's wars are fought on a date: as its scenario says; where it says nothing, in swarms before
// FRONTS_FROM_YEAR and along fronts from then on. A calendar of its own, with no year to read, goes by the era the
// scenario set (swarms before 1850), and with none set either is the present's: fronts.
export const warfareOf = (world, date) => {
  const kept = normalizeWarSettings(world?.warSettings);
  if (kept?.warfare) return kept.warfare;
  const year = gameDateYear(date);
  if (Number.isFinite(year)) return year < FRONTS_FROM_YEAR ? "swarm" : "front";
  return kept?.era !== null && kept?.era !== undefined && kept.era < 2 ? "swarm" : "front";
};
