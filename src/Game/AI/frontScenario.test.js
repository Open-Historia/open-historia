/*! Open Historia — the fronts a scenario begins with: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontScenario.test.js
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "../../runtime/fronts/codec.js";
import { generalsOf } from "../../runtime/fronts/command.js";
import { TROOP_STATES } from "../../runtime/fronts/constants.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import {
  MAX_SCENARIO_FRONTS,
  authoredName,
  authoredTroops,
  blankScenarioFront,
  normalizeScenarioFronts,
  scenarioFrontOrders,
  scenarioFrontWars,
} from "../../runtime/fronts/scenarioFronts.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { buildScenarioFronts, scenarioFrontsPending } from "./frontScenario.js";
import { runTurnFronts } from "./frontTurn.js";

// Aland in the west, Borduria in the east and Syldavia beyond it, the sea to the south.
const legend = { A: "Aland", B: "Borduria", S: "Syldavia", "~": null };
const cities = [{ name: "Alba", lng: 20.6, lat: 51.4, capital: true }, { name: "Brod", lng: 22.3, lat: 51.2, capital: true }];
const sheet = () => syntheticMap({ layout: enlarge(["AAABBBBSSS", "AAABBBBSSS", "AAABBBBSSS", "AAABBBBSSS", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });
const worldOn = (map, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } }, Syldavia: { population: { total: 1.5e6 } } },
  wars: [],
  battlefields: [],
  units: [],
  ...extra,
});
const game = { country: "Aland", gameDate: "1916-07-01", round: 1 };
const mapOf = (map) => ({
  map: { key: "the sheet", cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  seed: "campaign|1|1916-07-01",
});
const front = (extra = {}) => ({ ...blankScenarioFront(), name: "The Alba Front", sides: [["Aland"], ["Borduria"]], ...extra });
const living = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0);

test("a scenario's fronts are read as their author wrote them, and held to what a front can be", () => {
  const read = normalizeScenarioFronts([
    front({ troops: [40.4, -3], stance: ["Dig In", "nonsense"], generals: [["  Gen.  Haig ", ""], []] }),
    // A country cannot be on both sides; a border at peace has one a side and nobody attacks across it.
    front({ name: "Quiet", war: false, sides: [["Borduria", "Aland"], ["Aland", "Syldavia"]], stance: ["advance", "dig in"] }),
    { name: "Nobody", sides: [[], ["Borduria"]] },
    "nonsense",
  ]);
  assert.deepEqual(read, [
    { name: "The Alba Front", sides: [["Aland"], ["Borduria"]], war: true, troops: [40, 0], stance: ["dig in", "hold"], generals: [["Gen. Haig", ""], []] },
    { name: "Quiet", sides: [["Borduria"], ["Syldavia"]], war: false, troops: [0, 0], stance: ["hold", "dig in"], generals: [[], []] },
  ]);
  // While it is being written a row with a side still empty is kept.
  assert.equal(normalizeScenarioFronts([{ name: "Nobody", sides: [[], ["Borduria"]] }], { draft: true }).length, 1);
  assert.equal(normalizeScenarioFronts(Array.from({ length: MAX_SCENARIO_FRONTS + 4 }, () => front())).length, MAX_SCENARIO_FRONTS);
  assert.deepEqual(normalizeScenarioFronts(null), []);
  assert.equal(scenarioFrontsPending({ scenarioFronts: [front()] }), true);
  assert.equal(scenarioFrontsPending({ scenarioFronts: [] }), false);
  assert.equal(scenarioFrontsPending({}), false);
});

test("a front at war has its war in the ledger, and every side its first order", () => {
  const fronts = normalizeScenarioFronts([front({ stance: ["advance", "dig in"] }), front({ name: "Quiet", war: false, sides: [["Borduria"], ["Syldavia"]], stance: ["hold", "dig in"] })]);
  const wars = scenarioFrontWars(fronts, [], "1916-07-01");
  assert.deepEqual(wars.map((war) => [war.id, war.title, war.status, war.sideA, war.sideB, war.startedDate]), [["war-scenario-front-1", "The Alba Front", "active", ["Aland"], ["Borduria"], "1916-07-01"]]);
  // A war already under way between them is the war: none is added. One that has ended is not.
  assert.deepEqual(scenarioFrontWars(fronts, [{ id: "w", status: "active", sideA: ["Borduria", "X"], sideB: ["Aland"] }], "1916-07-01"), []);
  assert.equal(scenarioFrontWars(fronts, [{ id: "w", status: "ended", sideA: ["Borduria"], sideB: ["Aland"] }], "1916-07-01").length, 1);
  assert.deepEqual(scenarioFrontOrders(fronts).map((order) => [order.battlefield, order.side, order.order]), [
    ["border: Aland / Borduria", "Aland", "advance"],
    ["border: Aland / Borduria", "Borduria", "dig in"],
    ["border: Borduria / Syldavia", "Borduria", "hold"],
    ["border: Borduria / Syldavia", "Syldavia", "dig in"],
  ]);
  assert.deepEqual(authoredTroops(normalizeScenarioFronts([front({ troops: [40, 12] })]), [["Borduria"], ["Aland"]]), [12, 40], "in the battle's own order of sides");
  assert.equal(authoredTroops(fronts, [["Syldavia"], ["Aland"]]), null);
  assert.equal(authoredName(fronts, [["Borduria"], ["Aland"]]), "The Alba Front");
  assert.equal(authoredName(fronts, [["Borduria"], ["Syldavia"]]), "", "a border at peace keeps the name the engine knows it by");
});

test("the engine builds a scenario's fronts on the first day: named, manned as said, and under their first orders", async () => {
  const map = sheet();
  const world = worldOn(map, {
    scenarioFronts: [
      front({ troops: [40, 0], stance: ["hold", "dig in"], generals: [["Gen. Haig", "Gen. Rawlinson"], ["Gen. von Below"]] }),
      front({ name: "The Quiet Border", war: false, sides: [["Borduria"], ["Syldavia"]], stance: ["hold", "dig in"] }),
    ],
  });
  const built = await buildScenarioFronts({ world, game, createFrontRun, ...mapOf(map) });
  assert.deepEqual(built.notes, []);
  assert.deepEqual(built.wars.map((war) => [war.title, war.sideA, war.sideB]), [["The Alba Front", ["Aland"], ["Borduria"]]]);
  assert.deepEqual(built.battlefields.map((record) => [record.name, record.status, record.sides]), [
    ["The Alba Front", "active", [["Aland"], ["Borduria"]]],
    ["Borduria / Syldavia border", "standing", [["Borduria"], ["Syldavia"]]],
  ]);
  const [war, border] = built.battlefields;
  assert.equal(war.openedDate, "1916-07-01");
  assert.equal(living(war, 0).length, 40, "as many as the author said");
  assert.ok(living(war, 1).length >= 6, "and the other side as many as its size gives");
  // Borduria is told to dig in from the first day and Aland to hold: each is what the author made
  // the front, and is marked as his, so that it stands until an event changes it.
  assert.deepEqual(war.orders.map((order) => [order.s, order.order, order.sector, order.mark]), [[0, "hold", "all", "scenario"], [1, "dig in", "all", "scenario"]]);
  // Forty troops are three generals' commands: the two the author named, in
  // the order of their commands, and one he did not.
  assert.deepEqual(generalsOf(war, 0).map((general) => general.name), ["Gen. Haig", "Gen. Rawlinson", ""]);
  assert.equal(generalsOf(war, 1)[0].name, "Gen. von Below");
  // The border at peace: each side that was told to be there is.
  assert.ok(living(border, 0).length > 0 && living(border, 1).length > 0);
  assert.deepEqual(border.orders.map((order) => [order.s, order.order]).sort(), [[0, "hold"], [1, "dig in"]]);

  // The next turn finds them as they were built: a day of it digs Borduria in.
  const next = await runTurnFronts({
    createFrontRun,
    world: { ...world, wars: built.wars, battlefields: built.battlefields, scenarioFronts: [] },
    events: [],
    frontOrders: [],
    warStages: [built.wars],
    fromDate: "1916-07-01",
    toDate: "1916-07-04",
    ...mapOf(map),
  });
  const after = next.battlefields.find((record) => record.name === "The Alba Front");
  assert.ok(decodeTroops(after.troops[1]).some((troop) => troop.state === TROOP_STATES.indexOf("dug in")), "dug in");
  assert.equal(living(after, 0).length, 40);
  assert.equal(next.battlefields.length, 2, "and no second battlefield has opened beside either");
});

test("a scenario without fronts builds nothing, and one whose map cannot be read writes nothing", async () => {
  const map = sheet();
  assert.equal(await buildScenarioFronts({ world: worldOn(map), game, createFrontRun, ...mapOf(map) }), null);
  const unread = await buildScenarioFronts({ world: worldOn(map, { scenarioFronts: [front()] }), game, createFrontRun, ...mapOf(map), loadRegions: async () => null });
  assert.equal(unread.battlefields, null);
});
