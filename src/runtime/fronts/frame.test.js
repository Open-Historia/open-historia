// Run: node --test src/runtime/fronts/frame.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { CELL_STEPS_KM, MAX_CELLS, MAX_GRID_SPAN } from "./constants.js";
import { KM_PER_DEGREE, cellIndexAt, createFrame, frameBounds, homeLng0, latToY, normalizeFrame, pointInFrame, projectorOf, unwrapLng, yToLat } from "./frame.js";

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label ?? "value"}: ${actual} is not within ${tolerance} of ${expected}`);

test("the map's height of a latitude and back", () => {
  for (const lat of [-80, -45, 0, 12.5, 50, 65, 84]) near(yToLat(latToY(lat)), lat, 1e-9, `latitude ${lat}`);
  near(latToY(0), 0, 1e-12, "the equator");
  assert.ok(latToY(60) > 60, "the map stretches toward the poles");
  near(latToY(89.9), latToY(85.0511287798066), 1e-9, "held at the map's edge");
});

test("a longitude is read as the copy nearest the frame", () => {
  assert.equal(unwrapLng(179, -179), -181);
  assert.equal(unwrapLng(-179, 179), 181);
  assert.equal(unwrapLng(30, 20), 30);
  assert.equal(unwrapLng(390, 20), 30);
});

test("a frame takes the finest cell its limits allow", () => {
  // About 420 by 330 km round Kharkiv: fine cells fit.
  const small = createFrame({ west: 34, south: 48.5, east: 40, north: 51.5 });
  assert.equal(small.km, CELL_STEPS_KM[0]);
  // About 2,000 by 1,500 km of eastern Europe.
  const large = createFrame({ west: 22, south: 44, east: 50, north: 58 });
  assert.ok(large.km > small.km);
  for (const frame of [small, large]) {
    assert.ok(frame.cols <= MAX_GRID_SPAN && frame.rows <= MAX_GRID_SPAN && frame.cols * frame.rows <= MAX_CELLS);
    const bounds = frameBounds(frame);
    assert.ok(bounds.west <= (frame === small ? 34 : 22) && bounds.north >= (frame === small ? 51.5 : 58));
  }
  // A box no step fits still gets a frame.
  const vast = createFrame({ west: -170, south: -60, east: 170, north: 75 });
  assert.ok(vast && vast.cols * vast.rows <= MAX_CELLS && vast.km > CELL_STEPS_KM.at(-1));
  assert.equal(createFrame({ west: 10, south: 5, east: 10, north: 6 }), null);
  assert.equal(createFrame({ west: 10, south: 6, east: 12, north: 6 }), null);
  assert.equal(createFrame(null), null);
});

test("a cell measures what the frame says at its middle, less toward the pole, the same in both directions", () => {
  for (const middle of [30, 50, 65]) {
    const frame = createFrame({ west: 10, south: middle - 3, east: 20, north: middle + 3 });
    const { rowKm, toLngLat } = projectorOf(frame);
    near(rowKm[Math.floor(frame.rows / 2)], frame.km, frame.km * 0.01, `middle row at ${middle}`);
    assert.ok(rowKm[0] > rowKm[frame.rows - 1], "smaller toward the pole");
    // One cell north and one cell east of a point are the same distance on the ground.
    const row = Math.floor(frame.rows / 2);
    const [lng, lat] = toLngLat(5, row + 0.5);
    const [lngEast] = toLngLat(6, row + 0.5);
    const [, latNorth] = toLngLat(5, row + 1.5);
    const eastKm = (lngEast - lng) * KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    const northKm = (latNorth - lat) * 110.95;
    near(eastKm, rowKm[row], rowKm[row] * 0.002, "east");
    near(northKm, rowKm[row], rowKm[row] * 0.02, "north");
  }
});

test("points go into cell units and come back, across the date line too", () => {
  const frame = createFrame({ west: 170, south: 50, east: -165, north: 66 });
  // (25 degrees wide over the date line, its middle in the map's own turn: so it is its WEST edge that is past it.)
  assert.ok(frame.cols * frame.cell >= 25 && unwrapLng(frame.lng0, 170) <= 170);
  const { toCell, toLngLat } = projectorOf(frame);
  for (const [lng, lat] of [[172, 52], [-170, 60], [179.5, 65]]) {
    const [x, y] = toCell(lng, lat);
    assert.ok(x >= 0 && x < frame.cols && y >= 0 && y < frame.rows, `${lng},${lat} is inside`);
    const [backLng, backLat] = toLngLat(x, y);
    near(unwrapLng(backLng, lng), lng, 1e-9, "longitude");
    near(backLat, lat, 1e-9, "latitude");
  }
  assert.ok(toLngLat(0, 0)[0] < -180 || toLngLat(frame.cols, 0)[0] > 180, "an edge is past the date line, not wrapped");
  assert.equal(pointInFrame(frame, -170, 60), true);
  assert.equal(pointInFrame(frame, 10, 60), false);
  assert.equal(cellIndexAt(frame, 0.5, 0.5), 0);
  assert.equal(cellIndexAt(frame, frame.cols, 0), -1);
  assert.equal(cellIndexAt(frame, 2.9, 1.1), frame.cols + 2);
});

test("a flat sheet measures the same everywhere", () => {
  const frame = createFrame({ west: -40, south: 20, east: -10, north: 70 }, { flat: true, scale: 50 });
  assert.equal(frame.flat, true);
  assert.equal(frame.scale, 50);
  const { rowKm } = projectorOf(frame);
  near(rowKm[0], rowKm[frame.rows - 1], 1e-9, "top and bottom rows");
  near(rowKm[0], frame.km, 1e-9, "a cell");
});

test("a saved frame is checked, and survives being written out and read back", () => {
  const frame = createFrame({ west: 22, south: 44, east: 50, north: 58 }, { marginKm: 40 });
  const read = normalizeFrame(JSON.parse(JSON.stringify(frame)));
  assert.deepEqual(read, frame);
  assert.deepEqual([...projectorOf(read).rowKm], [...projectorOf(frame).rowKm], "the same grid to the last digit");
  assert.equal(normalizeFrame({ ...frame, cols: 0 }), null);
  assert.equal(normalizeFrame({ ...frame, cols: 300 }), null);
  assert.equal(normalizeFrame({ ...frame, cols: 255, rows: 255 }), null, "more cells than a frame may have");
  assert.equal(normalizeFrame({ ...frame, cell: "wide" }), null);
  assert.equal(normalizeFrame([frame]), null);
  assert.equal(normalizeFrame({ ...frame, flat: true }).scale, KM_PER_DEGREE);
});

// A player's game (the United States against Canada, then Mexico): the battlefield's frame was told
// as 215 to 300 east. The map would not place its painted ground, the war room's selector looked for
// its troops a world away, and a route drawn for them fell off it. A frame is made at home now.
test("a frame's middle is within the map's own turn of the world, however the box it is made from was told", () => {
  const home = createFrame({ west: -125, east: -95, south: 44, north: 52 }, { marginKm: 100 });
  const off = createFrame({ west: 235, east: 265, south: 44, north: 52 }, { marginKm: 100 });
  const far = createFrame({ west: -485, east: -455, south: 44, north: 52 }, { marginKm: 100 });
  // The same frame, to the last cell.
  assert.deepEqual(off, home);
  assert.deepEqual(far, home);
  const middle = home.lng0 + (home.cols * home.cell) / 2;
  assert.ok(middle >= -180 && middle < 180);
  // One across the date line still runs past 180, its middle at home.
  const across = createFrame({ west: 170, east: -170, south: 50, north: 60 });
  assert.ok(across.lng0 < 180 && across.lng0 + across.cols * across.cell > 180 || across.lng0 < -180);
  const centre = across.lng0 + (across.cols * across.cell) / 2;
  assert.ok(centre >= -180 && centre < 180, String(centre));
  // And a place is in it whichever turn the place is told in.
  for (const lng of [175, -175, 535, -185]) assert.ok(pointInFrame(across, lng, 55), String(lng));
  assert.equal(homeLng0(20, 8), 20);
  assert.equal(homeLng0(215, 85), -145);
  assert.equal(homeLng0(-520, 20), -160);
});

test("a frame saved a turn off is brought home as it is read, and is the same ground", () => {
  const home = createFrame({ west: -125, east: -95, south: 44, north: 52 });
  const saved = { ...home, lng0: home.lng0 + 360 };
  const read = normalizeFrame(saved);
  assert.equal(read.lng0, home.lng0);
  // The same cell for the same place: nothing kept by cell (the ground, the troops, a replay) moves.
  const [x, y] = projectorOf(read).toCell(-110, 48);
  const [x0, y0] = projectorOf(saved).toCell(-110, 48);
  assert.ok(Math.abs(x - x0) < 1e-9 && Math.abs(y - y0) < 1e-9);
  // What it says of where a troop stands is told in the map's own longitudes now.
  const [lng] = projectorOf(read).toLngLat(x, y);
  assert.ok(Math.abs(lng - -110) < 1e-9, String(lng));
  assert.deepEqual(normalizeFrame(home), home);
});
