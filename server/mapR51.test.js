import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nations = fs.readFileSync(path.resolve(here, "../src/Game/Map/Nations.jsx"), "utf8");
const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");

test("R5.1 polity layers have valid explicit GeoJSON sources", () => {
  assert.match(nations, /id="country-labels-live-managed"\s+source="country-live-polity-point-label-source"/);
  assert.match(nations, /id="country-labels-live-overlap"\s+source="country-live-polity-point-label-source"/);
  assert.match(nations, /id="country-line-labels-live-world"\s+source="country-live-polity-line-label-source"/);
  assert.match(nations, /id="country-line-labels-live-detail"\s+source="country-live-polity-line-label-source"/);
  assert.doesNotMatch(nations, /Invalid prop "source"/);
});

test("R5.1 never changes framebuffer density at zoom thresholds", () => {
  assert.doesNotMatch(world, /applyDynamicPixelRatio/);
  assert.doesNotMatch(world, /zoom <= 4\.5|zoom >= 5/);
  assert.match(world, /setPixelRatio\(1\)/);
});
