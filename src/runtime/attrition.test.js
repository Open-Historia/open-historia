/*! Open Historia — attrition: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/attrition.test.js
//
// "Make it so strong winters or dangerous weather conditions can directly harm
// armies AND hugely effect on weariness and atrition (also add atrition stats
// and fully implement them everywhere they should be and would improve the
// game)", and "make dug-in troops even stronger to make always advancing a
// worse strategic decision".

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { turnWarAndPeace } from "../Game/AI/warAndPeace.js";
import { describeWeatherForAdvisor } from "../Game/AI/advisorWeather.js";
import { attritionOf, normalizeAttrition, withTurnAttrition } from "./attrition.js";
import { ATTRITION_DUG, ATTRITION_SHORT, ATTRITION_TIRED, ATTRITION_WEATHER, DUG_IN_DEFENCE, STRONG_WORKS } from "./fronts/constants.js";
import { describeBattlefield } from "./fronts/brief.js";
import { runFronts } from "./fronts/engine.js";
import { frontInput, syntheticMap } from "./fronts/syntheticMap.js";
import { WEATHER, WEATHER_LOSS, weatherLoss } from "./fronts/weather.js";
import { RESOURCES_HARSH_A_MONTH, resourcesAfter } from "./warResources.js";
import { WEARINESS_ATTRITION, WEARINESS_HARSH_A_YEAR, wearinessAfter, withTurnWeariness } from "./warWeariness.js";

const sky = (state) => ({ state, effects: WEATHER[state] });
const troop = (extra = {}) => ({ supply: 1, pocket: false, fatigue: 0, dug: false, climate: null, ...extra });

test("harsh weather wears down every troop out in it, supplied or not: tired more, short more, dug in less", () => {
  // Without attrition, as it always was: only a troop short of supply.
  assert.equal(weatherLoss(sky("blizzard"), troop()), 0);
  assert.equal(weatherLoss(sky("blizzard"), troop({ supply: 0.5 })), WEATHER.blizzard.cold * WEATHER_LOSS * 0.5);
  // With it, a supplied troop in a blizzard loses ATTRITION_WEATHER a day; on a hard winter's ground more.
  assert.equal(weatherLoss(sky("blizzard"), troop(), { short: 0 }), WEATHER.blizzard.cold * ATTRITION_WEATHER);
  const siberia = troop({ climate: { cold: 1.3, heat: 0, pace: 1, attack: 1, wear: 0, air: 1, freezes: 1 } });
  assert.ok(Math.abs(weatherLoss(sky("clear"), siberia, { short: 0 }) - 1.3 * ATTRITION_WEATHER) < 1e-12, "a clear day in a Siberian winter too");
  assert.equal(weatherLoss(sky("clear"), troop(), { short: 0 }), 0, "a clear day in a mild place costs nothing");
  // Spent, short and dug in.
  assert.equal(weatherLoss(sky("blizzard"), troop({ fatigue: 1 }), { short: 0 }), ATTRITION_WEATHER * (1 + ATTRITION_TIRED));
  assert.equal(weatherLoss(sky("blizzard"), troop(), { short: 1 }), ATTRITION_WEATHER * (1 + ATTRITION_SHORT));
  assert.equal(weatherLoss(sky("blizzard"), troop({ dug: true }), { short: 0 }), ATTRITION_WEATHER * ATTRITION_DUG);
});

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "attrition" });
const war = (extra = {}) => frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" }), ...extra });

test("a run counts what attrition took from each country, and the battle's report tells it", () => {
  const harsh = runFronts(war({ mechanics: { weather: true, attrition: true }, steering: { weather: "blizzard" } }));
  const of = (name) => harsh.attrition.find((entry) => entry.name === name);
  assert.ok(of("Aland").lost > 0 && of("Aland").men > 0, JSON.stringify(of("Aland")));
  assert.ok(of("Aland").harshDays > 0 && of("Aland").harshDays === of("Aland").troopDays, "every day of a blizzard is a harsh one");
  assert.equal(of("Aland").days, 20);
  const brief = harsh.battlefields[0].brief;
  assert.ok(Array.isArray(brief.attrition) && brief.attrition[0] > 0);
  assert.match(describeBattlefield(harsh.battlefields[0]), /Attrition: Aland lost [\d.]+ formations' worth, Borduria lost [\d.]+ formations' worth to the weather and to being cut off this period/);
  // Without it, the same weather takes nothing from troops in supply, and nothing is counted.
  const plain = runFronts(war({ mechanics: { weather: true }, steering: { weather: "blizzard" } }));
  assert.equal(plain.attrition, undefined);
  assert.equal(plain.battlefields[0].brief.attrition, undefined);
  // Attrition on with no weather to speak of: the war it was.
  assert.deepEqual(runFronts(war({ mechanics: { attrition: true } })).battlefields, runFronts(war()).battlefields);
});

test("works are stronger with the fatigue mechanic, and the engine without it is as it was", () => {
  assert.ok(STRONG_WORKS.defence > DUG_IN_DEFENCE && STRONG_WORKS.loss < 0.55 && STRONG_WORKS.most > 0.5 && STRONG_WORKS.perDay > 0.04);
  const dawn = fs.readFileSync(new URL("./fronts/dawn.js", import.meta.url), "utf8");
  assert.match(dawn, /battle\.works = run\.mech\.fatigue \? STRONG_WORKS : null;/);
  const combat = fs.readFileSync(new URL("./fronts/combat.js", import.meta.url), "utf8");
  assert.match(combat, /troop\.dug \? \(battle\.works \? battle\.works\.defence : DUG_IN_DEFENCE\)/);
});

test("attrition weighs hugely on weariness, and harsh weather on supplies", () => {
  // A tenth of the army lost to attrition in a period: WEARINESS_ATTRITION / 10 points.
  assert.equal(wearinessAfter({ before: 10, days: 30, atWar: true, attrition: 0.1 }) - wearinessAfter({ before: 10, days: 30, atWar: true }), WEARINESS_ATTRITION / 10);
  // A month of a hard winter for the whole army.
  const winter = wearinessAfter({ before: 10, days: 30, atWar: true, harsh: 1 }) - wearinessAfter({ before: 10, days: 30, atWar: true });
  assert.ok(Math.abs(winter - (WEARINESS_HARSH_A_YEAR * 30) / 365) < 1e-9);
  const after = withTurnWeariness([], {
    days: 30,
    wars: [{ status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
    attrition: [{ name: "Aland", lost: 1000, troopDays: 3000, harshDays: 3000, days: 30 }, { name: "Borduria", lost: 0, troopDays: 3000, harshDays: 0, days: 30 }],
  });
  const value = (name) => after.find((entry) => entry.country === name)?.value ?? 0;
  assert.ok(value("Aland") > value("Borduria") + 20, `${value("Aland")} ${value("Borduria")}`);
  // Supplies: the whole army out in harsh weather for a month.
  assert.equal(resourcesAfter({ before: 80, days: 30, warDays: 30, harsh: 1, rate: 0 }), 80 - RESOURCES_HARSH_A_MONTH);
});

test("each country's attrition is kept while it is at war, told on its Military card and to the advisor", () => {
  const wars = [{ status: "active", sideA: ["Aland"], sideB: ["Borduria"] }];
  const first = withTurnAttrition([], { attrition: [{ name: "Aland", lost: 320, men: 6400 }], wars });
  assert.deepEqual(first, [{ country: "Aland", lastMen: 6400, lastFormations: 3.2, warMen: 6400 }]);
  const second = withTurnAttrition(first, { attrition: [{ name: "Aland", lost: 50, men: 1000 }, { name: "Borduria", lost: 10, men: 200 }], wars });
  assert.deepEqual(attritionOf(second, "aland"), { country: "Aland", lastMen: 1000, lastFormations: 0.5, warMen: 7400 });
  assert.equal(attritionOf(second, "Borduria").warMen, 200);
  // At peace, gone.
  assert.deepEqual(withTurnAttrition(second, { attrition: [], wars: [] }), []);
  assert.deepEqual(normalizeAttrition([{ country: "Aland", lastMen: -3, warMen: "12" }]), [{ country: "Aland", lastMen: 0, lastFormations: 0, warMen: 12 }]);
  // The turn keeps it, where the scenario counts attrition.
  const world = { wars, countryStats: {} };
  const turned = turnWarAndPeace({ world, baseWorld: world, days: 30, date: "1940-01-31", fronts: { attrition: [{ name: "Aland", lost: 100, men: 2000, troopDays: 300, harshDays: 300, days: 30 }] } });
  assert.equal(attritionOf(turned.attrition, "Aland").lastMen, 2000);
  assert.ok((turned.warWeariness.find((entry) => entry.country === "Aland")?.value ?? 0) > (turned.warWeariness.find((entry) => entry.country === "Borduria")?.value ?? 0));
  const off = turnWarAndPeace({ world: { ...world, warSettings: { mechanics: { attrition: false } } }, baseWorld: world, days: 30, date: "1940-01-31", fronts: { attrition: [] } });
  assert.equal(off.attrition, undefined);
  // The card and the advisor.
  const stats = fs.readFileSync(new URL("../Game/GameUI/stats.jsx", import.meta.url), "utf8");
  assert.match(stats, /Lost to attrition, the weather and being cut off: \$\{worn\.lastMen\.toLocaleString\(\)\} men last turn/);
  const advised = describeWeatherForAdvisor({ world: { climateZones: [], battlefields: [{ name: "The Front", status: "active", sides: [["Aland"], ["Borduria"]], brief: { weather: { season: "winter", now: "blizzard", days: { blizzard: 5 } } } }], attrition: first }, player: "Aland", date: "1940-01-31", seed: "s" });
  assert.match(advised, /Attrition \(the weather and being cut off, besides the fighting\): 6,400 men lost last turn, 6,400 in this war\./);
});
