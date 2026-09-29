import test from "node:test";
import assert from "node:assert/strict";
import { fmgToEditorSeed } from "./fmgImport.js";

// A tiny FMG bundle already in lon/lat (fmgDriver's toGeo does the pixel
// conversion before the importer sees it): a 3x2 grid of one-degree cells.
//
//   lat 1..2 |  C: Orvia land  |  D: ocean  |  F: neutral land |
//   lat 0..1 |  A: Kuizltan N  |  B: Kuiz S |  E: lake         |
//            lon 0..1          lon 1..2     lon 2..3
const square = (lon, lat) => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + 1, lat], [lon + 1, lat + 1], [lon, lat + 1], [lon, lat]]],
});
const cell = (lon, lat, properties) => ({ type: "Feature", geometry: square(lon, lat), properties });

const bundle = () => ({
  cells: {
    type: "FeatureCollection",
    features: [
      cell(0, 0, { height: 30, biome: 5, type: "island", state: 1, province: 1, population: 10 }),
      cell(1, 0, { height: 30, biome: 5, type: "island", state: 1, province: 2, population: 10 }),
      cell(0, 1, { height: 40, biome: 6, type: "island", state: 2, province: 3, population: 5 }),
      cell(1, 1, { height: 8, biome: 0, type: "ocean", state: 0, province: 0, population: 0 }),
      cell(2, 0, { height: 25, biome: 0, type: "lake", state: 1, province: 2, population: 0 }),
      cell(2, 1, { height: 30, biome: 6, type: "island", state: 0, province: 0, population: 1 }),
    ],
  },
  states: [
    { i: 0, name: "Neutrals" },
    { i: 1, name: "Kuizltan", color: "#ff0000" },
    { i: 2, name: "Orvia", color: "#00ff00" },
    { i: 3, name: "Gone", color: "#0000ff", removed: true },
  ],
  provinces: [
    { i: 0, name: "" },
    { i: 1, name: "North Kuiz", state: 1 },
    { i: 2, name: "South Kuiz", state: 1 },
    { i: 3, name: "Orvia Prime", state: 2 },
  ],
  burgs: [
    { i: 1, name: "Kuizgrad", population: 25, capital: 1, lon: 0.5, lat: 0.5 },
    { i: 2, name: "Townsville", population: 3, capital: 0, lon: 1.5, lat: 0.5 },
    { i: 3, name: "Ghost", population: 9, capital: 0, lon: 0.5, lat: 1.5, removed: true },
    { i: 4, name: "Nowhere", population: 9, capital: 0, lon: null, lat: null },
  ],
  biomes: [
    { i: 0, name: "Marine", color: "#466eab" },
    { i: 5, name: "Grassland", color: "#c8d68f" },
    { i: 6, name: "Taiga", color: "#4b6b32" },
  ],
});

const allPoints = (geometry) => {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
};

test("one region per province, owned by the state's exact name; water and neutral land are dropped", () => {
  const seed = fmgToEditorSeed(bundle());
  const regions = seed.regions.features.map((f) => f.properties);
  assert.deepEqual(
    regions.map((p) => [p.id, p.name, p.owner]).sort(),
    [
      ["reg_fmg_p1_s1", "North Kuiz", "Kuizltan"],
      ["reg_fmg_p2_s1", "South Kuiz", "Kuizltan"],
      ["reg_fmg_p3_s2", "Orvia Prime", "Orvia"],
    ],
  );
  for (const p of regions) {
    assert.equal(p.gid0, p.owner);
    assert.equal(p.typeId, "land");
  }
  assert.equal(seed.stats.landCells, 4); // A, B, C and the neutral F; not the ocean or the lake
  assert.equal(seed.stats.regions, 3);
});

test("groupBy state dissolves a state's cells into one region", () => {
  const seed = fmgToEditorSeed(bundle(), { groupBy: "state" });
  const regions = seed.regions.features;
  assert.deepEqual(regions.map((f) => [f.properties.id, f.properties.owner]).sort(), [
    ["reg_fmg_s1", "Kuizltan"],
    ["reg_fmg_s2", "Orvia"],
  ]);
  const kuiz = regions.find((f) => f.properties.owner === "Kuizltan");
  assert.equal(kuiz.geometry.type, "MultiPolygon");
  assert.equal(kuiz.geometry.coordinates.length, 1, "the two touching cells become one polygon");
});

test("without provinces, regions fall back to states", () => {
  const seed = fmgToEditorSeed({ ...bundle(), provinces: [] });
  assert.deepEqual(seed.regions.features.map((f) => f.properties.id).sort(), ["reg_fmg_s1", "reg_fmg_s2"]);
});

test("polities and colours come from live, named states only", () => {
  const seed = fmgToEditorSeed(bundle());
  assert.deepEqual(seed.polities.map((p) => p.name), ["Kuizltan", "Orvia"]);
  assert.deepEqual(seed.colors, { Kuizltan: [255, 0, 0], Orvia: [0, 255, 0] });
});

test("cities come from burgs: removed and unplaced burgs are skipped, the capital is flagged", () => {
  const seed = fmgToEditorSeed(bundle());
  const cities = seed.cities.features.map((f) => f.properties);
  assert.deepEqual(cities, [
    { city: "Kuizgrad", population: 25000, capital: "primary", tier: 4 },
    { city: "Townsville", population: 3000, capital: "", tier: 1 },
  ]);
});

test("every output coordinate stays on the map, with the ocean margin left free", () => {
  const seed = fmgToEditorSeed(bundle());
  const land = seed.background.geojson.features.filter((f) => f.properties.biome);
  const points = [
    ...seed.regions.features.flatMap((f) => allPoints(f.geometry)),
    ...seed.cities.features.flatMap((f) => allPoints(f.geometry)),
    ...land.flatMap((f) => allPoints(f.geometry)),
  ];
  assert.ok(points.length > 0);
  for (const [lon, lat] of points) {
    assert.ok(Math.abs(lon) <= 180 * 0.92 + 1e-6, `lon ${lon}`);
    assert.ok(Math.abs(lat) < 85.06, `lat ${lat}`);
  }
  // The land (3 by 2 degrees) keeps its shape: it fills the width, not the height.
  const landPoints = land.flatMap((f) => allPoints(f.geometry));
  const lons = landPoints.map((p) => p[0]);
  const lats = landPoints.map((p) => p[1]);
  assert.ok(Math.max(...lons) > 165 && Math.min(...lons) < -165);
  assert.ok(Math.max(...lats) < 80 && Math.min(...lats) > -80);
});

test("the basemap paints the whole-world ocean first, then depth bands, biomes and lakes", () => {
  const seed = fmgToEditorSeed(bundle());
  const layers = seed.background.geojson.features.map((f) => f.properties);
  assert.deepEqual(layers[0], { water: "ocean", fill: "#0b1a2b" });
  assert.ok(layers.some((p) => p.water === "ocean" && p.fill === "#163246"), "the ocean cell's depth band");
  assert.deepEqual(layers.filter((p) => p.biome).map((p) => p.biome).sort(), ["Grassland", "Taiga"]);
  assert.deepEqual(layers.at(-1), { water: "lake", fill: "#39627f" });
});

test("an empty or missing bundle gives an empty seed rather than throwing", () => {
  for (const data of [null, {}]) {
    const seed = fmgToEditorSeed(data);
    assert.equal(seed.regions.features.length, 0);
    assert.equal(seed.cities.features.length, 0);
    assert.equal(seed.polities.length, 0);
    assert.equal(seed.background.geojson.features.length, 1, "only the base ocean");
  }
});
