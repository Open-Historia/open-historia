/*! Open Historia — a turn's land war, fought away from the page: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontWorkerCore.test.js
//
// A run fought in the worker is the run fought on the page: given as data,
// asking the page for the map's facts and shapes by name, with the lab's staff
// made again there. Here the "page" is the test, and nothing is sent anywhere:
// what is checked is that what is sent is data the browser can send
// (structuredClone), and that the war that comes back is the same war.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvents } from "../../runtime/gameState.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { labStaffPolicy } from "../../runtime/fronts/mind/trained.js";
import { enlarge, syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { engineRegionsOf, runTurnFronts } from "./frontTurn.js";
import { AWAY_KEYS, awayInputOf, fightAway, pageAnswersOf } from "./frontWorkerCore.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.4, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Mid", lng: 21.7, lat: 50.9 },
];
const sheet = () => syntheticMap({ layout: enlarge(["AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "AAABBBBBBB", "~~~~~~~~~~"], 2), legend, west: 20, north: 52, step: 0.25, cities });
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const worldOn = (map) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: {
    Aland: { code: "Aland", name: "Aland", aliases: [], color: "", note: "" },
    Borduria: { code: "Borduria", name: "Borduria", aliases: [], color: "", note: "" },
  },
  countryStats: { Aland: { population: { total: 2.25e6 } }, Borduria: { population: { total: 1e6 } } },
  wars: [WAR],
  battlefields: [],
  units: [],
});
const events = normalizeEvents([
  { id: "e1", date: "2024-03-04", title: "The first of the war", description: "The fighting goes on along the border.", source: "ai", impacts: {} },
  { id: "e2", date: "2024-03-15", title: "The second of the war", description: "The fighting goes on along the border.", source: "ai", impacts: {} },
]);

// A turn's arguments as frontApply.js gives them: the map read through readMap, its shapes through loadRegions, the
// lab's staff (and the same as data), a pause between slices.
const turnArgs = (map, world) => {
  const asked = { readMap: 0, loadRegions: 0 };
  const staffConfig = { outcomes: [], difficulty: "easy", players: ["Borduria"] };
  return {
    asked,
    args: {
      createFrontRun,
      world,
      events,
      frontOrders: [{ id: "front-0", battlefield: "The Border", side: "Aland", order: "advance", sector: "all", eventIds: ["e1"] }],
      warStages: [world.wars],
      fromDate: "2024-03-01",
      toDate: "2024-03-21",
      readMap: async () => {
        asked.readMap += 1;
        return { map: { key: "the sheet", cities: map.map.cities, flat: false }, baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])), regionIds: map.regions.map((region) => region.id), arenas: new Map() };
      },
      loadRegions: async () => {
        asked.loadRegions += 1;
        return map.regions;
      },
      pause: async () => {},
      tempoAllowance: () => null,
      tempo: 0,
      seed: "campaign|2|2024-03-01",
      players: ["Borduria"],
      staffPolicy: labStaffPolicy(staffConfig),
      staffConfig,
      mechanics: { fatigue: true, weather: true, supply: true },
      climateSeed: "campaign",
    },
  };
};

test("what is sent away is data the browser can send, and nothing of the page's own", () => {
  const map = sheet();
  const { args } = turnArgs(map, worldOn(map));
  const away = awayInputOf(args);
  assert.doesNotThrow(() => structuredClone(away));
  for (const key of ["createFrontRun", "readMap", "loadRegions", "pause", "tempoAllowance", "staffPolicy", "staffConfig"]) assert.equal(key in away, false, key);
  for (const key of AWAY_KEYS) assert.equal(key in away, true, key);
  assert.deepEqual(away.staff, { outcomes: [], difficulty: "easy", players: ["Borduria"] });
  assert.deepEqual([away.readsMap, away.readsRegions, away.tempo], [true, true, 0]);
  // (Whether an event tells of fighting is its own fields', read in the run itself: nothing of the page's is asked for it.)
  assert.equal("narrates" in away, false);
  assert.deepEqual(away.strikes, []);
  // No staff of the lab's: none made again there.
  assert.equal(awayInputOf({ ...args, staffPolicy: null }).staff, null);
});

test("a run fought away is the run fought on the page: the same war, its map's facts and shapes asked of the page", async () => {
  const map = sheet();
  const world = worldOn(map);
  const here = turnArgs(map, world);
  const onPage = await runTurnFronts(here.args);
  const there = turnArgs(map, world);
  const page = pageAnswersOf(there.args);
  const said = [];
  const away = await fightAway(structuredClone(awayInputOf(there.args)), {
    ask: async (name, value) => {
      said.push(name);
      // (Everything the page answers goes across as data too.)
      return structuredClone(await page(name, value));
    },
    pause: async () => {},
  });
  assert.ok(onPage.battlefields?.length > 0);
  assert.deepEqual(said.filter((name, index) => said.indexOf(name) === index).sort(), ["loadRegions", "readMap"]);
  assert.equal(JSON.stringify(away.battlefields), JSON.stringify(onPage.battlefields));
  assert.equal(JSON.stringify(away.events), JSON.stringify(onPage.events));
  assert.equal(JSON.stringify(away.flips), JSON.stringify(onPage.flips));
  // And what comes back can be sent back to the page.
  assert.doesNotThrow(() => structuredClone(away));
  // The page asked for something it does not answer: the run is told so, rather than left waiting.
  await assert.rejects(page("anything else"), /does not answer/);
});

// The map's shapes as the page has them (frontApply.js turnRunInput): its regions file through engineRegionsOf, with
// the names the map gives them, and where that file is. Here a stand-in fetch serves it. (`key` names a map of its own:
// the ground drawn for a map is kept here between runs.)
const FILE_URL = "blob:the-regions-file";
const withRegionsFile = ({ args, asked }, map, key) => {
  const file = { type: "FeatureCollection", features: map.regions.map((region) => ({ type: "Feature", properties: { id: region.id, name: `file ${region.id}` }, geometry: region.geometry })) };
  const names = map.regions.slice(0, 4).map((region) => [region.id, `named ${region.id}`]);
  return {
    file,
    args: {
      ...args,
      readMap: async () => {
        const read = await args.readMap();
        return { ...read, map: { ...read.map, key } };
      },
      loadRegions: async () => {
        asked.loadRegions += 1;
        return engineRegionsOf(structuredClone(file), { nameOf: (id) => new Map(names).get(id) });
      },
      regionsFile: async () => ({ url: FILE_URL, names }),
    },
  };
};
const serving = (file, { ok = true } = {}) => {
  const fetched = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return ok ? new Response(JSON.stringify(file)) : new Response("", { status: 500 });
  };
  return { fetched, restore: () => { globalThis.fetch = before; } };
};
const fightThere = async (args) => {
  const page = pageAnswersOf(args);
  const said = [];
  const result = await fightAway(structuredClone(awayInputOf(args)), {
    ask: async (name, value) => {
      said.push(name);
      return structuredClone(await page(name, value));
    },
    pause: async () => {},
  });
  return { result, said: said.filter((name, index) => said.indexOf(name) === index).sort() };
};

test("a run fought away reads the map's shapes from their file itself, and they are the shapes the page would give", async () => {
  const map = sheet();
  const world = worldOn(map);
  const here = turnArgs(map, world);
  const onPage = await runTurnFronts(withRegionsFile(here, map, "read away").args);
  assert.equal(here.asked.loadRegions, 1);
  const there = turnArgs(map, world);
  const { args, file } = withRegionsFile(there, map, "read away");
  assert.equal(awayInputOf(args).findsRegionsFile, true);
  const served = serving(file);
  try {
    const { result, said } = await fightThere(args);
    assert.deepEqual(said, ["readMap", "regionsFile"]);
    assert.equal(there.asked.loadRegions, 0, "the page never read the shapes");
    assert.deepEqual(served.fetched, [FILE_URL]);
    assert.ok(onPage.battlefields?.length > 0);
    assert.equal(JSON.stringify(result.battlefields), JSON.stringify(onPage.battlefields));
    assert.equal(JSON.stringify(result.events), JSON.stringify(onPage.events));
    assert.equal(JSON.stringify(result.flips), JSON.stringify(onPage.flips));
  } finally {
    served.restore();
  }
});

test("a file that cannot be read away from the page has the page read the shapes, as before", async () => {
  const map = sheet();
  const world = worldOn(map);
  const onPage = await runTurnFronts(withRegionsFile(turnArgs(map, world), map, "read on the page").args);
  const there = turnArgs(map, world);
  const { args, file } = withRegionsFile(there, map, "read on the page");
  const served = serving(file, { ok: false });
  try {
    const { result, said } = await fightThere(args);
    assert.deepEqual(said, ["loadRegions", "readMap", "regionsFile"]);
    assert.equal(there.asked.loadRegions, 1);
    assert.equal(JSON.stringify(result.battlefields), JSON.stringify(onPage.battlefields));
  } finally {
    served.restore();
  }
});
