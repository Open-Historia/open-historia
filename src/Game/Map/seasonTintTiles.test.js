// Run: node --test src/Game/Map/seasonTintTiles.test.js
//
// "antartica has this strange bug where there are triangles cut out of the
// climate zones" (the owner, 2026-11-03): the season's tint was one picture
// laid over the whole world, which MapLibre draws with half its squares
// missing near the picture's far edge once 3D terrain is on. It is tiles now,
// each cut from the picture where the map's tile lies.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { GLOBE_TOP_LAT, MERCATOR_TOP_LAT, seasonTintHeight } from "./seasonTint.js";
import { tintTileRect } from "./seasonTintTiles.js";

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`);

test("the map's tiles cover the Mercator picture exactly, row for row", () => {
  const width = 512;
  const height = seasonTintHeight(width, MERCATOR_TOP_LAT);
  const whole = tintTileRect({ z: 0, x: 0, y: 0, width, height });
  close(whole.sx, 0, "sx"); close(whole.sy, 0, "sy"); close(whole.sw, width, "sw"); close(whole.sh, height, "sh");
  // The last row at zoom 3 ends at the picture's foot; neighbours meet.
  const last = tintTileRect({ z: 3, x: 7, y: 7, width, height });
  close(last.sy + last.sh, height, "foot");
  close(last.sx + last.sw, width, "right edge");
  const above = tintTileRect({ z: 3, x: 7, y: 6, width, height });
  close(above.sy + above.sh, last.sy, "rows meet");
});

test("on the globe's taller picture the map's tiles keep inside it, the poles left beyond them", () => {
  const width = 512;
  const height = seasonTintHeight(width, GLOBE_TOP_LAT);
  const whole = tintTileRect({ z: 0, x: 0, y: 0, width, height, topLat: GLOBE_TOP_LAT });
  assert.ok(whole.sy > 0 && whole.sy + whole.sh < height);
  close(whole.sy, height - (whole.sy + whole.sh), "the same margin north and south");
});

test("the tint is a tiled raster source on the map, registered once, with no world-sized picture left", () => {
  const layers = fs.readFileSync(new URL("./SeasonLayers.jsx", import.meta.url), "utf8");
  assert.match(layers, /type="raster"\s*\n\s*tiles=\{\[`\$\{SEASON_TINT_PROTOCOL\}:\/\/\$\{drawn\.number\}\/\{z\}\/\{x\}\/\{y\}`\]\}/);
  assert.doesNotMatch(layers, /type="canvas"/);
  const setup = fs.readFileSync(new URL("./mapLibreSetup.js", import.meta.url), "utf8");
  assert.match(setup, /addProtocol\(SEASON_TINT_PROTOCOL, seasonTintTileLoader\);/);
});
