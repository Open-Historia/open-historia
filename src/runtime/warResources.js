/*! Open Historia — a country's war resources © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2 (mechanics.js "supply"). "Make it so advancing uses up
// resources (so does building fortifications) which lowers the amount of
// resources availible weakening your army" (the owner, 2026-10-14).
//
// A country's WAR RESOURCES are what it fights with besides its men: fuel,
// shells, fodder, pay. The game keeps them as a share of what the country can
// hold, 0 to 100 (world.warResources; a country not in it has them all). No
// model is asked for them. They are SPENT by
//
//   advancing   every day its formations take ground or attack (fronts/dawn.js
//               dusk counts them): a period in which every one of them did,
//               every day it was at war, spends RESOURCES_ADVANCE_A_MONTH a
//               month; one in which half of them did, half that. Holding,
//               digging in and resting spend nothing. Since 2026-10-15 that is
//               nothing too: "make advancing not use resources" (the owner,
//               when a country that had advanced for two months was left at a
//               fifth of its resources and its armies crawled). The days of
//               advance are still counted, so it can be weighed again.
//   building    every fortified line of its being built (warGeography.js
//               building): RESOURCES_FORTIFY_A_DAY for every day until it
//               stands. A longer or stronger line takes longer to build and so
//               costs more; a richer country builds it sooner and so for less
//               (fortifyCost.js).
//
// and REFILLED by its economy, over time, in peace as at war, up to the full:
// RESOURCES_REFILL_A_MONTH a month for an ordinary country, at the rate its
// economy gives (economyRate: "have resources recover overtime (depending on
// economic stats)", the owner, 2026-10-14):
//
//   wealth     what its forces have for each of its people against the middle
//              of the countries whose economies are known (the square root of
//              the ratio: militaryFunding.js, which counts its budget's balance
//              and its debt in), or its treasury alone with none to compare
//   growth     an economy growing refills faster, one shrinking slower:
//              1 + growth% / 20, between a half and one and a half
//   blockade   what comes by sea does not come: a blockade cuts the rate by
//              RESOURCES_BLOCKADE_CUT of its pressure ("make blockades
//              directly effect economies")
//
// between RESOURCES_RATE_LEAST and RESOURCES_RATE_MOST; 1 where nothing of its
// economy is known.
//
// WHAT THEY DO. Under RESOURCES_SHORT_FROM a country's armies are short, as a
// blockade leaves them (fronts/handicap.js shortEdge: they come back up to
// strength more slowly, with fewer reserves, and fight and move a little
// worse), the more so the lower, RESOURCES_SHORTAGE_MOST with nothing left;
// and its military power is less (militaryPower.js). So a country that
// attacks everywhere, all the time, runs itself dry within a couple of months,
// and one that holds where it can refills.
//
// Pure, and loads in plain Node.

import { addGameDays, diffGameDays } from "./gameDates.js";
import { fundingPerHead, treasuryFactor } from "./militaryFunding.js";

export const RESOURCES_FULL = 100;
export const RESOURCES_ADVANCE_A_MONTH = 0;
export const RESOURCES_FORTIFY_A_DAY = 0.2;
// And keeping armies out in harsh weather (fuel, winter clothing, fodder): this a month with all of them in it.
export const RESOURCES_HARSH_A_MONTH = 20;
export const RESOURCES_REFILL_A_MONTH = 15;
export const RESOURCES_RATE_LEAST = 0.25;
export const RESOURCES_RATE_MOST = 2;
export const RESOURCES_BLOCKADE_CUT = 0.6;
// From where running low tells on a country's armies, and what it is at its worst.
export const RESOURCES_SHORT_FROM = 40;
export const RESOURCES_SHORTAGE_MOST = 0.6;
export const RESOURCES_KEPT_MOST = 120;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};

// world.warResources: [{ country, value }], a country once, none at the full.
export const normalizeWarResources = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const country = clean(raw?.country);
    const read = Number(raw?.value);
    if (!country || !Number.isFinite(read) || kept.has(fold(country))) continue;
    const held = Math.round(within(read, 0, RESOURCES_FULL) * 10) / 10;
    if (held < RESOURCES_FULL) kept.set(fold(country), { country, value: held });
  }
  return [...kept.values()].slice(0, RESOURCES_KEPT_MOST);
};

const signed = (value) => {
  const read = typeof value === "number" ? value : Number.parseFloat(String(value ?? "").replace(/[^0-9+\-.]/g, ""));
  return Number.isFinite(read) ? read : null;
};

// How fast a country's economy refills its war resources, 1 an ordinary
// country's (see the head of this file).
//   sheet      its sheet of statistics (countryStats), or null
//   middle     middleFundingPerHead of the world's sheets, 0 for none to compare with
//   pressure   how hard a blockade pressed on it, 0 to 1
export const economyRate = ({ sheet = null, middle = 0, pressure = 0 } = {}) => {
  const economy = sheet?.economy ?? null;
  let rate = 1;
  if (economy) {
    const head = fundingPerHead(sheet);
    rate = middle > 0 && head > 0 ? Math.sqrt(head / middle) : treasuryFactor(sheet);
    const growth = signed(economy.gdpGrowth);
    if (growth !== null) rate *= within(1 + growth / 20, 0.5, 1.5);
  }
  rate *= 1 - RESOURCES_BLOCKADE_CUT * within(figure(pressure), 0, 1);
  return within(rate, RESOURCES_RATE_LEAST, RESOURCES_RATE_MOST);
};

// What a country has left, 0 to 100.
export const resourcesOf = (resources, country) => {
  const wanted = fold(country);
  const found = list(resources).find((entry) => fold(entry?.country) === wanted);
  const read = Number(found?.value);
  return Number.isFinite(read) ? within(read, 0, RESOURCES_FULL) : RESOURCES_FULL;
};

// How short running low leaves a country's armies, 0 to RESOURCES_SHORTAGE_MOST: nothing from RESOURCES_SHORT_FROM up.
export const resourceShortage = (value) => {
  const left = within(figure(value), 0, RESOURCES_FULL);
  if (left >= RESOURCES_SHORT_FROM) return 0;
  return (RESOURCES_SHORTAGE_MOST * (RESOURCES_SHORT_FROM - left)) / RESOURCES_SHORT_FROM;
};

// How many days of a period each line was being built: the days of
// [since, since + days) that fall in [from, to).
export const buildingDaysIn = (line, from, to) => {
  const since = clean(line?.building?.since, 40);
  const days = figure(line?.building?.days);
  if (!since || !(days > 0)) return 0;
  const start = diffGameDays(from, since);
  const span = diffGameDays(from, to);
  if (!Number.isFinite(start) || !Number.isFinite(span)) return 0;
  const first = Math.max(0, start);
  const last = Math.min(span, start + days);
  return last > first ? last - first : 0;
};

// A country's resources after a period.
//   before       what it had as the period began
//   days         how long the period was
//   advanced     the share of its formations' days at war spent advancing, 0 to 1
//   warDays      the days of the period it had formations at war
//   fortifying   days of building, summed over its lines being built
//   rate         how fast its economy refills them (economyRate): 1 an ordinary country's
//   harsh        the share of its armies' days out spent in harsh weather (fronts/attrition.js), 0 to 1
export const resourcesAfter = ({ before = RESOURCES_FULL, days = 0, advanced = 0, warDays = 0, fortifying = 0, rate = 1, harsh = 0 } = {}) => {
  const had = within(figure(before), 0, RESOURCES_FULL);
  const refill = (RESOURCES_REFILL_A_MONTH * Math.max(0, figure(rate)) * Math.max(0, figure(days))) / 30;
  const spent = (RESOURCES_ADVANCE_A_MONTH * within(figure(advanced), 0, 1) * Math.max(0, figure(warDays))) / 30
    + RESOURCES_FORTIFY_A_DAY * Math.max(0, figure(fortifying))
    + (RESOURCES_HARSH_A_MONTH * within(figure(harsh), 0, 1) * Math.max(0, figure(warDays))) / 30;
  return within(had + refill - spent, 0, RESOURCES_FULL);
};

// The world's war resources after a turn.
//   kept             world.warResources as the turn began
//   days             how long the turn's period was
//   toDate           the date it ended on
//   effort           what the land war's formations did: [{ name, advanced, troopDays, warDays }]
//                    (formation-days advancing, formation-days at war, days at war: fronts/dawn.js)
//   fortifications   world.fortifications as the turn ends
//   rateOf           (name) => how fast its economy refills them (economyRate); 1 where it is not given
//   attrition        what attrition counted (fronts/attrition.js): its armies' days in harsh weather
export const withTurnResources = (kept, { days = 0, toDate = "", effort = [], fortifications = [], rateOf = null, attrition = [] } = {}) => {
  const before = normalizeWarResources(kept);
  const names = new Map(before.map((entry) => [fold(entry.country), entry.country]));
  const effortOf = new Map();
  for (const entry of list(effort)) {
    const key = fold(entry?.name);
    if (!key) continue;
    if (!names.has(key)) names.set(key, clean(entry.name));
    effortOf.set(key, entry);
  }
  const harshOf = new Map(list(attrition).filter((entry) => figure(entry?.troopDays) > 0).map((entry) => [fold(entry.name), figure(entry.harshDays) / figure(entry.troopDays)]));
  const span = Math.max(0, Math.round(figure(days)));
  const from = toDate ? addGameDays(toDate, -span) : "";
  const building = new Map();
  if (from && toDate) {
    for (const line of list(fortifications)) {
      const owner = clean(line?.owner);
      const inPeriod = owner ? buildingDaysIn(line, from, toDate) : 0;
      if (!(inPeriod > 0)) continue;
      if (!names.has(fold(owner))) names.set(fold(owner), owner);
      building.set(fold(owner), (building.get(fold(owner)) ?? 0) + inPeriod);
    }
  }
  const next = [];
  for (const [key, country] of names) {
    const done = effortOf.get(key);
    const troopDays = figure(done?.troopDays);
    const value = resourcesAfter({
      before: resourcesOf(before, country),
      days: span,
      advanced: troopDays > 0 ? figure(done?.advanced) / troopDays : 0,
      warDays: figure(done?.warDays),
      fortifying: building.get(key) ?? 0,
      harsh: harshOf.get(key) ?? 0,
      rate: typeof rateOf === "function" && Number.isFinite(Number(rateOf(country))) ? Number(rateOf(country)) : 1,
    });
    if (value < RESOURCES_FULL) next.push({ country, value });
  }
  return normalizeWarResources(next);
};

// What a country's economy refills a month, in points, at a rate (economyRate).
export const refillAMonth = (rate) => Math.round(RESOURCES_REFILL_A_MONTH * Math.max(0, figure(rate)) * 10) / 10;

// What building a line costs a country, as it is ordered: per month and in all, in points of its resources.
export const fortifyResourceCost = (buildDays) => {
  const days = Math.max(0, figure(buildDays));
  return { aMonth: Math.round(RESOURCES_FORTIFY_A_DAY * 30 * 10) / 10, total: Math.round(RESOURCES_FORTIFY_A_DAY * days) };
};
