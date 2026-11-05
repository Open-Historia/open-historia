/*! Open Historia — what attrition has cost each country © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "attrition"). "Add atrition stats and
// fully implement them everywhere they should be" (the owner, 2026-10-14).
//
// What the weather and being cut off have taken from each country at war,
// besides the fighting (runtime/fronts/attrition.js counts it each turn), kept
// in world.attrition:
//
//   [{ country, lastMen, lastFormations, warMen }]
//     lastMen, lastFormations   the last turn's
//     warMen                    all of it since the country last went to war
//
// A country no longer at war is dropped. It is told on the Stats pane's
// Military card and to the advisor, and it weighs on war weariness
// (runtime/warWeariness.js) and on war resources (runtime/warResources.js).
//
// Pure, and loads in plain Node.

import { countriesAtWar } from "./warWeariness.js";

export const ATTRITION_KEPT_MOST = 120;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const count = (value) => {
  const read = Math.round(Number(value));
  return Number.isFinite(read) && read > 0 ? read : 0;
};

// world.attrition, a country once.
export const normalizeAttrition = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const country = clean(raw?.country);
    if (!country || kept.has(fold(country))) continue;
    const lastFormations = Math.round(Math.max(0, Number(raw?.lastFormations) || 0) * 10) / 10;
    kept.set(fold(country), { country, lastMen: count(raw?.lastMen), lastFormations, warMen: count(raw?.warMen) });
  }
  return [...kept.values()].slice(0, ATTRITION_KEPT_MOST);
};

// A country's record, or null.
export const attritionOf = (record, country) => normalizeAttrition(record).find((entry) => fold(entry.country) === fold(country)) ?? null;

// The record after a turn.
//   kept        world.attrition as the turn began
//   attrition   the turn's count: [{ name, lost, men }] (fronts/attrition.js)
//   wars        the war ledger as the turn ends
export const withTurnAttrition = (kept, { attrition = [], wars = [] } = {}) => {
  const before = new Map(normalizeAttrition(kept).map((entry) => [fold(entry.country), entry]));
  const fighting = countriesAtWar(wars);
  const turn = new Map(list(attrition).filter((entry) => clean(entry?.name)).map((entry) => [fold(entry.name), entry]));
  const next = [];
  for (const [key, name] of fighting) {
    const had = before.get(key);
    const now = turn.get(key);
    const lastMen = count(now?.men);
    if (!had && !now) continue;
    next.push({
      country: had?.country ?? name,
      lastMen,
      lastFormations: Math.round(Math.max(0, Number(now?.lost) || 0) / 10) / 10,
      warMen: (had?.warMen ?? 0) + lastMen,
    });
  }
  return normalizeAttrition(next);
};
