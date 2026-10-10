/*! Open Historia — projection change tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/projectionConvert.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { DETAILED_MAP_BLOCKS_CONVERSION, formatAspect, moveFeatureCoords, moveUnits, parseAspect, planBasemapChange, projectionChoice } from "./projectionConvert.js";
import { MAX_REDRAWN_WIDTH, redrawnSize, reprojectPixels } from "./projectionImage.js";
import { convertDisplayPoint, geoToDisplay, sheetBounds } from "../../server/mapProjection.js";

const freeform = (aspect) => ({ type: "freeform", aspect });
const picture = (bounds = null) => ({ kind: "image", dataUrl: "data:image/png;base64,AAAA", aspect: 2, bounds });

test("a picture between two world projections is drawn again, unless it is already drawn for the new one", () => {
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "robinson", background: picture() }), { kind: "redraw" });
  // The Star Wars case: places written for a 2:1 sheet, picture already that sheet.
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "equirectangular", background: picture(), keepPicture: true }), { kind: "bounds", bounds: sheetBounds("equirectangular") });
  assert.deepEqual(planBasemapChange({ from: "robinson", to: "robinson", background: picture() }), { kind: "none" });
});

test("to and from freeform a picture is never redrawn: it is laid on the new sheet", () => {
  // A picture stretched over the square, given its own 2:1 shape.
  const plan = planBasemapChange({ from: "mercator", to: freeform(2), background: picture() });
  assert.equal(plan.kind, "bounds");
  assert.ok(Math.abs(plan.bounds.north - 66.51326) < 1e-4 && plan.bounds.east === 180);
  // Reshaped again, and back onto the square.
  assert.equal(planBasemapChange({ from: freeform(2), to: freeform(1.5), background: picture(plan.bounds) }).kind, "bounds");
  const back = planBasemapChange({ from: freeform(2), to: "mercator", background: picture(plan.bounds) });
  assert.ok(Math.abs(back.bounds.north - 85.051129) < 1e-4);
  // A picture that only covers part of the sheet keeps its part.
  const part = planBasemapChange({ from: freeform(1), to: freeform(2), background: picture({ west: -90, south: -40, east: 90, north: 40 }) });
  assert.equal(part.bounds.west, -90);
  assert.ok(part.bounds.north < 40);
});

test("a vector basemap moves with the map, and the built-in tiles give way to a plain sea", () => {
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "mollweide", background: { kind: "vector" } }), { kind: "vector" });
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "mollweide", background: { kind: "vector" }, keepPicture: true }), { kind: "none" });
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "mollweide", background: null }), { kind: "plain" });
  assert.deepEqual(planBasemapChange({ from: "mollweide", to: "robinson", background: { kind: "plain" } }), { kind: "none" });
  assert.deepEqual(planBasemapChange({ from: "mollweide", to: "mercator", background: { kind: "plain" } }), { kind: "tiles" });
  assert.deepEqual(planBasemapChange({ from: "mollweide", to: "mercator", background: null }), { kind: "none" });
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "miller", background: { kind: "raster" } }), { kind: "none" }, "a session-only reference is left alone");
});

test("a map on a detailed map is not converted: the detailed map cannot move with it", () => {
  // A detailed map is a Mercator tile archive; the regions and the drawn
  // basemap would move and it would not, so nothing moves.
  const drawn = { kind: "vector" };
  assert.deepEqual(
    planBasemapChange({ from: "mercator", to: "robinson", background: drawn, detailedMap: true }),
    { kind: "blocked", reason: DETAILED_MAP_BLOCKS_CONVERSION },
  );
  assert.match(DETAILED_MAP_BLOCKS_CONVERSION, /remove the detailed map/i);
  // Nothing to convert, nothing to block; and without one the map converts.
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "mercator", background: drawn, detailedMap: true }), { kind: "none" });
  assert.deepEqual(planBasemapChange({ from: "mercator", to: "robinson", background: drawn }), { kind: "vector" });
});

test("cities, features and units go where their map goes", () => {
  const features = [{ id: "a", name: "Lothal", coord: [42.705, -58.725] }, { id: "b", coord: null }, { id: "c", coord: [1, 2, 3] }];
  const moved = moveFeatureCoords(features, "mercator", "equirectangular");
  assert.deepEqual(moved[0], { id: "a", name: "Lothal", coord: convertDisplayPoint("mercator", "equirectangular", 42.705, -58.725) });
  // A place written as a true latitude is where the sheet puts it.
  assert.deepEqual(moved[0].coord, geoToDisplay("equirectangular", 42.705, -58.725));
  assert.equal(moved[1], features[1]);
  assert.equal(moved[2].coord[2], 3);
  assert.deepEqual(moveFeatureCoords(null, "mercator", "miller"), []);

  const units = moveUnits([{ id: "u", lng: 10, lat: 60, strength: 5 }], "mercator", "equirectangular");
  assert.deepEqual(units, [{ id: "u", lng: 10, lat: geoToDisplay("equirectangular", 10, 60)[1], strength: 5 }]);
});

test("a shape is typed any of the usual ways and shown as a ratio", () => {
  assert.equal(parseAspect("16:9"), 16 / 9);
  assert.equal(parseAspect("16 x 9"), 16 / 9);
  assert.equal(parseAspect("4/3"), 4 / 3);
  assert.equal(parseAspect("2"), 2);
  assert.equal(parseAspect("1,5"), 1.5);
  for (const text of ["", "wide", "0", "0:5", "16:0", "999", "-2", "1:2:3"]) assert.equal(parseAspect(text), null, text);
  assert.equal(formatAspect(2), "2:1");
  assert.equal(formatAspect(16 / 9), "16:9");
  assert.equal(formatAspect(1.5), "3:2");
  assert.equal(formatAspect(1.37), "1.37:1");
  assert.equal(formatAspect(0), "");
  assert.deepEqual(projectionChoice("freeform", 1.5), { type: "freeform", aspect: 1.5 });
  assert.deepEqual(projectionChoice("robinson", 1.5), { type: "robinson" });
});

test("a redrawn picture keeps its width and takes the new sheet's shape", () => {
  assert.deepEqual(redrawnSize(2048, "equirectangular"), { width: 2048, height: 1024 });
  assert.deepEqual(redrawnSize(1000, "mercator"), { width: 1000, height: 1000 });
  assert.equal(redrawnSize(20000, "mollweide").width, MAX_REDRAWN_WIDTH);
});

test("each pixel of the new picture shows the same place as before, and the corners off the globe stay empty", () => {
  // A 4 by 4 Mercator picture: the left half red, the right half blue.
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) data.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4);
  const source = { width: 4, height: 4, data };

  const out = reprojectPixels(source, { from: "mercator", to: "mollweide", width: 16, height: 8 });
  const pixel = (x, y) => [...out.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  // West of the middle is still red, east still blue.
  assert.deepEqual(pixel(4, 4), [255, 0, 0, 255]);
  assert.deepEqual(pixel(11, 4), [0, 0, 255, 255]);
  // The corners of a Mollweide sheet are outside its ellipse.
  assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(15, 7), [0, 0, 0, 0]);

  // The same projection, the same picture.
  const same = reprojectPixels(source, { from: "mercator", to: "mercator", width: 4, height: 4 });
  assert.deepEqual([...same.data], [...data]);

  // A picture that covers only part of its map leaves the rest empty.
  const part = reprojectPixels(source, { from: "equirectangular", to: "miller", bounds: { west: -90, south: -30, east: 90, north: 30 }, width: 16, height: 12 });
  assert.equal(part.data[3], 0, "the far corner had no picture");
  assert.equal(part.data[(6 * 16 + 8) * 4 + 3], 255, "the middle did");
});
