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
  FRONT_GROUND_LAYER_ID,
  copiesOverTile,
  cornerColours,
  createFrontGroundLayer,
  groundBorderWidths,
  lineCoverage,
  pictureRect,
  tilePixelsPerScreenPixel,
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

test("a picture's place and its regions' colours", () => {
  const rect = pictureRect([[20, 52], [28, 52], [28, 46], [20, 46]]);
  assert.deepEqual(rect, [mercatorX(20), mercatorY(52), mercatorX(28), mercatorY(46)]);
  assert.ok(rect[1] < rect[3], "north is the top of the sheet");
  assert.equal(pictureRect(null), null);
  assert.equal(pictureRect([[0, 0], [1, 0], [1, NaN], [0, 1]]), null);

  const colours = cornerColours(new Float32Array([0, 0, 0, 1, 1, 1]), [[255, 0, 0], [0, 0, 255]]);
  assert.deepEqual([...colours.slice(0, 3)], [1, 0, 0]);
  assert.deepEqual([...colours.slice(9, 12)], [0, 0, 1]);

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

test("the ground's border has the map's own edge, and is traced from the front's field, nothing of the screen copied", () => {
  // MapLibre's line (line.vertex.glsl, line.fragment.glsl): solid to half a device pixel past the half
  // width less the fade, gone half a device pixel past it, the fade the blur and one device pixel.
  assert.equal(lineCoverage(0, 2), 1);
  assert.equal(lineCoverage(1.5, 2), 0);
  assert.ok(Math.abs(lineCoverage(1, 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(lineCoverage(1.2, 2, 0, 2) - 0.1) < 1e-9 && Math.abs(lineCoverage(1.2, 2) - 0.3) < 1e-9, "on a sharper screen the edge is half as soft");
  assert.ok(lineCoverage(2, 4, 1) > 0 && lineCoverage(2, 4, 1) < 1, "a blurred casing fades over its blur");
  const source = read("./frontGroundLayer.js");
  // The same rule in the shader, in device pixels.
  assert.ok(source.includes("return clamp((0.5 * width + 0.5 - far) / (blur + 1.0), 0.0, 1.0);"));
  // Half-way across the front's field, so many screen pixels from it by how fast it changes there.
  assert.ok(source.includes("float side = front.r - 0.5;") && source.includes("vec2 change = vec2(dFdx(side), dFdy(side));") && source.includes("float far = abs(side) / steep;"));
  // Only where the run moved the front (the field's green), never from the colours of the picture.
  assert.ok(source.includes("front.g > 0.0"));
  assert.doesNotMatch(source, /holder\(|u_field/);
  assert.ok(source.includes("gl.LINEAR"));
  assert.ok(!source.includes("copyTexImage2D"), "no copy of the screen");
  assert.ok(source.includes("gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);"));
  // The picture and the field are taken up only when they have been drawn anew.
  assert.ok(source.includes("entry.version !== area.version") && source.includes("entry.frontVersion !== front.version"));
  // No gradient of any kind is drawn: plain colours.
  assert.doesNotMatch(source, /createLinearGradient|createRadialGradient|linear-gradient|radial-gradient/);
});

// "3d terrain and warfronts do not seem to work together, the war terrain is not 3d" (the owner, 2026-11-09).
test("a terrain tile's place and the width of a line in it", () => {
  // A 1024-pixel tile seen at its own zoom: two of its pixels a screen pixel; a zoom in, one.
  assert.equal(tilePixelsPerScreenPixel(1024, 6, 6), 2);
  assert.equal(tilePixelsPerScreenPixel(1024, 6, 7), 1);
  assert.equal(tilePixelsPerScreenPixel(1024, 6, 6.5), 2 / Math.SQRT2);
  // The copies of the world a mesh lies in over a tile; none when it is above or below it.
  const tile = [0.5, 0.25, 0.625, 0.375];
  assert.deepEqual(copiesOverTile([0.55, 0.3, 0.6, 0.35], tile), [0]);
  assert.deepEqual(copiesOverTile([1.52, 0.3, 1.6, 0.35], tile), [-1]);
  assert.deepEqual(copiesOverTile([-0.45, 0.3, -0.4, 0.35], tile), [1]);
  assert.deepEqual(copiesOverTile([0.55, 0.4, 0.6, 0.45], tile), []);
  assert.deepEqual(copiesOverTile([0.7, 0.3, 0.8, 0.35], tile), []);
  assert.deepEqual(copiesOverTile(null, tile), [0]);
});

test("with the 3D terrain on the ground is drawn into the terrain's tiles, made ready once for what it shows", async () => {
  class FakeWebGL2 {}
  const had = Object.prototype.hasOwnProperty.call(globalThis, "WebGL2RenderingContext");
  const before = globalThis.WebGL2RenderingContext;
  globalThis.WebGL2RenderingContext = FakeWebGL2;
  try {
    const calls = {};
    const drawn = [];
    const tiles = [];
    const lines = [];
    const count = (name, result) => (...args) => {
      calls[name] = (calls[name] ?? 0) + 1;
      return typeof result === "function" ? result(...args) : result;
    };
    const locations = new Map();
    const gl = new Proxy(Object.create(FakeWebGL2.prototype), {
      get(target, name) {
        if (name === "drawArrays") return (mode, first, number) => drawn.push(number);
        if (name === "uniform4f") {
          return (location, ...values) => {
            if (locations.get(location) === "u_tile") tiles.push(values);
          };
        }
        if (name === "uniform3f") {
          return (location, ...values) => {
            if (locations.get(location) === "u_line") lines.push(values);
          };
        }
        if (name === "getUniformLocation") {
          return (program, uniform) => {
            const location = { uniform };
            locations.set(location, uniform);
            return location;
          };
        }
        if (typeof name === "string" && /^[A-Z0-9_]+$/.test(name)) return 1;
        if (["createTexture", "createBuffer", "createProgram", "createShader"].includes(name)) return count(name, () => ({}));
        if (name === "getShaderParameter" || name === "getProgramParameter") return count(name, true);
        if (name === "getAttribLocation") return count(name, 0);
        if (name === "getParameter") return count(name, false);
        if (typeof name === "symbol" || name === "then") return undefined;
        return count(name);
      },
    });
    const map = { getZoom: () => 6, terrain: { tileManager: { tileSize: 512 } } };
    // One region, two triangles over the whole frame.
    const corners = [[20, 52], [28, 52], [28, 46], [20, 46]];
    const [left, top, right, bottom] = pictureRect(corners);
    const area = {
      key: "1:Front",
      canvas: {},
      version: 1,
      front: { data: new Uint8Array(4), width: 1, height: 1, version: 1 },
      coordinates: corners,
      meshId: "m1",
      positions: new Float32Array([left, top, right, top, right, bottom, left, top, right, bottom, left, bottom]),
      regionOf: new Float32Array(6),
      colours: [[200, 40, 40]],
      colourKey: "200,40,40",
      ready: true,
    };
    const layer = createFrontGroundLayer({ areas: () => [area] });
    layer.onAdd(map, gl);
    const revision = layer.terrainTileRevision;
    assert.equal(layer.terrainTileRevision, revision, "the same ground, the same number");
    // The z6 tile under the frame (x 35 of 64: 16.9 to 22.5 degrees east), and one far from it.
    const under = { canonical: { x: 35, y: 21, z: 6 }, wrap: 0 };
    layer.renderToTerrainTile(gl, { tileID: under, width: 1024, height: 1024 });
    layer.renderToTerrainTile(gl, { tileID: under, width: 1024, height: 1024 });
    layer.renderToTerrainTile(gl, { tileID: { canonical: { x: 10, y: 21, z: 6 }, wrap: 0 }, width: 1024, height: 1024 });
    assert.deepEqual(drawn, [6, 6], "drawn into the tile under it, not the other");
    assert.deepEqual(tiles[0], [35 / 64, 21 / 64, 64, 0]);
    assert.equal(calls.texImage2D, 2, "the picture and the field taken up once, not once a tile");
    // A 1024-pixel tile at its own zoom: two of its pixels a screen pixel, so every width drawn doubled.
    const widths = groundBorderWidths(6);
    assert.deepEqual(lines[0], [widths.core * 2, widths.casing * 2, widths.blur * 2]);
    // A 512-pixel DEM makes the fork's tile manager 1024: the tile still covers MapLibre's 512-pixel world
    // tile on screen, so the widths are the same, not halved.
    map.terrain.tileManager.tileSize = 1024;
    layer.renderToTerrainTile(gl, { tileID: under, width: 1024, height: 1024 });
    assert.deepEqual(lines.at(-1), lines[0]);
    map.terrain.tileManager.tileSize = 512;
    assert.equal(calls.bufferData, 2);
    // Painted again: a new number, so MapLibre draws the tiles again, and the picture is taken up anew.
    area.version = 2;
    assert.ok(layer.terrainTileRevision > revision);
    layer.renderToTerrainTile(gl, { tileID: under, width: 1024, height: 1024 });
    assert.equal(calls.texImage2D, 3);
    // Not yet ready (the map's fills of its regions not hidden): not drawn, so no region is drawn twice.
    area.ready = false;
    assert.ok(layer.terrainTileRevision > revision + 1);
    layer.renderToTerrainTile(gl, { tileID: under, width: 1024, height: 1024 });
    assert.equal(drawn.length, 4);
    layer.onRemove(map, gl);
  } finally {
    if (had) globalThis.WebGL2RenderingContext = before;
    else delete globalThis.WebGL2RenderingContext;
  }
});
