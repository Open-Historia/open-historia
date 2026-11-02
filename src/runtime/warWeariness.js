/*! Open Historia — war weariness © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "A peace offer the player accepts or declines, with war weariness."
//
// A country at war grows WEARY of it: a figure from 0 to 100 the game keeps
// for every country that is, or lately was, at war (world.warWeariness). No
// model is asked for it. It rises with
//
//   time            WEARINESS_A_YEAR for every year at war, whatever happens
//   the men called  the share of its people its armies took in a period, net
//                   of those who came home (runtime/fronts/manpower.js)
//   ground lost     the share of the regions it held that changed hands to
//                   an enemy in a period
//   a blockade      by how hard it presses (runtime/naval/blockade.js)
//   attrition       hugely: the share of its army the weather and being cut
//                   off took in a period (WEARINESS_ATTRITION), and every day
//                   its armies spent out in harsh weather, a hard winter above
//                   all (WEARINESS_HARSH_A_YEAR) (runtime/fronts/attrition.js:
//                   "make it so strong winters or dangerous weather conditions
//                   ... hugely effect on weariness and atrition")
//
// falls a little with ground taken, and falls away in peace. A country the
// game holds none for goes to war as weary as the scenario says it is (its
// military figures, runtime/militaryStats.js), where the scenario weighs them.
//
// WHAT IT DOES. A country nobody plays that is weary enough, or is losing
// its own ground, offers a person it is at war with peace (runtime/
// peaceOffers.js). Past WEARY_FROM it tells on a country's armies as a
// blockade does (wearyShortage: slower to recover, fewer reserves), for the
// player's country as for any other. And the story is told who is weary, so
// that it shows at home.
//
// Pure, and loads in plain Node.

export const WEARINESS_MOST = 100;
export const WEARINESS_A_YEAR = 8;
// For a country that calls up 1% of its people in a period: 4 points.
export const WEARINESS_PER_SHARE_CALLED = 400;
// For a country that loses every region it held in a period; a tenth of them is a tenth of it.
export const WEARINESS_ALL_GROUND_LOST = 60;
// The relief of taking as many regions as it held: victories are borne more easily.
export const WEARINESS_GROUND_TAKEN = 12;
export const WEARINESS_BLOCKADE_A_YEAR = 25;
// For a country that loses a tenth of its army to attrition in a period: 15 points.
export const WEARINESS_ATTRITION = 150;
// For a year with all of its armies in harsh weather: a month of a hard winter is seven and a half.
export const WEARINESS_HARSH_A_YEAR = 90;
// How fast it falls away once a country is at peace.
export const WEARINESS_PEACE_A_YEAR = 30;
// The most one period adds, however bad it was.
export const WEARINESS_PERIOD_MOST = 35;
// From where it tells on a country's armies, and what it is at its worst (a
// shortage, as a blockade's is: runtime/fronts/handicap.js shortEdge).
export const WEARY_FROM = 50;
export const WEARY_SHORTAGE_MOST = 0.5;
export const WEARINESS_KEPT_MOST = 80;

const clean = (value, most = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const within = (value, least, most) => Math.min(most, Math.max(least, value));
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};

// world.warWeariness: [{ country, value }], a country once, nothing at 0.
export const normalizeWarWeariness = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const country = clean(raw?.country);
    const weary = Math.round(within(figure(raw?.value), 0, WEARINESS_MOST) * 10) / 10;
    if (!country || !(weary > 0)) continue;
    kept.set(fold(country), { country, value: weary });
  }
  return [...kept.values()].slice(0, WEARINESS_KEPT_MOST);
};

// How weary a country is, 0 to 100.
export const wearinessOf = (weariness, country) => {
  const key = fold(country);
  if (!key) return 0;
  for (const entry of list(weariness)) if (fold(entry?.country) === key) return within(figure(entry.value), 0, WEARINESS_MOST);
  return 0;
};

// What a period does to one country's weariness.
//   before      what it was
//   days        how long the period was
//   atWar       whether it is in an active war
//   called      the share of its people its armies took in the period, net (0 where they are not known)
//   lost        the share of the regions it held that an enemy took in the period
//   taken       the regions it took from an enemy, as a share of those it held
//   blockade    how hard a blockade pressed on it, 0 to 1
//   attrition   the share of its army attrition took in the period, 0 to 1
//   harsh       the share of its armies' days out spent in harsh weather, 0 to 1
//   bombed      what air strikes on its cities added, in points (runtime/fronts/airStrike.js wearinessFromStrikes)
export const wearinessAfter = ({ before = 0, days = 0, atWar = false, called = 0, lost = 0, taken = 0, blockade = 0, attrition = 0, harsh = 0, bombed = 0 } = {}) => {
  const was = within(figure(before), 0, WEARINESS_MOST);
  const years = Math.max(0, figure(days)) / 365;
  if (!atWar) return Math.max(0, was - WEARINESS_PEACE_A_YEAR * years);
  const rise = WEARINESS_A_YEAR * years
    + WEARINESS_PER_SHARE_CALLED * Math.max(0, figure(called))
    + WEARINESS_ALL_GROUND_LOST * within(figure(lost), 0, 1)
    + WEARINESS_BLOCKADE_A_YEAR * within(figure(blockade), 0, 1) * years
    + WEARINESS_ATTRITION * within(figure(attrition), 0, 1)
    + WEARINESS_HARSH_A_YEAR * within(figure(harsh), 0, 1) * years
    + Math.max(0, figure(bombed))
    - WEARINESS_GROUND_TAKEN * within(figure(taken), 0, 1);
  return within(was + Math.min(WEARINESS_PERIOD_MOST, rise), 0, WEARINESS_MOST);
};

// The countries in an active war, folded, from the ledger.
export const countriesAtWar = (wars) => {
  const names = new Map();
  for (const war of list(wars)) {
    if (fold(war?.status || "active") !== "active") continue;
    for (const name of [...list(war.sideA), ...list(war.sideB)]) if (clean(name) && !names.has(fold(name))) names.set(fold(name), clean(name));
  }
  return names;
};

// The weariness the countries at war go into a period with: the game's figure
// for each, and for one at war the game holds none for (it never fought, or
// has long been at peace) what its own figures say it goes to war with.
//   kept        world.warWeariness
//   wars        the war ledger (every stage of it the period goes through)
//   startOf     (name) => 0 to 100, or null for none (militaryStats.js startingWearinessOf); null: none
export const wearinessGoingIn = (kept, { wars = [], startOf = null } = {}) => {
  const known = normalizeWarWeariness(kept);
  if (typeof startOf !== "function") return known;
  const held = new Set(known.map((entry) => fold(entry.country)));
  const seeded = [];
  for (const [key, name] of countriesAtWar(wars)) {
    if (held.has(key)) continue;
    const start = Number(startOf(name));
    if (Number.isFinite(start) && start > 0) seeded.push({ country: name, value: start });
  }
  return seeded.length > 0 ? normalizeWarWeariness([...known, ...seeded]) : known;
};

// The world's weariness after a turn.
//   kept        world.warWeariness as the turn began
//   days        how long the turn's period was
//   wars        the war ledger as the turn ends
//   manpower    what the land war drew and gave back: [{ name, drawn, returned }] in men
//   peopleOf    (name) => its people, 0 where not known
//   flips       the regions that changed hands on battlefields: [{ kind: "control", regionId, from, to }]
//   heldBy      (name) => how many regions it held as the turn began
//   blockades   the period's blockades: [{ country, pressure }]
//   attrition   what attrition took: [{ name, lost, troopDays, harshDays, days }] (runtime/fronts/attrition.js)
//   bombed      what air strikes on its cities added to each: [{ country, value }] (runtime/fronts/airStrike.js)
export const withTurnWeariness = (kept, { days = 0, wars = [], manpower = [], peopleOf = null, flips = [], heldBy = null, blockades = [], attrition = [], bombed = [] } = {}) => {
  const before = normalizeWarWeariness(kept);
  const fighting = countriesAtWar(wars);
  const names = new Map(before.map((entry) => [fold(entry.country), entry.country]));
  for (const [key, name] of fighting) if (!names.has(key)) names.set(key, name);
  const called = new Map();
  for (const entry of list(manpower)) {
    const people = typeof peopleOf === "function" ? figure(peopleOf(entry?.name)) : 0;
    if (!(people > 0)) continue;
    called.set(fold(entry.name), Math.max(0, figure(entry.drawn) - figure(entry.returned)) / people);
  }
  const lost = new Map();
  const taken = new Map();
  for (const flip of list(flips)) {
    if (flip?.kind !== "control") continue;
    if (clean(flip.from)) lost.set(fold(flip.from), (lost.get(fold(flip.from)) ?? 0) + 1);
    if (clean(flip.to)) taken.set(fold(flip.to), (taken.get(fold(flip.to)) ?? 0) + 1);
  }
  const pressed = new Map(list(blockades).map((entry) => [fold(entry?.country), figure(entry?.pressure)]));
  const struck = new Map(list(bombed).map((entry) => [fold(entry?.country), figure(entry?.value)]));
  // Of its army, what attrition took (its formations' worth against the army it kept out on average), and of its days out, those in harsh weather.
  const worn = new Map();
  for (const entry of list(attrition)) {
    const troopDays = figure(entry?.troopDays);
    if (!(troopDays > 0) || !clean(entry?.name)) continue;
    const runDays = figure(entry?.days) > 0 ? figure(entry.days) : Math.max(1, figure(days));
    const army = troopDays / runDays;
    worn.set(fold(entry.name), { attrition: figure(entry.lost) / 100 / Math.max(1, army), harsh: figure(entry.harshDays) / troopDays });
  }
  const next = [];
  for (const [key, country] of names) {
    const held = typeof heldBy === "function" ? Math.max(1, figure(heldBy(country))) : 1;
    const value = wearinessAfter({
      before: wearinessOf(before, country),
      days,
      atWar: fighting.has(key),
      called: called.get(key) ?? 0,
      lost: (lost.get(key) ?? 0) / held,
      taken: (taken.get(key) ?? 0) / held,
      blockade: pressed.get(key) ?? 0,
      attrition: worn.get(key)?.attrition ?? 0,
      harsh: worn.get(key)?.harsh ?? 0,
      bombed: struck.get(key) ?? 0,
    });
    if (value > 0) next.push({ country, value });
  }
  return normalizeWarWeariness(next);
};

// How short weariness leaves a country's armies, 0 to WEARY_SHORTAGE_MOST: nothing under WEARY_FROM.
export const wearyShortage = (value) => {
  const weary = within(figure(value), 0, WEARINESS_MOST);
  if (weary <= WEARY_FROM) return 0;
  return (WEARY_SHORTAGE_MOST * (weary - WEARY_FROM)) / (WEARINESS_MOST - WEARY_FROM);
};

// Two things that leave a country short, taken together: neither alone is ever made less by the other.
export const shortagesTogether = (first, second) => {
  const a = within(figure(first), 0, 1);
  const b = within(figure(second), 0, 1);
  return 1 - (1 - a) * (1 - b);
};

// A word for how weary a country is, for whoever reads the game: "" under a fifth.
export const WEARINESS_WORDS = Object.freeze([[80, "exhausted"], [60, "war-weary"], [40, "strained"], [20, "uneasy"]]);
export const wearinessWord = (value) => {
  const weary = figure(value);
  for (const [from, word] of WEARINESS_WORDS) if (weary >= from) return word;
  return "";
};
