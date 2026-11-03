/*! Open Historia — a country's military power, as the player is shown it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/militaryPower.test.js
//
// "All 4 of these backend stats (quality, technology, manpower share,
// weariness) should decide what the country's overall frontend military power
// is", and land, sea and air are "ANOTHER set of stats that affect the overall
// front end military strength". And never the land it holds: "remove region
// count power entirely" (the owner, 2026-10-16). Nor its people where nobody
// rated it ("get rid of that fallback"), and the men weighed far less, how they
// are armed far more: "I belive its just taking manpower too high into
// consideration and technological stuff too low because that scenario has
// accurate military stats" (the owner, 2026-11-03, of a ranking of Modern Day
// 2026 that put China, India and the US first, in that order).

import test from "node:test";
import assert from "node:assert/strict";

import { WEIGHT_UNKNOWN, countryWeight, middleWeight } from "./countryWeight.js";
import { MANPOWER_SHARE } from "./fronts/constants.js";
import { FUNDING_FACTOR_MOST, fundingFactor, middleFundingPerHead, spendingFactor } from "./militaryFunding.js";
import { MANPOWER_PERCENT, MEN_AT, MEN_POWER, POWER_SCALE, landWeightsOf, militaryPower, militaryProfile, peopleFor } from "./militaryPower.js";
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
// A world with one country's own figures in it, as its author or the AI gives them.
const withFigures = (name, military, extra = {}) => {
  const base = world(extra);
  return { ...base, polityOverrides: { ...base.polityOverrides, [name]: { ...(base.polityOverrides[name] ?? { name }), military } } };
};
// What a country's men under arms and its spending come to, at every other figure 50.
const menOf = (people, share = MANPOWER_PERCENT, spending = 50) => POWER_SCALE * ((people * share) / 100 / MEN_AT) ** MEN_POWER * spendingFactor(spending);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} vs ${expected}`);

test("a country's power comes from what the AI rated it at, and one never rated has none, whatever its people", () => {
  assert.equal(MANPOWER_PERCENT, Math.round(MANPOWER_SHARE * 100));
  assert.equal(MANPOWER_PERCENT, 12);
  // Its people, its economy and its land stand in for nothing: no rating, no figure.
  for (const name of ["Aland", "Borduria", "Cisland", "Dorland", "Esland", "The Watch", "Nowhere"]) assert.equal(militaryPower(world(), name), null, name);
  assert.equal(militaryProfile(world(), "Borduria").rated, false);
  assert.equal(countryWeight({ regions: 300 }), null, "the land a country holds is no weight at all");
  assert.equal(militaryPower({}, ""), null);
  // Rated, but nobody knows its people (the rating asks for them): none yet.
  assert.equal(militaryPower(withFigures("Esland", { spending: 60 }), "Esland"), null);
  // Rated: its men under arms and its spending, through its figures.
  near(militaryPower(withFigures("Dorland", { spending: 50 }), "Dorland"), menOf(7e6));
  near(militaryPower(withFigures("Dorland", { spending: 90 }), "Dorland"), menOf(7e6, 12, 90));
  assert.equal(militaryProfile(withFigures("Dorland", { spending: 60 }), "Dorland").rated, true);
  // A million men under arms, every figure at the middle: the scale itself. A hundred times the men is two and a
  // half times the power, not ten.
  near(menOf(MEN_AT / 0.12), POWER_SCALE);
  near(menOf((100 * MEN_AT) / 0.12) / menOf(MEN_AT / 0.12), 100 ** MEN_POWER);
});

test("rated as Modern Day 2026 rates them, the great powers rank as the world does, not by their numbers", () => {
  // The scenario's own figures and people (the owner's community scenario, 2026-11-03).
  const rated = {
    polityOverrides: Object.fromEntries([
      ["People's Republic of China", 1404000000, { quality: 65, technology: 90, land: 90, sea: 85, air: 85, spending: 80, manpowerShare: 3 }],
      ["Republic of India", 1429400000, { quality: 60, technology: 70, land: 80, sea: 65, air: 70, spending: 60, manpowerShare: 4 }],
      ["United States of America", 341780000, { quality: 82, technology: 97, land: 98, sea: 95, air: 95, spending: 95, manpowerShare: 2 }],
      ["Russian Federation", 150000000, { quality: 60, technology: 75, land: 85, sea: 60, air: 75, spending: 80, weariness: 35, manpowerShare: 8 }],
      ["Islamic Republic of Pakistan", 240000000, { quality: 60, technology: 65, land: 75, sea: 40, air: 65, spending: 50, manpowerShare: 5 }],
      ["Republic of Korea", 51000000, { quality: 75, technology: 85, land: 80, sea: 60, air: 80, spending: 80, manpowerShare: 6 }],
      ["State of Israel", 9000000, { quality: 85, technology: 90, land: 80, sea: 40, air: 85, spending: 85, manpowerShare: 15 }],
      ["Japan", 122690000, { quality: 75, technology: 85, land: 52, sea: 70, air: 65, spending: 80, manpowerShare: 1 }],
      ["United Kingdom of Great Britain and Northern Ireland", 69480000, { quality: 75, technology: 90, land: 65, sea: 85, air: 80, spending: 80, manpowerShare: 2 }],
      ["French Republic", 69080000, { quality: 75, technology: 90, land: 65, sea: 80, air: 85, spending: 80, manpowerShare: 2 }],
    ].map(([name, population, military]) => [name, { name, population, military }])),
  };
  const order = Object.keys(rated.polityOverrides).sort((a, b) => militaryPower(rated, b) - militaryPower(rated, a));
  assert.deepEqual(order, [
    "United States of America",
    "People's Republic of China",
    "Republic of India",
    "Russian Federation",
    "Republic of Korea",
    "State of Israel",
    "United Kingdom of Great Britain and Northern Ireland",
    "French Republic",
    "Japan",
    "Islamic Republic of Pakistan",
  ]);
});

test("native supplies default on, derive the 100/100 baseline and disappear when a scenario disables supply", () => {
  // Supply changes a rated army's power; an unrated army has no power to compare.
  // Preserve the upstream rule that population alone never manufactures a rating.
  const baseline = withFigures("Aland", { spending: 50 });
  const defaultProfile = militaryProfile(baseline, "Aland");
  assert.equal(defaultProfile.supplied, true);
  assert.equal(defaultProfile.figures.resources, 100);
  assert.equal(defaultProfile.refill !== null, true);
  assert.ok(defaultProfile.power > 0);
  const depleted = withFigures("Aland", { spending: 50 }, { warResources: [{ country: "Aland", value: 21 }] });
  const depletedProfile = militaryProfile(depleted, "Aland");
  assert.equal(depletedProfile.figures.resources, 21);
  assert.ok(depletedProfile.power < defaultProfile.power);
  const disabled = withFigures("Aland", { spending: 50 }, { warSettings: { mechanics: { supply: false } },
    warResources: [{ country: "Aland", value: 21 }] });
  const disabledProfile = militaryProfile(disabled, "Aland");
  assert.equal(disabledProfile.supplied, false);
  assert.equal(Object.hasOwn(disabledProfile.figures, "resources"), false);
  assert.equal(disabledProfile.refill, null);
  assert.equal(disabledProfile.power, defaultProfile.power,
    "old warResources records do not penalize warfare when supplies are disabled");
});

test("quality, technology and the arms each move it, and an arm at 0 counts nothing", () => {
  const power = (military, extra) => militaryPower(withFigures("Dorland", { spending: 50, ...military }, extra), "Dorland");
  const base = power({});
  near(base, menOf(7e6));
  near(power({ quality: 100 }), base * 1.8);
  near(power({ quality: 0 }), base * 0.5);
  near(power({ technology: 100 }), base * 1.5);
  near(power({ technology: 0 }), base * 0.5);
  // Land counts most, then the sea, then the air.
  near(power({ land: 100 }), base * (1 + 0.6 * 0.8));
  near(power({ sea: 100 }), base * (1 + 0.25 * 0.8));
  near(power({ air: 100 }), base * (1 + 0.15 * 0.8));
  // No navy (the Dothraki): the sea's quarter is gone, not halved.
  near(power({ sea: 0 }), base * 0.75);
  near(power({ sea: 1 }), base * (0.75 + 0.25 * (0.3 + 0.7 / 50)));
  assert.equal(power({ land: 0, sea: 0, air: 0 }), 0, "no army, no navy, no air force");
  // A scenario that leaves air out of its battles weighs the land and the sea alone.
  const noAir = { warSettings: { mechanics: { air: false } } };
  near(power({ air: 0 }, noAir), base);
  near(power({ land: 100 }, noAir), base * ((0.6 * 1.8 + 0.25) / 0.85));
});

test("the share of people who can fight counts as more or fewer men; a weary country is worth less", () => {
  const rated = (military = {}, extra = {}) => withFigures("Dorland", { spending: 50, ...military }, extra);
  const base = militaryPower(rated(), "Dorland");
  near(militaryPower(rated({ manpowerShare: 48 }), "Dorland"), menOf(7e6, 48), "four times the share");
  // The scenario's share for every country, unless a country has its own.
  near(militaryPower(rated({}, { warSettings: { manpowerShare: 3 } }), "Dorland"), menOf(7e6, 3));
  // Weariness costs nothing up to 50, then down to 0.6 at 100.
  assert.equal(militaryPower({ ...rated(), warWeariness: [{ country: "Dorland", value: 50 }] }, "Dorland"), base);
  near(militaryPower({ ...rated(), warWeariness: [{ country: "dorland", value: 75 }] }, "Dorland"), base * 0.8);
  near(militaryPower({ ...rated(), warWeariness: [{ country: "Dorland", value: 100 }] }, "Dorland"), base * 0.6);
  // The figure its author gave it to begin with, until the game keeps one of its own.
  const tired = rated({ weariness: 100 });
  near(militaryPower(tired, "Dorland"), base * 0.6);
  assert.equal(militaryPower({ ...tired, warWeariness: [{ country: "Dorland", value: 20 }] }, "Dorland"), base);
});

test("the profile says which figures are the country's own, and a scenario that does not count them shows only its rating", () => {
  const night = world({ groups: { "The Watch": { name: "The Watch", population: 2000, military: { spending: 50, manpowerShare: 60, quality: 70 } } } });
  const lookup = militaryLookup(night);
  const profile = militaryProfile(night, "the watch", { lookup });
  // (And what it has left to fight with, where its wars use war resources: all of it here.)
  assert.deepEqual(profile.figures, { quality: 70, technology: 50, land: 50, sea: 50, air: 50, spending: 50, manpowerShare: 60, weariness: 0, resources: 100 });
  assert.deepEqual(profile.own, { quality: true, technology: false, land: false, sea: false, air: false, spending: true, manpowerShare: true, weariness: false, resources: false });
  assert.equal(profile.supplied, true);
  assert.equal(profile.counted, true);
  near(profile.power, menOf(2000, 60) * (1 + 0.8 * 0.4));
  // The sheet's figures stand over the author's.
  const sheeted = { ...night, countryStats: { ...night.countryStats, "The Watch": { military: { quality: 30 } } } };
  assert.equal(militaryProfile(sheeted, "The Watch").figures.quality, 30);
  // Turned off, every country is at every country's figures, its rated spending and the scenario's share of people aside.
  const off = { ...night, warSettings: { mechanics: { military: false }, manpowerShare: 24 } };
  const flat = militaryProfile(off, "The Watch");
  assert.equal(flat.counted, false);
  assert.deepEqual(flat.figures, { quality: 50, technology: 50, land: 50, sea: 50, air: 50, spending: 50, manpowerShare: 24, weariness: 0, resources: 100 });
  assert.deepEqual(Object.entries(flat.own).filter(([, own]) => own).map(([key]) => key), ["spending"]);
  near(flat.power, menOf(2000, 24));
  // A country that has spent its war resources is worth less: with none left, SPENT_POWER_COST_MOST less.
  const spent = { ...night, warResources: [{ country: "The Watch", value: 0 }] };
  near(militaryPower(spent, "The Watch"), profile.power * 0.7);
  assert.equal(militaryProfile(spent, "The Watch").own.resources, true);
  assert.equal(militaryProfile({ ...spent, warSettings: { mechanics: { supply: false } } }, "The Watch").supplied, false);
});

test("what its forces have to spend for each soldier, rated against the others, counts; its economy does not", () => {
  // "when this stuff is generated, it should be relative to other countries" (the owner, 2026-10-16).
  const power = (name, military, extra) => militaryPower(withFigures(name, military, extra), name);
  near(power("Dorland", { spending: 100 }), power("Dorland", { spending: 50 }) * FUNDING_FACTOR_MOST);
  near(power("Aland", { spending: 50 }), menOf(40e6));
  // A rich economy unrated is no power; rated, the rating alone counts, not its GDP.
  assert.equal(militaryPower(world(), "Aland"), null);
  near(power("Cisland", { spending: 50 }) / menOf(12e6), power("Aland", { spending: 50 }) / menOf(40e6), "one scale for every rated country");
  const profile = militaryProfile(withFigures("Dorland", { spending: 80 }), "Dorland");
  assert.equal(profile.figures.spending, 80);
  assert.equal(profile.own.spending, true);
});

test("each country weighs its people and spending in a land war; one nobody knows the people of, the middle of those known", () => {
  // "remove region count power entirely" (the owner, 2026-10-16): never the land it holds. (What sizes a country's
  // troops in a land war is its people under arms, by the root; the power the player is shown is above.)
  const weighs = landWeightsOf(world());
  const known = ["Aland", "Borduria", "Cisland", "Dorland", "The Watch"];
  for (const name of known) assert.equal(weighs(name), weight(name), name);
  assert.equal(weighs("Esland"), middleWeight(known.map(weight)));
  assert.equal(weighs("Nowhere"), middleWeight(known.map(weight)));
  assert.equal(landWeightsOf({})("Anyone"), WEIGHT_UNKNOWN, "nobody known: an ordinary state");
  assert.equal(middleWeight([4, 1, 9]), 4);
  assert.equal(middleWeight([4, 1, 9, 6]), 5);
  // Rated spending counts here too.
  near(landWeightsOf(withFigures("Dorland", { spending: 100 }))("Dorland"), countryWeight({ population: 7e6, funding: FUNDING_FACTOR_MOST }));
});
