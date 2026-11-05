/*! Open Historia — battlefields and fronts: the whole map as land and sea, and the ways found over it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/wayfinder.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticMap } from "./syntheticMap.js";
import { CANALS, findWay } from "./wayfinder.js";
import { buildWorldGrid, greatPoint, kmBetween, placeAlong, seasOf, wayKm, worldSheetKey } from "./worldGrid.js";
import { yToLat } from "./frame.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", C: "Cisland", L: "Landia", "~": null };
const sheetOf = (layout, extra = {}) => syntheticMap({ layout, legend, west: 20, north: 56, step: 1, ...extra });
const gridOf = (world, step = 0.1) => buildWorldGrid(world.regions, { step });
const asked = (world, extra = {}) => ({
  holderOf: world.controllerOf,
  friendly: (name) => name === "Aland",
  hostile: (name) => name === "Borduria",
  year: 2024,
  ...extra,
});
// Every place along a way, a step at a time: what it goes over.
const along = (grid, way, visit) => {
  const total = wayKm(way);
  for (let km = 0; km <= total; km += 4) {
    const at = placeAlong(way, km);
    visit(at, grid.cellOf(at.lng, at.lat));
  }
};

test("the sheet says where there is land, where there is sea, and which cells are both", () => {
  const world = sheetOf(["~~~~~", "~AA~~", "~AA~~", "~~~~~"]);
  const grid = gridOf(world, 0.25);
  assert.equal(grid.wrap, false, "a map of one corner of the world does not go round it");
  const at = (lng, lat) => grid.cellOf(lng, lat);
  assert.equal(grid.land[at(22, 54)], grid.full, "the middle of Aland is land all through");
  assert.equal(grid.land[at(20.4, 55.6)], 0, "and the open sea is none");
  assert.equal(grid.ids[grid.region[at(21.6, 54.4)]], "r1-1", "a cell knows its region");
  assert.equal(grid.region[at(20.4, 55.6)], 0);
  // Round the land there is sea to go round it by.
  assert.ok(grid.cellOf(20.3, 54) >= 0 && grid.cellOf(23.7, 54) >= 0 && grid.cellOf(22, 52.3) >= 0, "the sheet reaches past the land");
  assert.equal(grid.land[grid.cellOf(20.3, 54)], 0);
  assert.equal(grid.cellOf(60, 54), -1);
  const [lng, lat] = grid.centreOf(at(22.3, 54.3));
  assert.ok(Math.abs(lng - 22.3) <= 0.125 && Math.abs(lat - 54.3) <= 0.125);

  // A coast that runs through a cell makes it both: a ship may pass it and troops may come ashore in it.
  const ragged = buildWorldGrid([{ id: "isle", geometry: { type: "Polygon", coordinates: [[[21.05, 53.05], [22.2, 53.05], [22.2, 54.2], [21.05, 54.2], [21.05, 53.05]]] } }], { step: 0.25 });
  const edge = ragged.cellOf(22.13, 53.6);
  assert.ok(ragged.land[edge] > 0 && ragged.land[edge] < ragged.full, `${ragged.land[edge]} of ${ragged.full} samples of a coastal cell are land`);
  // A hole in a shape is water, and a lake is a sea of its own.
  const ring = { id: "ring", geometry: { type: "Polygon", coordinates: [[[20, 50], [26, 50], [26, 56], [20, 56], [20, 50]], [[22, 52], [24, 52], [24, 54], [22, 54], [22, 52]]] } };
  const lake = buildWorldGrid([ring], { step: 0.25 });
  const seas = seasOf(lake);
  assert.equal(lake.land[lake.cellOf(23, 53)], 0);
  assert.ok(seas[lake.cellOf(23, 53)] > 0 && seas[lake.cellOf(18.9, 53)] > 0);
  assert.notEqual(seas[lake.cellOf(23, 53)], seas[lake.cellOf(18.9, 53)], "the lake is not the sea round the land");
  assert.equal(seas[lake.cellOf(21, 53)], 0, "dry land is no sea");
  assert.equal(buildWorldGrid([], {}), null);
  assert.equal(buildWorldGrid([{ id: "x", geometry: null }], {}), null);

  // A map that goes all the way round the world wraps, and a shape drawn across the date line is one shape.
  const round = buildWorldGrid([
    { id: "west", geometry: { type: "Polygon", coordinates: [[[-170, 10], [-10, 10], [-10, 30], [-170, 30], [-170, 10]]] } },
    { id: "east", geometry: { type: "Polygon", coordinates: [[[10, 10], [160, 10], [160, 30], [10, 30], [10, 10]]] } },
    { id: "line", geometry: { type: "Polygon", coordinates: [[[176, 40], [-176, 40], [-176, 44], [176, 44], [176, 40]]] } },
  ], {});
  assert.equal(round.wrap, true);
  assert.equal(round.ids[round.region[round.cellOf(179.5, 42)]], "line");
  assert.equal(round.ids[round.region[round.cellOf(-179.5, 42)]], "line");
  assert.equal(round.land[round.cellOf(0, 42)], 0, "and it does not run round the world the other way");
});

test("distances and places along a way", () => {
  assert.ok(Math.abs(kmBetween(0, 0, 1, 0) - 111.19) < 0.1);
  assert.ok(Math.abs(kmBetween(0, 60, 1, 60) - 55.6) < 0.2, "a degree of longitude is half as long at sixty north");
  // A flat sheet is measured as it is drawn: up the sheet by the height the map draws a latitude at, the same everywhere.
  assert.ok(Math.abs(kmBetween(0, 0, 3, yToLat(4), { flat: true, scale: 10 }) - 50) < 1e-6);
  assert.ok(Math.abs(kmBetween(0, yToLat(60), 3, yToLat(64), { flat: true, scale: 10 }) - 50) < 1e-6, "as long near the top of the sheet as in its middle");
  assert.ok(Math.abs(kmBetween(179, 0, -179, 0) - 222.4) < 0.3, "across the date line is two degrees, not 358");
  // Half way along a great circle between two places on the same latitude lies north of it.
  const [lng, lat] = greatPoint(-70, 45, 0, 45, 0.5);
  assert.ok(Math.abs(lng + 35) < 1e-6 && lat > 50, `${lng}, ${lat}`);
  assert.ok(Math.abs(greatPoint(10, 10, 10, 10, 0.5)[0] - 10) < 1e-9 && Math.abs(greatPoint(10, 10, 10, 10, 0.5)[1] - 10) < 1e-9);
  const way = [[20, 50], [21, 50], [21, 51]];
  const total = wayKm(way);
  assert.ok(Math.abs(total - (kmBetween(20, 50, 21, 50) + kmBetween(21, 50, 21, 51))) < 1e-9);
  const middle = placeAlong(way, kmBetween(20, 50, 21, 50) / 2);
  assert.ok(Math.abs(middle.lng - 20.5) < 1e-9 && middle.lat === 50 && middle.leg === 0);
  assert.ok(Math.abs(middle.bearing - 90) < 1, "it faces east there");
  const later = placeAlong(way, kmBetween(20, 50, 21, 50) + 30);
  assert.equal(later.leg, 1);
  assert.ok(later.bearing < 1 || later.bearing > 359, "and north on the second stretch");
  assert.deepEqual([placeAlong(way, 1e9).lng, placeAlong(way, 1e9).lat], [21, 51], "past its end it is at its end");
  assert.equal(placeAlong([], 5), null);
});

// Aland in the west, Borduria in the east, and a long neck of Neutralia's
// land between them that reaches down from the north.
const NECK = [
  "~~~~~NNN~~~~~",
  "~~~~~NNN~~~~~",
  "~AA~~NNN~~BB~",
  "~AA~~NNN~~BB~",
  "~AA~~NNN~~BB~",
  "~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~",
];

test("a ship goes by sea, round the land, the same way every time", () => {
  const world = sheetOf(NECK);
  const grid = gridOf(world);
  // From the middle of Aland's east coast to the middle of Borduria's west coast: Neutralia lies straight across.
  const found = findWay(grid, { medium: "sea", from: [22.6, 52.5], to: [30.3, 52.5], ...asked(world) });
  assert.equal(found.error, undefined);
  assert.ok(found.way.length >= 4 && found.way.length <= 48, `${found.way.length} points`);
  let south = Infinity;
  along(grid, found.way, (at, cell) => {
    assert.ok(cell >= 0 && grid.land[cell] < grid.full, `the ship is on dry land at ${at.lng.toFixed(2)}, ${at.lat.toFixed(2)}`);
    south = Math.min(south, at.lat);
  });
  assert.ok(south < 51, `it rounds the neck's southern end (51): it goes as far south as ${south.toFixed(2)}`);
  const straight = kmBetween(22.6, 52.5, 30.3, 52.5);
  assert.ok(found.km > straight * 1.1 && found.km < straight * 1.9, `${found.km} km against ${Math.round(straight)} straight across`);
  // It sets out from the water beside where its troops are and comes to the coast it was sent to.
  assert.ok(kmBetween(found.start[0], found.start[1], 22.6, 52.5) < 60);
  assert.deepEqual(found.landing, [30.3, 52.5]);
  assert.equal(found.arrived, true);
  // No chance in it.
  assert.deepEqual(findWay(grid, { medium: "sea", from: [22.6, 52.5], to: [30.3, 52.5], ...asked(world) }), found);
  // The way back is as long.
  const back = findWay(grid, { medium: "sea", from: [30.3, 52.5], to: [22.6, 52.5], ...asked(world, { friendly: (name) => name === "Borduria", hostile: (name) => name === "Aland" }) });
  assert.ok(Math.abs(back.km - found.km) < found.km * 0.08, `${back.km} km back against ${found.km} out`);
});

test("a ship sent inland comes to the nearest coast; one with no sea to sail on is refused", () => {
  // A wide land: its middle is far from any sea.
  const wide = sheetOf(["~~~~~~~~~~~~~~~~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~AA~~~BBBBBBBBB~", "~~~~~~~~~~~~~~~~"]);
  const grid = gridOf(wide, 0.2);
  // Two degrees inside Borduria's west coast: the ship comes to that coast, and the troops go ashore there.
  const inland = findWay(grid, { medium: "sea", from: [22.6, 52], to: [28.2, 52], ...asked(wide) });
  assert.equal(inland.error, undefined);
  assert.ok(inland.landing[0] >= 26 && inland.landing[0] < 26.6, `they land on the coast, at ${inland.landing}`);
  assert.ok(grid.land[grid.cellOf(inland.landing[0], inland.landing[1])] > 0, "on land");
  assert.ok(grid.land[grid.cellOf(inland.end[0], inland.end[1])] < grid.full, "from the water beside it");
  // The middle of it is too far from the sea for any ship.
  assert.equal(findWay(grid, { medium: "sea", from: [22.6, 52], to: [30.6, 51], ...asked(wide) }).error, "no-shore");
  assert.equal(findWay(grid, { medium: "sea", from: [30.6, 51], to: [22.6, 52], ...asked(wide) }).error, "no-coast");
  assert.equal(findWay(grid, { medium: "sea", from: [22.6, 52], to: [80, 52], ...asked(wide) }).error, "off-map");
  assert.equal(findWay(null, { medium: "sea", from: [22.6, 52], to: [28.2, 52] }).error, "off-map");

  // A lake: a ship on it cannot reach the sea, and one on the sea cannot reach it.
  const ring = { id: "ring", geometry: { type: "Polygon", coordinates: [[[20, 50], [26, 50], [26, 56], [20, 56], [20, 50]], [[22.5, 52.5], [23.5, 52.5], [23.5, 53.5], [22.5, 53.5], [22.5, 52.5]]] } };
  const lake = buildWorldGrid([ring, { id: "isle", geometry: { type: "Polygon", coordinates: [[[30, 52], [31, 52], [31, 53], [30, 53], [30, 52]]] } }], { step: 0.1 });
  const holders = { holderOf: (id) => (id === "ring" ? "Aland" : "Borduria"), friendly: (name) => name === "Aland", hostile: (name) => name === "Borduria", year: 2024 };
  // From the lake's shore, sent to the island: the lake is nearer, but it is the sea that leads there.
  const out = findWay(lake, { medium: "sea", from: [23.6, 53], to: [30.5, 52.5], ...holders });
  assert.equal(out.error, undefined);
  assert.ok(out.start[0] > 25.9, `it sets out from the sea coast (${out.start}), not from the lake`);
  // Across the lake itself a ship does go.
  const across = findWay(lake, { medium: "sea", from: [22.3, 53], to: [23.7, 53], ...holders });
  assert.equal(across.error, undefined);
  assert.ok(across.km < 120, `${across.km} km across the lake`);
});

test("a ship keeps off a shore its enemies hold where another way is not much longer, and goes by it where there is none", () => {
  // Borduria's island lies beside the straight way from Aland to Cisland.
  const world = sheetOf(["~~~~~~~~~~~~~", "~AA~~~~~~~CC~", "~AA~~BBB~~CC~", "~~~~~BBB~~~~~", "~~~~~~~~~~~~~", "~~~~~~~~~~~~~", "~~~~~~~~~~~~~"]);
  const grid = gridOf(world);
  const enemy = (cell) => cell >= 0 && grid.region[cell] > 0 && world.controllerOf(grid.ids[grid.region[cell]]) === "Borduria";
  const nearEnemy = (lng, lat) => {
    for (let dy = -0.45; dy <= 0.45; dy += 0.09) for (let dx = -0.75; dx <= 0.75; dx += 0.09) if (enemy(grid.cellOf(lng + dx, lat + dy))) return true;
    return false;
  };
  const found = findWay(grid, { medium: "sea", from: [22.6, 54.5], to: [30.3, 54.5], ...asked(world) });
  assert.equal(found.error, undefined);
  along(grid, found.way, (at) => assert.equal(nearEnemy(at.lng, at.lat), false, `it passes within fifty kilometres of Borduria's shore at ${at.lng.toFixed(2)}, ${at.lat.toFixed(2)}`));
  // Nobody at war with Borduria goes straight past it.
  const calm = findWay(grid, { medium: "sea", from: [22.6, 54.5], to: [30.3, 54.5], ...asked(world, { hostile: () => false }) });
  assert.ok(calm.km <= found.km, `${calm.km} km with no enemy against ${found.km} km round one`);
  // Sent to that shore itself, a ship comes to it.
  const landed = findWay(grid, { medium: "sea", from: [22.6, 54.5], to: [26.5, 52.2], ...asked(world) });
  assert.equal(landed.error, undefined);
  assert.ok(enemy(grid.cellOf(landed.landing[0], landed.landing[1])), "the troops go ashore on Borduria's island");
});

test("a train goes through land its own side holds and no further", () => {
  // Aland lies round a block of Neutralia's; Borduria is across the water to the south.
  const world = sheetOf(["AAAAAAA", "ANNNNNA", "ANNNNNA", "AAAAAAA", "~~~~~~~", "BBBBBBB"]);
  const grid = gridOf(world);
  const mine = (cell) => cell >= 0 && grid.region[cell] > 0 && world.controllerOf(grid.ids[grid.region[cell]]) === "Aland";
  const found = findWay(grid, { medium: "land", from: [20.5, 54.4], to: [26.5, 54.4], ...asked(world) });
  assert.equal(found.error, undefined);
  // (A way is looked at a few kilometres at a time, so it may clip the very corner of a cell: one cell's grace.)
  const onMine = (at) => [-0.06, 0, 0.06].some((dy) => [-0.06, 0, 0.06].some((dx) => mine(grid.cellOf(at.lng + dx, at.lat + dy))));
  along(grid, found.way, (at) => assert.ok(onMine(at), `the train is off Aland's land at ${at.lng.toFixed(2)}, ${at.lat.toFixed(2)}`));
  let through = 0;
  along(grid, found.way, (at) => { if (at.lng > 21.3 && at.lng < 25.7 && at.lat > 53.3 && at.lat < 54.7) through += 1; });
  assert.equal(through, 0, "it never crosses Neutralia");
  assert.ok(found.km > kmBetween(20.5, 54.4, 26.5, 54.4) * 1.15, "round Neutralia, not across it");
  assert.deepEqual([found.way[0], found.way.at(-1), found.landing, found.arrived], [[20.5, 54.4], [26.5, 54.4], [26.5, 54.4], true]);
  // An ally's land is its side's too.
  const allied = findWay(grid, { medium: "land", from: [20.5, 54.4], to: [26.5, 54.4], ...asked(world, { friendly: (name) => name === "Aland" || name === "Neutralia" }) });
  assert.ok(allied.km < found.km * 0.9, `${allied.km} km straight through an ally's land against ${found.km} km round it`);
  // Sent across the water to Borduria it sets its troops down at the last of Aland's land on the way.
  const short = findWay(grid, { medium: "land", from: [20.5, 54.4], to: [23.5, 50.5], ...asked(world) });
  assert.equal(short.error, undefined);
  assert.equal(short.arrived, false);
  assert.ok(mine(grid.cellOf(short.landing[0], short.landing[1])) && short.landing[1] < 52.2 && short.landing[1] > 51.9, `the railhead is on Aland's southern edge, at ${short.landing}`);
  along(grid, short.way, (at) => assert.ok(onMine(at)));
  // A train has to start on its side's land.
  assert.equal(findWay(grid, { medium: "land", from: [23.5, 50.5], to: [20.5, 54.4], ...asked(world, { friendly: (name) => name === "Cisland" }) }).error, "no-ground");
});

test("an aircraft flies the short way, and round its enemies' land where that costs it little", () => {
  const world = sheetOf(["~~~~~~~~~~~~~", "~AA~~~~~~~CC~", "~AA~~BBB~~CC~", "~~~~~BBB~~~~~", "~~~~~~~~~~~~~"]);
  const grid = gridOf(world);
  const enemy = (cell) => cell >= 0 && grid.region[cell] > 0 && world.controllerOf(grid.ids[grid.region[cell]]) === "Borduria";
  // Over open sea: straight there, from where the troops are to where they are sent.
  const clear = findWay(grid, { medium: "air", from: [22, 54.6], to: [31, 54.6], ...asked(world) });
  assert.equal(clear.error, undefined);
  assert.ok(Math.abs(clear.km - kmBetween(22, 54.6, 31, 54.6)) < 12, `${clear.km} km against ${Math.round(kmBetween(22, 54.6, 31, 54.6))} the short way`);
  assert.deepEqual([clear.way[0], clear.way.at(-1), clear.landing], [[22, 54.6], [31, 54.6], [31, 54.6]]);
  // Borduria lies across the short way from Aland's south to Cisland's: the aircraft goes round it.
  const round = findWay(grid, { medium: "air", from: [22, 53.2], to: [31, 53.2], ...asked(world) });
  along(grid, round.way, (at, cell) => assert.equal(enemy(cell), false, `it flies over Borduria at ${at.lng.toFixed(2)}, ${at.lat.toFixed(2)}`));
  assert.ok(round.km > kmBetween(22, 53.2, 31, 53.2));
  // Sent into Borduria it goes in.
  const into = findWay(grid, { medium: "air", from: [22, 53.2], to: [26.5, 53], ...asked(world) });
  assert.equal(into.error, undefined);
  assert.deepEqual(into.landing, [26.5, 53]);
});

test("an invented world is sailed like any other: its own land is what is gone round, on a globe or on a flat sheet", () => {
  // No country of the Earth and no coast of it: two realms on one sea, a
  // mountainous isle between them, and an inland sea nobody can sail out of.
  const realm = { K: "Karhold", V: "Valdris", I: "The Isle", "~": null };
  const layout = [
    "~~~~~~~~~~~~~~",
    "~KKK~~~~~~VVV~",
    "~KKK~~II~~VVV~",
    "~KKK~~II~~VVV~",
    "~KKK~~II~~V~V~",
    "~KKK~~~~~~VVV~",
    "~~~~~~~~~~~~~~",
  ];
  const holders = (world) => ({ holderOf: world.controllerOf, friendly: (name) => name === "Karhold", hostile: (name) => name === "Valdris", year: 1203 });
  for (const flat of [false, true]) {
    // (On a flat sheet a degree is as many kilometres as the scenario says; here, the world's.)
    const world = syntheticMap({ layout, legend: realm, west: -40, north: 12, step: 2, flat });
    const grid = buildWorldGrid(world.regions, { step: 0.2, flat });
    assert.equal(grid.flat, flat);
    const found = findWay(grid, { medium: "sea", from: [-32.4, 5], to: [-19.6, 5], ...holders(world) });
    assert.equal(found.error, undefined, `a ship of Karhold's sails to Valdris on a ${flat ? "flat sheet" : "globe"}`);
    let ashore = 0;
    let rounded = false;
    const total = wayKm(found.way, { flat });
    for (let km = 0; km <= total; km += 6) {
      const at = placeAlong(found.way, km, { flat });
      const cell = grid.cellOf(at.lng, at.lat);
      if (cell < 0 || grid.land[cell] >= grid.full) ashore += 1;
      if ((at.lat > 8 || at.lat < 2) && at.lng > -28 && at.lng < -24) rounded = true;
    }
    assert.equal(ashore, 0, "it never crosses dry land");
    assert.equal(rounded, true, "it goes round the Isle, which lies straight across its way");
    assert.ok(found.km > kmBetween(-32.4, 5, -19.6, 5, { flat }) * 1.03);
    assert.deepEqual(findWay(grid, { medium: "sea", from: [-32.4, 5], to: [-19.6, 5], ...holders(world) }), found, "and the same way every time");
    // The water shut inside Valdris is no way out of it and no way in.
    assert.equal(seasOf(grid)[grid.cellOf(-17, 3)] > 0, true, "there is water inside Valdris");
    assert.notEqual(seasOf(grid)[grid.cellOf(-17, 3)], seasOf(grid)[grid.cellOf(-30, 11)], "and it is not the sea outside");
    const lakeside = findWay(grid, { medium: "sea", from: [-32.4, 5], to: [-17, 3.9], ...holders(world) });
    assert.equal(seasOf(grid)[grid.cellOf(lakeside.end[0], lakeside.end[1])], seasOf(grid)[grid.cellOf(-30, 11)], "a ship sent to its shore comes to the coast outside, not onto the lake");
    assert.ok(grid.land[grid.cellOf(lakeside.landing[0], lakeside.landing[1])] > 0, "and its troops go ashore on Valdris");
    // A train of Karhold's keeps to Karhold, and an aircraft goes straight there.
    assert.equal(findWay(grid, { medium: "land", from: [-37, 9], to: [-33, 2.5], ...holders(world) }).arrived, true);
    assert.equal(findWay(grid, { medium: "land", from: [-37, 9], to: [-19.6, 5], ...holders(world) }).arrived, false);
    const flown = findWay(grid, { medium: "air", from: [-35, 5], to: [-19.6, 5], ...holders(world) });
    assert.ok(Math.abs(flown.km - kmBetween(-35, 5, -19.6, 5, { flat })) < 25, `${flown.km} km flown`);
  }
});

test("a sea drawn as regions is sailed where its type is water", () => {
  // A pirate's world: every stretch of water is a region somebody may hold. No
  // cell of the map is without a region.
  const realm = { A: "Aland", B: "Borduria", o: { owner: "", typeId: "sea" }, p: { owner: "Corsairs", typeId: "sea" }, l: { owner: "Borduria", typeId: "lake" } };
  const layout = [
    "oooooooooooo",
    "oAAAoppoBBBo",
    "oAAAoppoBlBo",
    "oAAAoppoBBBo",
    "oooooooooooo",
  ];
  const world = syntheticMap({ layout, legend: realm, west: 20, north: 54, step: 1 });
  const holders = { holderOf: world.controllerOf, friendly: (name) => name === "Aland", hostile: (name) => name === "Borduria", year: 1680 };
  // Drawn as it stands, every region is land: the water between the two is not sea at all.
  const dry = buildWorldGrid(world.regions, { step: 0.25 });
  assert.equal(seasOf(dry)[dry.cellOf(26, 51.5)], 0);
  assert.equal(dry.land[dry.cellOf(26, 51.5)], dry.full);
  // (All a ship could do there is go round the outside of the map, where no region is.)
  const outside = findWay(dry, { medium: "sea", from: [22.5, 51.5], to: [28.5, 51.5], ...holders });
  // With its water types known, the same map has a sea, and a lake apart from it.
  const water = new Set(["sea", "lake"]);
  const grid = buildWorldGrid(world.regions, { step: 0.25, water });
  const seas = seasOf(grid);
  assert.ok(seas[grid.cellOf(26, 51.5)] > 0, "the corsairs' water is sea");
  assert.equal(seas[grid.cellOf(26, 51.5)], seas[grid.cellOf(20.5, 53.5)], "one sea with the water nobody holds");
  assert.ok(seas[grid.cellOf(29.5, 51.5)] > 0 && seas[grid.cellOf(29.5, 51.5)] !== seas[grid.cellOf(26, 51.5)], "the lake is water of its own");
  assert.equal(grid.land[grid.cellOf(22.5, 51.5)], grid.full, "and the land is land");
  // (The sheet reaches as far as the water regions do: they are part of the map.)
  assert.ok(grid.cellOf(20.2, 53.8) >= 0);
  const found = findWay(grid, { medium: "sea", from: [22.5, 51.5], to: [28.5, 51.5], ...holders });
  assert.equal(found.error, undefined);
  let ashore = 0;
  const total = wayKm(found.way);
  for (let km = 0; km <= total; km += 5) {
    const at = placeAlong(found.way, km);
    const cell = grid.cellOf(at.lng, at.lat);
    if (cell < 0 || grid.land[cell] >= grid.full) ashore += 1;
  }
  assert.equal(ashore, 0, "it keeps to the water the whole way");
  assert.ok(found.km > 250 && found.km < 700, `${Math.round(found.km)} km across`);
  // (Told it is all land, a ship never crosses the corsairs' water: it has none to cross.)
  let through = 0;
  if (!outside.error) {
    for (let km = 0; km <= wayKm(outside.way); km += 5) {
      const at = placeAlong(outside.way, km);
      if (at.lng > 25.3 && at.lng < 26.7 && at.lat > 50.3 && at.lat < 52.7) through += 1;
    }
  }
  assert.equal(through, 0);
  let crossing = 0;
  for (let km = 0; km <= total; km += 5) {
    const at = placeAlong(found.way, km);
    if (at.lng > 25.3 && at.lng < 26.7 && at.lat > 50.3 && at.lat < 52.7) crossing += 1;
  }
  assert.ok(crossing > 0, "with its water known, it sails straight through it");
  // A train still keeps to the land, and stops at the shore.
  assert.equal(findWay(grid, { medium: "land", from: [21.5, 52.5], to: [28.5, 51.5], ...holders }).arrived, false);
  // A sheet is kept by its map and its water types: switching one is another sheet.
  assert.equal(worldSheetKey("map"), "world|map");
  assert.equal(worldSheetKey("map", new Set()), "world|map");
  assert.notEqual(worldSheetKey("map", water), worldSheetKey("map"));
  assert.equal(worldSheetKey("map", new Set(["lake", "sea"])), worldSheetKey("map", water), "in whatever order they are named");
});

test("a canal is gone through once it has been dug, on the world's own map", () => {
  const suez = CANALS.find((canal) => canal.name === "Suez");
  assert.deepEqual([suez.since, CANALS.find((canal) => canal.name === "Panama").since], [1869, 1914]);
  // The land between two seas, where Suez is, drawn as it lies there: the
  // Mediterranean to the north, the gulf running down from the neck and the
  // Red Sea opening south-east of it, with Egypt on one hand and Sinai on the other.
  // (Anatolia across the top, so that the sheet reaches as far north as the sea does.)
  const EGYPT = ["LLLLLL", "~~~~~~", "~~~~~~", "~~~~~~", "LLLLLL", "LL~LLL", "LL~LLL", "LLL~LL", "LLLL~~", "LLLL~~"];
  const world = syntheticMap({ layout: EGYPT, legend, west: 30, north: 35, step: 1 });
  const grid = gridOf(world);
  const ask = (year) => findWay(grid, { medium: "sea", from: [32.5, 31.7], to: [31.5, 28.2], ...asked(world, { year }) });
  const before = ask(1850);
  const after = ask(1900);
  assert.equal(before.error, undefined);
  assert.equal(after.error, undefined);
  assert.ok(after.km < before.km * 0.75, `${after.km} km through the canal against ${before.km} km round the land`);
  let through = false;
  along(grid, after.way, (at) => {
    if (at.lat > 30.05 && at.lat < 30.95 && at.lng > 32 && at.lng < 33) through = true;
  });
  assert.equal(through, true, "the way goes across the neck of land");
  let crossed = false;
  along(grid, before.way, (at) => {
    if (at.lat > 30.05 && at.lat < 30.95 && at.lng > 30 && at.lng < 35) crossed = true;
  });
  assert.equal(crossed, false, "before it was dug, nothing crosses the land");
  // A flat sheet is not the world: it has no canals.
  const flat = buildWorldGrid(world.regions, { step: 0.1, flat: true });
  const sailed = findWay(flat, { medium: "sea", from: [32.5, 31.7], to: [31.5, 28.2], ...asked(world, { year: 1900 }) });
  assert.equal(sailed.error, undefined);
  let over = false;
  for (const [lng, lat] of sailed.way) if (lat > 30.05 && lat < 30.95 && lng > 30 && lng < 35) over = true;
  assert.equal(over, false);

  // An invented world, on a globe of its own, that happens to have sea at both
  // ends of the canal and land between them: it is not Egypt, and nothing is
  // dug there. (Here the land is one bar from sea to sea, with no gulf, no Sinai and no Red Sea.)
  const invented = syntheticMap({ layout: ["~~~~~~", "~~~~~~", "LLLLLL", "~~~~~~", "~~~~~~", "~~~~~~"], legend, west: 30, north: 33, step: 1 });
  const elsewhere = gridOf(invented);
  const round = findWay(elsewhere, { medium: "sea", from: [32.5, 31.7], to: [32.5, 30.2], ...asked(invented, { year: 2024 }) });
  assert.equal(round.error, undefined);
  let across = false;
  along(elsewhere, round.way, (at) => {
    if (at.lat > 30.1 && at.lat < 30.9 && at.lng > 30.05 && at.lng < 35.95) across = true;
  });
  assert.equal(across, false, "its ship goes round the bar of land, whatever the year");
  assert.ok(round.km > 400, `${round.km} km round it, not 160 across`);
});
