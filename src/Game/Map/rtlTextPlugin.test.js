/*! Open Historia — right-to-left map text tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/rtlTextPlugin.test.js
//
// Arabic, Persian and Urdu labels need MapLibre's right-to-left plugin (PR #969). It is the package's own file,
// pinned in the lockfile with its integrity, served by the game and fetched only once such a label is drawn: never
// a CDN (the PR first loaded it from unpkg.com, with no integrity check).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("the plugin is the game's own file, registered once and lazily", () => {
  const setup = read("./mapLibreSetup.js");
  assert.match(setup, /import rtlTextPluginUrl from "\.\.\/\.\.\/\.\.\/node_modules\/@mapbox\/mapbox-gl-rtl-text\/dist\/mapbox-gl-rtl-text\.js\?url";/);
  assert.match(setup, /getRTLTextPluginStatus\?\.\(\) === "unavailable"/, "MapLibre throws when it is set twice");
  assert.match(setup, /setRTLTextPlugin\(rtlTextPluginUrl, true\)/, "lazy: a game with no such label never loads it");
});

test("the package is pinned, with its integrity, and nothing loads map scripts from a CDN", () => {
  const manifest = JSON.parse(read("../../../package.json"));
  assert.equal(manifest.dependencies["@mapbox/mapbox-gl-rtl-text"], "0.3.0");
  const lock = JSON.parse(read("../../../package-lock.json"));
  const entry = lock.packages["node_modules/@mapbox/mapbox-gl-rtl-text"];
  assert.equal(entry.version, "0.3.0");
  assert.match(entry.integrity, /^sha512-/);
  const setup = read("./mapLibreSetup.js");
  assert.doesNotMatch(setup, /unpkg\.com|jsdelivr|cdnjs/);
});
