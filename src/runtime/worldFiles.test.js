// Run: node --test src/runtime/worldFiles.test.js
//
// The editor's default world and the stock world are fetched by name. On the
// website the name picks the bytes (the content origin serves only the names
// in its own table), so the deep-cleaned edition has a name of its own and is
// asked for first, with the name the origin has always known behind it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { WORLD_FILES, fetchWorldFile, worldFileUrls } from "./worldFiles.js";

const ORIGIN = "https://origin.example/content";
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

// An origin that has some names and answers 404 to the rest, as the registry
// Worker does for a name its table does not hold.
const originWith = (names) => {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url, init });
    const name = url.slice(url.lastIndexOf("/") + 1);
    return names.includes(name)
      ? { ok: true, status: 200, url, name }
      : { ok: false, status: 404, url, name };
  };
  return { asked, fetchImpl };
};

test("the website asks for the cleaned edition first and the older name second; a local build asks for its own copy", () => {
  assert.deepEqual(worldFileUrls("seed", { base: ORIGIN }), [`${ORIGIN}/regions-seed-clean.geojson`, `${ORIGIN}/regions-seed.geojson`]);
  assert.deepEqual(worldFileUrls("stock", { base: `${ORIGIN}/` }), [`${ORIGIN}/default-regions-names-clean.geojson`, `${ORIGIN}/default-regions.geojson`]);
  // The desktop and the Android app: one stable name in their own folder.
  assert.deepEqual(worldFileUrls("seed", { base: "" }), ["/assets/regions-seed.geojson"]);
  assert.deepEqual(worldFileUrls("stock", { base: "" }), ["/assets/default-regions.geojson"]);
  // This test runs with no content origin set, as those builds do.
  assert.deepEqual(worldFileUrls("seed"), ["/assets/regions-seed.geojson"]);
  assert.throws(() => worldFileUrls("tiles", { base: ORIGIN }), /unknown world file/);
});

test("an origin that does not know the newer name yet still serves the map, from the name before", async () => {
  const old = originWith(["regions-seed.geojson", "default-regions.geojson"]);
  const seed = await fetchWorldFile("seed", { cache: "force-cache" }, { base: ORIGIN, fetchImpl: old.fetchImpl });
  assert.equal(seed.ok, true);
  assert.equal(seed.name, "regions-seed.geojson");
  assert.deepEqual(old.asked.map((row) => row.url), [`${ORIGIN}/regions-seed-clean.geojson`, `${ORIGIN}/regions-seed.geojson`]);
  assert.deepEqual(old.asked.map((row) => row.init), [{ cache: "force-cache" }, { cache: "force-cache" }], "both are asked the way the caller asked");
  const stock = await fetchWorldFile("stock", undefined, { base: ORIGIN, fetchImpl: old.fetchImpl });
  assert.equal(stock.name, "default-regions.geojson");
});

test("an origin that knows the newer name is asked once", async () => {
  const current = originWith(["regions-seed-clean.geojson", "regions-seed.geojson", "default-regions-names-clean.geojson", "default-regions.geojson"]);
  const seed = await fetchWorldFile("seed", undefined, { base: ORIGIN, fetchImpl: current.fetchImpl });
  const stock = await fetchWorldFile("stock", undefined, { base: ORIGIN, fetchImpl: current.fetchImpl });
  assert.deepEqual([seed.name, stock.name], ["regions-seed-clean.geojson", "default-regions-names-clean.geojson"]);
  assert.equal(current.asked.length, 2);
});

test("an origin with neither hands back its last answer; a request that fails outright is thrown once every name has failed", async () => {
  const empty = originWith([]);
  const missing = await fetchWorldFile("seed", undefined, { base: ORIGIN, fetchImpl: empty.fetchImpl });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
  assert.equal(missing.name, "regions-seed.geojson", "the caller reads the status of the last name asked");
  let attempts = 0;
  await assert.rejects(
    fetchWorldFile("seed", undefined, { base: ORIGIN, fetchImpl: async () => { attempts += 1; throw new TypeError("offline"); } }),
    /offline/,
  );
  assert.equal(attempts, 2, "offline, both names are tried and the last failure is the caller's");

  // A self-hosted origin whose 404 carries no CORS headers: the browser
  // reports a failed request for the name it lacks, and the older name loads.
  const asked = [];
  const bucket = async (url) => {
    asked.push(url.slice(url.lastIndexOf("/") + 1));
    if (url.endsWith("/regions-seed.geojson")) return { ok: true, status: 200, url };
    throw new TypeError("Failed to fetch");
  };
  const served = await fetchWorldFile("seed", undefined, { base: ORIGIN, fetchImpl: bucket });
  assert.equal(served.ok, true);
  assert.deepEqual(asked, ["regions-seed-clean.geojson", "regions-seed.geojson"]);

  // A request the caller called off is not retried under another name.
  const controller = new AbortController();
  controller.abort();
  let afterAbort = 0;
  await assert.rejects(fetchWorldFile("seed", { signal: controller.signal }, {
    base: ORIGIN,
    fetchImpl: async () => { afterAbort += 1; throw new DOMException("aborted", "AbortError"); },
  }), { name: "AbortError" });
  assert.equal(afterAbort, 1);
  // A local build has one name: its answer is the answer.
  const local = originWith([]);
  await fetchWorldFile("stock", undefined, { base: "", fetchImpl: local.fetchImpl });
  assert.deepEqual(local.asked.map((row) => row.url), ["/assets/default-regions.geojson"]);
});

test("the names are the ones pinned: the website's list holds the first of each, the Android list lays its files under the last", () => {
  const web = readJson("../../scripts/map-assets.web.json").assets.map((entry) => entry.asset);
  assert.ok(web.includes(WORLD_FILES.seed[0]), "the signed manifest describes the edition the site asks for first");
  assert.ok(web.includes(WORLD_FILES.stock[0]));
  const android = readJson("../../mobile/map-assets.android.json").assets;
  for (const file of ["seed", "stock"]) {
    const stable = WORLD_FILES[file][WORLD_FILES[file].length - 1];
    const entry = android.find((row) => row.path === `assets/${stable}`);
    assert.ok(entry, `the Android app carries ${stable}`);
    assert.match(entry.asset, /-clean\.geojson$/, "and what it carries under that name is the cleaned edition");
  }
  // The same file under one name is one file: the stock world the site asks
  // for first is the one the desktop pins.
  const desktop = readJson("../../scripts/map-assets.json").assets.find((entry) => entry.path === "server/data/stock/regions.geojson");
  assert.equal(desktop.asset, WORLD_FILES.stock[0]);
});

test("both fetches go through this module, and nothing else spells the names", () => {
  const editor = read("../Editor/regionImport.js");
  assert.ok(editor.includes('res = await fetchWorldFile("seed", { signal });'));
  assert.ok(!/regions-seed[a-z-]*\.geojson`/.test(editor), "the editor builds no URL of its own");
  const store = read("./web/libraryStore.js");
  assert.ok(store.includes('fetchWorldFile("stock", { cache: "force-cache" })'));
  assert.ok(!store.includes("default-regions.geojson`"), "nor does the web store");
});
