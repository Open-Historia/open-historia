/*! Open Historia — the downloaded map files are served at /assets, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/mapAssetsServed.test.js
//
// A player's log, 2026-11-06 (desktop beta): "the world city list could not be read … not a list of cities" on every
// skip. A packaged build has no map files in dist/: they are downloaded after install into OH_ASSETS_DIR, and
// /assets/cities-seed.json fell through to the SPA fallback, answered with index.html and a 200.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const at = (needle) => {
  const index = server.indexOf(needle);
  assert.ok(index >= 0, `server.js has ${needle}`);
  return index;
};

test("the downloaded map folder is served at /assets after the build's files and before the app's page", () => {
  const dist = at("app.use(express.static(distDir));");
  const maps = at(`app.use("/assets", express.static(MAP_ASSETS_DIR, { index: false }));`);
  const missing = at(`app.use("/assets", (_req, res) => { res.status(404).type("text/plain").send("Not found"); });`);
  const page = at(`app.get("*splat", (_req, res) => {`);
  assert.ok(dist < maps && maps < missing && missing < page, "dist/, then the map folder, then a 404, then the page");
  assert.match(server, /MAP_ASSETS_DIR,\n\} from "\.\/libraryStore\.js";/);
});

test("the folder is the one the map download writes and the pmtiles are read from", () => {
  const store = fs.readFileSync(new URL("./libraryStore.js", import.meta.url), "utf8");
  assert.match(store, /const PMTILES_ASSETS_DIR = process\.env\.OH_ASSETS_DIR/);
  assert.match(store, /export const MAP_ASSETS_DIR = PMTILES_ASSETS_DIR;/);
  const manifest = JSON.parse(fs.readFileSync(new URL("../scripts/map-assets.json", import.meta.url), "utf8"));
  assert.ok(manifest.assets.some((asset) => asset.path === "public/assets/cities-seed.json"), "the city list is one of the downloaded files");
});
