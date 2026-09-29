/*! Open Historia — web library store behaviour © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/libraryStore.test.js
//
// The web store holds every save for web and Android players, and until these
// tests nothing ran it: the others read its source as text. It loads here with
// two stand-ins, redirected by a module hook:
// - idb.js becomes an in-memory table per object store. Reads hand back
//   structured clones, as IndexedDB does, and every getAll is logged so a test
//   can see what an action loaded.
// - the web build's generated modules (the seed, the country table, the colour
//   palette) are gitignored build output that a clean checkout does not have, so
//   they are replaced by small fixed ones.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const db = new Map();
const getAllLog = [];
globalThis.__ohWebStoreTestDb = db;
globalThis.__ohWebStoreTestGetAll = getAllLog;

const IDB_STUB = `
export const STORES = {
  scenarios: "scenarios", games: "games", mapeditorDocs: "mapeditorDocs", basemapMeta: "basemapMeta",
  basemapPayload: "basemapPayload", flags: "flags", kv: "kv", scenarioMeta: "scenarioMeta", gameMeta: "gameMeta",
};
const db = globalThis.__ohWebStoreTestDb;
const table = (name) => { if (!db.has(name)) db.set(name, new Map()); return db.get(name); };
const copy = (value) => (value === undefined ? undefined : structuredClone(value));
export const idbGet = async (store, key) => copy(table(store).get(key));
export const idbGetAll = async (store) => { globalThis.__ohWebStoreTestGetAll.push(store); return [...table(store).values()].map(copy); };
export const idbGetAllKeys = async (store) => [...table(store).keys()];
export const idbPut = async (store, value) => { table(store).set(store === "kv" ? value.key : value.id, copy(value)); };
export const idbPutPair = async (storeA, valueA, storeB, valueB) => { await idbPut(storeA, valueA); await idbPut(storeB, valueB); };
export const idbDelete = async (store, key) => { table(store).delete(key); };
export const kvGet = async (key, fallback = null) => { const record = table("kv").get(key); return record ? copy(record.value) : fallback; };
export const kvPut = (key, value) => idbPut("kv", { key, value });
`;

const SEED_WORLD = {
  builtInMap: "test-map",
  builtInRevision: 2,
  ownerSchema: 4,
  polityOverrides: { Testland: { name: "Testland" }, USA: { name: "USA" } },
};
const GENERATED = {
  "countryNames.js": `export default { USA: "United States", RUS: "Russia" };`,
  "defaultScenario.js": `export default ${JSON.stringify({
    meta: { name: "Modern Day" },
    data: {
      actions: [], advisor: [], chat: [], events: [], prompts: {},
      game: { country: "Testland", gameDate: "2016-01-01", startDate: "2016-01-01" },
      world: SEED_WORLD,
    },
    colors: { Testland: [1, 2, 3] },
  })};`,
  // An empty regionsUrl keeps usesBuiltInMap false, so nothing is fetched.
  "defaultScenarioMeta.js": `export const builtInMap = "test-map"; export const builtInRevision = 2; export const regionsUrl = "";`,
  "fallbackColors.js": `export default { Palette: [9, 9, 9] };`,
};
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (String(context.parentURL ?? "").includes("/runtime/web/")) {
      if (specifier === "./idb.js") return { url: moduleUrl(IDB_STUB), shortCircuit: true };
      const generated = /\/generated\/([^/]+)$/.exec(specifier);
      if (generated && GENERATED[generated[1]]) return { url: moduleUrl(GENERATED[generated[1]]), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const store = await import("./libraryStore.js");

const reset = async () => {
  db.clear();
  getAllLog.length = 0;
  await store.ensureSeeded();
};

const call = async (handler, method, path, body) => {
  const segments = path.split("/").filter(Boolean);
  const response = await handler({ method, segments, body, query: new URLSearchParams() });
  assert.ok(response, `${method} ${path} was not handled`);
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
};
const scenarios = (method, path, body) => call(store.handleScenarios, method, path, body);
const games = (method, path, body) => call(store.handleGames, method, path, body);
const runtime = (method, key, body) => call(store.handleRuntimeJson, method, `json/${key}`, body);
const library = async () => (await call(store.handleLibrary, "GET", "")).data;
const ok = (reply) => {
  assert.ok(reply.status < 300, `HTTP ${reply.status}: ${JSON.stringify(reply.data)}`);
  return reply.data;
};

const REGIONS = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { id: "reg_1", edited: true }, geometry: { type: "Point", coordinates: [1, 2] } }],
};
const CITIES = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "Capital" }, geometry: { type: "Point", coordinates: [3, 4] } }],
};
const BACKGROUND = { kind: "image", opacity: 0.5 };

// A bundle in the shape both exporters write today: the geometry as parsed JSON.
const scenarioBundle = (name, extra = {}) => ({
  schema: "pax-historia-scenario-bundle/2",
  version: 2,
  scenario: { id: "hub-map", name },
  data: { game: { country: "Testland" }, world: { ownerSchema: 4, polityOverrides: { Testland: { name: "Testland" } } } },
  assets: {
    regionsGeojson: { contentType: "application/json", data: REGIONS, fileName: "regions.geojson", mode: "embedded" },
    citiesGeojson: { contentType: "application/json", data: CITIES, fileName: "cities.geojson", mode: "embedded" },
    backgroundData: { contentType: "application/json", data: BACKGROUND, fileName: "background.json", mode: "embedded" },
    ...extra,
  },
});

const scenarioAsset = async (id, key) => {
  const response = await store.handleScenarios({ method: "GET", segments: [id, "assets", key], query: new URLSearchParams() });
  return response.status === 200 ? JSON.parse(await response.text()) : null;
};

test("a hub Update keeps the geometry, cities and basemap a current bundle carries as JSON", async () => {
  await reset();
  const imported = ok(await scenarios("POST", "import", scenarioBundle("Hub Map")));
  const id = imported.scenario.id;
  assert.deepEqual(await scenarioAsset(id, "regionsGeojson"), REGIONS);

  const updatedRegions = { ...REGIONS, features: [...REGIONS.features, { ...REGIONS.features[0], properties: { id: "reg_2" } }] };
  const bundle = scenarioBundle("Hub Map v2");
  bundle.assets.regionsGeojson.data = updatedRegions;
  const updated = ok(await scenarios("PUT", `${id}/import`, bundle));

  assert.equal(updated.scenario.name, "Hub Map v2");
  assert.equal(updated.assetStatus.regionsGeojson, true);
  assert.equal(updated.assetStatus.citiesGeojson, true);
  assert.equal(updated.assetStatus.backgroundData, true);
  assert.deepEqual(await scenarioAsset(id, "regionsGeojson"), updatedRegions);
  assert.deepEqual(await scenarioAsset(id, "citiesGeojson"), CITIES);
  assert.deepEqual(await scenarioAsset(id, "backgroundData"), BACKGROUND);
});

test("a hub Update still clears an asset the new bundle leaves out", async () => {
  await reset();
  const id = ok(await scenarios("POST", "import", scenarioBundle("Hub Map"))).scenario.id;
  const bundle = scenarioBundle("Hub Map v2");
  bundle.assets.backgroundData = { fileName: "background.json", mode: "default" };
  const updated = ok(await scenarios("PUT", `${id}/import`, bundle));
  assert.equal(updated.assetStatus.backgroundData, false);
  assert.equal(updated.assetStatus.regionsGeojson, true);
});
