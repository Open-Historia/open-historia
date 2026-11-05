// Run: node --test src/runtime/worldFiles.test.js
//
// Every build reads its map data from its own /assets folder under the same
// stable names. The website and the Android app are one bundle and carry one
// set of files, pinned in scripts/map-assets.web.json and laid into the build
// by scripts/stage-map-assets.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ASSETS_BASE, WORLD_FILES, mapArchiveUrl, worldFileUrl } from "./worldFiles.js";
import { SITE_FILE_LIMIT_BYTES, layMapAssets, readWebMapManifest } from "../../scripts/stage-map-assets.mjs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

test("a world file and a map archive are asked of the build's own assets folder", () => {
  // No base path here, as on the desktop and in the Android app. On
  // openhistoria.com the build's base is /play/ and the folder follows it.
  assert.equal(ASSETS_BASE, "/assets");
  assert.equal(worldFileUrl("seed"), "/assets/regions-seed.geojson");
  assert.equal(worldFileUrl("stock"), "/assets/default-regions.geojson");
  assert.equal(worldFileUrl("cities"), "/assets/cities-seed.json");
  assert.equal(mapArchiveUrl("regions"), "/assets/regions.pmtiles");
  assert.throws(() => worldFileUrl("tiles"), /unknown world file/);
  assert.ok(read("./worldFiles.js").includes("import.meta.env?.BASE_URL"), "the folder hangs off the build's base path");
});

test("the web build's list lays a file under every name the app asks for", () => {
  const { assets, release } = readWebMapManifest();
  assert.equal(release, "map-data");
  const paths = assets.map((entry) => entry.path).sort();
  const asked = [
    ...Object.values(WORLD_FILES).map((name) => `assets/${name}`),
    ...["regions", "countries", "cities"].map((key) => `assets/${key}.pmtiles`),
  ].sort();
  assert.deepEqual(paths, asked);
  for (const entry of assets) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${entry.asset} is pinned by sha256`);
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0, `${entry.asset} is pinned by size`);
  }
});

test("every file the website carries fits its host's limit for one file", () => {
  // Cloudflare Pages refuses a file over 25 MiB after reporting the deploy as a
  // success; the deploy workflow checks the built site for one over 24.
  assert.equal(SITE_FILE_LIMIT_BYTES, 25 * 1024 * 1024);
  for (const entry of readWebMapManifest().assets) {
    assert.ok(entry.bytes <= 24 * 1024 * 1024, `${entry.asset} is ${(entry.bytes / 1048576).toFixed(1)} MiB`);
  }
});

test("the web build and the desktop pin the same z8 archives, and each its own cut of the world", () => {
  const web = Object.fromEntries(readWebMapManifest().assets.map((entry) => [entry.path, entry]));
  const desktop = Object.fromEntries(readJson("../../scripts/map-assets.json").assets.map((entry) => [entry.path.replace(/^public\//, ""), entry]));
  for (const name of ["assets/regions.pmtiles", "assets/countries.pmtiles", "assets/cities.pmtiles", "assets/cities-seed.json"]) {
    assert.equal(web[name].sha256, desktop[name].sha256, `${name} is one file on every build`);
  }
  // The editor's default world and the stock world are the deep-cleaned
  // editions on both, in the size each can hold.
  assert.match(web["assets/regions-seed.geojson"].asset, /-clean\.geojson$/);
  assert.match(desktop["assets/regions-seed.geojson"].asset, /-clean\.geojson$/);
  assert.notEqual(web["assets/regions-seed.geojson"].sha256, desktop["assets/regions-seed.geojson"].sha256);
  // The stock world's owners are country names on both: the web-sized one is
  // built from its seed by the script that builds the desktop's.
  assert.match(web["assets/default-regions.geojson"].asset, /^default-regions-names-/);
  const desktopStock = readJson("../../scripts/map-assets.json").assets.find((entry) => entry.path === "server/data/stock/regions.geojson");
  assert.match(desktopStock.asset, /^default-regions-names-/);
});

test("the Android app carries the website's files: one list, one stager", () => {
  assert.ok(!fs.existsSync(new URL("../../mobile/map-assets.android.json", import.meta.url)), "there is no second list to drift");
  const mobile = read("../../mobile/scripts/stage-map-assets.mjs");
  assert.ok(mobile.includes('from "../../scripts/stage-map-assets.mjs"'));
  const scripts = readJson("../../package.json").scripts;
  for (const name of ["build:web", "build:site"]) {
    assert.ok(scripts[name].includes("node scripts/stage-map-assets.mjs dist-web"), `${name} lays the map into the site`);
  }
  assert.ok(scripts["build:site"].indexOf("stage-map-assets.mjs dist-web") < scripts["build:site"].indexOf("assemble-site.mjs"), "before the site is assembled from it");
});

test("the stager lays each file at its stable name, and can leave a folder's own copies alone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-stage-"));
  try {
    const cache = path.join(root, "cache");
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, "regions-z8.pmtiles"), "archive");
    fs.writeFileSync(path.join(cache, "world-web.geojson"), "web world");
    const staged = [
      { asset: "regions-z8.pmtiles", path: "assets/regions.pmtiles", bytes: 7, file: path.join(cache, "regions-z8.pmtiles") },
      { asset: "world-web.geojson", path: "assets/regions-seed.geojson", bytes: 9, file: path.join(cache, "world-web.geojson") },
    ];
    const out = path.join(root, "dist-web");
    fs.mkdirSync(out);
    assert.deepEqual(layMapAssets(staged, out), { laid: 2, bytes: 16 });
    assert.equal(fs.readFileSync(path.join(out, "assets", "regions.pmtiles"), "utf8"), "archive");
    assert.equal(fs.readFileSync(path.join(out, "assets", "regions-seed.geojson"), "utf8"), "web world");

    // A developer's public/ holds the desktop's world under the same name.
    const dev = path.join(root, "public");
    fs.mkdirSync(path.join(dev, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dev, "assets", "regions-seed.geojson"), "desktop world");
    assert.deepEqual(layMapAssets(staged, dev, { missingOnly: true }), { laid: 1, bytes: 7 });
    assert.equal(fs.readFileSync(path.join(dev, "assets", "regions-seed.geojson"), "utf8"), "desktop world");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("nothing in the app names a content origin or a node any more", () => {
  for (const file of ["../Editor/regionImport.js", "../Editor/citiesImport.js", "./web/libraryStore.js", "./web/router.js", "./web/index.js", "./assets.js", "../Game/AI/worldCities.js", "../Game/AI/promptContext.js"]) {
    const text = read(file);
    assert.ok(!/VITE_OH_PMTILES_URL|VITE_OH_DIRECTORY_URL|contentTrust|nodeConnect|connectBestNode/.test(text), file);
  }
  assert.ok(read("../Editor/regionImport.js").includes('export const SEED_URL = worldFileUrl("seed");'));
  assert.ok(read("./web/libraryStore.js").includes('fetch(worldFileUrl("stock"), { cache: "force-cache" })'));
  assert.ok(read("./web/router.js").includes("return fetch(new Request(mapArchiveUrl(key), {"));
  const env = read("../../.env.web");
  assert.ok(!/^VITE_OH_PMTILES_URL=|^VITE_OH_DIRECTORY_URL=/m.test(env), "the website's build is given no content origin");
});
