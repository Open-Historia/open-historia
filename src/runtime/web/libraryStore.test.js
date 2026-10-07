/*! Open Historia — web library store behaviour © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/libraryStore.test.js
//
// The web store holds every save for web and Android players, and until this
// test nothing ran it: the others read its source as text. It loads here with
// two stand-ins, redirected by a module hook:
// - idb.js becomes an in-memory table per object store. Reads hand back
//   structured clones, as IndexedDB does.
// - the web build's generated modules (the seed, the country table, the colour
//   palette) are gitignored build output that a clean checkout does not have, so
//   they are replaced by small fixed ones.
// The store also reads Vite's import.meta.env, which node does not have: the
// same hook hands it an empty one, so it takes its defaults.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const db = new Map();
globalThis.__ohWebStoreTestDb = db;
globalThis.__ohWebStoreTestEnv = {};

const IDB_STUB = `
export const STORES = {
  scenarios: "scenarios", games: "games", mapeditorDocs: "mapeditorDocs", basemapMeta: "basemapMeta",
  basemapPayload: "basemapPayload", flags: "flags", kv: "kv", scenarioMeta: "scenarioMeta", gameMeta: "gameMeta",
};
const db = globalThis.__ohWebStoreTestDb;
const table = (name) => { if (!db.has(name)) db.set(name, new Map()); return db.get(name); };
const copy = (value) => (value === undefined ? undefined : structuredClone(value));
export const idbGet = async (store, key) => copy(table(store).get(key));
export const idbGetAll = async (store) => [...table(store).values()].map(copy);
export const idbGetAllKeys = async (store) => [...table(store).keys()];
export const idbPut = async (store, value) => { table(store).set(store === "kv" ? value.key : value.id, copy(value)); };
export const idbPutPair = async (storeA, valueA, storeB, valueB) => { await idbPut(storeA, valueA); await idbPut(storeB, valueB); };
export const idbDelete = async (store, key) => { table(store).delete(key); };
export const kvGet = async (key, fallback = null) => { const record = table("kv").get(key); return record ? copy(record.value) : fallback; };
export const kvPut = (key, value) => idbPut("kv", { key, value });
export const kvUpdate = async (key, updater, fallback = null) => {
  const record = table("kv").get(key);
  const next = updater(record ? copy(record.value) : fallback);
  await kvPut(key, next);
  return next;
};
export const idbUpdate = async (store, key, updater) => {
  const next = updater(copy(table(store).get(key)));
  if (next === undefined) { table(store).delete(key); return null; }
  await idbPut(store, next);
  return next;
};
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
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/runtime/web/libraryStore.js")) return loaded;
    return { ...loaded, source: String(loaded.source).replaceAll("import.meta.env", "globalThis.__ohWebStoreTestEnv") };
  },
});

const store = await import("./libraryStore.js");

const reset = async () => {
  db.clear();
  await store.ensureSeeded();
};

const scenarios = async (method, path, body) => {
  const segments = path.split("/").filter(Boolean);
  const response = await store.handleScenarios({ method, segments, body, query: new URLSearchParams() });
  assert.ok(response, `${method} ${path} was not handled`);
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
};
const libraryCatalog = async () => JSON.parse(await (await store.handleLibrary({ method: "GET" })).text());
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
  schema: "open-historia-scenario-bundle/2",
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
  try {
    const response = await store.handleScenarios({ method: "GET", segments: [id, "assets", key], query: new URLSearchParams() });
    return response.status === 200 ? JSON.parse(await response.text()) : null;
  } catch {
    return null;
  }
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
  assert.equal(await scenarioAsset(id, "backgroundData"), null);
});

const HUB_FILE = (version) => `https://github.com/user-attachments/files/${version}/hub-map.zip`;
const HUB_RELEASE = (version) => `https://github.com/Open-Historia/Open-historia-scenarios/releases/download/scenarios-1/p42-${version}-hub-map-0a1b2c3d.zip`;
// A link as it was made when the game still downloaded the post's own
// attachment, which is what every older save holds: it names no release.
const hubBundle = (name, version = 1) => ({ ...scenarioBundle(name), hubOrigin: { postId: 42, bundleUrl: HUB_FILE(version) } });
const checkedBundle = (name, version) => ({ ...scenarioBundle(name), hubOrigin: { postId: 42, bundleUrl: HUB_FILE(version), release: HUB_RELEASE(version) } });
const PUBLISH_KEY = "oh-3f2a9c1e5d7b9a01";

test("a link keeps the checked copy it was downloaded from, and an Update gives an old link one", async () => {
  await reset();
  const id = ok(await scenarios("POST", "import", hubBundle("Hub Map"))).scenario.id;
  assert.equal(ok(await scenarios("GET", id)).scenario.hubOrigin.release, undefined, "an old link names no checked copy");
  const edited = ok(await scenarios("PUT", id, { name: "My Hub Map" })).scenario;
  assert.ok(edited.hubOrigin.editedAt);
  assert.equal(edited.hubOrigin.release, undefined);

  // The Update its card asks for: the hub's checked file replaces the copy,
  // the player's changes with it, and the link says which copy it was.
  const updated = ok(await scenarios("PUT", `${id}/import`, checkedBundle("Hub Map", 1))).scenario;
  assert.equal(updated.name, "Hub Map");
  assert.equal(updated.hubOrigin.release, HUB_RELEASE(1));
  assert.equal(updated.hubOrigin.editedAt, undefined);
  // The menu's cards read the library's catalog, not the scenario itself: it
  // has to say the same, or the card would go on asking for the Update.
  const listed = (await libraryCatalog()).scenarios.find((entry) => entry.id === id);
  assert.equal(listed.hubOrigin.release, HUB_RELEASE(1));
  assert.deepEqual(await scenarioAsset(id, "regionsGeojson"), REGIONS, "and the map is still there");
  ok(await scenarios("PUT", id, { hubPublished: { key: PUBLISH_KEY, postIds: [55] } }));
  const editedAgain = ok(await scenarios("PUT", id, { name: "Mine Again" })).scenario;
  assert.equal(editedAgain.hubOrigin.release, HUB_RELEASE(1), "bookkeeping and a later edit keep it");
  assert.ok(editedAgain.hubOrigin.editedAt);

  const imported = ok(await scenarios("POST", "import", checkedBundle("Second Copy", 2))).scenario;
  assert.equal(imported.hubOrigin.release, HUB_RELEASE(2), "an import keeps the copy it came from");
  const elsewhere = ok(await scenarios("POST", "import", {
    ...scenarioBundle("Elsewhere"),
    hubOrigin: { postId: 42, bundleUrl: HUB_FILE(3), release: "https://evil.example/releases/download/x/hub-map.zip" },
  })).scenario;
  assert.equal(elsewhere.hubOrigin.postId, 42);
  assert.equal(elsewhere.hubOrigin.release, undefined, "an address outside the hub's releases is not kept as one");

  // The link is the library's record of a download, not part of the scenario:
  // a file exported from the copy says nothing of the post or the release.
  const exported = ok(await scenarios("GET", `${imported.id}/export`));
  assert.equal(exported.hubOrigin, undefined);
});
