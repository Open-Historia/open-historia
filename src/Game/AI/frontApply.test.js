/*! Open Historia — the game's side of the front engine, and its switch: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontApply.test.js
//
// Needs node_modules: frontApply.js reaches assets.js, which imports maplibre-gl.
//
// Fronts are a feature a scenario can switch off (server/gameFeatures.js). This
// is what the switch does: off, nothing of the battlefields runs, is read or is
// said, and a game is what it was before there were any; on, the turn's land
// war goes through the engine. gameplay.js cannot be loaded under plain node,
// so where it calls these is read as text, the way the other guards read it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FEATURE_DEFINITIONS, featureDefaults, normalizeFeatureSettings } from "../../../server/gameFeatures.js";
import { createApplicationReceipt } from "../../runtime/applicationReceipt.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { setActiveFeatures } from "../../runtime/gameFeatures.js";
import { normalizeEvents } from "../../runtime/gameState.js";
import { applyTurnFronts, forecastTurnFronts, frontPowers, frontRegionTest, frontsLiveBlock, withFrontUnits, withoutFrontPowers } from "./frontApply.js";
import { airOn, frontsOn, frontsPace, naviesOn, unitsOffBattlefields } from "./frontsGate.js";
import { FRONT_MARK } from "./frontTurn.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const gameplay = read("gameplay.js");
const functionBody = (name) => {
  const start = gameplay.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} is gone from gameplay.js; this guard needs updating`);
  return gameplay.slice(start, gameplay.indexOf("\n};", start) + 3);
};

const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = syntheticMap({ layout: enlarge(["AAABBB", "AAABBB", "AAABBB", "AAABBB", "~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities: [] });
const geojson = { features: sheet.regions.map((region) => ({ properties: { id: region.id, name: region.name }, geometry: region.geometry })) };
const world = (extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(sheet.regions.map((region) => [region.id, sheet.controllerOf(region.id)])),
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01" }],
  battlefields: [],
  units: [],
  ...extra,
});
const turnEvents = () => normalizeEvents([
  { id: "e1", date: "2024-03-04", title: "The offensive opens", description: "x", impacts: {} },
  { id: "e2", date: "2024-03-12", title: "The line gives", description: "x", impacts: {} },
]);
const game = { country: "Neutralia", gameDate: "2024-03-01", round: 1 };
const applyArgs = (extra = {}) => ({
  baseGame: game,
  baseWorld: world(),
  campaignId: "campaign",
  events: turnEvents(),
  frontOrders: [
    { id: "front-0", battlefield: "The Border", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] },
    { id: "front-1", battlefield: "The Somme", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] },
  ],
  loadRegions: async () => geojson,
  nextGame: { ...game, gameDate: "2024-03-16", round: 2 },
  receipt: createApplicationReceipt(),
  warUpdates: [],
  ...extra,
});
// The map's catalog and its cities cannot be read under plain node; what the
// game says of that is not this test's to print.
const quietly = async (work) => {
  const { warn, info } = console;
  console.warn = () => {};
  console.info = () => {};
  try {
    return await work();
  } finally {
    console.warn = warn;
    console.info = info;
  }
};

test("the Wars feature is listed, always on, with Fronts, Air units and Navies switches and a pace from 25 to 300", () => {
  const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === "fronts");
  assert.ok(definition, "server/gameFeatures.js lists it");
  assert.equal(definition.label, "Wars");
  assert.equal(definition.toggleable, false, "its parts have the switches");
  const fronts = definition.settings.find((setting) => setting.key === "battlefields");
  assert.equal(fronts.label, "Fronts");
  assert.match(fronts.description, /^Land war fought on battlefields./);
  assert.match(fronts.description, / Off: no battlefield opens, /, "it says what switching it off does");
  assert.deepEqual(definition.settings.map(({ key, type, min, max, defaultValue }) => [key, type ?? "number", min, max, defaultValue]), [
    ["battlefields", "toggle", undefined, undefined, true],
    ["air", "toggle", undefined, undefined, true],
    ["navies", "toggle", undefined, undefined, true],
    ["pace", "number", 25, 300, 100],
  ]);
  const all = { enabled: true, battlefields: true, air: true, navies: true, pace: 100 };
  assert.deepEqual(featureDefaults().fronts, all);
  // A scenario saved before the feature existed has it on.
  assert.deepEqual(normalizeFeatureSettings({ espionage: false }).fronts, all);
  // One saved with fronts off, before the parts had switches, has its battlefields off and nothing else.
  assert.deepEqual(normalizeFeatureSettings({ fronts: { enabled: false, pace: 1000 } }).fronts, { ...all, battlefields: false, pace: 300 });
  assert.deepEqual(normalizeFeatureSettings({ fronts: { pace: 3 } }).fronts, { ...all, pace: 25 });
  assert.deepEqual(normalizeFeatureSettings({ fronts: { air: "off", navies: false } }).fronts, { ...all, air: false, navies: false });

  assert.equal(frontsOn(), true, "and a game that says nothing plays with it");
  assert.equal(frontsPace(), 0.4, "the built-in pace of a front: four tenths of a formation's on the move");
  try {
    setActiveFeatures({ fronts: { pace: 250 } }, null);
    assert.equal(frontsPace(), 1);
    setActiveFeatures({ fronts: { pace: 250 } }, { fronts: { pace: 25 } });
    assert.equal(frontsPace(), 0.1, "a game's own setting over its scenario's");
    setActiveFeatures({ fronts: { enabled: false } }, null);
    assert.equal(frontsOn(), false);
    setActiveFeatures({ fronts: { enabled: false } }, { fronts: { enabled: true } });
    assert.equal(frontsOn(), true);
    // Each part its own: air units and navies off leave the battlefields on.
    setActiveFeatures({ fronts: { air: false, navies: false } }, null);
    assert.deepEqual([frontsOn(), airOn(), naviesOn()], [true, false, false]);
    setActiveFeatures({ fronts: { air: false } }, { fronts: { air: true, battlefields: false } });
    assert.deepEqual([frontsOn(), airOn(), naviesOn()], [false, true, true], "a game's own over its scenario's");
  } finally {
    setActiveFeatures(null, null);
  }
});

test("with fronts off nothing runs, nothing is read and nothing is said", async () => {
  const refuse = () => { throw new Error("nothing is read with fronts off"); };
  const record = { name: "The Border", warId: "war-1", status: "active", sides: [["Aland"], ["Borduria"]], openedDate: "2024-03-01", asOf: "2024-03-09", frame: { lng0: 20, lat0: 50, cell: 0.1, cols: 30, rows: 20, km: 8 } };
  const units = [{ id: "u1", name: "1st Army", ownerCode: "Aland", committedTo: "The Border" }, { id: "u2", name: "Home Fleet", ownerCode: "Aland" }];
  const before = world({ battlefields: [record], units });
  const events = normalizeEvents([{ id: "e1", date: "2024-03-04", title: "x", description: "x", impacts: { regionControlOps: [{ op: "control", regionId: "r6-2", fromCode: "Borduria", toCode: "Aland", by: FRONT_MARK }] } }]);
  const missing = [{ power: "Aland", warId: "war-1", events: [] }];
  try {
    setActiveFeatures({ fronts: { enabled: false } }, null);
    assert.equal(frontsOn(), false);
    assert.equal(await applyTurnFronts(applyArgs({ baseWorld: before, events, loadRegions: refuse })), null, "the turn is not touched");
    assert.equal(events[0].impacts.regionControlOps.length, 1);
    assert.equal(withFrontUnits(before, null), before, "the world is the object it was");
    assert.equal(frontsLiveBlock(before, game), "", "no [Fronts] block");
    assert.deepEqual(frontPowers(before), [], "nobody is fielded by a battlefield");
    assert.equal(withoutFrontPowers(missing, before), missing);
    assert.equal(await frontRegionTest(before), null, "the territory Director is handed no test");
    assert.equal(unitsOffBattlefields(units), units, "the unit list is the whole list");
  } finally {
    setActiveFeatures(null, null);
  }
  // On, the same world: the block, the powers, the list.
  assert.ok(frontsLiveBlock(before, game).startsWith("[Fronts]\n"));
  assert.match(frontsLiveBlock(before, game), /\nNeutralia is played by a person: /);
  assert.match(frontsLiveBlock(before, game), /\nBattlefields open now:\n- The Border: Aland against Borduria/);
  assert.deepEqual(frontPowers(before), ["Aland", "Borduria"]);
  assert.deepEqual(withoutFrontPowers([...missing, { power: "Cisland" }], before), [{ power: "Cisland" }]);
  assert.deepEqual(unitsOffBattlefields(units).map((unit) => unit.id), ["u2"]);
  const free = units.slice(1);
  assert.equal(unitsOffBattlefields(free), free, "a list with nothing on a battlefield is the list it was");
});

test("with fronts on a turn's land war goes through the engine, and what it could not do is on the receipt", async () => {
  const args = applyArgs();
  const run = await quietly(() => applyTurnFronts(args));
  assert.deepEqual(run.battlefields.map((record) => [record.name, record.status, record.sides]), [["The Border", "active", [["Aland"], ["Borduria"]]]]);
  assert.ok(run.flips.length > 0);
  assert.equal(run.events.flatMap((entry) => entry.impacts.regionControlOps).every((op) => op.by === FRONT_MARK), true);
  assert.equal(run.stats.days, 15);
  assert.deepEqual(args.receipt.notes.map((note) => note.kind), ["dropped"]);
  assert.match(args.receipt.notes[0].text, /^Front orders named a battlefield that does not exist \(The Somme\)\./);
  assert.equal(args.events.every((entry) => entry.impacts.regionControlOps.length === 0), true, "the events handed in are not written to");

  // The same turn again is the same turn (a held turn retried on the same arguments).
  const again = await quietly(() => applyTurnFronts(applyArgs({ events: args.events })));
  assert.equal(JSON.stringify(again), JSON.stringify(run));
  // And again from the events as they were applied, the first run's operations on them.
  const replayed = await quietly(() => applyTurnFronts(applyArgs({ events: run.events })));
  assert.equal(JSON.stringify(replayed), JSON.stringify(run));

  // The map could not be read at all: the turn goes on, and the battlefields stand.
  const blind = await quietly(() => applyTurnFronts(applyArgs({ loadRegions: async () => null })));
  assert.equal(blind.battlefields, null);
  assert.deepEqual(blind.flips, []);
  // The engine failing is not the turn failing.
  const broken = await quietly(() => applyTurnFronts(applyArgs({ loadRegions: async () => { throw new Error("the file is damaged"); } })));
  assert.equal(broken.battlefields, null);
  assert.equal(broken.events.length, 2);
  // The player's Cancel is.
  const cancelled = new AbortController();
  cancelled.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  await assert.rejects(quietly(() => applyTurnFronts(applyArgs({ nextGame: { ...game, gameDate: "2024-05-30", round: 2 }, signal: cancelled.signal }))), { name: "AbortError" });
});

test("the period is fought before its story is asked for: what is foreseen is what is then applied, and it is worked out once", async () => {
  // A war a fortnight old, Aland advancing.
  const first = await quietly(() => applyTurnFronts(applyArgs({ frontOrders: [{ id: "front-0", battlefield: "The Border", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] }] })));
  const overrides = { ...world().regionOwnershipOverrides };
  for (const flip of first.flips) if (flip.kind === "control") overrides[flip.regionId] = flip.to;
  const next = world({ battlefields: first.battlefields, regionOwnershipOverrides: overrides });
  const later = { ...game, gameDate: "2024-03-16", round: 2 };
  let reads = 0;
  const asked = { world: next, game: later, campaignId: "campaign", toDate: "2024-03-21", requestedDays: 5, loadRegions: async () => { reads += 1; return geojson; } };

  const foreseen = await quietly(() => forecastTurnFronts(asked));
  assert.deepEqual([foreseen.fromDate, foreseen.toDate, foreseen.days], ["2024-03-16", "2024-03-21", 5]);
  assert.deepEqual(foreseen.battlefields.map((record) => record.name), ["The Border"]);
  assert.equal(foreseen.battlefields[0].asOf, "2024-03-21");
  assert.equal(next.battlefields[0].asOf, "2024-03-16", "the world it was given is not written to");
  // Asked again for the same turn (a request retried, the next model on the list): it is not fought again.
  const readsThen = reads;
  assert.equal(await quietly(() => forecastTurnFronts(asked)), foreseen);
  assert.equal(reads, readsThen);
  // The block is then the period as it leaves the battlefield.
  const block = frontsLiveBlock(next, later, foreseen);
  assert.match(block, /It has ALREADY fought this period on every battlefield told in full below/);
  assert.match(block, /\nBattlefields, as the period from 2024-03-16 to 2024-03-21 leaves them:\n- The Border: Aland against Borduria/);

  // The answer then tells it and gives Borduria an order from its first event:
  // the turn applied is the five days that were foreseen, and the order stands after them.
  const applied = await quietly(() => applyTurnFronts(applyArgs({
    baseGame: later,
    baseWorld: next,
    nextGame: { ...later, gameDate: "2024-03-21", round: 3 },
    events: normalizeEvents([{ id: "g1", date: "2024-03-17", title: "The line is told to stand", description: "x", impacts: {} }]),
    frontOrders: [{ id: "front-5", battlefield: "The Border", side: "Borduria", order: "dig in", sector: "all", eventIds: ["g1"] }],
    foretold: true,
  })));
  assert.deepEqual(applied.flips, foreseen.flips);
  assert.deepEqual(applied.news, foreseen.news);
  assert.deepEqual(applied.battlefields[0].orders.map(({ s, order }) => [s, order]), [[0, "advance"], [1, "dig in"]]);

  // Nothing is foreseen where there is nothing to fight, no whole day to run, or fronts are off.
  assert.equal(await forecastTurnFronts({ ...asked, world: world() }), null, "no battlefield yet");
  assert.equal(await quietly(() => forecastTurnFronts({ ...asked, toDate: "2024-03-16", requestedDays: 0.25 })), null, "a skip of hours");
  try {
    setActiveFeatures({ fronts: { enabled: false } }, null);
    assert.equal(await forecastTurnFronts({ ...asked, loadRegions: () => { throw new Error("nothing is read with fronts off"); } }), null);
  } finally {
    setActiveFeatures(null, null);
  }
  // The player's Cancel stops it.
  const cancelled = new AbortController();
  cancelled.abort(new DOMException("Timeline jump cancelled.", "AbortError"));
  await assert.rejects(quietly(() => forecastTurnFronts({ ...asked, toDate: "2024-05-30", requestedDays: 75, signal: cancelled.signal })), { name: "AbortError" });

  // How the war is fought is part of the period (Wars and Fronts Pt.2): the
  // scenario's rules for its wars, its fortified lines, a country's military
  // figures changed, the period is fought again, and that one is then kept.
  const base = await quietly(() => forecastTurnFronts(asked));
  assert.equal(await quietly(() => forecastTurnFronts(asked)), base);
  for (const [what, changed] of [
    ["the scenario's rules for its wars", { ...next, warSettings: { mechanics: { weather: false } } }],
    ["a fortified line", { ...next, fortifications: [{ id: "line-1", name: "The Line", owner: "Borduria", level: 5, points: [[21.2, 51.6], [21.2, 50.6]] }] }],
    ["a country's military figures", { ...next, countryStats: { ...next.countryStats, Borduria: { ...next.countryStats.Borduria, military: { quality: 80 } } } }],
    ["what the scenario's author gave a country", { ...next, polityOverrides: { Aland: { military: { technology: 30 } } } }],
  ]) {
    const refought = await quietly(() => forecastTurnFronts({ ...asked, world: changed }));
    assert.notEqual(refought, base, `${what}: fought again`);
    assert.equal(await quietly(() => forecastTurnFronts({ ...asked, world: changed })), refought, `${what}: and kept`);
  }
});

test("the formations a run took in, or gave back, are written with the standing orders a committed one no longer has", () => {
  const before = {
    units: [
      { id: "u1", name: "1st Army", ownerCode: "Aland", strength: 90, lng: 21, lat: 51 },
      { id: "u2", name: "2nd Army", ownerCode: "Aland", strength: 80, lng: 21, lat: 50.5, committedTo: "The Border" },
      { id: "u3", name: "Home Fleet", ownerCode: "Aland", strength: 70, lng: 20, lat: 49.9 },
    ],
    pendingUnitOrders: [{ id: "o1", unitId: "u1", kind: "move" }, { id: "o2", unitId: "u2", kind: "move" }, { id: "o3", unitId: "u3", kind: "patrol" }],
  };
  const after = withFrontUnits(before, { unitChanges: [{ unitId: "u1", committedTo: "The Border" }, { unitId: "u2", committedTo: "", lng: 21.4, lat: 50.6, strength: 55 }] });
  assert.deepEqual(after.units.map((unit) => [unit.id, unit.committedTo ?? "", unit.lng, unit.strength]), [["u1", "The Border", 21, 90], ["u2", "", 21.4, 55], ["u3", "", 20, 70]]);
  assert.deepEqual(after.pendingUnitOrders.map((order) => order.id), ["o2", "o3"], "the one that went onto the battlefield keeps no order of its own");
  assert.equal(withFrontUnits(before, { unitChanges: [] }), before);
  assert.equal(withFrontUnits(before, null), before);
});

// ---- where gameplay.js calls it, read as text --------------------------------------

test("the engine runs after the events are tallied and before they are applied, and its battlefields and formations are written with the turn", () => {
  const apply = functionBody("applySimulationResult");
  const tally = apply.indexOf("tallyAppliedEvents(receipt, freshEvents);");
  const run = apply.indexOf("const turnFronts = await applyTurnFronts({");
  const put = apply.indexOf("if (turnFronts) freshEvents.splice(0, freshEvents.length, ...turnFronts.events);");
  const impacts = apply.indexOf("const impactMerge = applyEventImpactsToWorld({");
  const written = apply.indexOf("...(turnFronts?.battlefields ? { battlefields: turnFronts.battlefields } : null),");
  const units = apply.indexOf("impactedWorld = withFrontUnits(impactedWorld, turnFronts);");
  const orders = apply.indexOf("confirmResolvedDeployments(advanceStandingOrders(");
  const caps = apply.indexOf("let worldWithImpacts = enforceUnitVolume(");
  const wars = apply.indexOf("const warMerge = applyWarUpdates({");
  for (const [name, at] of Object.entries({ tally, run, put, impacts, written, units, orders, caps, wars })) assert.ok(at > 0, `${name} is gone`);
  assert.ok(tally < run && run < put && put < impacts, "after the tally, before the impacts");
  assert.ok(impacts < written && written < apply.indexOf("activeInteractive: null,", impacts), "the battlefields go into the world the events are applied to, so a rename re-keys them");
  assert.ok(impacts < units && units < caps && units < orders, "the formations before the standing orders advance and before the caps");
  assert.ok(run < wars, "the engine is told the wars from the turn's own records, before the ledger's merge");
  // What it is handed: the turn's own orders and war records, as they survived the screens.
  const call = apply.slice(run, put);
  for (const argument of ["baseGame,", "baseWorld,", "campaignId,", "events: freshEvents,", "frontOrders,", "loadRegions: createRenderedRegionsReader(),", "nextGame,", "receipt,", "requestedDays: result.requestedDays,", "signal: projects?.signal,", "warUpdates,"]) {
    assert.ok(call.includes(argument), `applyTurnFronts is handed ${argument}`);
  }
  // The receipt is copied into the world when the events are applied, so the
  // engine's notes have to be on it by then: they are written inside the call.
  assert.match(read("frontApply.js"), /for \(const note of run\.notes\) noteReceipt\(receipt, note\.kind, note\.text\);/);
  // And the journal a round is stopped from carries the orders the run was made from.
  assert.match(apply, /journalTurn\(\{[^}]*\bfrontOrders,/);
  assert.match(functionBody("finishTimelineJump"), /\brequestedDays: context\.safeDays,/);
});

test("every other place that applies events is one the engine has no part in", () => {
  // A new caller has to be thought about: whether game days pass through it
  // (then the engine must run, as in applySimulationResult), or whether it only
  // replays events that already carry the engine's operations, or passes no time.
  const root = path.join(here, "..", "..");
  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) {
        const count = fs.readFileSync(full, "utf8").split("applyEventImpactsToWorld(").length - 1;
        if (count) callers.push(`${path.relative(root, full).split(path.sep).join("/")}:${count}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(callers.sort(), [
    // The Projects board's operations, an event at a time: no time passes.
    "Game/AI/boardPassApply.js:1",
    // applySimulationResult (the engine runs before it; a round stopped by
    // Intervene, a held turn and a kept one all come through it again), the
    // Game Master's Apply (no time passes: what it changes on a battlefield the
    // engine takes up at its next run) and the idle pulse (no time passes).
    "Game/AI/gameplay.js:3",
    // A peace made on terms (makePeace): the ground the two sides hold of each
    // other's is ceded or handed back. No time passes; the war it ends is
    // closed on its battlefields by the engine at its next run.
    "Game/AI/warAndPeace.js:1",
    // The Game Master's tools: no time passes.
    "Game/GameUI/cheats.jsx:4",
    // The reveal of a turn: the first events of a turn already applied, on its
    // restore point. They carry the engine's operations.
    "Game/GameUI/time.jsx:2",
    // The world as seen while a turn is revealed: the same replay as the reveal's.
    "runtime/gameState.js:1",
  ]);
  // The Game Master's Apply and the idle pulse pass no game time.
  const gmAt = gameplay.indexOf("export const applyGameMasterPreview = async");
  assert.match(gameplay.slice(gameplay.lastIndexOf("\n\n", gmAt), gmAt), /There is no AI call, no turn\s*\n\/\/ simulation, no date advance and no round increment\./);
  const gmApply = gameplay.slice(gameplay.indexOf("const impactMerge = applyEventImpactsToWorld({", gmAt));
  assert.equal(gmApply.slice(0, gmApply.indexOf("});")).includes("motion"), false, "its events are applied where they stand, with no days between them");
  assert.match(functionBody("applyIdlePulseUnitOps"), /\/\/ fromDate === toDate, so no unit travels/);
  // A long skip's segments are joined before anything is applied: one apply, one run.
  assert.equal(gameplay.split("await applySimulationResult(").length - 1 + gameplay.split("=> applySimulationResult(").length - 1, 5, "the skip, a kept skip, a held board, Intervene and a Scene");
});

test("a time skip's prompt gains the block only with fronts on, after the rules it sets aside", () => {
  const live = functionBody("buildJumpLiveState");
  assert.match(live, /const fronts = frontsLiveBlock\(world, game, variables\.frontsForecast \?\? null\);\s*\n\s*if \(fronts\) blocks\.push\(fronts\);/);
  assert.ok(live.indexOf("blocks.push(FOLDED_SKIP_CONSEQUENCES)") < live.indexOf("frontsLiveBlock(world, game"), "after [Every Event Carries Its Consequences]");
  assert.ok(live.indexOf("[Units and Structures on the Map]") < live.indexOf("frontsLiveBlock(world, game"));
  // (The land's block and then the sea's, navalPrompt.js: each "" with fronts off.)
  assert.ok(read("frontApply.js").includes("export const frontsLiveBlock = (world, game, foreseen = null) => [landBlock(world, game, foreseen), seasLiveBlock(world, game, foreseen)].filter(Boolean).join(\"\\n\\n\");"));
  // (The sea's also "" with navies off: the Wars feature.)
  assert.match(read("frontApply.js"), /export const seasLiveBlock = \(world, game, foreseen = null\) => \(frontsOn\(\) && naviesOn\(\)\s*\n\s*\? buildSeasBlock\(/);
  assert.match(read("frontApply.js"), /const landBlock = \(world, game, foreseen = null\) => \(frontsOn\(\)\s*\n\s*\? buildFrontsBlock\(\{ battlefields: world\?\.battlefields, players: humanCountriesOf\(game\), period: foreseen, transports: world\?\.transports, difficulty: normalizeDifficulty\(game\?\.difficulty\), orderFunction: foreseen\?\.orderFunction === true \}\)\s*\n\s*: ""\);/);
  // The contract carries the field under the same switch.
  assert.match(gameplay, /return frontsOn\(\) \? withFrontOrders\(shown\) : shown;/);
  // A side of a battlefield is not "at war with nobody on the map"; with fronts off the set is the units' owners alone.
  assert.match(functionBody("describeWarsWithoutFormations"), /const fielded = new Set\(\[\.\.\.normalizeArray\(world\?\.units\)\.map\(\(unit\) => unit\?\.ownerCode\), \.\.\.frontPowers\(world\)\]\.map\(fold\)\.filter\(Boolean\)\);/);
  assert.match(read("frontApply.js"), /export const frontPowers = \(world\) => \(frontsOn\(\) \? battlefieldPowers\(world\?\.battlefields\) : \[\]\);/);
  // The list of units a task that moves them reads.
  const context = read("promptContext.js");
  assert.match(context, /const UNIT_MOVING_TASKS = new Set\(\["jumpForward", "autoJumpForward", "idleDiplomacy"\]\);/);
  assert.match(context, /const listedUnits = UNIT_MOVING_TASKS\.has\(taskKey\) \? unitsOffBattlefields\(bundle\.world\?\.units\) : bundle\.world\?\.units;/);
});

test("the old stand-ins are handed the battlefields to keep clear of", () => {
  assert.match(functionBody("raiseMissingCombatants"), /const missing = withoutFrontPowers\(missingCombatantSpawns\(input, answer\.payload\), bundle\?\.world\);/);
  assert.equal(gameplay.split("battlefieldRegions: () => frontRegionTest(bundle.world),").length - 1, 2, "a time skip's Directors and a Scene's");
  const consequences = read("mapConsequences.js");
  assert.match(consequences, /directGeneratedTerritoryOps\(\{ events: current, world, findPlaces, signal, battlefieldRegions, analyzeBatch: asking\(analyze\.territory\) \}\)/);
});
