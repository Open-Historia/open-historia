// Run: node --test src/runtime/fronts/arena.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { arenaFor, citiesInFrame, rasterizeArena, sampleRegions } from "./arena.js";
import { createFrame, projectorOf, unwrapLng } from "./frame.js";
import { syntheticMap } from "./syntheticMap.js";

const legend = {
  A: "Aland",
  B: "Borduria",
  N: "Neutralia",
  M: { owner: "Borduria", typeId: "peaks" },
  R: { owner: "Aland", typeId: "road" },
  S: { owner: "Aland", typeId: "swamp" },
  "~": null,
};
const regionTypes = [
  { id: "peaks", passable: false, pathfindingSpeed: 1 },
  { id: "road", passable: true, pathfindingSpeed: 5 },
  { id: "swamp", passable: true, pathfindingSpeed: 0.05 },
  { id: "void", passable: true, pathfindingSpeed: 0 },
];
const sheet = () => syntheticMap({
  layout: [
    "AAARBBBB",
    "AASABBMB",
    "AAAABBBB",
    "~~~~NNNN",
  ],
  legend,
  west: 20,
  north: 52,
  step: 0.5,
});

// Every cell's centre, asked of the sheet's own arithmetic.
const assertEveryCell = (arena, world, label) => {
  const { toLngLat } = projectorOf(arena.frame);
  let land = 0;
  for (let index = 0; index < arena.size; index += 1) {
    const [lng, lat] = toLngLat((index % arena.cols) + 0.5, Math.floor(index / arena.cols) + 0.5);
    const expected = world.regionAt(lng, lat);
    assert.equal(arena.ids[arena.region[index]], expected, `${label}: cell ${index} at ${lng},${lat}`);
    if (expected) land += 1;
  }
  return land;
};

test("every cell lies in the region the map draws under its centre", () => {
  const world = sheet();
  const arena = rasterizeArena(world.frame({ marginKm: 20 }), world.regions, { regionTypes });
  const land = assertEveryCell(arena, world, "sheet");
  assert.ok(land > 2000, "the frame is fine enough to mean something");
  assert.equal(arena.ids[0], "");
  assert.equal(arena.ids.length - 1, 28, "every region of the sheet, the sea left out");
  assert.equal(arena.names[arena.indexOf.get("r0-0")], "Aland 0.0");
  // Whole inside the frame: a region is exactly its cells, and its middle is its middle.
  for (let value = 1; value < arena.ids.length; value += 1) {
    assert.equal(arena.area[value], arena.cells[value]);
    assert.equal(arena.outside[value], 0);
  }
  const { toCell } = projectorOf(arena.frame);
  const [x, y] = toCell(20.25, 51.75);
  const corner = arena.indexOf.get("r0-0");
  assert.ok(Math.abs(arena.centreX[corner] - x) < 0.51 && Math.abs(arena.centreY[corner] - y) < 0.51);
});

test("a region the frame cuts has more area than cells", () => {
  const world = sheet();
  const frame = createFrame({ west: 20.25, south: 50.6, east: 23.2, north: 51.8 });
  const arena = rasterizeArena(frame, world.regions, { regionTypes });
  assertEveryCell(arena, world, "cut");
  const cut = arena.indexOf.get("r0-0");
  assert.ok(cut > 0);
  assert.ok(arena.area[cut] > arena.cells[cut] * 1.5, `${arena.area[cut]} against ${arena.cells[cut]}`);
  assert.ok(Math.abs(arena.outside[cut] - (arena.area[cut] - arena.cells[cut])) < 1e-9);
  const whole = arena.indexOf.get("r2-1");
  assert.equal(arena.outside[whole], 0);
  assert.equal(arena.area[whole], arena.cells[whole]);
  // The two cut halves of one region, on two frames, add up to the region.
  const rest = rasterizeArena(createFrame({ west: 19.5, south: 50.6, east: 20.25, north: 52.4 }), world.regions, { regionTypes });
  const other = rest.indexOf.get("r0-0");
  const scale = (frame.cell / rest.frame.cell) ** 2;
  assert.ok(Math.abs(arena.area[cut] * scale - rest.area[other]) < rest.area[other] * 0.001, "one area, whichever frame measures it");
});

test("ground no unit may enter is a wall, and a type's speed is held to its range", () => {
  const world = sheet();
  const arena = rasterizeArena(world.frame(), world.regions, { regionTypes });
  const speedAt = (id) => arena.regionSpeed[arena.indexOf.get(id)];
  assert.equal(speedAt("r6-1"), 0, "impassable");
  assert.equal(speedAt("r3-0"), 2, "a road is fast, within reason");
  assert.ok(Math.abs(speedAt("r2-1") - 0.2) < 1e-12, "a swamp is slow, within reason");
  assert.equal(speedAt("r0-0"), 1);
  const peaks = arena.indexOf.get("r6-1");
  let walls = 0;
  for (let index = 0; index < arena.size; index += 1) {
    if (arena.region[index] === peaks) {
      assert.equal(arena.speed[index], 0);
      walls += 1;
    } else if (arena.region[index] === 0) assert.equal(arena.speed[index], 0, "the sea has no speed");
  }
  assert.equal(walls, arena.cells[peaks]);
  const zero = rasterizeArena(world.frame(), [{ ...world.regions[0], typeId: "void" }], { regionTypes });
  assert.equal(zero.regionSpeed[1], 0, "a speed of nothing is impassable too");
});

test("water is ground no troop enters, whatever else its type is set to", () => {
  const world = syntheticMap({ layout: ["AAwwBB", "AAwwBB"], legend: { A: "Aland", B: "Borduria", w: { owner: "", typeId: "deep" } } });
  const speedOf = (types) => {
    const arena = rasterizeArena(world.frame(), world.regions, { regionTypes: types });
    return arena.regionSpeed[arena.indexOf.get("r2-0")];
  };
  // Named for what it is, or switched: a wall. Left passable and fast by its maker, still a wall.
  assert.equal(speedOf([{ id: "deep", name: "Deep Ocean" }]), 0);
  assert.equal(speedOf([{ id: "deep", name: "Deep Ocean", passable: true, pathfindingSpeed: 3 }]), 0);
  assert.equal(speedOf([{ id: "deep", name: "The Narrows", water: true }]), 0);
  // Not water: ground like any other.
  assert.equal(speedOf([{ id: "deep", name: "Deep Ocean", water: false }]), 1);
  assert.equal(speedOf([{ id: "deep", name: "Marsh" }]), 1);
  // A type switched to water, or back, is other ground: an arena is not kept across it.
  const cache = new Map();
  const map = { ...world.map, key: "narrows" };
  const frame = world.frame();
  const wet = arenaFor(cache, map, frame, [{ id: "deep", name: "The Narrows", water: true }]);
  assert.notEqual(arenaFor(cache, map, frame, [{ id: "deep", name: "The Narrows" }]), wet);
});

test("a map across the date line is drawn in one piece", () => {
  const world = syntheticMap({ layout: ["AABB", "AABB", "NN~~"], legend, west: 176, north: 60, step: 2, wrapped: true });
  // Stored the way a file stores it: nothing past 180, so one region's ring
  // jumps from 178 to -178 between two neighbours.
  const straddling = world.regions.find((region) => region.id === "r1-0");
  assert.deepEqual(straddling.geometry.coordinates[0].map(([lng]) => lng), [178, 180, 180, 178, 178]);
  const across = world.regions.find((region) => region.id === "r2-0");
  assert.deepEqual(across.geometry.coordinates[0].map(([lng]) => lng), [180, -178, -178, 180, 180]);
  const frame = createFrame({ west: 175, south: 53, east: -175, north: 61 });
  const arena = rasterizeArena(frame, world.regions, {});
  const { toLngLat } = projectorOf(frame);
  let east = 0;
  for (let index = 0; index < arena.size; index += 1) {
    // (The frame's middle is in the map's own turn, so here it tells its cells as -185 to -175: the sheet is asked in its own, 175 to 185.)
    const [told, lat] = toLngLat((index % arena.cols) + 0.5, Math.floor(index / arena.cols) + 0.5);
    const lng = told < 0 ? told + 360 : told;
    assert.equal(arena.ids[arena.region[index]], world.regionAt(lng, lat), `cell ${index} at ${lng},${lat}`);
    if (lng > 180 && arena.region[index] !== 0) east += 1;
  }
  assert.ok(east > 500, "land on the far side of the line");
  // A wide region stored wrapped, seen from a frame half a world from its far end, is not torn across the frame.
  const wide = [{ id: "wide", name: "Wide", geometry: { type: "Polygon", coordinates: [[[30, 50], [100, 50], [170, 50], [-170, 50], [-170, 60], [170, 60], [100, 60], [30, 60], [30, 50]]] } }];
  const west = rasterizeArena(createFrame({ west: -20, south: 52, east: 10, north: 58 }), wide, {});
  assert.equal(west.ids.length, 1, "none of it is here");
  const near = rasterizeArena(createFrame({ west: 20, south: 52, east: 40, north: 58 }), wide, {});
  const [edge] = projectorOf(near.frame).toCell(30, 55);
  for (let index = 0; index < near.size; index += 1) {
    assert.equal(near.region[index] !== 0, (index % near.cols) + 0.5 > edge, `cell ${index}`);
  }
  assert.equal(unwrapLng(-170, 170), 190);
});

test("a finer drawing of the same regions agrees with the sheet", () => {
  const world = sheet();
  const arena = rasterizeArena(world.frame(), world.regions, { regionTypes });
  const box = { col0: 0, row0: 0, col1: arena.cols - 1, row1: arena.rows - 1 };
  const fine = sampleRegions(arena, world.regions, box, 4, (value) => arena.regionSpeed[value] > 0);
  const { toLngLat } = projectorOf(arena.frame);
  assert.equal(fine.width, arena.cols * 4);
  for (let row = 0; row < fine.height; row += 7) {
    for (let col = 0; col < fine.width; col += 5) {
      const [lng, lat] = toLngLat((col + 0.5) / 4, (row + 0.5) / 4);
      const expected = world.regionAt(lng, lat);
      const wanted = expected && arena.regionSpeed[arena.indexOf.get(expected)] > 0 ? expected : "";
      assert.equal(arena.ids[fine.grid[row * fine.width + col]], wanted);
    }
  }
});

test("cities are placed in the frame, and an arena is drawn once for a map and a frame", () => {
  const world = sheet();
  const frame = world.frame();
  const cities = [{ name: "Alba", lng: 20.6, lat: 51.2, population: 400000, capital: true }, { name: "Far", lng: 60, lat: 10 }, { name: "", lng: 21, lat: 51 }];
  const placed = citiesInFrame(frame, cities);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].name, "Alba");
  assert.equal(placed[0].capital, true);
  const map = { ...world.map, cities };
  const cache = new Map();
  const first = arenaFor(cache, map, frame, regionTypes);
  assert.equal(arenaFor(cache, map, { ...frame }, regionTypes), first, "the same frame, another object");
  assert.equal(first.ids[first.region[placed[0].cell]], world.regionAt(20.6, 51.2));
  assert.notEqual(arenaFor(cache, map, world.frame({ marginKm: 50 }), regionTypes), first);
  assert.notEqual(arenaFor(cache, map, frame, []), first, "other ground rules, other ground");
  // Without its shapes a map can still hand out what it has drawn, and nothing else.
  const bare = { ...map, regions: null };
  assert.equal(arenaFor(cache, bare, frame, regionTypes), first);
  assert.equal(arenaFor(cache, bare, world.frame({ marginKm: 80 }), regionTypes), null);
  assert.equal(arenaFor(null, bare, frame, regionTypes), null);
  // The key names the ground: the same drawing has the same key, another has another.
  assert.equal(rasterizeArena(frame, world.regions, { regionTypes }).key, first.key);
  assert.notEqual(rasterizeArena(frame, world.regions.slice(1), { regionTypes }).key, first.key);
});
