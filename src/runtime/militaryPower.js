/*! Open Historia — a country's military power, as the player is shown it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. "All 4 of these backend stats (quality, technology,
// manpower share, weariness) should decide what the country's overall
// frontend military power is", and its land, sea and air capabilities are
// "ANOTHER set of stats that affect the overall front end military strength".
//
// A country's MILITARY POWER, the figure the Stats pane shows on its Military
// card and ranks countries by (Game/GameUI/countryRanking.js), is what its
// forces come to by the figures the AI rated them at against every other
// country's (Game/AI/militaryRating.js: by its scenario's designer, else when
// the game first needs them). Never the land it holds: "remove region count
// power entirely" (the owner, 2026-10-16). A country never rated, or whose
// people nobody knows, has none (null): its people no longer stand in for a
// rating ("get rid of that fallback", the owner, 2026-11-03).
//
// The power is the men it can put under arms times what each of them is worth,
// raised to the scenario's IMPORTANCE OF TECHNOLOGY (warSettings.js
// technologyWeight): power = men x worth^weight. The men count in full, and how
// far being better armed outweighs being more is the scenario's to say, never
// the year's: "for a scenario not in modern times where the amount of people
// mattered above all else this doesnt work. and dont just make it be so if its
// in a scertain year its a diff formula, cause maybe a scenario 500 years in the
// future is a post apocalyptic thing" (the owner, 2026-11-04), who chose men x
// technology with a multiplier set in the scenario's Wars feature, the modern
// world's by default. At that default (TECHNOLOGY_WEIGHT_MODERN, 4.5) Modern Day
// 2026's figures rank the US, China, India, Russia, Korea, Israel, the UK,
// France, Japan and Pakistan (militaryPower.test.js); at 1 it is the plain
// product, numbers and arms alike, as in a world where the soldiers on each side
// are armed much the same; at 0 the men alone. (Before, the men counted by the
// fifth root whatever the scenario, and a world of numbers came out as one of
// arms.) Its own ranges are the figure's alone: a battle is fought as
// fronts/military.js has it, and a land war's troops are sized as
// countryWeight.js has them (people by the square root).
//
//   men             the men it can put under arms: its people at the share of
//                   them who can fight, in thousands (MEN_AT)
//   worth           what each soldier is worth, 1 for one with every figure at
//                   50, raised to the importance of technology:
//     spending        what its forces have to spend for each soldier, against
//                     the others: militaryFunding.js spendingFactor, 0.6 to 1.5
//     quality         POWER_QUALITY, and technology POWER_TECHNOLOGY (1 at 50)
//     arms            its land, sea and air arms, each POWER_ARMS (1 at 50; an
//                     arm at 0 counts nothing), weighed 0.6, 0.25 and 0.15
//   weariness       nothing up to 50; past it, less and less, to 0.6 at 100: a
//                   weary country fights less willingly. The game's own figure
//                   for it (warWeariness.js), else the one its author gave it to
//                   begin with. Not raised: it is the men's will, not their arms.
//
// So the figure is the thousands of ordinary soldiers (every figure at 50) the
// country's forces are worth.
//
// A scenario that turns countries' figures off (warSettings.js
// mechanics.military) leaves every country's quality, technology and arms at
// 50, its rated spending and men aside; one that leaves air out of its battles
// (mechanics.air) weighs the land and the sea alone.
//
// Pure, and loads in plain Node.

import { RESOURCES_FULL, RESOURCES_SHORTAGE_MOST, economyRate, refillAMonth, resourceShortage, resourcesOf } from "./warResources.js";
import { normalizeBlockades } from "./naval/blockade.js";
import { countryWeight, middleWeight } from "./countryWeight.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";
import { readMilitary, statFactor } from "./fronts/military.js";
import { forcesFunding, middleFundingPerHead, spendingFactor } from "./militaryFunding.js";
import { militaryLookup } from "./militaryStats.js";
import { populationFigureOf } from "./populationFigure.js";
import { TECHNOLOGY_WEIGHT_MODERN, warSettingsOf } from "./warSettings.js";

// The share of its people every country could put under arms before, in percent.
export const MANPOWER_PERCENT = Math.round(MANPOWER_SHARE * 1000) / 10;
export const ARM_WEIGHTS = Object.freeze({ land: 0.6, sea: 0.25, air: 0.15 });
// The power is POWER_SCALE for MEN_AT men under arms, every figure at 50: a thousand ordinary soldiers, 1.
export const POWER_SCALE = 1;
export const MEN_AT = 1000;
// What quality, technology and each arm are worth to the power, at 0 and at 100.
export const POWER_QUALITY = Object.freeze([0.5, 1.8]);
export const POWER_TECHNOLOGY = Object.freeze([0.5, 1.5]);
export const POWER_ARMS = Object.freeze([0.3, 1.8]);
// Weariness costs nothing up to WEARY_POWER_FROM, and WEARY_POWER_COST_MOST at 100.
export const WEARY_POWER_FROM = 50;
export const WEARY_POWER_COST_MOST = 0.4;
// What a country with no war resources left loses of its power (warResources.js): its armies short, its power less.
export const SPENT_POWER_COST_MOST = 0.3;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// A record of a keyed map, by its key, else by its key or its name in any case.
const recordIn = (map, name) => {
  if (!isRecord(map) || !clean(name)) return null;
  if (isRecord(map[clean(name)])) return map[clean(name)];
  const key = fold(name);
  for (const [other, record] of Object.entries(map)) {
    if (isRecord(record) && (fold(other) === key || fold(record.name) === key)) return record;
  }
  return null;
};

// A country's people as the game knows them: its sheet's, else what the
// scenario's author gave it (or the group of that name). 0 where nobody says.
export const peopleFor = (world, name) => {
  const total = Number(recordIn(world?.countryStats, name)?.population?.total);
  if (Number.isFinite(total) && total > 0) return total;
  return populationFigureOf(recordIn(world?.polityOverrides, name)) || populationFigureOf(recordIn(world?.groups, name));
};

// How weary of war a country is now, 0 to 100, and whose figure that is:
// "game" (world.warWeariness), "own" (what its author gave it to begin with),
// or "none".
const wearinessFor = (world, name, given) => {
  const key = fold(name);
  for (const entry of Array.isArray(world?.warWeariness) ? world.warWeariness : []) {
    const value = Number(entry?.value);
    if (key && fold(entry?.country) === key && Number.isFinite(value)) return { value: within(value, 0, 100), from: "game" };
  }
  const own = Number(given?.weariness);
  if (given?.weariness !== undefined && given?.weariness !== null && Number.isFinite(own)) return { value: within(own, 0, 100), from: "own" };
  return { value: 0, from: "none" };
};

// What an arm is worth to the power: nothing at 0.
const armFactor = (value) => (value <= 0 ? 0 : statFactor(value, POWER_ARMS[0], POWER_ARMS[1]));

// Everything a country's military power is read from, and the power.
//   middle    middleFundingPerHead of the world's sheets; worked out here when not given
//   lookup    militaryLookup(world), to read many countries of one world
// Returns {
//   power     the figure, or null where it was never rated
//   rated     whether the AI rated it (its spending is known)
//   base      its men under arms, in thousands (POWER_SCALE a MEN_AT), before what each is worth
//   figures   { quality, technology, land, sea, air, spending, manpowerShare, weariness } as they count
//   own       for each figure, whether it is the country's own (its author's, its
//             sheet's, or for weariness the game's) rather than every country's
//   factors   { quality, technology, weariness, arms }
//   worth     what each soldier is worth (spending, quality, technology, arms), before the weight
//   weight    the scenario's importance of technology the worth is raised to
//   counted   whether the scenario counts countries' own figures at all
// }
export const militaryProfile = (world, name, { middle = null, lookup = null } = {}) => {
  const settings = warSettingsOf(world);
  const counted = settings.mechanics.military;
  // (Its rating is read whether or not the scenario counts its figures in battle: its spending is the power's scale.)
  const rating = (typeof lookup === "function" ? lookup : militaryLookup(world))(name);
  const given = counted ? rating : null;
  const spent = Number(rating?.spending);
  const rated = rating?.spending !== null && rating?.spending !== undefined && rating?.spending !== "" && Number.isFinite(spent);
  const read = readMilitary(given);
  const share = read.manpowerShare ?? settings.manpowerShare ?? MANPOWER_PERCENT;
  const weary = wearinessFor(world, name, given);
  const figures = {
    quality: read.quality,
    technology: read.technology,
    land: read.land,
    sea: read.sea,
    air: read.air,
    spending: rated ? spent : 50,
    manpowerShare: share,
    weariness: weary.value,
  };
  const has = (key) => given?.[key] !== undefined && given?.[key] !== null;
  const own = {
    quality: has("quality"),
    technology: has("technology"),
    land: has("land"),
    sea: has("sea"),
    air: has("air"),
    spending: rated,
    manpowerShare: read.manpowerShare !== null,
    weariness: weary.from !== "none",
  };

  const people = peopleFor(world, name);
  const base = rated && people > 0 ? (POWER_SCALE * (people * share)) / 100 / MEN_AT : null;

  const landArm = armFactor(figures.land);
  const seaArm = armFactor(figures.sea);
  const arms = settings.mechanics.air
    ? ARM_WEIGHTS.land * landArm + ARM_WEIGHTS.sea * seaArm + ARM_WEIGHTS.air * armFactor(figures.air)
    : (ARM_WEIGHTS.land * landArm + ARM_WEIGHTS.sea * seaArm) / (ARM_WEIGHTS.land + ARM_WEIGHTS.sea);
  const factors = {
    quality: statFactor(figures.quality, POWER_QUALITY[0], POWER_QUALITY[1]),
    technology: statFactor(figures.technology, POWER_TECHNOLOGY[0], POWER_TECHNOLOGY[1]),
    weariness: 1 - (WEARY_POWER_COST_MOST * Math.max(0, figures.weariness - WEARY_POWER_FROM)) / (100 - WEARY_POWER_FROM),
    arms,
  };
  // What it has left to fight with, where the scenario's wars use war resources (warResources.js).
  const supplied = settings.mechanics.supply === true;
  if (supplied) {
    figures.resources = resourcesOf(world?.warResources, name);
    own.resources = figures.resources < RESOURCES_FULL;
    factors.resources = 1 - (SPENT_POWER_COST_MOST * resourceShortage(figures.resources)) / RESOURCES_SHORTAGE_MOST;
  }
  // How fast its economy refills them, in points a month, under the blockade on it if any (warResources.js economyRate).
  const blockade = supplied ? normalizeBlockades(world?.blockades).find((entry) => String(entry.country).toLowerCase() === String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase()) : null;
  const refill = supplied ? refillAMonth(economyRate({ sheet: recordIn(world?.countryStats, name), middle: middle ?? middleFundingPerHead(world?.countryStats), pressure: blockade?.pressure ?? 0 })) : null;
  const worth = spendingFactor(figures.spending) * factors.quality * factors.technology * factors.arms;
  const weight = settings.technologyWeight ?? TECHNOLOGY_WEIGHT_MODERN;
  const power = base === null ? null : base * Math.pow(worth, weight) * factors.weariness * (supplied ? factors.resources : 1);
  return { power, rated, base, figures, own, factors, worth, weight, counted, supplied, refill };
};

// A country's military power: null where its people are not known.
export const militaryPower = (world, name, options = {}) => militaryProfile(world, name, options).power;

// The power as the Stats pane writes it: to a tenth while it is small, then short ("12K", "1.7M"), as the men count in
// full and a great power's figure runs to millions. "—" for none.
export const formatMilitaryPower = (power, language = undefined) => {
  const value = Number(power);
  if (power === null || power === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 10000) return (Math.round(value * 10) / 10).toLocaleString(language);
  try {
    return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return Math.round(value).toLocaleString();
  }
};

// What each country of a world weighs in a land war, as the engine sizes its troops (countryWeight.js; the turn's
// own reader: Game/AI/frontTurn.js frontWorldReaders): its people and what its forces have to spend; one whose
// people nobody knows yet, the middle of those whose people are known. Never the land it holds: "remove region
// count power entirely" (the owner, 2026-10-16). (name) => weight.
export const landWeightsOf = (world) => {
  const counted = warSettingsOf(world).mechanics.military;
  const lookup = counted ? militaryLookup(world) : null;
  const middle = middleFundingPerHead(world?.countryStats);
  const weightOf = (name) => countryWeight({
    population: peopleFor(world, name),
    funding: forcesFunding({ sheet: recordIn(world?.countryStats, name), middle, military: lookup ? lookup(name) : null }),
  });
  let unknown = null;
  return (name) => {
    const weight = weightOf(name);
    if (weight !== null) return weight;
    if (unknown === null) {
      const names = new Set();
      for (const source of [world?.countryStats, world?.polityOverrides, world?.groups]) for (const key of Object.keys(isRecord(source) ? source : {})) names.add(key);
      unknown = middleWeight([...names].map(weightOf).filter((weight) => weight !== null));
    }
    return unknown;
  };
};
