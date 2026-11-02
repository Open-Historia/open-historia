/*! Open Historia — a battlefield's ground drawn on the map, and the border that moves across it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/frontGroundLayer.test.js
//
// "Battlefield ground drawn the way the ownership hand-over animation is, plus
// a moving front border." The battlefield draws its sides' regions itself, in
// place of the map's fills, with the border where the holders meet; the take
// and put pair (frontBasemapLayer.js) is kept for where it cannot.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BORDER_CASING,
  BORDER_CORE,
  FIELD_LARGEST,
  FRONT_GROUND_LAYER_ID,
  cornerColours,
  createFrontGroundLayer,
  fieldSize,
  groundBorderWidths,
  pictureRect,
} from "./frontGroundLayer.js";
import {
  CUSTOM_FILL_SOURCE,
  REPAIR_FILL_SOURCE,
  TILE_FILL_SOURCE,
  getGroundAreas,
  hiddenFillChanges,
  hiddenFillTargets,
  resetFrontGroundForTest,
  setGroundAreas,
  setGroundHeldIds,
  subscribeGroundAreas,
  subscribeGroundHeldIds,
} from "./frontGround.js";
import { FRONT_BASEMAP_PUT_LAYER_ID } from "./frontBasemapLayer.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { mercatorX, mercatorY } from "./vnext/battlefieldGround.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

test("the ground is drawn with the fills it stands in for, as the hand-over flood is, under the hairlines, the stripes of a dispute and the borders", () => {
  const at = (id) => MAP_LAYER_ORDER.indexOf(id);
  assert.ok(at(FRONT_GROUND_LAYER_ID) > 0);
  for (const fill of ["custom-regions-fill-far", "regions-fill", "custom-regions-fill", "custom-regions-repair-fill", "ownership-transition-flood", "ownership-transition-sweep-fill"]) {
    assert.ok(at(fill) < at(FRONT_GROUND_LAYER_ID), fill);
  }
  for (const over of ["custom-regions-local-outline", "custom-regions-disputed-vnext", FRONT_BASEMAP_PUT_LAYER_ID, "group-areas-tint", "fronts-paint-0", "polity-boundaries-shadow", "polity-boundaries"]) {
    assert.ok(at(FRONT_GROUND_LAYER_ID) < at(over), over);
  }
});

test("the border is the map's own: its widths for the zoom, its dark line and casing", () => {
  assert.deepEqual(groundBorderWidths(1), { core: 0.58, casing: 1.8, blur: 0.7 });
  assert.deepEqual(groundBorderWidths(0), { core: 0.58, casing: 1.8, blur: 0.7 }, "held at the end stops");
  assert.deepEqual(groundBorderWidths(14), { core: 2.08, casing: 5.8, blur: 1.5 });
  const mid = groundBorderWidths(7.5);
  assert.ok(Math.abs(mid.core - (1.34 + 1.72) / 2) < 1e-9);
  assert.ok(Math.abs(mid.casing - (3.6 + 4.7) / 2) < 1e-9);
  // The very lines Nations draws, from the same lists.
  const nations = read("./Nations.jsx");
  assert.ok(nations.includes(`"line-width": ["interpolate", ["linear"], ["zoom"], ...POLITY_BOUNDARY_WIDTH_STOPS.flat()],`));
  assert.ok(nations.includes(`"line-width": ["interpolate", ["linear"], ["zoom"], ...POLITY_BOUNDARY_SHADOW_WIDTH_STOPS.flat()],`));
  assert.ok(nations.includes(`"line-color": "rgba(5, 8, 13, 0.96)",`) && nations.includes(`"line-opacity": customActive && worldKnown ? 0.94 : 0,`));
  assert.ok(nations.includes(`"line-color": "rgba(1, 4, 8, 0.72)",`) && nations.includes(`"line-opacity": customActive && worldKnown ? 0.52 : 0,`));
  assert.deepEqual(BORDER_CORE.rgb.map((part) => Math.round(part * 255)), [5, 8, 13]);
  assert.ok(Math.abs(BORDER_CORE.alpha - 0.94 * 0.96) < 1e-9);
  assert.deepEqual(BORDER_CASING.rgb.map((part) => Math.round(part * 255)), [1, 4, 8]);
  assert.ok(Math.abs(BORDER_CASING.alpha - 0.52 * 0.72) < 1e-9);
});

test("a picture's place, its regions' colours and the field's size", () => {
  const rect = pictureRect([[20, 52], [28, 52], [28, 46], [20, 46]]);
  assert.deepEqual(rect, [mercatorX(20), mercatorY(52), mercatorX(28), mercatorY(46)]);
  assert.ok(rect[1] < rect[3], "north is the top of the sheet");
  assert.equal(pictureRect(null), null);
  assert.equal(pictureRect([[0, 0], [1, 0], [1, NaN], [0, 1]]), null);

  const colours = cornerColours(new Float32Array([0, 0, 0, 1, 1, 1]), [[255, 0, 0], [0, 0, 255]]);
  assert.deepEqual([...colours.slice(0, 3)], [1, 0, 0]);
  assert.deepEqual([...colours.slice(9, 12)], [0, 0, 1]);

  assert.deepEqual(fieldSize(200, 100), [800, 400]);
  const [width, height] = fieldSize(4000, 1000);
  assert.equal(width, FIELD_LARGEST);
  assert.equal(height, FIELD_LARGEST / 4, "the picture's shape kept");
});

test("without WebGL 2 the layer says at once it cannot draw, and the pair takes over", async () => {
  const states = [];
  const errors = [];
  const layer = createFrontGroundLayer({ areas: () => [], onState: (working) => states.push(working), onError: (error) => errors.push(error) });
  assert.equal(layer.id, FRONT_GROUND_LAYER_ID);
  assert.equal(layer.type, "custom");
  layer.onAdd({}, {});
  await Promise.resolve();
  assert.deepEqual(states, [false]);
  assert.match(String(errors[0]?.message), /WebGL 2/);
  // Nothing more is drawn or touched.
  const gl = new Proxy({}, { get: () => { throw new Error("the map was touched"); } });
  layer.render(gl, {});
  layer.prerender(gl, {});
  assert.equal(layer.drawn, 0);
  // The fallback: the pair goes on only once the layer has said so, and the map's own picture layers only past that.
  const layers = read("./FrontLayers.jsx");
  assert.ok(layers.includes(`onState: (working) => setGround((now) => (now === "failed" ? now : working ? "working" : "failed")),`));
  assert.ok(layers.includes("const painted = anyPainted && groundFailed;"));
});

test("hidden fills: the sweep and the ground together, where each region is drawn", () => {
  const targets = hiddenFillTargets({ sweep: ["a", "b"], ground: ["b", "c"], repaired: new Set(["a", "c"]), tiles: true });
  assert.deepEqual([...targets.keys()].sort(), [
    `${CUSTOM_FILL_SOURCE}\u001fa`,
    `${CUSTOM_FILL_SOURCE}\u001fb`,
    `${CUSTOM_FILL_SOURCE}\u001fc`,
    `${REPAIR_FILL_SOURCE}\u001fa`,
    `${REPAIR_FILL_SOURCE}\u001fc`,
    `${TILE_FILL_SOURCE}\u001fb`,
    `${TILE_FILL_SOURCE}\u001fc`,
  ].sort());
  assert.deepEqual(targets.get(`${TILE_FILL_SOURCE}\u001fc`), { source: TILE_FILL_SOURCE, sourceLayer: "regions", id: "c" });
  assert.ok(!targets.has(`${TILE_FILL_SOURCE}\u001fa`), "the sweep leaves the stock tiles be, as it always has");

  // The sweep lets go of b; the ground still holds it, so it stays hidden; a is shown again.
  const written = new Map(targets);
  const after = hiddenFillTargets({ sweep: [], ground: ["b", "c"], repaired: new Set(["a", "c"]), tiles: true });
  const { hide, show } = hiddenFillChanges(written, after);
  assert.deepEqual(hide, []);
  assert.deepEqual(show.map(([key]) => key).sort(), [`${CUSTOM_FILL_SOURCE}\u001fa`, `${REPAIR_FILL_SOURCE}\u001fa`].sort());
});

test("the battlefields told once, and what is hidden told back", () => {
  resetFrontGroundForTest();
  const told = [];
  subscribeGroundAreas((areas) => told.push(areas.length));
  assert.equal(setGroundAreas([{ key: "1:Front", bounds: [0, 0, 1, 1], members: ["Alpha", "Beta"] }]), true);
  assert.equal(setGroundAreas([{ key: "1:Front", bounds: [0, 0, 1, 1], members: ["Alpha", "Beta"] }]), false, "the same again tells nobody");
  assert.equal(setGroundAreas([{ key: "", bounds: [0, 0, 1, 1] }]), true, "one without a key is no battlefield");
  assert.deepEqual(getGroundAreas(), []);
  assert.deepEqual(told, [1, 0]);
  const held = [];
  subscribeGroundHeldIds((ids) => held.push([...ids]));
  setGroundHeldIds(["a", "b"]);
  setGroundHeldIds(["b", "a"]);
  assert.deepEqual(held, [["a", "b"]]);
  resetFrontGroundForTest();
});

test("the political map holds the fills through one ledger, and asks for the ground again after a held patch", () => {
  const nations = read("./Nations.jsx");
  // The sweep no longer writes the hidden flag itself.
  assert.ok(nations.includes(`    const setBaseHidden = (hidden) => {
      hiddenFillRef.current.sweep = hidden ? [...sweep.regionIds] : [];
      writeHiddenFillsRef.current();
    };`));
  assert.equal(nations.split("{ ownershipTransitionHidden: hidden }").length, 2, "one writer of the flag");
  assert.doesNotMatch(nations, /\{ ownershipTransitionHidden: Boolean\(hidden\) \}/);
  // A battlefield is drawn once its regions are hidden, and told which are.
  assert.ok(nations.includes("setGroundHeldIds(state.ground.filter((id) => state.written.has(`${CUSTOM_FILL_SOURCE}\\u001f${id}`)));"));
  // The boundary patch the sweep held back was made before the newest answer about the battlefields.
  assert.match(nations, /ownershipPresentation\.releaseEntry\(queued\);[\s\S]{0,200}?battlefieldGroundRequestRef\.current\?\.\(true\);/);
  assert.match(nations, /messageType === "battlefield-ground-result"[\s\S]{0,600}?updateBoundarySourceFromPatch\(patch\)/);
  // FrontLayers tells the battlefields only while its layer can draw them.
  const layers = read("./FrontLayers.jsx");
  assert.match(layers, /const drawing = ground === "working";\s*setGroundAreas\(drawing \?/);
});

test("the ground's shader: the border by the screen's own pixels, the holder read smoothly, nothing of the screen copied", () => {
  const source = read("./frontGroundLayer.js");
  assert.ok(source.includes("vec2 dx = dFdx(v_uv);"));
  assert.ok(source.includes("textureLod(u_paint, uv, 0.0)") && source.includes("gl.LINEAR"));
  assert.ok(!source.includes("copyTexImage2D"), "no copy of the screen");
  assert.ok(source.includes("gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);"));
  // The picture is taken up only when it has been painted anew.
  assert.ok(source.includes("entry.version !== area.version"));
  // No gradient of any kind is drawn: plain colours.
  assert.doesNotMatch(source, /createLinearGradient|createRadialGradient|linear-gradient|radial-gradient/);
});
