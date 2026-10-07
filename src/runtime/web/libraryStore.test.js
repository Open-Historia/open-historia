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
const getLog = [];
globalThis.__ohWebStoreTestDb = db;
globalThis.__ohWebStoreTestGetAll = getAllLog;
globalThis.__ohWebStoreTestGet = getLog;

const IDB_STUB = `
export const STORES = {
  scenarios: "scenarios", games: "games", mapeditorDocs: "mapeditorDocs", basemapMeta: "basemapMeta",
  basemapPayload: "basemapPayload", flags: "flags", kv: "kv", scenarioMeta: "scenarioMeta", gameMeta: "gameMeta",
  covers: "covers", snapshots: "snapshots", snapshotIndex: "snapshotIndex",
  trash: "trash", trashMeta: "trashMeta",
};
const db = globalThis.__ohWebStoreTestDb;
const table = (name) => { if (!db.has(name)) db.set(name, new Map()); return db.get(name); };
const copy = (value) => (value === undefined ? undefined : structuredClone(value));
export const idbGet = async (store, key) => { globalThis.__ohWebStoreTestGet.push(store); return copy(table(store).get(key)); };
export const idbGetAll = async (store) => { globalThis.__ohWebStoreTestGetAll.push(store); return [...table(store).values()].map(copy); };
export const idbGetAllKeys = async (store) => [...table(store).keys()];
export const idbPut = async (store, value) => { table(store).set(store === "kv" ? value.key : value.id, copy(value)); };
export const idbPutPair = async (storeA, valueA, storeB, valueB) => { await idbPut(storeA, valueA); await idbPut(storeB, valueB); };
export const idbDelete = async (store, key) => { table(store).delete(key); };
export const idbDeletePair = async (storeA, storeB, key) => { table(storeA).delete(key); table(storeB).delete(key); };
export const idbGetMany = async (store, keys) => Promise.all(keys.map((key) => idbGet(store, key)));
export const idbTransaction = async (stores, fn) => fn({
  get: (store, key) => idbGet(store, key),
  getAllKeys: (store) => idbGetAllKeys(store),
  put: (store, value) => idbPut(store, value),
  delete: (store, key) => idbDelete(store, key),
});
export const idbMovePair = async (fromRecords, fromIndex, key, toRecords, toIndex, build) => idbTransaction([], async (tx) => {
  const record = copy(table(fromRecords).get(key));
  if (record === undefined) return null;
  const [nextRecord, nextIndex] = await build(record, tx);
  table(fromRecords).delete(key); table(fromIndex).delete(key);
  await idbPut(toRecords, nextRecord); await idbPut(toIndex, nextIndex);
  return copy(nextIndex);
});
export const kvGet = async (key, fallback = null) => { const record = table("kv").get(key); return record ? copy(record.value) : fallback; };
export const kvPut = (key, value) => idbPut("kv", { key, value });
export const kvUpdate = async (key, updater, fallback = null) => {
  const record = table("kv").get(key);
  const next = updater(record ? copy(record.value) : fallback);
  await kvPut(key, next);
  return next;
};
// The same reconciliation as idb.js: keys of the records, the whole (lean) index,
// and a record loaded only when its index row is missing.
export const reconcileMetaIndex = async (recordStore, metaStore, project) => {
  const [keys, metas] = await Promise.all([idbGetAllKeys(recordStore), idbGetAll(metaStore)]);
  const byId = new Map(metas.map((m) => [m.id, m]));
  const live = new Set(keys);
  for (const id of keys) {
    if (byId.has(id)) continue;
    const record = await idbGet(recordStore, id);
    if (!record) continue;
    const proj = project(record);
    await idbPut(metaStore, proj);
    byId.set(id, proj);
  }
  for (const m of metas) {
    if (live.has(m.id)) continue;
    await idbDelete(metaStore, m.id);
    byId.delete(m.id);
  }
  return [...byId.values()];
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

// ---- links to the community hub (server/hubProvenance.js, shared with the desktop store) ----

const HUB_FILE = (version) => `https://github.com/user-attachments/files/${version}/hub-map.zip`;
// A post's file as the Community tab hands it to the import: the bundle, stamped with where it came from.
const hubBundle = (name, version = 1) => ({ ...scenarioBundle(name), hubOrigin: { postId: 42, bundleUrl: HUB_FILE(version) } });
const PUBLISH_KEY = "oh-3f2a9c1e5d7b9a01";
const NEW_PUBLISH_KEY = "oh-0a1b2c3d4e5f6a7b";

test("an Unlink is for good here as on the desktop, whoever writes afterwards", async () => {
  await reset();
  const id = ok(await scenarios("POST", "import", hubBundle("Hub Map"))).scenario.id;
  const write = async (body) => ok(await scenarios("PUT", id, body)).scenario;
  const imported = ok(await scenarios("GET", id)).scenario;
  assert.equal(imported.hubOrigin.postId, 42, "an import says where the scenario came from");
  assert.equal(imported.hubOrigin.editedAt, undefined);

  // The player's own post: published and found, then unlinked.
  await write({ hubPublished: { key: PUBLISH_KEY, postIds: [55] } });
  const ownUnlinked = await write({ hubPublished: null });
  assert.equal(ownUnlinked.hubPublished, null);
  assert.deepEqual(ownUnlinked.hubUnlinked, { postIds: [55], keys: [PUBLISH_KEY] }, "the scenario remembers the post and its key");
  assert.equal(ownUnlinked.updatedAt, imported.updatedAt, "an Unlink is bookkeeping, not an edit");
  const afterStaleWrite = await write({ hubPublished: { key: PUBLISH_KEY, postIds: [55], commentCounts: { 55: 2 } } });
  assert.equal(afterStaleWrite.hubPublished, null, "a record read before the Unlink is not written back");
  const republished = await write({ hubPublished: { key: NEW_PUBLISH_KEY, postIds: [55, 60] } });
  assert.equal(republished.hubPublished.key, NEW_PUBLISH_KEY, "publishing again is followed as usual");
  assert.deepEqual(republished.hubPublished.postIds, [60], "but the unlinked post never comes back");
  assert.equal(ok(await scenarios("PUT", id, { hubPublished: { postIds: [70] } })).scenario.hubPublished.key, NEW_PUBLISH_KEY, "and no post is linked by hand");

  // The post it was downloaded from.
  const linkRefused = await scenarios("PUT", id, { hubOrigin: { postId: 99, bundleUrl: HUB_FILE(9) } });
  assert.equal(linkRefused.status, 400, "a scenario write cannot link a scenario to a post");
  assert.match(linkRefused.data.error, /cannot be linked/);
  const updated = ok(await scenarios("PUT", `${id}/import`, hubBundle("Hub Map v2", 2))).scenario;
  assert.equal(updated.hubOrigin.bundleUrl, HUB_FILE(2), "a copy still linked takes its post's newer file");
  assert.equal(updated.hubOrigin.editedAt, undefined);
  const originUnlinked = await write({ hubOrigin: null });
  assert.equal(originUnlinked.hubOrigin, null);
  assert.deepEqual(originUnlinked.hubUnlinked, { postIds: [55, 42], keys: [PUBLISH_KEY] });
  assert.equal((await scenarios("PUT", id, { hubOrigin: { postId: 42, bundleUrl: HUB_FILE(3) } })).status, 400);
  const updateRefused = await scenarios("PUT", `${id}/import`, hubBundle("Hub Map v3", 3));
  assert.equal(updateRefused.status, 400, "an Update cannot link it again either");
  assert.match(updateRefused.data.error, /not linked to that community post/);

  const card = (await library()).scenarios.find((entry) => entry.id === id);
  assert.equal(card.name, "Hub Map v2", "the refused Update wrote nothing over the player's scenario");
  assert.equal(card.hubOrigin, null);
  assert.deepEqual(card.hubPublished.postIds, [60]);
  assert.deepEqual(card.hubUnlinked, { postIds: [55, 42], keys: [PUBLISH_KEY] }, "the card carries what was unlinked, for the search to skip");
});

test("a check for suggestions that lands with an Unlink finds the scenario unlinked", async () => {
  // A write here is a read, a change and a put with awaits between them. Both
  // of these began from the same record, and the check's put used to land
  // last, with the post the player had just unlinked back in it.
  await reset();
  const id = ok(await scenarios("POST", "", { name: "Own Map" })).scenario.id;
  const record = { key: PUBLISH_KEY, postIds: [55] };
  ok(await scenarios("PUT", id, { hubPublished: record }));
  const [unlink, check] = await Promise.all([
    scenarios("PUT", id, { hubPublished: null }),
    scenarios("PUT", id, { hubPublished: { ...record, commentCounts: { 55: 3 } } }),
  ]);
  ok(unlink);
  assert.equal(ok(check).scenario.hubPublished, null, "the check is told what the store kept");
  const after = ok(await scenarios("GET", id)).scenario;
  assert.equal(after.hubPublished, null);
  assert.deepEqual(after.hubUnlinked, { postIds: [55], keys: [PUBLISH_KEY] });
});

test("an Update and an Unlink of one scenario take turns", async () => {
  // An Update is several writes here, where the desktop store does it in one
  // request. Pressed together, each waits for the other: an Unlink that came
  // second stands over the copy the Update left, and one that came first has
  // the Update refused, so the player's own scenario is not replaced.
  await reset();
  const updatedFirst = ok(await scenarios("POST", "import", hubBundle("Hub Map"))).scenario.id;
  const [update, unlink] = await Promise.all([
    scenarios("PUT", `${updatedFirst}/import`, hubBundle("Hub Map v2", 2)),
    scenarios("PUT", updatedFirst, { hubOrigin: null }),
  ]);
  ok(update);
  ok(unlink);
  const unlinkedCopy = ok(await scenarios("GET", updatedFirst)).scenario;
  assert.equal(unlinkedCopy.name, "Hub Map v2");
  assert.equal(unlinkedCopy.hubOrigin, null, "the Unlink stands");
  assert.deepEqual(unlinkedCopy.hubUnlinked, { postIds: [42], keys: [] });

  const unlinkedFirst = ok(await scenarios("POST", "import", hubBundle("Hub Map"))).scenario.id;
  const [unlinkBefore, refused] = await Promise.all([
    scenarios("PUT", unlinkedFirst, { hubOrigin: null }),
    scenarios("PUT", `${unlinkedFirst}/import`, hubBundle("Hub Map v2", 2)),
  ]);
  ok(unlinkBefore);
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /not linked to that community post/);
  const own = ok(await scenarios("GET", unlinkedFirst)).scenario;
  assert.equal(own.name, "Hub Map", "nothing was written over it");
  assert.equal(own.hubOrigin, null);
});

test("a link keeps the checked copy it was downloaded from, and an Update gives an old link one", async () => {
  // hubBundle stamps no release: a link as it was made when the game still
  // downloaded the post's own attachment, which is what every older save holds.
  const HUB_RELEASE = (version) => `https://github.com/Open-Historia/Open-historia-scenarios/releases/download/scenarios-1/p42-${version}-hub-map-0a1b2c3d.zip`;
  const checkedBundle = (name, version) => ({ ...scenarioBundle(name), hubOrigin: { postId: 42, bundleUrl: HUB_FILE(version), release: HUB_RELEASE(version) } });
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

const upload = async (id, key, bytes, contentType = "application/octet-stream") => {
  const response = await store.handleScenarios({ method: "PUT", segments: [id, "assets", key], rawBody: bytes, contentType, query: new URLSearchParams() });
  assert.equal(response.status, 200, await response.clone().text());
};

test("a game export measures its scenario's tile archives and geometry", async () => {
  await reset();
  const scenarioId = ok(await scenarios("POST", "", { name: "Heavy Map" })).scenario.id;
  const tiles = new Uint8Array(25 * 1024 * 1024);
  await upload(scenarioId, "regions", tiles);
  const regionsText = JSON.stringify({ ...REGIONS, padding: "x".repeat(1024 * 1024) });
  await upload(scenarioId, "regionsGeojson", new TextEncoder().encode(regionsText), "application/json");
  const id = await newGame("Heavy", { scenarioId });

  const { scenarioRef } = ok(await games("GET", `${id}/export`));
  assert.ok(scenarioRef.scenarioBytes >= Math.round(tiles.byteLength * 1.34) + regionsText.length, `measured ${scenarioRef.scenarioBytes}`);
  // gameZip.js refuses to embed anything over 32 MB.
  assert.ok(scenarioRef.scenarioBytes > 32 * 1024 * 1024);
});

test("creating, importing and deleting never load every record to read the ids", async () => {
  await reset();
  getAllLog.length = 0;
  const scenarioId = ok(await scenarios("POST", "", { name: "Light" })).scenario.id;
  const id = await newGame("Light", { scenarioId });
  const bundle = ok(await games("GET", `${id}/export`));
  const imported = ok(await games("POST", "import", bundle)).game.id;
  ok(await games("DELETE", imported));
  ok(await games("DELETE", id));
  ok(await scenarios("DELETE", scenarioId));
  assert.deepEqual(getAllLog.filter((name) => name === "games" || name === "scenarios"), []);
});

test("a revision of the built-in scenario reaches its games one at a time", async () => {
  await reset();
  const id = await newGame("On the built-in");
  const stored = db.get("scenarios").get("default");
  stored.json.world = { ...stored.json.world, builtInRevision: 1 };
  stored.flags = { Testland: "seed.png" };
  const game = db.get("games").get(id);
  delete game.flags;
  getAllLog.length = 0;

  await store.ensureSeeded();
  assert.deepEqual(getAllLog.filter((name) => name === "games"), []);
  assert.deepEqual(db.get("games").get(id).flags, { Testland: "seed.png" }, "the game keeps the flags it read from the scenario");
  assert.equal(db.get("scenarios").get("default").json.world.builtInRevision, 2);
});

test("the built-in scenario is seeded with one stamp, and one seeded with two is still untouched", async () => {
  await reset();
  const seeded = db.get("scenarios").get("default");
  assert.equal(seeded.meta.updatedAt, seeded.meta.createdAt);

  // An install seeded by a build that read the clock twice, a moment apart.
  const id = await newGame("On an older seed");
  const stored = db.get("scenarios").get("default");
  stored.meta = { ...stored.meta, updatedAt: new Date(Date.parse(stored.meta.createdAt) + 2).toISOString() };
  stored.json.world = { ...stored.json.world, builtInRevision: 1 };
  stored.flags = { Testland: "seed.png" };
  delete db.get("games").get(id).flags;

  await store.ensureSeeded();
  assert.deepEqual([...db.get("scenarios").keys()], ["default"], "no edited copy is made of a built-in nobody edited");
  assert.deepEqual(db.get("games").get(id).flags, { Testland: "seed.png" });
  assert.equal(db.get("scenarios").get("default").json.world.builtInRevision, 2);
});

test("a built-in scenario the player edited is kept as their copy when a revision arrives", async () => {
  await reset();
  const id = await newGame("On my edits");
  const stored = db.get("scenarios").get("default");
  stored.meta = { ...stored.meta, name: "My Modern Day", updatedAt: new Date(Date.parse(stored.meta.createdAt) + 60 * 1000).toISOString() };
  stored.json.world = { ...stored.json.world, builtInRevision: 1 };

  await store.ensureSeeded();
  const copy = [...db.get("scenarios").keys()].find((key) => key !== "default");
  assert.ok(copy, "the edited built-in is kept beside the new one");
  assert.equal(db.get("scenarios").get(copy).meta.name, "My Modern Day (your edited copy)");
  assert.equal(db.get("games").get(id).meta.scenarioId, copy, "its campaign moves to the copy");
  assert.equal(db.get("scenarios").get("default").json.world.builtInRevision, 2);
});

test("archiving a game shelves it and hands the active slot to the last one played", async () => {
  await reset();
  const older = await newGame("Older");
  const current = await newGame("Current");
  assert.equal((await library()).activeGameId, current);

  const archived = ok(await games("PUT", current, { archived: true }));
  assert.equal(archived.game.archived, true);
  const after = await library();
  assert.equal(after.games.find((game) => game.id === current).archived, true);
  assert.equal(after.activeGameId, older, "the player is not left inside a game the list hides");

  // A later metadata write keeps it archived.
  ok(await games("PUT", current, { name: "Renamed" }));
  assert.equal((await library()).games.find((game) => game.id === current).archived, true);

  ok(await games("PUT", current, { archived: false }));
  const restored = await library();
  assert.equal(restored.games.find((game) => game.id === current).archived, false);
  assert.equal(restored.activeGameId, older, "unarchiving does not move the active slot");
});

test("archiving the only game leaves it active", async () => {
  await reset();
  const catalog = await library();
  for (const game of catalog.games) ok(await games("DELETE", game.id));
  const only = await newGame("Only");
  ok(await games("PUT", only, { archived: true }));
  assert.equal((await library()).activeGameId, only);
});

test("Import & play points the game at the scenario it fetched", async () => {
  await reset();
  const imported = ok(await games("POST", "import", {
    schema: "open-historia-game-bundle/1",
    game: { name: "Mapless" },
    scenarioRef: { scenarioId: "gone-map", scenarioName: "Gone Map" },
    data: { game: { country: "Testland" }, world: { ownerSchema: 4 } },
  })).game.id;
  const scenarioId = ok(await scenarios("POST", "import", scenarioBundle("Gone Map"))).scenario.id;
  const relinked = ok(await games("PUT", imported, { scenarioId }));
  assert.equal(relinked.game.scenarioId, scenarioId);
  assert.equal(relinked.game.scenarioMissing, false);
  assert.equal((await games("PUT", imported, { scenarioId: "not-here" })).status, 400);
});

test("writing game.json keeps a polity key that looks like a stock country code", async () => {
  await reset();
  await newGame("USA campaign");
  // The seed world has a polity keyed exactly "USA"; the stock registry calls USA "United States".
  const saved = ok(await runtime("PUT", "game", { country: "USA", difficulty: "hard", gameDate: "2016-01-01" }));
  assert.equal(saved.country, "USA");
  assert.equal(ok(await runtime("GET", "game")).country, "USA");
  ok(await runtime("PUT", "colors", { USA: [4, 5, 6] }));
  assert.deepEqual(ok(await runtime("GET", "colors")), { USA: [4, 5, 6] });
});

test("a runtime read or write never rebuilds the library catalogs", async () => {
  await reset();
  const scenarioId = ok(await scenarios("POST", "import", scenarioBundle("Own Map"))).scenario.id;
  await newGame("Quiet", { scenarioId });
  getAllLog.length = 0;
  ok(await runtime("GET", "world"));
  ok(await runtime("GET", "regionsGeojson"));
  const echoed = ok(await runtime("PUT", "world", { ownerSchema: 4, polityOverrides: { Testland: { name: "Testland" } } }));
  assert.equal(echoed.customRegions, true, "the echo is still the served, normalised world");
  assert.deepEqual(getAllLog, []);
});

test("a tile request asks the catalog rows, and loads only the archive it serves", async () => {
  await reset();
  const scenarioId = ok(await scenarios("POST", "", { name: "Own Tiles" })).scenario.id;
  const tiles = new Uint8Array([1, 2, 3, 4]);
  await upload(scenarioId, "regions", tiles);
  await newGame("Tiled", { scenarioId });
  // Restore points make the game record the heavy one; a tile request must not load it.
  ok(await runtime("PUT", "snapshots", [SNAPSHOT]));

  getLog.length = 0;
  assert.equal(await store.hasScenarioPmtilesOverride("regions"), true);
  assert.equal(await store.hasScenarioPmtilesOverride("cities"), false);
  assert.equal(await store.getScenarioPmtilesOverride("cities", null), null);
  assert.deepEqual(getLog.filter((name) => name === "games" || name === "scenarios"), [], "no record for a yes or no");

  const response = await store.getScenarioPmtilesOverride("regions", null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), tiles);
  assert.deepEqual(getLog.filter((name) => name === "games" || name === "scenarios"), ["scenarios"], "only the scenario whose bytes are served");

  // A game on a map with no archive of its own serves none.
  await newGame("Plain");
  assert.equal(await store.hasScenarioPmtilesOverride("regions"), false);
  assert.equal(await store.getScenarioPmtilesOverride("regions", null), null);
});

test("a runtime write that asks for no reply gets none", async () => {
  await reset();
  await newGame("Minimal");
  const response = await store.handleRuntimeJson({
    method: "PUT", segments: ["json", "snapshots"], body: [SNAPSHOT], prefer: "return=minimal",
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Preference-Applied"), "return=minimal");
  assert.equal(await response.text(), "");
  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT]);
});

test("the lean catalog rows heal themselves against the records", async () => {
  await reset();
  const kept = await newGame("Kept");
  const gone = await newGame("Gone");
  db.get("gameMeta").delete(kept); // a record written by sync, with no row yet
  db.get("games").delete(gone); // a record deleted out of band, its row left behind
  const listed = (await library()).games.map((game) => game.id);
  assert.ok(listed.includes(kept));
  assert.ok(!listed.includes(gone));
  assert.ok(db.get("gameMeta").has(kept));
  assert.ok(!db.get("gameMeta").has(gone));
});

test("a code-keyed game migrates to names on first read, once, and drops its restore points", async () => {
  await reset();
  const id = await newGame("Legacy");
  const stored = db.get("games").get(id);
  stored.json.world = { regionOwnershipOverrides: { r1: "USA" }, ownerCodes: ["USA"] };
  stored.json.game = { country: "USA", gameDate: "2016-01-01" };
  stored.colors = { USA: [7, 7, 7] };
  stored.snapshots = [SNAPSHOT];

  const world = ok(await runtime("GET", "world"));
  assert.equal(world.ownerSchema, 4);
  assert.equal(world.regionOwnershipOverrides.r1, "United States");
  assert.deepEqual(ok(await runtime("GET", "colors")), { "United States": [7, 7, 7] });
  assert.equal(ok(await runtime("GET", "game")).country, "United States");
  assert.deepEqual(ok(await runtime("GET", "snapshots")), []);

  const migrated = structuredClone(db.get("games").get(id));
  ok(await runtime("GET", "world"));
  assert.deepEqual(db.get("games").get(id), migrated, "a second read changes nothing");
});

test("a game and a scenario that share an id each migrate as their own record", async () => {
  await reset();
  const scenarioId = ok(await scenarios("POST", "", { name: "Twin Map" })).scenario.id;
  const id = await newGame("Twin", { id: scenarioId, scenarioId });
  assert.equal(id, scenarioId);
  const legacyWorld = () => ({ regionOwnershipOverrides: { r1: "USA" }, ownerCodes: ["USA"] });
  db.get("games").get(id).json.world = legacyWorld();
  db.get("scenarios").get(scenarioId).json.world = legacyWorld();

  ok(await runtime("GET", "world")); // migrates the game
  ok(await runtime("GET", "regionsGeojson")); // migrates the scenario, which owns the geometry
  for (const record of [db.get("games").get(id), db.get("scenarios").get(scenarioId)]) {
    assert.equal(record.json.world.ownerSchema, 4);
    assert.equal(record.json.world.regionOwnershipOverrides.r1, "United States");
  }
});

test("a turn commit is what every runtime read then sees", async () => {
  await reset();
  await newGame("Committed");
  ok(await turnCommit("2016-09-01", { chat: [{ id: "c1", messages: [] }], actions: [{ id: "a1", status: "pending" }] }));
  assert.equal(ok(await runtime("GET", "game")).gameDate, "2016-09-01");
  assert.deepEqual(ok(await runtime("GET", "events")), [{ id: "e-2016-09-01" }]);
  assert.deepEqual(ok(await runtime("GET", "chat")), [{ id: "c1", messages: [] }]);
  assert.deepEqual(ok(await runtime("GET", "actions")), [{ id: "a1", status: "pending" }]);
  const entry = (await library()).activeGame;
  assert.equal(entry.currentDate, "2016-09-01");
  assert.equal(entry.pendingActions, 1);
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
  assert.equal("snapshots" in after, false, "restore points live in their own store now");
  assert.deepEqual(db.get("snapshotIndex").get(id).entries.map((entry) => entry.id), ["snap-1", "snap-2"]);
  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT, next]);
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

// A time skip that finished while another game was open is kept with its own
// game (src/Game/AI/parkedTurn.js), written while that game is NOT the active one.
test("a kept turn is stored with its own game while another is open, and goes when removed", async () => {
  await reset();
  const kept = await newGame("Where the skip ran");
  const other = await newGame("Opened meanwhile");
  assert.equal((await library()).activeGameId, other);

  assert.equal(ok(await games("GET", `${kept}/parked-turn`)), null, "none until one is kept");
  const record = { version: 1, campaignId: kept, round: 3, turn: { baseGame: { round: 3 } } };
  ok(await games("PUT", `${kept}/parked-turn`, record));
  assert.deepEqual(ok(await games("GET", `${kept}/parked-turn`)), record);
  assert.equal(ok(await games("GET", `${other}/parked-turn`)), null, "the open game is not given it");
  assert.equal("parkedTurn" in db.get("games").get(kept), false, "not in the record every runtime read clones");

  const exported = ok(await games("GET", `${kept}/export`));
  assert.equal(JSON.stringify(exported).includes("parked"), false, "an export does not carry it");

  ok(await games("DELETE", `${kept}/parked-turn`));
  assert.equal(ok(await games("GET", `${kept}/parked-turn`)), null);
});

test("a kept turn is refused for another game or a game that is not there, and goes with its game", async () => {
  await reset();
  const kept = await newGame("Kept here");
  const other = await newGame("Elsewhere");
  const refused = await games("PUT", `${other}/parked-turn`, { version: 1, campaignId: kept });
  assert.equal(refused.status, 400);
  assert.equal((await games("PUT", "no-such-game/parked-turn", { version: 1, campaignId: "no-such-game" })).status, 400);
  assert.equal((await games("GET", "no-such-game/parked-turn")).status, 404);

  ok(await games("PUT", `${kept}/parked-turn`, { version: 1, campaignId: kept }));
  ok(await games("DELETE", kept));
  assert.equal(db.get("kv").has(`parked-turn:${kept}`), false, "deleting the game deletes its kept turn");
});

// --- Covers and restore points in stores of their own (idb.js version 5) ---
const coverBytes = (n) => new Uint8Array([n, n, n, n]);
const coverOf = async (handler, id) => {
  const response = await handler({ method: "GET", segments: [id, "assets", "cover"], query: new URLSearchParams() });
  return response.status === 200 ? [...new Uint8Array(await response.arrayBuffer())] : null;
};
const uploadGameCover = async (id, bytes) => {
  const response = await store.handleGames({ method: "PUT", segments: [id, "assets", "cover"], rawBody: bytes, contentType: "image/png" });
  assert.equal(response.status, 200, await response.clone().text());
};
const restorePoint = (n) => ({ ...SNAPSHOT, id: `snap-${n}`, round: n, capturedAt: `2026-09-2${n}T00:00:00.000Z` });

test("a game's cover lives in its own store; the record and its catalog row keep a marker", async () => {
  await reset();
  const id = await newGame("Covered");
  await uploadGameCover(id, coverBytes(5));
  assert.deepEqual(db.get("games").get(id).cover, { contentType: "image/png", byteLength: 4, key: `game:${id}` });
  assert.equal(db.get("gameMeta").get(id).cover.bytes, undefined, "listing the library copies no cover bytes");
  assert.deepEqual([...db.get("covers").get(`game:${id}`).bytes], [5, 5, 5, 5]);
  assert.deepEqual(await coverOf(store.handleGames, id), [5, 5, 5, 5]);
  assert.match((await library()).games.find((game) => game.id === id).ownCoverImageUrl, /^blob:/);

  // A copy of the game gets a cover of its own, not a pointer at this one.
  const copy = ok(await games("POST", "", { name: "Covered copy", seedGameId: id })).game.id;
  assert.deepEqual([...db.get("covers").get(`game:${copy}`).bytes], [5, 5, 5, 5]);
  ok(await games("DELETE", `${id}/assets/cover`));
  assert.equal(db.get("covers").has(`game:${id}`), false);
  assert.equal(await coverOf(store.handleGames, id), null);
  assert.deepEqual(await coverOf(store.handleGames, copy), [5, 5, 5, 5]);
  ok(await games("DELETE", copy));
  assert.equal(db.get("covers").has(`game:${copy}`), false, "a deleted game's cover goes with it");
});

test("a scenario's cover is copied with the scenario, exported, and deleted with it", async () => {
  await reset();
  const id = ok(await scenarios("POST", "", { name: "Pictured" })).scenario.id;
  await upload(id, "cover", coverBytes(7), "image/png");
  assert.equal(db.get("scenarios").get(id).cover.bytes, undefined);
  const copy = ok(await scenarios("POST", "", { name: "Pictured copy", seedScenarioId: id })).scenario.id;
  assert.deepEqual(await coverOf(store.handleScenarios, copy), [7, 7, 7, 7]);
  const bundle = ok(await scenarios("GET", `${copy}/export`));
  assert.equal(bundle.assets.cover.mode, "embedded");
  assert.equal(bundle.assets.cover.data, Buffer.from(coverBytes(7)).toString("base64"));
  const reimported = ok(await scenarios("POST", "import", bundle)).scenario.id;
  assert.deepEqual(await coverOf(store.handleScenarios, reimported), [7, 7, 7, 7], "the round trip keeps the cover");
  ok(await scenarios("DELETE", copy));
  assert.equal(db.get("covers").has(`scenario:${copy}`), false);
  assert.ok(db.get("covers").has(`scenario:${id}`), "the original keeps its own");
  ok(await scenarios("DELETE", `${id}/assets/cover`));
  assert.equal(db.get("covers").has(`scenario:${id}`), false);
  // A 404, as on the desktop: the client reads a 404 asset as none, a 500 as a failure.
  assert.equal((await scenarios("GET", `${id}/assets/cover`)).status, 404);
});

test("restore points are rows of their own: a turn writes the one it adds", async () => {
  await reset();
  const id = await newGame("Long campaign");
  ok(await runtime("PUT", "snapshots", [restorePoint(2), restorePoint(1)]));
  assert.equal("snapshots" in db.get("games").get(id), false, "loading the game loads no restore points");
  assert.deepEqual([...db.get("snapshots").keys()].sort(), [`${id}/snap-1`, `${id}/snap-2`]);

  // Marks a stored row: a write that rewrote it would drop the mark.
  db.get("snapshots").get(`${id}/snap-2`).snapshot.untouched = true;
  ok(await runtime("PUT", "snapshots", [restorePoint(3), restorePoint(2)]));
  assert.equal(db.get("snapshots").get(`${id}/snap-2`).snapshot.untouched, true, "the stored one was not written again");
  assert.equal(db.get("snapshots").has(`${id}/snap-1`), false, "the one that fell off the end is gone");
  assert.deepEqual(ok(await runtime("GET", "snapshotsIndex")).entries.map((entry) => entry.id), ["snap-3", "snap-2"]);
  assert.deepEqual(ok(await runtime("GET", "snapshots")).map((entry) => entry.id), ["snap-3", "snap-2"]);

  ok(await games("DELETE", id));
  assert.equal([...db.get("snapshots").keys()].some((key) => key.startsWith(`${id}/`)), false, "a deleted game's restore points go with it");
  assert.equal(db.get("snapshotIndex").has(id), false);
});

// A game the way the store kept it before version 5: cover bytes on the record
// and its catalog row, restore points inline.
const makeLegacy = (id) => {
  const cover = { contentType: "image/png", bytes: coverBytes(9) };
  const record = db.get("games").get(id);
  record.cover = cover;
  record.snapshots = [SNAPSHOT];
  const row = db.get("gameMeta").get(id);
  row.cover = cover;
  row.assetStatus = { cover: true };
  delete row.inlineRestorePoints;
  for (const name of ["covers", "snapshots", "snapshotIndex"]) db.get(name)?.clear();
};

test("a save from before the new stores reads as it is, and is moved once", async () => {
  await reset();
  const id = await newGame("Old save");
  makeLegacy(id);
  const scenarioId = ok(await scenarios("POST", "", { name: "Old map" })).scenario.id;
  const legacyScenarioCover = { contentType: "image/png", bytes: coverBytes(3) };
  db.get("scenarios").get(scenarioId).cover = legacyScenarioCover;
  db.get("scenarioMeta").get(scenarioId).cover = legacyScenarioCover;
  db.get("scenarioMeta").get(scenarioId).assetStatus.cover = true;

  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT]);
  assert.equal(ok(await runtime("GET", "snapshotsIndex")).entries.length, 1);
  assert.deepEqual(await coverOf(store.handleGames, id), [9, 9, 9, 9]);
  assert.deepEqual(await coverOf(store.handleScenarios, scenarioId), [3, 3, 3, 3]);
  assert.match((await library()).games.find((game) => game.id === id).ownCoverImageUrl, /^blob:/);

  getLog.length = 0;
  await store.migrateStoreLayout();
  assert.equal(getLog.includes("scenarios"), false, "a scenario's cover moves from its row, without loading the scenario");
  assert.deepEqual([...db.get("covers").get(`scenario:${scenarioId}`).bytes], [3, 3, 3, 3]);
  assert.equal(db.get("scenarioMeta").get(scenarioId).cover.bytes, undefined);
  const moved = db.get("games").get(id);
  assert.equal("snapshots" in moved, false);
  assert.equal(moved.cover.bytes, undefined);
  assert.equal(db.get("gameMeta").get(id).cover.bytes, undefined);
  assert.deepEqual([...db.get("covers").get(`game:${id}`).bytes], [9, 9, 9, 9]);
  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT], "nothing lost");
  assert.deepEqual(await coverOf(store.handleGames, id), [9, 9, 9, 9]);
  assert.deepEqual(await coverOf(store.handleScenarios, scenarioId), [3, 3, 3, 3]);
  assert.match((await library()).scenarios.find((scenario) => scenario.id === scenarioId).coverImageUrl, /^blob:/);

  getLog.length = 0;
  await store.migrateStoreLayout();
  assert.deepEqual(getLog, [], "done once");
});

test("one restore point is read by its id, from its own row or an older save's list", async () => {
  await reset();
  const id = await newGame("Revealing");
  ok(await runtime("PUT", "snapshots", [restorePoint(2), restorePoint(1)]));
  const one = (snapshotId) => call(store.handleRuntimeSnapshot, "GET", `snapshots/${snapshotId}`);
  getLog.length = 0;
  assert.deepEqual(ok(await one("snap-1")), restorePoint(1));
  assert.deepEqual(getLog.filter((name) => name === "snapshots"), ["snapshots"], "that one row, not the others");
  assert.equal((await one("snap-9")).status, 404);

  makeLegacy(id);
  assert.deepEqual(ok(await one("snap-1")), SNAPSHOT, "an older save's inline list is read too");
});

test("a save from before the new stores is moved by its own next write too", async () => {
  await reset();
  const id = await newGame("Old save, played");
  makeLegacy(id);
  ok(await runtime("PUT", "game", { country: "Testland", gameDate: "2016-03-01" }));
  assert.equal("snapshots" in db.get("games").get(id), false);
  assert.deepEqual(db.get("snapshotIndex").get(id).entries.map((entry) => entry.id), ["snap-1"]);
  assert.deepEqual([...db.get("covers").get(`game:${id}`).bytes], [9, 9, 9, 9]);
  assert.deepEqual(ok(await runtime("GET", "snapshots")), [SNAPSHOT]);
});

// ---- Recently deleted -------------------------------------------------------
// Deleting a game or scenario used to remove its records outright, while the
// desktop keeps it in .trash. It now moves into the trash store for a week, the
// last five at most.
const trash = (method, path, query = "") => store.handleTrash({ method, segments: path.split("/").filter(Boolean), query: new URLSearchParams(query) })
  .then(async (response) => ({ status: response.status, data: JSON.parse(await response.text()) }));

test("a deleted game is listed, and restored under its id with its events", async () => {
  await reset();
  const id = await newGame("The Saga");
  ok(await runtime("PUT", "events", [{ id: "e1" }, { id: "e2" }]));
  ok(await games("DELETE", id));
  assert.equal((await library()).games.some((game) => game.id === id), false);

  const listed = ok(await trash("GET", ""));
  assert.equal(listed.keepDays, 7);
  assert.equal(listed.keepCount, 5);
  assert.equal(listed.entries.length, 1);
  const [entry] = listed.entries;
  assert.equal(entry.kind, "game");
  assert.equal(entry.id, id);
  assert.equal(entry.name, "The Saga");
  assert.equal(entry.scenarioId, "default");
  assert.ok(!Number.isNaN(Date.parse(entry.deletedAt)));

  const restored = ok(await trash("POST", `${encodeURIComponent(entry.entry)}/restore`));
  assert.deepEqual({ id: restored.id, kind: restored.kind }, { id, kind: "game" });
  const game = restored.library.games.find((row) => row.id === id);
  assert.equal(game.name, "The Saga");
  assert.equal(game.eventCount, 2);
  assert.equal(ok(await trash("GET", "")).entries.length, 0);
});

test("a scenario restored after its id was reused comes back beside it, not over it", async () => {
  await reset();
  const first = ok(await scenarios("POST", "", { id: "vinland", name: "Vinland" })).scenario.id;
  ok(await scenarios("DELETE", first));
  ok(await scenarios("POST", "", { id: "vinland", name: "New Vinland" }));
  const [entry] = ok(await trash("GET", "")).entries;
  const restored = ok(await trash("POST", `${encodeURIComponent(entry.entry)}/restore`));
  assert.equal(restored.id, "vinland-2");
  const names = Object.fromEntries(restored.library.scenarios.map((scenario) => [scenario.id, scenario.name]));
  assert.equal(names.vinland, "New Vinland");
  assert.equal(names["vinland-2"], "Vinland");
  assert.equal(ok(await scenarios("GET", "vinland-2")).scenario.name, "Vinland");
});

test("the trash keeps the last five, and nothing older than a week", async () => {
  await reset();
  const ids = [];
  for (let n = 1; n <= 6; n += 1) {
    ids.push(await newGame(`Game ${n}`));
    ok(await games("DELETE", ids.at(-1)));
    // One millisecond apart at least, so the order is the order of deletion.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  let entries = ok(await trash("GET", "")).entries;
  assert.deepEqual(entries.map((entry) => entry.id), ids.slice(1).reverse(), "the first one deleted went first");
  assert.equal(db.get("trash").size, 5, "its record went with it");

  const oldest = db.get("trashMeta").get(entries.at(-1).entry);
  oldest.deletedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  entries = ok(await trash("GET", "")).entries;
  assert.equal(entries.length, 4);
  assert.equal(db.get("trash").has(oldest.id), false);
});

test("emptying the games shelf leaves the deleted scenarios", async () => {
  await reset();
  ok(await games("DELETE", await newGame("Gone")));
  ok(await scenarios("DELETE", ok(await scenarios("POST", "", { name: "Also Gone" })).scenario.id));
  assert.deepEqual(ok(await trash("DELETE", "", "kind=game")), { removed: 1 });
  const entries = ok(await trash("GET", "")).entries;
  assert.deepEqual(entries.map((entry) => entry.kind), ["scenario"]);
  assert.deepEqual(ok(await trash("DELETE", "")), { removed: 1 });
  assert.equal(db.get("trash").size, 0);

  const missing = await trash("POST", "game-nothing-1/restore");
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /Not in the trash/);
});

// ---- A community basemap that could not be downloaded -------------------------
const COMMUNITY_REF = { mode: "communityRef", via: "image", hash: "abc", url: "https://github.com/user-attachments/assets/basemap.png", fileName: "background.json" };
const HUB_ORIGIN = { postId: 7, bundleUrl: "https://github.com/user-attachments/files/1/hub-map.zip" };
const bundleMissingBasemap = (name) => {
  const bundle = scenarioBundle(name);
  bundle.data.world.background = { kind: "image", extent: [-180, -85, 180, 85] };
  bundle.assets.backgroundData = { ...COMMUNITY_REF, missingReason: "Download failed (HTTP 502)." };
  bundle.hubOrigin = HUB_ORIGIN;
  return bundle;
};

test("a basemap that could not be downloaded is kept as its reference, exported as one, and put in place later", async () => {
  await reset();
  const imported = ok(await scenarios("POST", "import", bundleMissingBasemap("Hub Map")));
  const id = imported.scenario.id;
  assert.equal(imported.assetStatus.backgroundData, false);
  const listed = (await library()).scenarios.find((scenario) => scenario.id === id);
  assert.deepEqual(listed.missingBasemap, {
    reference: COMMUNITY_REF,
    background: { kind: "image", extent: [-180, -85, 180, 85] },
    reason: "Download failed (HTTP 502).",
  });

  const exported = ok(await scenarios("GET", `${id}/export`));
  assert.deepEqual(exported.assets.backgroundData, COMMUNITY_REF, "the next import tries the download too");

  const restored = ok(await scenarios("PUT", `${id}/basemap`, { payload: { dataUrl: "data:image/png;base64,T0xE" } }));
  assert.equal(restored.assetStatus.backgroundData, true);
  assert.equal(restored.scenario.missingBasemap, undefined);
  assert.equal(restored.scenario.hubOrigin.editedAt, undefined, "not an edit: the copy still follows its post");
  assert.deepEqual(restored.data.world.background, { kind: "image", extent: [-180, -85, 180, 85] });
  assert.deepEqual(await scenarioAsset(id, "backgroundData"), { dataUrl: "data:image/png;base64,T0xE" });
  assert.equal((await scenarios("PUT", `${id}/basemap`, { payload: { dataUrl: "data:image/png;base64,T0xE" } })).status, 400, "only while one is missing");
});

test("an Update records the new version's missing basemap, and one that brings it clears the record", async () => {
  await reset();
  const id = ok(await scenarios("POST", "import", { ...scenarioBundle("Hub Map"), hubOrigin: HUB_ORIGIN })).scenario.id;
  const failed = ok(await scenarios("PUT", `${id}/import`, bundleMissingBasemap("Hub Map v2")));
  assert.equal(failed.scenario.missingBasemap.reference.url, COMMUNITY_REF.url);
  assert.deepEqual(await scenarioAsset(id, "backgroundData"), BACKGROUND, "the basemap it had is kept meanwhile");

  const fixed = ok(await scenarios("PUT", `${id}/import`, { ...scenarioBundle("Hub Map v3"), hubOrigin: HUB_ORIGIN }));
  assert.equal(fixed.scenario.missingBasemap, undefined);
});

test("a basemap the player sets themselves replaces the one still missing", async () => {
  await reset();
  const id = ok(await scenarios("POST", "import", bundleMissingBasemap("Hub Map"))).scenario.id;
  const uploaded = ok(await store.handleScenarios({
    method: "PUT", segments: [id, "assets", "backgroundData"], query: new URLSearchParams(),
    rawBody: new TextEncoder().encode(JSON.stringify(BACKGROUND)), contentType: "application/json",
  }).then((response) => response.json().then((data) => ({ status: response.status, data }))));
  assert.equal(uploaded.scenario.missingBasemap, undefined, "the late download would overwrite their choice");
});

test("a malformed missing-basemap record is dropped, not kept", async () => {
  await reset();
  const bundle = bundleMissingBasemap("Hub Map");
  bundle.assets.backgroundData = { mode: "communityRef", url: "javascript:alert(1)" };
  const imported = ok(await scenarios("POST", "import", bundle));
  assert.equal(imported.scenario.missingBasemap, undefined);
});

// ---- Recently deleted, with covers and restore points in their own stores ----
// A deleted record's cover and a game's restore points leave their stores
// inside its trash entry, and its kept turn beside it: none of it may be left
// under an id a new game or scenario can take, a restore brings it all back
// under the id it restores to, and emptying the trash leaves nothing behind.
const entryOf = async (id) => ok(await trash("GET", "")).entries.find((entry) => entry.id === id);
const rowsUnder = (id) => ({
  cover: db.get("covers")?.has(`game:${id}`) ?? false,
  restorePoints: [...(db.get("snapshots")?.keys() ?? [])].filter((key) => key.startsWith(`${id}/`)),
  index: db.get("snapshotIndex")?.has(id) ?? false,
  keptTurn: db.get("kv")?.has(`parked-turn:${id}`) ?? false,
});
const NOTHING = { cover: false, restorePoints: [], index: false, keptTurn: false };

test("a deleted game takes its cover, restore points and kept turn into the trash, and a restore brings them back", async () => {
  await reset();
  const id = await newGame("Saga with a past");
  await uploadGameCover(id, coverBytes(4));
  ok(await runtime("PUT", "snapshots", [restorePoint(2), restorePoint(1)]));
  const keptTurn = { version: 1, campaignId: id, round: 2 };
  ok(await games("PUT", `${id}/parked-turn`, keptTurn));

  ok(await games("DELETE", id));
  assert.deepEqual(rowsUnder(id), NOTHING, "nothing is left under its id");

  ok(await trash("POST", `${encodeURIComponent((await entryOf(id)).entry)}/restore`));
  const record = db.get("games").get(id);
  assert.deepEqual(record.cover, { contentType: "image/png", byteLength: 4, key: `game:${id}` });
  assert.equal("snapshots" in record, false, "the record is lean again");
  assert.equal(db.get("gameMeta").get(id).cover.bytes, undefined);
  assert.equal(db.get("gameMeta").get(id).inlineRestorePoints, false);
  assert.deepEqual(await coverOf(store.handleGames, id), [4, 4, 4, 4]);
  assert.deepEqual(ok(await games("GET", `${id}/parked-turn`)), keptTurn);
  ok(await games("PUT", "active", { gameId: id }));
  assert.deepEqual(ok(await runtime("GET", "snapshots")), [restorePoint(2), restorePoint(1)]);
  assert.deepEqual(ok(await runtime("GET", "snapshotsIndex")).entries.map((entry) => entry.id), ["snap-2", "snap-1"]);
  assert.equal(db.get("trash").size, 0);
});

test("a game restored beside a new one with its id takes its cover and restore points under its new id", async () => {
  await reset();
  const id = await newGame("Twice", { id: "twice" });
  await uploadGameCover(id, coverBytes(6));
  ok(await runtime("PUT", "snapshots", [restorePoint(1)]));
  ok(await games("PUT", `${id}/parked-turn`, { version: 1, campaignId: id }));
  ok(await games("DELETE", id));

  assert.equal(await newGame("Twice again", { id: "twice" }), id, "the id is free while the first is in the trash");
  assert.equal(await coverOf(store.handleGames, id), null, "the new game is given none of the old one's");
  assert.deepEqual(ok(await runtime("GET", "snapshots")), []);
  assert.equal(ok(await games("GET", `${id}/parked-turn`)), null);

  const restored = ok(await trash("POST", `${encodeURIComponent((await entryOf(id)).entry)}/restore`));
  assert.equal(restored.id, `${id}-2`);
  assert.deepEqual(await coverOf(store.handleGames, restored.id), [6, 6, 6, 6]);
  assert.deepEqual(db.get("snapshotIndex").get(restored.id).entries.map((entry) => entry.id), ["snap-1"]);
  assert.deepEqual(rowsUnder(restored.id).restorePoints, [`${restored.id}/snap-1`]);
  assert.deepEqual(rowsUnder(id), NOTHING, "the new game keeps its own, which is nothing");
  assert.equal(ok(await games("GET", `${restored.id}/parked-turn`)), null, "a kept turn is not moved to another id");
});

test("a deleted scenario takes its cover into the trash, and a restore brings it back", async () => {
  await reset();
  const id = ok(await scenarios("POST", "", { name: "Framed" })).scenario.id;
  await upload(id, "cover", coverBytes(8), "image/png");
  ok(await scenarios("DELETE", id));
  assert.equal(db.get("covers").has(`scenario:${id}`), false);

  ok(await trash("POST", `${encodeURIComponent((await entryOf(id)).entry)}/restore`));
  assert.deepEqual(db.get("scenarios").get(id).cover, { contentType: "image/png", byteLength: 4, key: `scenario:${id}` });
  assert.equal(db.get("scenarioMeta").get(id).cover.bytes, undefined);
  assert.deepEqual(await coverOf(store.handleScenarios, id), [8, 8, 8, 8]);
  assert.match((await library()).scenarios.find((scenario) => scenario.id === id).coverImageUrl, /^blob:/);
});

test("a save from before the new stores goes into the trash whole, and comes back into them", async () => {
  await reset();
  const id = await newGame("Old and deleted");
  makeLegacy(id);
  ok(await games("DELETE", id));
  assert.deepEqual(rowsUnder(id), NOTHING);

  ok(await trash("POST", `${encodeURIComponent((await entryOf(id)).entry)}/restore`));
  const record = db.get("games").get(id);
  assert.equal("snapshots" in record, false);
  assert.deepEqual(record.cover, { contentType: "image/png", byteLength: 4, key: `game:${id}` });
  assert.deepEqual([...db.get("covers").get(`game:${id}`).bytes], [9, 9, 9, 9]);
  assert.deepEqual(db.get("snapshotIndex").get(id).entries.map((entry) => entry.id), ["snap-1"]);
  assert.equal(db.get("gameMeta").get(id).inlineRestorePoints, false, "nothing left for migrateStoreLayout to move");
});

test("emptying the trash, or an entry outliving it, leaves nothing of a deleted game behind", async () => {
  await reset();
  const emptied = await newGame("Emptied");
  const expired = await newGame("Expired");
  for (const id of [emptied, expired]) {
    await uploadGameCover(id, coverBytes(1));
    ok(await games("PUT", `${id}/snapshots`, [restorePoint(1)]));
    ok(await games("PUT", `${id}/parked-turn`, { version: 1, campaignId: id }));
    assert.deepEqual(rowsUnder(id), { cover: true, restorePoints: [`${id}/snap-1`], index: true, keptTurn: true });
  }
  ok(await games("DELETE", expired));
  db.get("trashMeta").get((await entryOf(expired)).entry).deletedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(await entryOf(expired), undefined, "past the week");
  ok(await games("DELETE", emptied));
  assert.deepEqual(ok(await trash("DELETE", "")), { removed: 1 });

  assert.equal(db.get("trash").size, 0);
  assert.equal(db.get("trashMeta").size, 0);
  for (const id of [emptied, expired]) assert.deepEqual(rowsUnder(id), NOTHING);
  assert.deepEqual([...db.get("covers").keys()], []);
  assert.deepEqual([...db.get("snapshots").keys()], []);
});
