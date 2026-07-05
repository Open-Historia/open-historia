/*! Open Historia — Fantasy Map Generator import adapter © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Turns a Fantasy Map Generator (Azgaar, MIT) generation into Open Historia
// editor pieces: land regions dissolved by province/state, polities + colours
// from states, cities from burgs, and a vector "basemap" (biome-coloured land)
// that stays crisp at any zoom. Pure + framework-free so it's unit-testable; the
// live FMG driver extracts the raw data and feeds it here.
//
// Input contract (all coordinates GEOGRAPHIC lon/lat — the driver converts FMG's
// pixel space via FMG's own toGeoCoordinates before handing data over):
//   cells:     GeoJSON FeatureCollection from FMG saveGeoJsonCells — each cell
//              Polygon carries { height, biome, type, state, province, population }.
//   states:    [{ i, name, color, removed }]        (pack.states)
//   provinces: [{ i, name, color, state, removed }] (pack.provinces, optional)
//   burgs:     [{ i, name, population, capital, lon, lat, removed }] (pack.burgs)
//   biomes:    [{ i, name, color }]                 (biomesData)

import polygonClipping from "polygon-clipping";

const SEA_LEVEL = 20; // FMG convention: cell height >= 20 is land, below is water

// The editor renders in Web Mercator (EPSG:3857). FMG's map is a FLAT
// (equirectangular) rectangle, so to show it undistorted we place it in Mercator
// space — where the editor's screen actually lives — preserving its flat aspect,
// then hand the placed points back as lon/lat (the editor reprojects 4326 -> 3857
// to draw). Fitting straight into a lat/lon box instead (the old way) let Mercator
// stretch the latitudes, squashing the whole map horizontally.
const MERC_R = 6378137; // EPSG:3857 sphere radius
const MERC_MAX = Math.PI * MERC_R; // 20037508.34 — the 3857 world half-extent
const WORLD_FILL = 0.92; // fraction of the Mercator world the map fills (leaves an ocean margin)
const mercXToLon = (x) => (x / MERC_R) * (180 / Math.PI);
const mercYToLat = (y) => (2 * Math.atan(Math.exp(y / MERC_R)) - Math.PI / 2) * (180 / Math.PI);

const hexToRgb = (hex) => {
  const h = String(hex || "").replace(/^#/, "");
  if (h.length < 6) return [136, 136, 136];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

// A short, unique, stable owner code for a state — the editor keys ownership by code.
const stateCode = (state) => `${(String(state.name || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3) || "ST")}${state.i}`;

// ---- coordinate fit: FMG lon/lat bbox -> target extent, aspect-preserving ----
const boundsOf = (features) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (rings) => {
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  };
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") scan(g.coordinates);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates) scan(p);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
};

// Place the source bbox (FMG equirectangular degrees — 1° lon == 1° lat in pixels,
// so its width:height IS the map's true flat aspect) into Mercator space, centred
// and preserving that aspect, then convert back to lon/lat. The landmass keeps its
// proportions at any latitude instead of being squashed by the projection.
const makeFit = (src) => {
  const sw = src.maxX - src.minX || 1, sh = src.maxY - src.minY || 1;
  const aspect = sw / sh;
  const avail = 2 * MERC_MAX * WORLD_FILL;
  let mw = avail, mh = avail / aspect; // fill width first…
  if (mh > avail) { mh = avail; mw = avail * aspect; } // …unless that overflows the height
  return ([x, y]) => {
    const mx = -mw / 2 + ((x - src.minX) / sw) * mw; // west → east
    const my = -mh / 2 + ((y - src.minY) / sh) * mh; // south → north
    return [+mercXToLon(mx).toFixed(4), +mercYToLat(my).toFixed(4)];
  };
};

const mapGeom = (geom, fit) => {
  if (geom.type === "Polygon") return { type: "Polygon", coordinates: geom.coordinates.map((r) => r.map(fit)) };
  if (geom.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: geom.coordinates.map((p) => p.map((r) => r.map(fit))) };
  return geom;
};

// Union GeoJSON Polygon/MultiPolygon geometries into one MultiPolygon. FMG cells
// can have tiny gaps/overlaps, and union can throw on degenerate input — fall back
// to the undissolved cells rather than dropping the region.
const dissolve = (geoms) => {
  const polys = [];
  for (const g of geoms) {
    if (g.type === "Polygon") polys.push(g.coordinates);
    else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
  }
  if (!polys.length) return null;
  try {
    return { type: "MultiPolygon", coordinates: polygonClipping.union(...polys) };
  } catch {
    return { type: "MultiPolygon", coordinates: polys };
  }
};

export const fmgToEditorSeed = (data, options = {}) => {
  const { cells = { features: [] }, states = [], provinces = [], burgs = [], biomes = [] } = data || {};
  const groupBy = options.groupBy === "state" ? "state" : provinces.length ? "province" : "state";

  const stateById = new Map(states.map((s) => [s.i, s]));
  const provinceById = new Map(provinces.map((p) => [p.i, p]));
  const biomeById = new Map(biomes.map((b) => [b.i, b]));

  // Land cells only (drop ocean/lake), so water never becomes a region.
  const landCells = (cells.features || []).filter((f) => {
    const p = f.properties || {};
    return Number(p.height) >= SEA_LEVEL && p.type !== "ocean" && p.type !== "lake";
  });

  const fit = makeFit(boundsOf(landCells));

  // ---- regions: dissolve land cells by province (or state) ----
  const regionGroups = new Map();
  for (const f of landCells) {
    const p = f.properties || {};
    const stateId = Number(p.state) || 0;
    const provinceId = Number(p.province) || 0;
    const key = groupBy === "province" ? `p${provinceId}_s${stateId}` : `s${stateId}`;
    const g = regionGroups.get(key) || { geoms: [], stateId, provinceId };
    g.geoms.push(mapGeom(f.geometry, fit));
    regionGroups.set(key, g);
  }

  const regionFeatures = [];
  for (const [key, g] of regionGroups) {
    const state = stateById.get(g.stateId);
    if (!state || state.i === 0) continue; // neutral/unclaimed land isn't a region
    const geometry = dissolve(g.geoms);
    if (!geometry) continue;
    const owner = stateCode(state);
    const province = provinceById.get(g.provinceId);
    regionFeatures.push({
      type: "Feature",
      geometry,
      properties: {
        id: `reg_fmg_${key}`,
        owner,
        gid0: owner,
        name: province?.name || state.name || owner,
        country: state.name || owner,
        typeId: "land",
      },
    });
  }

  // ---- polities + colours from states ----
  const polities = [];
  const colors = {};
  for (const s of states) {
    if (!s || s.i === 0 || s.removed) continue;
    const code = stateCode(s);
    colors[code] = hexToRgb(s.color);
    polities.push({ code, name: s.name || code, color: s.color || "#888888" });
  }

  // ---- cities from burgs ----
  const cityFeatures = [];
  for (const b of burgs) {
    if (!b || b.removed || b.lon == null || b.lat == null) continue;
    const pop = Number(b.population) || 0; // FMG population is in thousands
    const capital = Boolean(b.capital);
    cityFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: fit([b.lon, b.lat]) },
      properties: {
        city: b.name || "",
        population: Math.round(pop * 1000),
        capital: capital ? "primary" : "",
        tier: capital ? 4 : pop >= 20 ? 3 : pop >= 5 ? 2 : 1,
      },
    });
  }

  // ---- vector basemap: land dissolved by biome, each feature carries its fill ----
  // A data-driven renderer paints these biome colours; a plain vector renderer just
  // shows land vs sea. Either way it's sharp at any zoom (no raster to pixelate).
  const biomeGroups = new Map();
  for (const f of landCells) {
    const bid = Number((f.properties || {}).biome) || 0;
    const g = biomeGroups.get(bid) || [];
    g.push(mapGeom(f.geometry, fit));
    biomeGroups.set(bid, g);
  }
  const bgFeatures = [];
  for (const [bid, geoms] of biomeGroups) {
    const geometry = dissolve(geoms);
    if (!geometry) continue;
    const biome = biomeById.get(bid);
    bgFeatures.push({
      type: "Feature",
      geometry,
      properties: { biome: biome?.name || String(bid), fill: biome?.color || "#8aa66a" },
    });
  }

  return {
    regions: { type: "FeatureCollection", features: regionFeatures },
    polities,
    colors,
    cities: { type: "FeatureCollection", features: cityFeatures },
    background: { kind: "vector", geojson: { type: "FeatureCollection", features: bgFeatures } },
    stats: {
      regions: regionFeatures.length,
      polities: polities.length,
      cities: cityFeatures.length,
      biomes: bgFeatures.length,
      landCells: landCells.length,
    },
  };
};
