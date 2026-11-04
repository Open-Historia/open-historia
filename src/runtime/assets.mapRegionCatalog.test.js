// Run: node --test src/runtime/assets.mapRegionCatalog.test.js
// While a game opens, its map's border worker reads the regions file and hands its catalog over. A catalog asked
// for meanwhile used to read the same 50 MB on the page as well, holding it for over a second as the game opened.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = Object.assign(new EventTarget(), { location: new URL("http://localhost/") });
globalThis.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => false }) };

const { JSON_URLS, loadScenarioRegionCatalog, primeCustomRegionCatalogEntries } = await import("./assets.js");
const { announceGameOpening, markPolitiesReady, mapIsOpening, setReadinessGame } = await import("./mapReadiness.js");

const FILE = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { id: "reg_a", name: "From the file", owner: "Aland" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
};
const MAP_RECORDS = [{ id: "reg_a", name: "From the map", owner: "Aland", country: "", lng: 0.5, lat: 0.5 }];

let reads = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url?.url ?? url).includes("regionsGeojson")) {
    reads += 1;
    return new Response(JSON.stringify(FILE), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url);
};
window.fetch = globalThis.fetch;
let opened = 0;
const openGame = () => {
  opened += 1;
  const game = `game-${opened}`;
  setReadinessGame(game);
  JSON_URLS.regionsGeojson = `/api/runtime/json/regionsGeojson?v=${game}`;
  announceGameOpening(game);
  reads = 0;
};
const later = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test("while a game opens, the catalog waits for the map's copy and never reads the file", async () => {
  openGame();
  assert.equal(mapIsOpening(), true);
  let answer = null;
  const asked = loadScenarioRegionCatalog().then((rows) => { answer = rows; });
  await later(30);
  assert.equal(answer, null, "it waits");
  primeCustomRegionCatalogEntries(MAP_RECORDS, { url: JSON_URLS.regionsGeojson, invalidateCatalog: false });
  await asked;
  assert.equal(answer[0].name, "From the map");
  assert.equal(reads, 0);
});

// (Under Node the file read itself cannot run: it needs the build's import.meta.env. What these show is that
// the catalog stops waiting and goes to the file, as it always did.)
test("a map that gives up on its borders lets the catalog read the file after all", async () => {
  openGame();
  let answer = null;
  const asked = loadScenarioRegionCatalog().then((rows) => { answer = rows; });
  await later(30);
  assert.equal(answer, null);
  markPolitiesReady(JSON_URLS.regionsGeojson, { failed: true });
  await asked;
  assert.deepEqual(answer, [], "it went to the file instead of waiting on");
});

test("with no game opening, the catalog goes to the file at once, as before", async () => {
  openGame();
  markPolitiesReady(JSON_URLS.regionsGeojson);
  assert.equal(mapIsOpening(), false);
  const started = Date.now();
  assert.deepEqual(await loadScenarioRegionCatalog(), []);
  assert.ok(Date.now() - started < 1000, "nothing was waited for");
});

test("the general catalog waits for the map's copy too", () => {
  const source = readFileSync(new URL("./assets.js", import.meta.url), "utf8");
  assert.match(source, /export const loadRegionCatalog = [\s\S]*?const fromMap = await mapRegionCatalogSoon\(JSON_URLS\.regionsGeojson\);/);
});

test("a catalog the map primed for another game is not handed out for this one", async () => {
  openGame();
  primeCustomRegionCatalogEntries(MAP_RECORDS, { url: "/api/runtime/json/regionsGeojson?v=elsewhere", invalidateCatalog: false });
  let answer = null;
  const asked = loadScenarioRegionCatalog().then((rows) => { answer = rows; });
  await later(30);
  assert.equal(answer, null);
  primeCustomRegionCatalogEntries(MAP_RECORDS, { url: JSON_URLS.regionsGeojson, invalidateCatalog: false });
  await asked;
  assert.equal(answer[0].name, "From the map");
  assert.equal(reads, 0);
});
