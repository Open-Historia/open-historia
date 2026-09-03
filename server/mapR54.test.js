import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const world = fs.readFileSync(path.resolve(here, "../src/Game/Map/World.jsx"), "utf8");

test("R5.4+ ETOPO relief remains fixed at z3 and overzoomed thereafter", () => {
  const match = world.match(/"pax-world-relief":\s*\{[\s\S]*?maxzoom:\s*(\d+)/);
  assert.ok(match);
  assert.equal(Number(match[1]), 3);
  assert.doesNotMatch(world, /"pax-world-relief":\s*\{[\s\S]*?maxzoom:\s*[456789]/);
});

test("R5.4+ relief still fades with camera zoom rather than loading finer ETOPO LODs", () => {
  assert.match(world, /const PAX_WORLD_RELIEF_PAINT = \{[\s\S]*?"raster-opacity":\s*\[/);
  assert.match(world, /4\.85,\s*0/);
});
