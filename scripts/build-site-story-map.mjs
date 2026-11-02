/*! Open Historia — the landing page's story map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Builds site/story/map-data.js: the world as the landing page draws it, from
// the built-in Modern Day map (server/seed/default/regions.geojson), so the
// story is told on the game's own borders.
//
//   node scripts/build-site-story-map.mjs
//   (OH_MODULES=<a checkout with node_modules> when this one has none)
//
// Run by hand when the built-in map changes; the output is committed, so the
// site's build needs nothing new. What it writes, projected (Mercator) onto
// a plane 1600 wide, cut at 84°N and 57°S:
//   - every country as one outline (its regions merged);
//   - Western Europe and Korea region by region, finer, so the story can
//     colour each region by who holds it;
//   - Korea's front line at each step of the North's advance: where the
//     regions one side holds meet the other's, found on the unsimplified map,
//     where neighbouring regions carry the same points;
//   - the flights of the story's missiles, on the great circles they would
//     fly, and the sites they leave from and fall on;
//   - the grid, rivers, towns and names the map is dressed with.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.env.OH_MODULES || root, "package.json"));
const { geoArea, geoInterpolate, geoMercator, geoStream } = require("d3-geo");
const polygonClipping = require("polygon-clipping");

const W = 1600;
const NORTH = 84;
const SOUTH = -57;
// Mercator: x by longitude, y by the log of latitude's tangent.
const K = (W - 16) / (2 * Math.PI);
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const Y0 = 8 + K * mercY(NORTH);
const H = Math.ceil(Y0 - K * mercY(SOUTH) + 8);
const regions = JSON.parse(fs.readFileSync(path.join(root, "server/seed/default/regions.geojson"), "utf8")).features;
const cities = JSON.parse(fs.readFileSync(path.join(root, "server/seed/default/cities.geojson"), "utf8")).features;

// Not rotated: the map is cut at 180°. d3's stream below cuts any outline
// that crosses it, rather than drawing it from one side of the map to the other.
const projection = geoMercator().scale(K).translate([W / 2, Y0]);
const project = ([lon, lat]) => projection([lon, lat]);
const at2 = (lonLat) => project(lonLat).map((v) => Number(v.toFixed(2)));

// ---- geometry helpers ------------------------------------------------------
const polygonsOf = (geometry) => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : []);

// Douglas-Peucker on a projected ring or line.
const simplify = (points, tolerance) => {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const sq = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > far) { far = d; worst = i; }
    }
    if (far > sq && worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(sum / 2);
};

const fmt = (value, digits) => {
  const text = value.toFixed(digits);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
};

// A multipolygon projected through d3's own stream, which cuts any outline at
// the map's edge. d3 reads a ring's winding to know its inside, so a polygon
// that comes out larger than a hemisphere is turned round first.
const projectedRings = (polygon) => {
  let shape = { type: "Polygon", coordinates: polygon };
  if (geoArea(shape) > 2 * Math.PI) shape = { type: "Polygon", coordinates: polygon.map((ring) => [...ring].reverse()) };
  const rings = [];
  let current = null;
  geoStream(shape, projection.stream({
    point(x, y) { current.push([x, y]); },
    lineStart() { current = []; },
    lineEnd() { if (current && current.length > 2) rings.push(current); current = null; },
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  }));
  return rings;
};

// As a path ("M x y L x y … Z"), rings under `minArea` units² dropped.
const pathOf = (polygons, { tolerance, digits, minArea }) => {
  let d = "";
  for (const polygon of polygons) {
    for (const projected of projectedRings(polygon)) {
      const simple = simplify([...projected, projected[0]], tolerance);
      if (simple.length < 4 || ringArea(simple) < minArea) continue;
      d += `M${simple.slice(0, -1).map(([x, y]) => `${fmt(x, digits)} ${fmt(y, digits)}`).join("L")}Z`;
    }
  }
  return d;
};

const line = (points, digits = 2, tolerance = 0) => {
  let projected = points.map(project).filter(Boolean);
  if (tolerance) projected = simplify(projected, tolerance);
  for (let i = 1; i < projected.length; i += 1) {
    if (Math.abs(projected[i][0] - projected[i - 1][0]) > W / 2) throw new Error(`a line crosses the map's edge near ${points[i]}`);
  }
  return `M${projected.map(([x, y]) => `${fmt(x, digits)} ${fmt(y, digits)}`).join("L")}`;
};

const centroidOf = (feature) => {
  let best = null;
  for (const polygon of polygonsOf(feature.geometry)) {
    const area = ringArea(polygon[0]);
    if (!best || area > best.area) best = { ring: polygon[0], area };
  }
  let x = 0;
  let y = 0;
  for (const point of best.ring) { x += point[0]; y += point[1]; }
  return [x / best.ring.length, y / best.ring.length];
};

// ---- the world, one outline a country ---------------------------------------
const byOwner = new Map();
for (const feature of regions) {
  const owner = feature.properties.owner;
  if (!owner || owner === "Antarctica") continue;
  if (!byOwner.has(owner)) byOwner.set(owner, []);
  byOwner.get(owner).push(...polygonsOf(feature.geometry));
}
const countries = [];
for (const [name, polygons] of byOwner) {
  let merged;
  try {
    merged = polygonClipping.union(...polygons.map((polygon) => [polygon]));
  } catch {
    merged = polygons;
  }
  const d = pathOf(merged, { tolerance: 0.4, digits: 1, minArea: 0.3 });
  if (d) countries.push({ n: name, d });
}
countries.sort((a, b) => a.n.localeCompare(b.n));

// ---- region by region: Western Europe and Korea -------------------------------
const EUROPE = new Set(["France", "Germany", "Belgium", "Luxembourg", "Switzerland", "Netherlands", "Austria"]);
const inEurope = (feature) => {
  const { owner, id } = feature.properties;
  if (!EUROPE.has(owner)) return false;
  if (owner === "France") return id.startsWith("FRA.");
  if (owner === "Netherlands") return id.startsWith("NLD.");
  return true;
};
const regionsOf = (features, tolerance) => features.map((feature) => ({
  id: feature.properties.id,
  n: feature.properties.name,
  o: feature.properties.owner,
  d: pathOf(polygonsOf(feature.geometry), { tolerance, digits: 2, minArea: 0.0015 }),
})).filter((region) => region.d);
const europeFeatures = regions.filter(inEurope);
const koreaFeatures = regions.filter((feature) => ["North Korea", "South Korea"].includes(feature.properties.owner));

// ---- Korea: the North takes the South, a region at a time ---------------------
// North to south by each region's middle; the islands last.
const south = koreaFeatures.filter((feature) => feature.properties.owner === "South Korea");
const order = south
  .map((feature) => ({ id: feature.properties.id, lat: centroidOf(feature)[1], island: feature.properties.id === "KOR.12_1" }))
  .sort((a, b) => (a.island - b.island) || (b.lat - a.lat))
  .map((entry) => entry.id);

const key = ([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
const edgesOf = (features) => {
  const edges = new Map();
  for (const feature of features) {
    for (const polygon of polygonsOf(feature.geometry)) {
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i += 1) {
          const a = key(ring[i - 1]);
          const b = key(ring[i]);
          if (a === b) continue;
          edges.set(a < b ? `${a}|${b}` : `${b}|${a}`, [ring[i - 1], ring[i]]);
        }
      }
    }
  }
  return edges;
};
// Shared edges chained into lines.
const chain = (segments) => {
  const next = new Map();
  const points = new Map();
  const add = (a, b) => {
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  };
  for (const [p, q] of segments) {
    const a = key(p);
    const b = key(q);
    points.set(a, p);
    points.set(b, q);
    add(a, b);
    add(b, a);
  }
  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const lines = [];
  const starts = [...next.keys()].sort((a, b) => next.get(a).length - next.get(b).length);
  for (const start of starts) {
    for (const first of next.get(start)) {
      if (used.has(edgeKey(start, first))) continue;
      const out = [points.get(start)];
      let at = first;
      used.add(edgeKey(start, at));
      out.push(points.get(at));
      for (;;) {
        const onward = (next.get(at) ?? []).find((candidate) => !used.has(edgeKey(at, candidate)));
        if (!onward) break;
        used.add(edgeKey(at, onward));
        at = onward;
        out.push(points.get(at));
      }
      lines.push(out);
    }
  }
  return lines;
};
const koreaFronts = [];
for (let step = 0; step <= order.length; step += 1) {
  const taken = new Set(order.slice(0, step));
  const north = koreaFeatures.filter((feature) => feature.properties.owner === "North Korea" || taken.has(feature.properties.id));
  const rest = koreaFeatures.filter((feature) => feature.properties.owner === "South Korea" && !taken.has(feature.properties.id));
  const a = edgesOf(north);
  const b = edgesOf(rest);
  const shared = [...a.keys()].filter((edge) => b.has(edge)).map((edge) => a.get(edge));
  koreaFronts.push(chain(shared).filter((part) => part.length > 2).map((part) => line(part, 3, 0.01)).join(""));
}

// ---- the missiles: silo fields in the United States to missile fields in Russia --
// Each flies the great circle between the two, over the Arctic.
const LAUNCH = { Malmstrom: [-111.18, 47.5], Minot: [-101.36, 48.42], "F. E. Warren": [-104.86, 41.15] };
const TARGET = { Kozelsk: [35.78, 54.04], Tatishchevo: [45.6, 51.9], Plesetsk: [40.3, 62.7], Yasny: [59.87, 51.03], Moscow: [37.62, 55.75] };
const DEFENCE = { Sofrino: [37.9, 56.2], Severomorsk: [33.4, 69.07], Kaliningrad: [20.5, 54.7], Orenburg: [55.1, 51.8] };
// In launch order. The last is the one the camera chases: it goes furthest east,
// toward Korea, where the story goes next.
const FLIGHTS = [
  ["Malmstrom", "Plesetsk"], ["Minot", "Kozelsk"], ["F. E. Warren", "Tatishchevo"], ["Malmstrom", "Moscow"], ["Malmstrom", "Yasny"],
  ["F. E. Warren", "Kozelsk"], ["Malmstrom", "Tatishchevo"], ["Minot", "Plesetsk"], ["F. E. Warren", "Moscow"], ["Minot", "Yasny"],
];
const missiles = FLIGHTS.map(([from, to]) => {
  const between = geoInterpolate(LAUNCH[from], TARGET[to]);
  const points = [];
  for (let i = 0; i <= 64; i += 1) points.push(between(i / 64));
  const projected = points.map(project);
  for (let i = 1; i < projected.length; i += 1) {
    if (Math.abs(projected[i][0] - projected[i - 1][0]) > W / 2) throw new Error(`the flight ${from} → ${to} crosses the map's edge`);
  }
  return { from, to, p: projected.flat().map((v) => Number(v.toFixed(2))) };
});
const sites = {
  launch: Object.fromEntries(Object.entries(LAUNCH).map(([name, lonLat]) => [name, at2(lonLat)])),
  target: Object.fromEntries(Object.entries(TARGET).map(([name, lonLat]) => [name, at2(lonLat)])),
  defence: Object.fromEntries(Object.entries(DEFENCE).map(([name, lonLat]) => [name, at2(lonLat)])),
};

// ---- cartography: the grid, the rivers, the towns, the names ---------------------
const graticule = { world: "", europe: "", korea: "" };
for (let lon = -180; lon <= 180; lon += 15) {
  const points = [];
  for (let lat = -56; lat <= NORTH; lat += 2) points.push([lon, lat]);
  graticule.world += line(points, 1);
}
for (const lat of [-45, -30, -15, 0, 15, 30, 45, 60, 70, 75, 80]) {
  const points = [];
  for (let lon = -180; lon <= 180; lon += 3) points.push([lon, lat]);
  graticule.world += line(points, 1);
}
const fineGrid = (lon0, lon1, lat0, lat1) => {
  let d = "";
  for (let lon = lon0; lon <= lon1; lon += 1) {
    const points = [];
    for (let lat = lat0; lat <= lat1; lat += 1) points.push([lon, lat]);
    d += line(points);
  }
  for (let lat = lat0; lat <= lat1; lat += 1) {
    const points = [];
    for (let lon = lon0; lon <= lon1; lon += 1) points.push([lon, lat]);
    d += line(points);
  }
  return d;
};
graticule.europe = fineGrid(-14, 32, 34, 64);
graticule.korea = fineGrid(118, 136, 30, 46);

// The rivers of the story's maps, by their main bends (lon, lat).
const RIVERS = {
  Rhine: [[9.6, 47.55], [8.6, 47.66], [7.6, 47.57], [7.58, 48.05], [7.8, 48.6], [8.18, 49.0], [8.46, 49.5], [8.27, 50.0], [7.6, 50.36], [7.1, 50.74], [6.96, 50.94], [6.77, 51.23], [6.2, 51.84], [5.86, 51.85], [5.0, 51.9], [4.1, 51.96]],
  Moselle: [[6.88, 47.95], [6.45, 48.35], [5.9, 48.68], [6.18, 49.12], [6.37, 49.55], [6.64, 49.76], [7.05, 49.95], [7.6, 50.36]],
  Meuse: [[5.6, 48.0], [5.42, 48.7], [5.38, 49.16], [4.85, 49.75], [4.86, 50.47], [5.57, 50.63], [5.69, 50.85], [6.17, 51.37], [5.3, 51.75], [4.5, 51.82]],
  Seine: [[4.7, 47.5], [4.08, 48.3], [3.0, 48.4], [2.35, 48.86], [1.9, 49.0], [1.1, 49.44], [0.2, 49.45]],
  Loire: [[4.2, 44.8], [4.05, 46.0], [3.16, 46.99], [2.4, 47.3], [1.9, 47.9], [0.69, 47.39], [-0.55, 47.47], [-1.55, 47.21], [-2.2, 47.28]],
  "Rhône": [[6.15, 46.2], [5.6, 45.92], [4.83, 45.76], [4.89, 44.93], [4.81, 43.95], [4.63, 43.45]],
  Danube: [[8.5, 47.95], [9.99, 48.4], [11.42, 48.76], [12.1, 49.02], [13.46, 48.57], [14.29, 48.31], [16.37, 48.21], [17.1, 48.14], [18.9, 47.8], [19.05, 47.5], [18.92, 46.0], [20.46, 44.82], [22.5, 44.62], [24.0, 43.72], [26.1, 44.05], [28.0, 45.3], [29.6, 45.2]],
  Elbe: [[15.5, 50.6], [14.3, 50.5], [13.74, 51.05], [12.2, 51.75], [11.63, 52.13], [11.0, 53.0], [9.99, 53.55], [8.7, 53.88]],
  Thames: [[-1.9, 51.7], [-1.26, 51.75], [-0.5, 51.47], [-0.12, 51.5], [0.6, 51.5], [1.0, 51.48]],
  Po: [[7.1, 44.7], [7.69, 45.07], [9.0, 45.15], [10.0, 45.02], [11.4, 44.95], [12.4, 44.95]],
  Volga: [[33.0, 57.2], [35.9, 56.86], [39.9, 57.63], [43.9, 56.33], [47.25, 56.12], [49.1, 55.78], [48.5, 54.3], [50.1, 53.2], [46.0, 51.53], [44.5, 48.7], [46.0, 47.6], [48.0, 46.35]],
  Han: [[128.7, 37.5], [127.7, 37.55], [127.2, 37.55], [126.98, 37.52], [126.6, 37.65]],
  Imjin: [[127.4, 38.9], [127.0, 38.2], [126.8, 37.95], [126.68, 37.75]],
  Nakdong: [[128.9, 37.0], [128.5, 36.2], [128.45, 35.85], [128.6, 35.4], [128.95, 35.1]],
  Taedong: [[126.9, 39.6], [126.2, 39.15], [125.75, 39.02], [125.3, 38.7]],
  Yalu: [[128.1, 41.6], [126.9, 41.75], [125.6, 40.8], [124.4, 40.1]],
  Mississippi: [[-95.2, 47.2], [-93.1, 44.95], [-91.2, 43.0], [-91.0, 40.4], [-90.2, 38.6], [-89.2, 37.0], [-90.1, 35.1], [-91.1, 32.3], [-91.2, 30.5], [-89.4, 29.0]],
  Missouri: [[-111.3, 45.9], [-111.0, 47.5], [-109.0, 47.9], [-104.0, 48.0], [-101.4, 47.5], [-100.3, 46.8], [-100.0, 44.4], [-97.4, 42.8], [-96.0, 41.3], [-94.6, 39.1], [-90.2, 38.8]],
};
const rivers = Object.entries(RIVERS).map(([name, points]) => ({ n: name, d: line(points), at: at2(points[Math.floor(points.length / 2)]) }));

// Towns drawn quietly behind the story's places. Tier 1 shows from afar, tier 2 close in.
const TOWNS = [
  ["Amsterdam", 4.9, 52.37, 1], ["Rotterdam", 4.48, 51.92, 2], ["Lille", 3.06, 50.63, 1], ["Amiens", 2.3, 49.9, 2], ["Calais", 1.86, 50.95, 2],
  ["Reims", 4.03, 49.26, 2], ["Nancy", 6.18, 48.69, 2], ["Metz", 6.18, 49.12, 2], ["Strasbourg", 7.75, 48.58, 1], ["Saarbrücken", 6.99, 49.24, 2],
  ["Cologne", 6.96, 50.94, 1], ["Frankfurt", 8.68, 50.11, 1], ["Mannheim", 8.47, 49.49, 2], ["Stuttgart", 9.18, 48.78, 1], ["Basel", 7.59, 47.56, 2],
  ["Zürich", 8.54, 47.37, 1], ["Bern", 7.45, 46.95, 1], ["Geneva", 6.14, 46.2, 1], ["Lyon", 4.83, 45.76, 1], ["Dijon", 5.04, 47.32, 2],
  ["Marseille", 5.37, 43.3, 1], ["Toulouse", 1.44, 43.6, 1], ["Bordeaux", -0.58, 44.84, 1], ["Nantes", -1.55, 47.22, 1], ["Brest", -4.49, 48.39, 2],
  ["Le Havre", 0.11, 49.49, 2], ["Rouen", 1.1, 49.44, 2], ["Hamburg", 9.99, 53.55, 1], ["Hanover", 9.73, 52.37, 2], ["Leipzig", 12.37, 51.34, 2],
  ["Dresden", 13.74, 51.05, 2], ["Munich", 11.58, 48.14, 1], ["Nuremberg", 11.08, 49.45, 2], ["Vienna", 16.37, 48.21, 1], ["Prague", 14.42, 50.08, 1],
  ["Milan", 9.19, 45.46, 1], ["Turin", 7.69, 45.07, 2], ["Copenhagen", 12.57, 55.68, 1], ["Warsaw", 21.0, 52.23, 1], ["Edinburgh", -3.19, 55.95, 1],
  ["Dublin", -6.26, 53.35, 1], ["Barcelona", 2.17, 41.39, 1], ["Rome", 12.5, 41.9, 1], ["Antwerp", 4.4, 51.22, 2], ["Luxembourg", 6.13, 49.61, 2],
  ["Oslo", 10.75, 59.91, 1], ["Stockholm", 18.07, 59.33, 1], ["Helsinki", 24.94, 60.17, 1], ["St Petersburg", 30.31, 59.94, 1], ["Minsk", 27.56, 53.9, 1],
  ["Kyiv", 30.52, 50.45, 1], ["Murmansk", 33.08, 68.97, 1], ["Arkhangelsk", 40.54, 64.54, 2], ["Kazan", 49.1, 55.79, 1], ["Samara", 50.1, 53.2, 2],
  ["Yekaterinburg", 60.6, 56.84, 1], ["Volgograd", 44.5, 48.7, 2], ["Reykjavík", -21.9, 64.15, 1], ["Nuuk", -51.7, 64.18, 1], ["Thule", -68.7, 76.53, 2],
  ["Ottawa", -75.7, 45.42, 1], ["Winnipeg", -97.14, 49.9, 2], ["Calgary", -114.07, 51.05, 2], ["Denver", -104.99, 39.74, 1], ["Chicago", -87.63, 41.88, 1],
  ["Great Falls", -111.3, 47.5, 2], ["Bismarck", -100.78, 46.81, 2], ["Cheyenne", -104.82, 41.14, 2], ["Anchorage", -149.9, 61.22, 2], ["New York", -74.0, 40.71, 1],
  ["Seoul", 126.98, 37.57, 1], ["Pyongyang", 125.75, 39.02, 1], ["Busan", 129.08, 35.18, 1], ["Incheon", 126.7, 37.46, 2], ["Daegu", 128.6, 35.87, 2],
  ["Daejeon", 127.38, 36.35, 2], ["Gwangju", 126.85, 35.16, 2], ["Ulsan", 129.31, 35.54, 2], ["Kaesong", 126.55, 37.97, 2], ["Wonsan", 127.44, 39.15, 2],
  ["Hamhung", 127.54, 39.92, 2], ["Chongjin", 129.78, 41.8, 2], ["Sinuiju", 124.4, 40.1, 2], ["Chuncheon", 127.73, 37.88, 2], ["Pohang", 129.34, 36.02, 2],
  ["Tokyo", 139.69, 35.69, 1], ["Osaka", 135.5, 34.69, 2], ["Fukuoka", 130.4, 33.59, 2], ["Beijing", 116.4, 39.9, 1], ["Shenyang", 123.43, 41.8, 2],
  ["Vladivostok", 131.89, 43.12, 1], ["Dalian", 121.6, 38.91, 2], ["Shanghai", 121.47, 31.23, 1],
];
const towns = TOWNS.map(([name, lon, lat, tier]) => ({ n: name, t: tier, at: at2([lon, lat]) }));

const regionLabels = [...europeFeatures, ...koreaFeatures]
  .filter((feature) => !/^(NLD\.(6|13|14)_1|LUX|KOR\.(5|7|11|15|16|17|1)_1|PRK\.(11|12|14|6)_1)/.test(feature.properties.id))
  .map((feature) => ({ n: feature.properties.name, at: at2(centroidOf(feature)), o: feature.properties.owner }));

// ---- places the story points at --------------------------------------------------
const places = {};
for (const feature of cities) {
  const name = feature.properties.name || feature.properties.city;
  if (["Paris", "Berlin", "Brussels", "London", "Madrid", "Cairo", "New Delhi", "Beijing", "Tokyo"].includes(name) && !places[name]) places[name] = at2(feature.geometry.coordinates);
}
for (const [name, lonLat] of Object.entries({
  Washington: [-77.04, 38.9], Moscow: [37.62, 55.75], "Brasília": [-47.88, -15.79], Pretoria: [28.19, -25.75], Canberra: [149.13, -35.28],
  Strasbourg: [7.75, 48.58], Seoul: [126.98, 37.57], Pyongyang: [125.75, 39.02], Busan: [129.08, 35.18], France: [2.5, 46.6],
})) places[name] = at2(lonLat);

// The frames the camera is aimed by.
const boxOf = (features) => {
  const xs = [];
  const ys = [];
  for (const feature of features) for (const polygon of polygonsOf(feature.geometry)) for (const point of polygon[0]) {
    const [x, y] = project(point);
    xs.push(x);
    ys.push(y);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((value) => Number(value.toFixed(1)));
};

const lonLatBox = (lon0, lat0, lon1, lat1) => {
  const [x0, y1] = project([lon0, lat0]);
  const [x1, y0] = project([lon1, lat1]);
  return [x0, y0, x1, y1].map((value) => Number(value.toFixed(1)));
};

const data = {
  w: W,
  h: H,
  countries,
  europe: regionsOf(europeFeatures, 0.05),
  korea: { regions: regionsOf(koreaFeatures, 0.02), order, fronts: koreaFronts },
  missiles,
  sites,
  graticule,
  rivers,
  towns,
  regionLabels,
  places,
  frames: {
    world: lonLatBox(-168, -50, 178, 76),
    europe: boxOf(europeFeatures),
    korea: boxOf(koreaFeatures),
    skip: lonLatBox(-20, 36, 130, 64),
    talks: lonLatBox(-95, 32, 118, 64),
  },
  // Back to degrees, for the frame's coordinates and the scale bar.
  merc: { k: Number(K.toFixed(4)), x0: W / 2, y0: Number(Y0.toFixed(3)) },
};

const out = path.join(root, "site/story/map-data.js");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `/*! Open Historia — the landing page's story map, built by scripts/build-site-story-map.mjs from the built-in Modern Day map. AGPL-3.0-or-later. */\nwindow.OH_STORY_MAP=${JSON.stringify(data)};\n`);
console.log(`site/story/map-data.js: ${(fs.statSync(out).size / 1024).toFixed(0)} KB · ${countries.length} countries · Europe ${data.europe.length} and Korea ${data.korea.regions.length} regions · ${koreaFronts.length} Korean fronts · ${missiles.length} flights`);
