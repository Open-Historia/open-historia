import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../src/Game/Map/unitsController.js");
const source = fs.readFileSync(sourcePath, "utf8");

test("unit map sync is event-driven and never polls world.json every five seconds", () => {
  assert.doesNotMatch(source, /setInterval\s*\(\s*refresh\s*,\s*5000\s*\)/);
  assert.doesNotMatch(source, /readWorldState\s*\(\s*\{\s*force:\s*true\s*\}\s*\)[\s\S]{0,600}setInterval/);
  assert.match(source, /addEventListener\("oh:world-updated"/);
  assert.match(source, /addEventListener\("oh:game-updated"/);
  assert.match(source, /readWorldStateView\(\{\s*force:\s*false\s*\}\)/);
});

test("camera-motion LOD is not allowed to hide political labels", () => {
  const nationsPath = path.resolve(here, "../src/Game/Map/Nations.jsx");
  const nations = fs.readFileSync(nationsPath, "utf8");
  assert.doesNotMatch(nations, /mapMoving\s*\?\s*"none"/);
  assert.doesNotMatch(nations, /hideCountryLabels\s*\|\|\s*mapMoving/);
});

test("R5 startup never warms complete PMTiles archives", () => {
  const preload = fs.readFileSync(path.resolve(here, "../src/runtime/preload.js"), "utf8");
  assert.doesNotMatch(preload, /warmPmtilesArchive/);
  assert.doesNotMatch(preload, /PMTILES_ARCHIVES/);
});

test("R5 authored region geometry is parsed by the worker and streamed to MapLibre by URL", () => {
  const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
  const worker = fs.readFileSync(path.resolve(here, "../src/Game/Map/vnext/polityBoundariesWorker.js"), "utf8");
  assert.match(nations, /regionsUrl:\s*regionsGeojsonUrl/);
  assert.doesNotMatch(nations, /worker\.postMessage\(\{[\s\S]{0,220}regions:\s*customRegionData/);
  assert.match(nations, /data=\{vNext \? regionsGeojsonUrl : enrichedCustomRegionData\}/);
  assert.match(worker, /fetch\(url, \{ cache: "default", credentials: "same-origin" \}\)/);
  assert.match(worker, /JSON\.parse\(text\)/);
});

test("R5 polity label renderer is constant-layer rather than tier-expanded", () => {
  const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
  assert.doesNotMatch(nations, /LIVE_POLITY_LABEL_TIERS\.flatMap/);
  for (const id of [
    "country-labels-live-managed",
    "country-labels-live-overlap",
    "country-line-labels-live-world",
    "country-line-labels-live-detail",
  ]) {
    assert.match(nations, new RegExp(`id=["']${id}["']`));
  }
});

test("R5 fully authored maps can omit the stock region PMTiles source", () => {
  const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
  assert.match(nations, /fullyAuthoredGeometry/);
  assert.match(nations, /shouldMountStockRegions/);
  assert.match(nations, /\{shouldMountStockRegions && \(/);
});

test("R5 map-facing world state has no forced safety polling", () => {
  const worldState = fs.readFileSync(path.resolve(here, "../src/Game/Map/useWorldState.js"), "utf8");
  assert.doesNotMatch(worldState, /POLL_MS|RETRY_BUSY_MS|scheduleIdlePoll|world external safety poll/);
  assert.doesNotMatch(worldState, /readJson\([\s\S]{0,240}force:\s*true/);
  assert.match(worldState, /addEventListener\("oh:world-updated"/);
});

test("R5 locked-2D map does not bind DEM terrain and exposes drag performance", () => {
  const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");
  assert.match(world, /const terrain = null;/);
  assert.match(world, /crossSourceCollisions=\{true\}/);
  assert.match(world, /__OH_LAST_MAP_PERF__/);
  assert.doesNotMatch(world, /React\.Profiler id="MapTree"/);
});

test("R5 does not compile hidden Advisor\/Cheats or run watchdog during map idle", () => {
  const main = fs.readFileSync(path.resolve(here, "../src/Game/GameUI/main.jsx"), "utf8");
  assert.doesNotMatch(main, /requestIdleCallback\(warm/);
  assert.doesNotMatch(main, /installPerformanceWatchdog\(\)/);
  assert.match(main, /window\.__OH_MAP_MOVING__/);
});
