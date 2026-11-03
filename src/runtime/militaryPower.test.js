/*! Open Historia — a country's military power, as the player is shown it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/militaryPower.test.js
//
// "All 4 of these backend stats (quality, technology, manpower share,
// weariness) should decide what the country's overall frontend military power
// is", and land, sea and air are "ANOTHER set of stats that affect the overall
// front end military strength". And never the land it holds: "remove region
// count power entirely" (the owner, 2026-10-16).

import test from "node:test";
import assert from "node:assert/strict";

import { WEIGHT_UNKNOWN, countryWeight, middleWeight } from "./countryWeight.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";
import { FUNDING_FACTOR_LEAST, FUNDING_FACTOR_MOST, fundingFactor, middleFundingPerHead } from "./militaryFunding.js";
import { MANPOWER_PERCENT, landWeightsOf, militaryPower, militaryProfile, peopleFor } from "./militaryPower.js";
import { militaryLookup } from "./militaryStats.js";

const sheet = (people, gdp, balance = 0) => ({ population: { total: people }, economy: { gdp, budgetBalance: balance, publicDebt: 40 } });
const world = (extra = {}) => ({
  countryStats: {
    Aland: sheet(40e6, 9e11),
    Borduria: sheet(90e6, 6e11, -6),
    Cisland: sheet(12e6, 3e11),
  },
  polityOverrides: {
    Dorland: { name: "Dorland", population: 7e6 },
    Esland: { name: "Esland" },
  },
  groups: { "The Watch": { name: "The Watch", population: 2000 } },
  ...extra,
});
const weight = (name) => {
  const w = world();
  return countryWeight({ population: peopleFor(w, name), funding: fundingFactor(w.countryStats[name], middleFundingPerHead(w.countryStats)) });
};
// A world with one country's own figures in it, as its author gives them.
const withFigures = (name, military, extra = {}) => {
  const base = world(extra);
  return { ...base, polityOverrides: { ...base.polityOverrides, [name]: { ...(base.polityOverrides[name] ?? { name }), military } } };
};

test("at the figures every country has, the power is the land war's own weight to the last digit", () => {
  assert.equal(MANPOWER_PERCENT, Math.round(MANPOWER_SHARE * 100));
  assert.equal(MANPOWER_PERCENT, 12);
  for (const name of ["Aland", "Borduria", "Cisland", "Dorland", "The Watch"]) assert.equal(militaryPower(world(), name), weight(name), name);
  // Given figures that are every country's own are no different.
  const neutral = withFigures("Dorland", { quality: 50, technology: 50, land: 50, sea: 50, air: 50, weariness: 0, manpowerShare: 12 });
  assert.equal(militaryPower(neutral, "Dorland"), weight("Dorland"));
  // A scenario that switches mechanics off changes nothing at these figures.
  assert.equal(militaryPower(world({ warSettings: { mechanics: { military: false, air: false } } }), "Aland"), weight("Aland"));
  // Nothing known of it: no figure.
  assert.equal(militaryPower(world(), "Nowhere"), null);
  assert.equal(militaryPower(world(), "Esland"), null, "no people given: none, whatever land it holds");
  assert.equal(countryWeight({ regions: 300 }), null, "the land a country holds is no weight at all");
  assert.equal(militaryPower({}, ""), null);
});

test("native supplies default on, derive the 100/100 baseline and disappear when a scenario disables supply", () => {
  const baseline = world();
  const defaultProfile = militaryProfile(baseline, "Aland");
  assert.equal(defaultProfile.supplied, true);
  assert.equal(defaultProfile.figures.resources, 100);
  assert.equal(defaultProfile.refill !== null, true);
  const depleted = world({ warResources: [{ country: "Aland", value: 21 }] });
  const depletedProfile = militaryProfile(depleted, "Aland");
  assert.equal(depletedProfile.figures.resources, 21);
  assert.ok(depletedProfile.power < defaultProfile.power);
  const disabled = world({ warSettings: { mechanics: { supply: false } },
    warResources: [{ country: "Aland", value: 21 }] });
  const disabledProfile = militaryProfile(disabled, "Aland");
  assert.equal(disabledProfile.supplied, false);
  assert.equal(Object.hasOwn(disabledProfile.figures, "resources"), false);
  assert.equal(disabledProfile.refill, null);
  assert.equal(disabledProfile.power, defaultProfile.power,
    "old warResources records do not penalize warfare when supplies are disabled");
});

test("quality, technology and the arms each move it, and an arm at 0 counts nothing", () => {
  const base = weight("Dorland");
  const power = (military, extra) => militaryPower(withFigures("Dorland", military, extra), "Dorland");
  assert.equal(power({ quality: 100 }), base * 1.5);
  assert.equal(power({ quality: 0 }), base * 0.5);
  assert.equal(power({ technology: 100 }), base * 1.3);
  assert.equal(power({ technology: 0 }), base * 0.7);
  // Land counts most, then the sea, then the air.
  assert.ok(Math.abs(power({ land: 100 }) - base * 1.3) < 1e-9);
  assert.ok(Math.abs(power({ sea: 100 }) - base * 1.125) < 1e-9);
  assert.ok(Math.abs(power({ air: 100 }) - base * 1.075) < 1e-9);
  // No navy (the Dothraki): the sea's quarter is gone, not halved.
  assert.ok(Math.abs(power({ sea: 0 }) - base * 0.75) < 1e-9);
  assert.ok(Math.abs(power({ sea: 1 }) - base * (0.75 + 0.25 * 0.51)) < 1e-9);
  assert.equal(power({ land: 0, sea: 0, air: 0 }), 0, "no army, no navy, no air force");
  // A scenario that leaves air out of its battles weighs the land and the sea alone.
  const noAir = { warSettings: { mechanics: { air: false } } };
  assert.equal(power({ air: 0 }, noAir), base);
  assert.ok(Math.abs(power({ land: 100 }, noAir) - base * ((0.6 * 1.5 + 0.25) / 0.85)) < 1e-9);
});

test("the share of people who can fight counts as more or fewer people; a weary country is worth less", () => {
  const base = weight("Dorland");
  // Four times the share is four times the people: twice the weight, by the root.
  assert.ok(Math.abs(militaryPower(withFigures("Dorland", { manpowerShare: 48 }), "Dorland") - countryWeight({ population: 28e6 })) < 1e-9);
  // The scenario's share for every country, unless a country has its own.
  const scenario = world({ warSettings: { manpowerShare: 3 } });
  assert.ok(Math.abs(militaryPower(scenario, "Dorland") - countryWeight({ population: 7e6 / 4 })) < 1e-9);
  // Nobody knows its people: no power, whatever its figures say, until the AI gives it its people (militaryRating.js).
  assert.equal(militaryPower(withFigures("Esland", { manpowerShare: 48, quality: 90 }), "Esland"), null);
  // Weariness costs nothing up to 50, then down to 0.6 at 100.
  assert.equal(militaryPower(world({ warWeariness: [{ country: "Dorland", value: 50 }] }), "Dorland"), base);
  assert.ok(Math.abs(militaryPower(world({ warWeariness: [{ country: "dorland", value: 75 }] }), "Dorland") - base * 0.8) < 1e-9);
  assert.ok(Math.abs(militaryPower(world({ warWeariness: [{ country: "Dorland", value: 100 }] }), "Dorland") - base * 0.6) < 1e-9);
  // The figure its author gave it to begin with, until the game keeps one of its own.
  const tired = withFigures("Dorland", { weariness: 100 });
  assert.ok(Math.abs(militaryPower(tired, "Dorland") - base * 0.6) < 1e-9);
  assert.equal(militaryPower({ ...tired, warWeariness: [{ country: "Dorland", value: 20 }] }, "Dorland"), base);
});

test("the profile says which figures are the country's own, and a scenario that does not count them shows none", () => {
  const night = world({ groups: { "The Watch": { name: "The Watch", population: 2000, military: { manpowerShare: 60, quality: 70 } } } });
  const lookup = militaryLookup(night);
  const profile = militaryProfile(night, "the watch", { lookup });
  // (And what it has left to fight with, where its wars use war resources: all of it here.)
  assert.deepEqual(profile.figures, { quality: 70, technology: 50, land: 50, sea: 50, air: 50, spending: 50, manpowerShare: 60, weariness: 0, resources: 100 });
  assert.deepEqual(profile.own, { quality: true, technology: false, land: false, sea: false, air: false, spending: false, manpowerShare: true, weariness: false, resources: false });
  assert.equal(profile.supplied, true);
  assert.equal(profile.counted, true);
  assert.ok(Math.abs(profile.power - countryWeight({ population: 2000 * 5 }) * 1.2) < 1e-9);
  // The sheet's figures stand over the author's.
  const sheeted = { ...night, countryStats: { ...night.countryStats, "The Watch": { military: { quality: 30 } } } };
  assert.equal(militaryProfile(sheeted, "The Watch").figures.quality, 30);
  // Turned off, every country is at every country's figures, the scenario's share of people aside.
  const off = { ...night, warSettings: { mechanics: { military: false }, manpowerShare: 24 } };
  const flat = militaryProfile(off, "The Watch");
  assert.equal(flat.counted, false);
  assert.deepEqual(flat.figures, { quality: 50, technology: 50, land: 50, sea: 50, air: 50, spending: 50, manpowerShare: 24, weariness: 0, resources: 100 });
  assert.equal(Object.values(flat.own).some(Boolean), false);
  // A country that has spent its war resources is worth less: with none left, SPENT_POWER_COST_MOST less.
  const spent = { ...night, warResources: [{ country: "The Watch", value: 0 }] };
  assert.ok(Math.abs(militaryPower(spent, "The Watch") - profile.power * 0.7) < 1e-9);
  assert.equal(militaryProfile(spent, "The Watch").own.resources, true);
  assert.equal(militaryProfile({ ...spent, warSettings: { mechanics: { supply: false } } }, "The Watch").supplied, false);
  // Funding is the land war's own (militaryFunding.js), read for the country it is asked for.
  assert.ok(militaryPower(world(), "Aland") > militaryPower(world(), "Cisland"));
});

test("what its forces have to spend, rated against the others, is what its weight takes; its economy where it was not rated", () => {
  // "when this stuff is generated, it should be relative to other countries" (the owner, 2026-10-16).
  const people = (name) => peopleFor(world(), name);
  const power = (name, military, extra) => militaryPower(withFigures(name, military, extra), name);
  assert.ok(Math.abs(power("Dorland", { spending: 100 }) - countryWeight({ population: people("Dorland"), funding: FUNDING_FACTOR_MOST })) < 1e-9);
  assert.ok(Math.abs(power("Dorland", { spending: 0 }) - countryWeight({ population: people("Dorland"), funding: FUNDING_FACTOR_LEAST })) < 1e-9);
  assert.equal(power("Dorland", { spending: 50 }), weight("Dorland"), "the middle of the world is what every country was");
  // A country whose economy is known and that was rated: the rating stands, so every rated country is on one scale.
  assert.equal(power("Aland", { spending: 50 }), countryWeight({ population: people("Aland") }));
  // A scenario that does not count countries' own figures counts their economies.
  assert.equal(power("Aland", { spending: 100 }, { warSettings: { mechanics: { military: false } } }), weight("Aland"));
  const profile = militaryProfile(withFigures("Dorland", { spending: 80 }), "Dorland");
  assert.equal(profile.figures.spending, 80);
  assert.equal(profile.own.spending, true);
});

test("each country weighs its people and spending in a land war; one nobody knows the people of, the middle of those known", () => {
  // "remove region count power entirely" (the owner, 2026-10-16): never the land it holds.
  const weighs = landWeightsOf(world());
  const known = ["Aland", "Borduria", "Cisland", "Dorland", "The Watch"];
  for (const name of known) assert.equal(weighs(name), weight(name), name);
  assert.equal(weighs("Esland"), middleWeight(known.map(weight)));
  assert.equal(weighs("Nowhere"), middleWeight(known.map(weight)));
  assert.equal(landWeightsOf({})("Anyone"), WEIGHT_UNKNOWN, "nobody known: an ordinary state");
  assert.equal(middleWeight([4, 1, 9]), 4);
  assert.equal(middleWeight([4, 1, 9, 6]), 5);
  // Rated spending counts here too.
  assert.ok(Math.abs(landWeightsOf(withFigures("Dorland", { spending: 100 }))("Dorland") - countryWeight({ population: 7e6, funding: FUNDING_FACTOR_MOST })) < 1e-9);
});
