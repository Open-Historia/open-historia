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

const newGame = async (name, body = {}) =>
  ok(await games("POST", "", { name, scenarioId: "default", setActive: true, ...body })).game.id;

test("a game export carries the campaign's own colours, flags, tags and institution logos", async () => {
  await reset();
  const id = await newGame("Colours");
  ok(await runtime("PUT", "colors", { Testland: [10, 20, 30] }));
  ok(await runtime("PUT", "flags", { Testland: "flag.png" }));
  ok(await runtime("PUT", "tags", { Testland: ["tag"] }));
  ok(await runtime("PUT", "institutionLogos", { un: "data:image/png;base64,AAAA" }));

  const bundle = ok(await games("GET", `${id}/export`));
  assert.deepEqual(bundle.data.colors, { Testland: [10, 20, 30] });
  assert.deepEqual(bundle.data.flags, { Testland: "flag.png" });
  assert.deepEqual(bundle.data.tags, { Testland: ["tag"] });
  assert.deepEqual(bundle.data.institutionLogos, { un: "data:image/png;base64,AAAA" });

  const imported = ok(await games("POST", "import", bundle)).game.id;
  ok(await games("PUT", "active", { gameId: imported }));
  assert.deepEqual(ok(await runtime("GET", "colors")), { Testland: [10, 20, 30] });
  assert.deepEqual(ok(await runtime("GET", "flags")), { Testland: "flag.png" });
  assert.deepEqual(ok(await runtime("GET", "tags")), { Testland: ["tag"] });
});

test("a game export leaves out an optional asset the game has none of", async () => {
  await reset();
  const id = await newGame("Plain");
  const bundle = ok(await games("GET", `${id}/export`));
  assert.deepEqual(bundle.data.colors, { Testland: [1, 2, 3] }, "the colours copied from the scenario at creation");
  assert.equal("flags" in bundle.data, false);
  assert.equal("tags" in bundle.data, false);
  assert.equal("institutionLogos" in bundle.data, false);
  assert.equal(bundle.data.game.country, "Testland");
});

test("an orphaned game exports its own stats sheet", async () => {
  await reset();
  const imported = ok(await games("POST", "import", {
    schema: "open-historia-game-bundle/1",
    game: { name: "Orphan" },
    scenarioRef: { scenarioId: "gone-map", scenarioName: "Gone Map" },
    data: { game: { country: "Testland" }, world: { ownerSchema: 4 }, stats: { rows: ["gdp"] } },
  })).game.id;
  const bundle = ok(await games("GET", `${imported}/export`));
  assert.deepEqual(bundle.data.stats, { rows: ["gdp"] });
});

test("a game whose map is not in the library is listed as missing, under the sender's name for it", async () => {
  await reset();
  const imported = ok(await games("POST", "import", {
    schema: "open-historia-game-bundle/1",
    game: { name: "Mapless" },
    scenarioRef: { scenarioId: "gone-map", scenarioName: "Gone Map", hubOrigin: { bundleUrl: "https://example.test/b.json", postId: "7" } },
    data: { game: { country: "Testland" }, world: { ownerSchema: 4 } },
  })).game.id;
  const entry = (await library()).games.find((game) => game.id === imported);
  assert.equal(entry.scenarioMissing, true);
  assert.equal(entry.scenarioName, "Gone Map");

  const own = await newGame("On the built-in");
  const onDefault = (await library()).games.find((game) => game.id === own);
  assert.equal(onDefault.scenarioMissing, false);
  assert.equal(onDefault.scenarioName, "Modern Day");
});

test("the running game saves city and region edits to its scenario", async () => {
  await reset();
  const scenarioId = ok(await scenarios("POST", "import", scenarioBundle("Custom Map"))).scenario.id;
  await newGame("Editing", { scenarioId });

  const cities = { ...CITIES, features: [...CITIES.features, { type: "Feature", properties: { name: "New Town" }, geometry: { type: "Point", coordinates: [5, 6] } }] };
  assert.deepEqual(ok(await runtime("PUT", "citiesGeojson", cities)), cities);
  assert.deepEqual(ok(await runtime("GET", "citiesGeojson")), cities);
  assert.deepEqual(await scenarioAsset(scenarioId, "citiesGeojson"), cities);

  const renamed = { ...REGIONS, features: [{ ...REGIONS.features[0], properties: { ...REGIONS.features[0].properties, name: "Renamed" } }] };
  ok(await runtime("PUT", "regionsGeojson", renamed));
  assert.deepEqual(ok(await runtime("GET", "regionsGeojson")), renamed);

  const refused = await runtime("PUT", "regionsGeojson", {});
  assert.equal(refused.status, 400);
  assert.deepEqual(ok(await runtime("GET", "regionsGeojson")), renamed, "an empty body never replaces the map");
});

test("a map edit on a game whose scenario is gone is refused, not written into a new scenario", async () => {
  await reset();
  const imported = ok(await games("POST", "import", {
    schema: "open-historia-game-bundle/1",
    game: { name: "Mapless" },
    scenarioRef: { scenarioId: "gone-map" },
    data: { game: { country: "Testland" }, world: { ownerSchema: 4 } },
  })).game.id;
  ok(await games("PUT", "active", { gameId: imported }));
  const refused = await runtime("PUT", "citiesGeojson", CITIES);
  assert.equal(refused.status, 400);
  assert.equal(db.get("scenarios").has("gone-map"), false);
});

const turnCommit = (gameDate, extra = {}) => call(store.handleRuntimeTurnCommit, "PUT", "", {
  actions: [], chat: [], events: [{ id: `e-${gameDate}` }], colors: { Testland: [1, 2, 3] },
  game: { country: "Testland", gameDate, round: 2 },
  world: { ownerSchema: 4, polityOverrides: { Testland: { name: "Testland" } } },
  ...extra,
});

test("a settings change during a turn commit keeps both", async () => {
  await reset();
  const id = await newGame("Racing");
  const cover = new Uint8Array([1, 2, 3]);
  const [commit, update, upload] = await Promise.all([
    turnCommit("2016-06-01"),
    games("PUT", id, { features: { playerFocus: { level: "focused" } } }),
    store.handleGames({ method: "PUT", segments: [id, "assets", "cover"], rawBody: cover, contentType: "image/png" }),
  ]);
  ok(commit);
  ok(update);
  assert.equal(upload.status, 200);

  const details = ok(await games("GET", id));
  assert.equal(details.data.game.gameDate, "2016-06-01", "the turn's new date survived");
  assert.deepEqual(details.data.events, [{ id: "e-2016-06-01" }]);
  assert.equal(details.game.features.playerFocus.level, "focused", "the setting survived");
  assert.equal(details.assetStatus.cover, true, "the cover survived");
});

const SNAPSHOT = { id: "snap-1", round: 1, fromDate: "2016-01-01", toDate: "2016-02-01", capturedAt: "2026-09-28T00:00:00.000Z", state: { game: {} } };

test("restore points travel out of a game and into another", async () => {
  await reset();
  const source = await newGame("With restore points");
  ok(await runtime("PUT", "snapshots", [SNAPSHOT]));
  const exported = ok(await games("GET", `${source}/snapshots`));
  assert.deepEqual(exported, [SNAPSHOT]);

  const bundle = ok(await games("GET", `${source}/export`));
  const target = ok(await games("POST", "import", bundle)).game.id;
  ok(await games("PUT", `${target}/snapshots`, exported));
  ok(await games("PUT", "active", { gameId: target }));

  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT]);
  assert.deepEqual(ok(await runtime("GET", "snapshotsIndex")).entries, [
    { id: "snap-1", round: 1, fromDate: "2016-01-01", toDate: "2016-02-01", capturedAt: "2026-09-28T00:00:00.000Z" },
  ]);
  assert.equal("snapshots" in db.get("games").get(target).json, false, "nothing left in the old slot");
});

test("restore points an earlier import stranded in record.json are found, and moved on the next write", async () => {
  await reset();
  const id = await newGame("Stranded");
  const stored = db.get("games").get(id);
  delete stored.snapshots;
  stored.json.snapshots = [SNAPSHOT];

  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT]);
  assert.equal(ok(await runtime("GET", "snapshotsIndex")).entries.length, 1);
  assert.deepEqual(ok(await games("GET", `${id}/snapshots`)), [SNAPSHOT]);

  const next = { ...SNAPSHOT, id: "snap-2" };
  ok(await runtime("PUT", "snapshots", [SNAPSHOT, next]));
  const after = db.get("games").get(id);
  assert.equal("snapshots" in after.json, false);
  assert.deepEqual(after.snapshots.map((entry) => entry.id), ["snap-1", "snap-2"]);
});

test("making a game active from inside a runtime write does not wait on itself", async () => {
  await reset();
  const catalog = await library();
  for (const game of catalog.games) ok(await games("DELETE", game.id));
  // No active game: the write creates one from the selected scenario, inside the queue.
  ok(await runtime("PUT", "flags", { Testland: "made.png" }));
  const after = await library();
  assert.equal(after.games.length, 1);
  assert.equal(after.activeGame.playCount, 1);
  assert.deepEqual(ok(await runtime("GET", "flags")), { Testland: "made.png" });
});
