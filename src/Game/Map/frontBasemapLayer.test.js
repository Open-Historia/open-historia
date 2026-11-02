/*! Open Historia — the bare map put back under a battlefield's painted ground: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/frontBasemapLayer.test.js
//
// "With different basemaps the color looks really different, especially the
// dark style basemaps." "Make the painted ground just make the territory
// color behind it fully see-through so the background is the basemap and it
// doesn't stack colors." The painted ground used to be cleared to a fixed pale
// grey; now the basemap itself is copied from under the territory fills and
// put back where the ground is painted.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FRONT_BASEMAP_PUT_LAYER_ID, FRONT_BASEMAP_TAKE_LAYER_ID, MESH_STEPS, createFrontBasemapLayers, pictureMesh } from "./frontBasemapLayer.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

test("the copy is taken under every territory fill and put back over them all, under the paint", () => {
  const at = (id) => MAP_LAYER_ORDER.indexOf(id);
  assert.equal(at(FRONT_BASEMAP_TAKE_LAYER_ID), 0, "nothing of the map's own politics is under it");
  for (const fill of ["custom-regions-fill-far", "regions-fill", "custom-regions-fill", "custom-regions-repair-fill", "custom-regions-disputed-vnext"]) {
    assert.ok(at(FRONT_BASEMAP_TAKE_LAYER_ID) < at(fill) && at(fill) < at(FRONT_BASEMAP_PUT_LAYER_ID), fill);
  }
  assert.ok(at(FRONT_BASEMAP_PUT_LAYER_ID) < at("fronts-paint-0"));
  assert.ok(at(FRONT_BASEMAP_PUT_LAYER_ID) < at("polity-boundaries"), "borders and labels are drawn over it as ever");
});

test("a picture's mesh covers it corner to corner, its rows even on the flat sheet", () => {
  const mesh = pictureMesh([[20, 52], [28, 52], [28, 46], [20, 46]]);
  assert.equal(mesh.length, MESH_STEPS * MESH_STEPS * 6 * 4);
  let [west, east, north, south] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let index = 0; index < mesh.length; index += 4) {
    west = Math.min(west, mesh[index]);
    east = Math.max(east, mesh[index]);
    north = Math.min(north, mesh[index + 1]);
    south = Math.max(south, mesh[index + 1]);
    // A place in the picture goes with its place on the sheet: straight across, and straight down.
    assert.ok(Math.abs(mesh[index + 2] - (mesh[index] - (20 + 180) / 360) / ((28 - 20) / 360)) < 1e-4);
  }
  assert.ok(Math.abs(west - 200 / 360) < 1e-6 && Math.abs(east - 208 / 360) < 1e-6);
  // North is the top of the sheet and of the picture (v = 0).
  assert.ok(north < south);
  const top = [...mesh].findIndex((value, index) => index % 4 === 3 && value === 0);
  assert.ok(Math.abs(mesh[top - 2] - north) < 1e-6);
  assert.equal(pictureMesh(null).length, 0);
  assert.equal(pictureMesh([[0, 0], [1, 0], [1, NaN], [0, 1]]).length, 0);
});

test("with nothing painted nothing is copied or drawn, and the pair says when it cannot work", () => {
  const states = [];
  const { take, put } = createFrontBasemapLayers({ pictures: () => [], onState: (working) => states.push(working) });
  assert.deepEqual([take.id, put.id, take.type, put.type], [FRONT_BASEMAP_TAKE_LAYER_ID, FRONT_BASEMAP_PUT_LAYER_ID, "custom", "custom"]);
  // (A context that would throw if it were touched.)
  const gl = new Proxy({}, { get: () => { throw new Error("the map was touched"); } });
  take.render(gl);
  put.render(gl, {});
  assert.deepEqual(states, []);
  // Something painted and no copy to be had: it says so, and the caller falls back.
  const painted = createFrontBasemapLayers({ pictures: () => [{ key: "a", canvas: {}, coordinates: [[20, 52], [28, 52], [28, 46], [20, 46]] }], onState: (working) => states.push(working) });
  painted.put.render({}, {});
  assert.deepEqual(states, [false]);
});

// The same player, on the same battlefield (its frame told a whole turn of longitude off the map's
// own): "I can't select troops ... they just don't get selected if I use the selector tool."
test("the war room's tools look for a troop where the map shows it, and tell a route in the battlefield's own longitudes", () => {
  const tools = read("./WarRoomTools.jsx");
  assert.ok(tools.includes("const onScreen = (place) => map.project([unwrapLng(place[0], map.getCenter().lng), place[1]]);"));
  assert.ok(tools.includes("const inFrame = (place) => [unwrapLng(place.lng, frameLngRef.current), place.lat];"));
  assert.equal(tools.split("const shown = onScreen(").length - 1, 2, "the click and the box both");
  assert.equal(tools.includes("const shown = map.project("), false);
  assert.ok(tools.includes("return inFrame(map.unproject([x, y]));"));
});

test("the battlefield layer uses the pair, and clears to grey only where the map cannot be copied", () => {
  const layers = read("./FrontLayers.jsx");
  assert.match(layers, /const \{ take, put \} = createFrontBasemapLayers\(\{/);
  assert.match(layers, /onState: \(working\) => setSeenThrough\(working === true\),/);
  // The bare map and the colour over it are ONE drawing, from the picture itself: a player's
  // screenshots showed bare map with no colour on it where the map had refused its own copy of the
  // picture, and then pale lines along every edge of the painted ground where the two drawings met.
  assert.ok(layers.includes("pictures: () => picturesRef.current,"));
  assert.ok(layers.includes("strength: politicalFillOpacityAtZoom,"));
  // The map's layers are sorted only when one of the two has just been added, never on every change
  // of style: sorting them each time moved every layer and sent whatever had just been added (a
  // border, a troop layer) under the territory. "All the country borders and troops keep
  // disappearing irregularly while reading through events."
  assert.ok(layers.includes("if (added) enforceMapLayerOrder(mapInstance);"));
  assert.equal(layers.split("mapInstance.addLayer(put);\n        enforceMapLayerOrder(mapInstance);").length, 1);
  // So the map's own two picture layers are drawn only where neither the ground's own layer
  // (frontGroundLayer.js) can draw nor the map be copied.
  assert.match(layers, /"raster-opacity": seenThrough \|\| !groundFailed \? 0 : PAINT_CLEAR_OPACITY,/);
  assert.match(layers, /"raster-opacity": seenThrough \|\| !groundFailed \? 0 : PAINT_OPACITY,/);
  // The pair is the fallback: there only once the ground's own layer has said it cannot draw.
  assert.ok(layers.includes("const painted = anyPainted && groundFailed;"));
  assert.match(layers, /const PAINT_OPACITY = \["interpolate", \["linear"\], \["zoom"\], \.\.\.POLITICAL_FILL_OPACITY_STOPS\.flat\(\)\];/);
  const shader = read("./frontBasemapLayer.js");
  // The taker's colour over the bare map at the strength of a country's fill, as solid as the picture is there.
  assert.ok(shader.includes("colour = vec4(base * (1.0 - u_strength) * paint.a + paint.rgb * u_strength, paint.a);"));
  assert.ok(shader.includes("gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);"));
});
