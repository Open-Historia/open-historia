/*! Open Historia — portions (custom-regions tier-2 rendering) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected, onOceanClicked, dismissRegionPopup } from "../Selection/Regions";
import { onUnitSelected, dismissUnitPopup } from "../Selection/Units";
import { onFeatureSelected, dismissFeaturePopup } from "../Selection/Features";
import {
  getInteractionMode,
  clearInteractionMode,
  deployUnit,
  placeUnitAdmin,
  moveUnitTo,
  attackWith,
  attackFeature,
  attackRegion,
} from "./unitsController.js";
import { recordMapTrace, recordMapWork } from "../../runtime/mapPerfTrace.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  getNationColors,
  primeCustomRegionCatalog,
  primeCustomRegionCatalogEntries,
  readJson,
  reportPerfOperation,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import { resolveRegionName } from "../../runtime/regionNameFixes.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  buildPolityLabelCollections,
  loadCountryLabelCollections,
  selectPolityPointFallbacks,
  summarizePolityLabelDiagnostics,
} from "../../runtime/countryLabels.js";
import { translateLabel } from "../../runtime/translator.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";
import { useWorldState } from "./useWorldState.js";
import { V_NEXT_MARKER_SHAPE_LAYER_IDS } from "./vnext/presentationPolicy.js";
import { resolveContextualPolityLabels } from "./vnext/polityNaming.js";

ensurePmtilesProtocol();
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const EMPTY_CUSTOM_REGION_META = Object.freeze({
  ready: false,
  featureCount: 0,
  hasDrawnGeometry: false,
  fullyAuthoredGeometry: false,
  ownedCountryCodes: Object.freeze([]),
  editedStockIds: Object.freeze([]),
  records: Object.freeze([]),
});

// Globe projection renders a label's own high-latitude countries oversized
// relative to their outline — confirmed (issue #6) to be text-only (fills
// stay correctly scaled) and tied to each FEATURE's own latitude, not the
// camera's. cos(lat) undoes it; only applied in globe mode; flat/mercator
// keeps the exact same sizing it always has (this factor is 1 at lat 0 and
// visibly wrong in mercator at high latitude, so never enable it there).
const GLOBE_LAT_CORRECTION = ["cos", ["*", ["coalesce", ["get", "lat"], 0], Math.PI / 180]];

const buildCountryTextSize = (
  multiplier = 1,
  correctForGlobe = false,
  maxSize = 254,
  scaleProperty = "areaScale",
) => {
  const scale = correctForGlobe ? ["*", multiplier, GLOBE_LAT_CORRECTION] : multiplier;
  const atZoom = (power) => [
    "min",
    maxSize,
    ["*", scale, ["*", ["get", scaleProperty], ["^", 2, power]]],
  ];

  return [
    "interpolate", ["exponential", 2], ["zoom"],
    0, atZoom(-16),
    4, atZoom(-12),
    8, atZoom(-8),
    12, atZoom(-4),
    16, atZoom(0),
    20, atZoom(4),
    24, atZoom(8),
  ];
};

const buildFallbackColorExpression = () => ([
  "rgb",
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
]);

// Procedural colour for an owner with no entry in the palette. Takes the owner —
// a country NAME now ("Russia", "Roman Empire"), not a GID_0 code.
//
// Stripping to A-Z first is what makes a name hash usefully. The letters are read
// positionally, so "Côte d'Ivoire" would otherwise hash on 'C', 'Ô', 'T' — and 'Ô'
// is not in the alphabet, so indexOf returns -1 and the channel clamps to 0. Every
// accented or two-word name would collapse toward the same dark corner of the
// space. Stripping gives "COTEDIVOIRE" and a colour that actually differs from its
// neighbours'.
//
// NOTE this is the JS twin of buildFallbackColorExpression above, which reads
// GID_0 off the stock tiles and must keep hashing the CODE — tile properties are
// baked GADM and never become names.
const fallbackRgbFromOwner = (owner = "") => {
  const normalized = String(owner ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length < 3) {
    return [96, 96, 96];
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[2]));
  return [64 + a * 5, 64 + c * 5, 64 + b * 5];
};

const fallbackColorFromOwner = (owner = "") => {
  const [r, g, b] = fallbackRgbFromOwner(owner);
  return `rgb(${r}, ${g}, ${b})`;
};

// "#c0507a" / "#c07" / "rgb(192, 80, 122)" -> [r,g,b]; null when unparseable.
// world.polityOverrides stores colours as CSS strings while colors.json stores
// RGB triplets, so the two namespaces need a bridge before they can be merged.
const parseColorToRgb = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(`${hex[0]}${hex[0]}`, 16),
      parseInt(`${hex[1]}${hex[1]}`, 16),
      parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])].map((c) => Math.max(0, Math.min(255, c)));
};

// Display-only palette shaping. Scenario/save colours remain canonical; the map
// merely reins in extreme saturation/lightness so neighbouring polities read as
// one designed atlas rather than unrelated UI swatches.
const normalizePoliticalRgb = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length !== 3) return rgb;
  let [r, g, b] = rgb.map((value) => Math.max(0, Math.min(255, Number(value) || 0)));

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const desaturate = chroma > 20 ? 0.08 : 0.03;
  r = r * (1 - desaturate) + luminance * desaturate;
  g = g * (1 - desaturate) + luminance * desaturate;
  b = b * (1 - desaturate) + luminance * desaturate;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;

  if (lightness < 0.30) {
    const mix = Math.min(0.22, (0.30 - lightness) * 0.7);
    r += (255 - r) * mix;
    g += (255 - g) * mix;
    b += (255 - b) * mix;
  } else if (lightness > 0.64) {
    const mix = Math.min(0.18, (lightness - 0.64) * 0.75);
    r *= 1 - mix;
    g *= 1 - mix;
    b *= 1 - mix;
  }

  return [r, g, b].map((value) => Math.round(Math.max(0, Math.min(255, value))));
};

// Palettes are owner -> [r,g,b]. Re-reading colors.json hands back a fresh object
// every time; swapping identity for identical contents would rebuild every
// MapLibre match expression on the map, so compare contents before accepting it.
const shallowEqualColors = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
};

// Case/diacritic/punctuation-folded owner key, so "Côte d'Ivoire", "cote divoire"
// and "COTE D'IVOIRE" all reach the same palette entry.
const ownerFoldKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// ---- Disputed-region stripes ------------------------------------------------
// A region whose `claimants` list names the countries contesting it renders
// striped in their colors (current administrator first). The stripe tile's
// image id encodes the rgb list itself ("oh-stripes-r_g_b-r_g_b"), so the
// styleimagemissing handler can rebuild any tile the style asks for — including
// after the globe/mercator toggle remounts the map and its images are gone.
const STRIPE_PREFIX = "oh-stripes-";
const STRIPE_BAND_PX = 8;

const stripeImageId = (rgbList) => STRIPE_PREFIX + rgbList.map((rgb) => rgb.join("_")).join("-");

const parseStripeImageId = (id) => {
  if (typeof id !== "string" || !id.startsWith(STRIPE_PREFIX)) return null;
  const colors = id
    .slice(STRIPE_PREFIX.length)
    .split("-")
    .map((part) => part.split("_").map(Number));
  const valid = colors.length >= 2 &&
    colors.every((rgb) => rgb.length === 3 && rgb.every((n) => Number.isFinite(n) && n >= 0 && n <= 255));
  return valid ? colors : null;
};

// Diagonal stripe tile as raw RGBA: band = (x+y) mod period, which tiles
// seamlessly in both directions.
const buildStripeImage = (rgbList) => {
  const size = rgbList.length * STRIPE_BAND_PX;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rgb = rgbList[Math.floor(((x + y) % size) / STRIPE_BAND_PX)];
      const p = (y * size + x) * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }
  return { width: size, height: size, data };
};

// Neutral tone for unowned custom regions (land with no owner code).
const NEUTRAL_LAND_COLOR = "rgb(88, 98, 110)";
// Constant GL expression — the colour data is baked into each feature's
// _fillColor property by enrichedCustomRegionData above.
const CUSTOM_FILL_COLOR = [
  "coalesce",
  ["feature-state", "fillColor"],
  ["get", "ownerColor"],
  ["get", "_fillColor"],
  NEUTRAL_LAND_COLOR,
];
const DETAIL_FILL_COLOR = [
  "coalesce",
  ["feature-state", "fillColor"],
  "rgba(0, 0, 0, 0)",
];

// GADM region ids contain a dot ("DEU.2_1"); author-drawn regions ("reg_...")
// don't. On custom maps, GADM regions crossfade between two sources: the seed
// GeoJSON when zoomed OUT (the stock tiles are too simplified out there and
// show sliver gaps) and the stock vector tiles when zoomed IN (the z5 seed is
// too coarse up close). Author-drawn geometry renders from the GeoJSON at every
// zoom, on top — the tiles don't know those shapes.
const CUSTOM_GEOMETRY_FILTER = ["==", ["index-of", ".", ["get", "id"]], -1];
const GADM_GEOMETRY_FILTER = [">=", ["index-of", ".", ["get", "id"]], 0];
// A feature whose geometry lives ONLY in the GeoJSON: author-drawn ("reg_...", no
// dot) OR a GADM region the editor reshaped (dotted id, but `edited`). Both must
// render from the GeoJSON at every zoom AND be kept out of the stock tiles, whose
// geometry is the ORIGINAL shape — painting both stacks twice darkens
// the reshaped area. A plain unedited GADM region carries no `edited`, so
// ["==", ["get","edited"], true] is false for it and these fall back exactly to the
// dot test — stock and author-only maps render identically to before.
const AUTHORED_GEOMETRY_FILTER = ["any", CUSTOM_GEOMETRY_FILTER, ["==", ["get", "edited"], true]];
const STOCK_GEOMETRY_FILTER = ["all", GADM_GEOMETRY_FILTER, ["!=", ["get", "edited"], true]];
// keep the seed fill under the close-up tiles instead of crossfading it away.
// if a vector tile is late (or gets evicted while panning), the coarse geometry is
// still there rather than briefly revealing the basemap. the tile layer becomes
// fully opaque once it takes over, so the fallback does not soften its borders.
// Keep the low-zoom political wash slightly translucent, then make the seed
// fully opaque before detailed tiles begin fading in. Once the handoff starts,
// a late/missing tile and a loaded tile therefore resolve to the same colour
// instead of randomly shifting whole regions between two shades.
const BASE_FILL_OPACITY = ["interpolate", ["linear"], ["zoom"], 5, 0.90, 5.5, 1];
// Physical geography should be part of the political map rather than hidden
// beneath it. Keep the far/continental wash translucent enough for relief and
// bathymetry to read, then progressively strengthen ownership color as the
// player zooms toward province/city detail.
const PAX_POLITICAL_FILL_OPACITY = [
  "interpolate", ["linear"], ["zoom"],
  1.5, 0.40,
  2.5, 0.43,
  3.75, 0.47,
  // R20: aggressively open the regional terrain window. This deliberately
  // halves the R19 political tint through the Poland/Europe zoom band so the
  // physical basemap can dominate while borders and labels keep polity identity.
  5.0, 0.205,
  6.5, 0.22,
  8.0, 0.25,
  // Rejoin the established deep-local ramp by z10 so very close play remains
  // strongly political and province/city interaction stays visually grounded.
  10.0, 0.565,
  12.0, 0.575,
  14.0, 0.585,
];
const TILE_FILL_FADE = ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 1];
// Dispute stripes are an overlay, so unlike the solid seed fallback they still
// hand off to the tile-native stripe layer instead of stacking at close zoom.
const FAR_OVERLAY_FADE = ["interpolate", ["linear"], ["zoom"], 5.5, 0.90, 6.5, 0];

// ---- Owner labels for custom maps -----------------------------------------
// The stock label pipeline labels modern countries from countries.pmtiles, which
// is wrong on scenario maps (it printed "Russia"/"Ukraine" over the Soviet Union
// and nothing said "Soviet Union"). For custom maps we build labels per OWNER:
// each owner's regions are clustered by proximity, and every sufficiently large
// cluster gets the owner's era name — so the USSR reads as one "Soviet Union",
// while a global empire is named once per landmass, atlas-style.

const largestRingOf = (geometry) => {
  if (!geometry) return null;
  const polys = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!ring || ring.length < 3) continue;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    area = Math.abs(area / 2);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best ? { ring: best, area: bestArea } : null;
};

const ringCentroidLngLat = (ring) => {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    a += f;
    x += (ring[i][0] + ring[j][0]) * f;
    y += (ring[i][1] + ring[j][1]) * f;
  }
  const s = a * 3 || 1;
  return [x / s, y / s];
};

// Clusters are primarily CONTIGUOUS territory (region adjacency, below); the
// centroid join only mops up islands near their mainland and hairline adjacency
// misses. Keeping it small is what gives a colony or exclave its own label —
// at the old 28° France's metropole merged with its African empire across the
// Mediterranean and only the empire got named.
const CLUSTER_JOIN_DEGREES = 10; // centroids closer than this merge into one label cluster
const MIN_CLUSTER_AREA = 1.5; // in lng/lat degrees^2 — skips tiny extra islands

// Which regions physically touch, from shared border vertices. The seed
// simplifies each region on its own, so mid-border vertices don't always match
// between neighbours — but junction corners (tripoints) survive any
// simplification, and most border runs still share long identical stretches.
// Hashing EVERY vertex on a ~11m grid (1e-4°) catches both; the centroid
// mop-up in the label builder heals whatever this still misses. Owner-agnostic
// (geometry only) so it can be memoized per world and reused across ownership
// changes.
const buildRegionAdjacency = (regionsFC) => {
  const features = regionsFC?.features ?? [];
  const firstSeen = new Map(); // packed vertex -> first feature index
  const neighbors = features.map(() => null);
  const link = (a, b) => {
    (neighbors[a] ??= new Set()).add(b);
    (neighbors[b] ??= new Set()).add(a);
  };
  for (let index = 0; index < features.length; index += 1) {
    const geometry = features[index]?.geometry;
    const polys = geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const poly of polys) {
      for (const ring of poly ?? []) {
        if (!ring) continue;
        for (let v = 0; v < ring.length; v += 1) {
          const pt = ring[v];
          // 1e-4° grid, packed into one number (fits 2^53).
          const key = Math.round((pt[0] + 180) * 1e4) * 4194304 + Math.round((pt[1] + 90) * 1e4);
          const seen = firstSeen.get(key);
          if (seen === undefined) firstSeen.set(key, index);
          else if (seen !== index) link(seen, index);
        }
      }
    }
  }
  return neighbors;
};

// Merge same-owner clusters until stable — the greedy pass alone under-merges
// long landmass chains (Siberia), which printed the same name a dozen times.
const mergeOwnerClusters = (clusters, joinDeg) => {
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) <= joinDeg) {
          const total = a.area + b.area;
          a.cx = (a.cx * a.area + b.cx * b.area) / total;
          a.cy = (a.cy * a.area + b.cy * b.area) / total;
          a.area = total;
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return clusters;
};

// GADM assigns disputed / undetermined boundary areas the codes Z01-Z09 (the
// slivers around India — Kashmir, Aksai Chin, Arunachal Pradesh). The base map
// carries each as its own polity named with the bare code, which surfaced on the
// map as "Z01" labels; show "Disputed (<claimant>)" instead, keyed to the main
// country that administers/claims each (per server/country-names.json).
const DISPUTED_TERRITORY_CLAIMANT = {
  Z01: "India", Z02: "China", Z03: "China", Z04: "India", Z05: "India",
  Z06: "Pakistan", Z07: "India", Z08: "China", Z09: "India",
};

const buildOwnerLabelCollection = (regionsFC, overrides, polityOverrides, nameResolver, adjacency = null) => {
  const allFeatures = regionsFC?.features ?? [];
  const countryNameByCode = new Map(); // gid0 -> modern country name (fallback labels)
  const ownerByIndex = new Array(allFeatures.length).fill("");
  const entryByIndex = new Array(allFeatures.length).fill(null);

  for (let index = 0; index < allFeatures.length; index += 1) {
    const props = allFeatures[index].properties || {};
    if (props.gid0 && props.country && !countryNameByCode.has(props.gid0)) {
      countryNameByCode.set(props.gid0, props.country);
    }
    const rawOwner = overrides?.[props.id] ?? props.owner;
    // Captured-region override stores the AI's owner CODE ("ESP"); the seed stores the NAME
    // ("Spain"). Canonicalize so both share one cluster + label instead of the code splitting
    // off as a phantom new country.
    const owner = toCountryName(rawOwner);
    if (!owner) continue;
    const best = largestRingOf(allFeatures[index].geometry);
    if (!best || best.area <= 0) continue;
    ownerByIndex[index] = owner;
    entryByIndex[index] = { c: ringCentroidLngLat(best.ring), area: best.area };
  }

  // Union-find over same-owner ADJACENT regions: each root is one contiguous
  // territory. Contiguity, not distance, is what separates a colony from its
  // metropole: France's mainland and French West Africa sit close enough that
  // distance clustering merged them into one label across the Mediterranean,
  // while a touching chain like Siberia must stay a single label.
  const parent = new Int32Array(allFeatures.length);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  if (adjacency) {
    for (let i = 0; i < allFeatures.length; i += 1) {
      if (!ownerByIndex[i] || !adjacency[i]) continue;
      for (const j of adjacency[i]) {
        if (j <= i || ownerByIndex[j] !== ownerByIndex[i]) continue;
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }

  // Fold each region into its territory's cluster (area-weighted centroid).
  const perOwner = new Map(); // owner -> Map(root -> cluster)
  for (let index = 0; index < allFeatures.length; index += 1) {
    const owner = ownerByIndex[index];
    const entry = entryByIndex[index];
    if (!owner || !entry) continue;
    let roots = perOwner.get(owner);
    if (!roots) {
      roots = new Map();
      perOwner.set(owner, roots);
    }
    const root = find(index);
    const cluster = roots.get(root);
    if (cluster) {
      const total = cluster.area + entry.area;
      cluster.cx = (cluster.cx * cluster.area + entry.c[0] * entry.area) / total;
      cluster.cy = (cluster.cy * cluster.area + entry.c[1] * entry.area) / total;
      cluster.area = total;
    } else {
      roots.set(root, { cx: entry.c[0], cy: entry.c[1], area: entry.area });
    }
  }

  const features = [];
  let id = 0;
  for (const [owner, roots] of perOwner) {
    // Islands still join their nearby mainland (and any adjacency near-miss
    // heals) via the small centroid merge.
    const clusters = mergeOwnerClusters([...roots.values()], CLUSTER_JOIN_DEGREES);
    clusters.sort((a, b) => b.area - a.area);
    const rawName = DISPUTED_TERRITORY_CLAIMANT[owner]
      ? `Disputed (${DISPUTED_TERRITORY_CLAIMANT[owner]})`
      : polityOverrides?.[owner]?.name || countryNameByCode.get(owner) || owner;
    const name = String(nameResolver ? nameResolver(rawName, owner) : rawName).toUpperCase();
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      // Every owner keeps its largest cluster (tiny states still get a label);
      // additional clusters must clear the size bar.
      if (index > 0 && cluster.area < MIN_CLUSTER_AREA) continue;
      features.push({
        type: "Feature",
        id: `owner-label-${id++}`,
        geometry: { type: "Point", coordinates: [cluster.cx, cluster.cy] },
        properties: {
          name,
          areaScale: Math.sqrt(cluster.area) * 17500,
          rotation: 0,
          // See GLOBE_LAT_CORRECTION — same globe text-size fix (issue #6).
          lat: cluster.cy,
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
};


const PERF_MAP_WARN_MS = 40;
const measureMapWork = (label, fn) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const value = fn();
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
  reportPerfOperation(`map ${label}`, elapsed, { warnAt: PERF_MAP_WARN_MS });
  recordMapWork(`Nations:${label}`, elapsed);
  return value;
};

const WorldMap = ({ isGlobe = false, vNext = false }) => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const {
    worldState,
    worldKnown,
    customRegions: customFlag,
    regionOwnershipOverrides,
    regionClaimants,
    polityOverrides,
    labelFont,
    labelHaloColor,
    labelTextColor,
  } = useWorldState();
  const mapDisplaySettings = {
    hideCountryLabels: useMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
  };
  const [pointLabelData, setPointLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const [curvedLabelData, setCurvedLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  // Legacy custom-map geometry only. Map vNext never parses the giant authored
  // regions file on the UI thread; the dedicated worker owns that parse and
  // MapLibre consumes the URL directly in its own worker pool.
  const [customRegionData, setCustomRegionData] = useState(EMPTY_FEATURE_COLLECTION);
  const [customRegionMeta, setCustomRegionMeta] = useState(EMPTY_CUSTOM_REGION_META);
  const [disputedRegionData, setDisputedRegionData] = useState(EMPTY_FEATURE_COLLECTION);
  const [polityBoundaryData, setPolityBoundaryData] = useState(EMPTY_FEATURE_COLLECTION);
  const [politySurfaceData, setPolitySurfaceData] = useState(EMPTY_FEATURE_COLLECTION);
  const [labelZoom, setLabelZoom] = useState(3.5);
  // R5.4.6: owners whose curved polity label MapLibre has actually confirmed
  // as rendered after the map settles. A curve-capable point fallback is never
  // hidden from theoretical zoom eligibility alone.
  const [renderConfirmedCurveOwners, setRenderConfirmedCurveOwners] = useState([]);
  const polityBoundaryWorkerRef = useRef(null);
  const initialFramingAppliedRef = useRef(false);
  const latestBoundaryRequestRef = useRef(0);
  const initializedBoundaryOwnershipRef = useRef(null);
  const initializedBoundaryClaimantsRef = useRef(null);
  const regionOwnershipOverridesRef = useRef(regionOwnershipOverrides);
  regionOwnershipOverridesRef.current = regionOwnershipOverrides;
  const countriesUrl = PMTILES_PROTOCOL_URLS.countries;
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;
  const regionsGeojsonUrl = JSON_URLS.regionsGeojson;
  const legacyCustomActive = customFlag && Array.isArray(customRegionData?.features) && customRegionData.features.length > 0;
  const customActive = customFlag && (vNext ? customRegionMeta.ready : legacyCustomActive);
  const hasDrawnGeometry = customActive && (
    vNext
      ? customRegionMeta.hasDrawnGeometry
      : customRegionData.features.some((feature) => !/\./.test(String(feature?.properties?.id ?? "")))
  );
  const fullyAuthoredGeometry = Boolean(vNext && customActive && customRegionMeta.fullyAuthoredGeometry);
  const shouldMountStockRegions = !customFlag || !vNext
    || (customRegionMeta.ready && !customRegionMeta.fullyAuthoredGeometry);
  const ownedCountryCodes = useMemo(() => {
    if (vNext) return new Set(customRegionMeta.ownedCountryCodes ?? []);
    const set = new Set();
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (props.owner && props.gid0) set.add(props.gid0);
    }
    return set;
  }, [customRegionData, customRegionMeta.ownedCountryCodes, vNext]);
  const ownedCodesKey = useMemo(() => [...ownedCountryCodes].sort().join(","), [ownedCountryCodes]);

  // Bumped when the translator learns new strings, so labels rebuild with
  // translated names (they're baked into map features, not DOM text).
  const [labelEpoch, setLabelEpoch] = useState(0);
  useEffect(() => {
    const onUpdated = () => setLabelEpoch((epoch) => epoch + 1);
    window.addEventListener("i18n:updated", onUpdated);
    return () => window.removeEventListener("i18n:updated", onUpdated);
  }, []);

  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!vNext || !mapInstance?.getZoom) return undefined;

    const updateZoom = () => {
      const next = Number(mapInstance.getZoom?.() ?? 3.5);
      setLabelZoom((current) => {
        if (Math.abs(current - next) < 0.01) return current;
        recordMapTrace("nations:label-zoom", { from: current, to: next });
        return next;
      });
    };

    updateZoom();
    // Panning must not wake React/Nations at all. Only a completed zoom can
    // change polity label eligibility.
    mapInstance.on("zoomend", updateZoom);
    return () => mapInstance.off("zoomend", updateZoom);
  }, [map, vNext]);

  // Disputed-region stripe tiles, generated the moment the style asks for one.
  // Reactive (rather than pre-registered) so any stripe combination works and
  // the globe/mercator remount — which rebuilds the style without its images —
  // heals itself on the next frame.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.on) return undefined;
    const onMissing = (event) => {
      const colors = parseStripeImageId(event?.id);
      if (!colors) return;
      if (mapInstance.hasImage?.(event.id)) return;
      try {
        mapInstance.addImage(event.id, buildStripeImage(colors), { pixelRatio: 1 });
      } catch (error) {
        console.warn("Failed to build stripe tile:", error);
      }
    };
    mapInstance.on("styleimagemissing", onMissing);
    return () => mapInstance.off("styleimagemissing", onMissing);
  }, [map]);

  // Owner (polity) labels for custom maps — one label per landmass-cluster per
  // owner, named by the scenario's polity registry ("Soviet Union", not "Russia").
  // Recomputed as ownership overrides poll in, so labels follow conquests.
  // Geometry-only, so it survives ownership polls — rebuilt only when the
  // world's region geometry itself changes.
  // Legacy-only fallback. Map vNext gets dissolved polity surfaces from the
  // worker, so synchronously building a 4.8k-region adjacency graph and owner
  // label clusters on the UI thread is pure duplicate work.
  const regionAdjacency = useMemo(
    () => (!vNext && legacyCustomActive
      ? measureMapWork("region adjacency", () => buildRegionAdjacency(customRegionData))
      : null),
    [legacyCustomActive, customRegionData, vNext],
  );

  const ownerLabelData = useMemo(() => {
    if (vNext || !legacyCustomActive) return EMPTY_FEATURE_COLLECTION;
    return measureMapWork("owner labels", () => buildOwnerLabelCollection(
      customRegionData,
      regionOwnershipOverrides,
      polityOverrides,
      (raw, owner) => translateLabel(resolveCountryDisplayName(raw, owner)),
      regionAdjacency,
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vNext, legacyCustomActive, customRegionData, regionOwnershipOverrides, polityOverrides, regionAdjacency, labelEpoch]);

  const contextualPolityLabels = useMemo(
    () => resolveContextualPolityLabels(politySurfaceData, polityOverrides),
    [polityOverrides, politySurfaceData],
  );

  const polityLabelCollections = useMemo(() => {
    if (!vNext || !politySurfaceData?.features?.length) {
      return {
        labelData: EMPTY_FEATURE_COLLECTION,
        pointLabelData: EMPTY_FEATURE_COLLECTION,
        curvedLabelData: EMPTY_FEATURE_COLLECTION,
        lineLabelData: EMPTY_FEATURE_COLLECTION,
        glyphLabelData: EMPTY_FEATURE_COLLECTION,
      };
    }
    return measureMapWork("live polity labels", () => buildPolityLabelCollections(
      politySurfaceData,
      {
        nameResolver: (owner) => {
          const rawName = DISPUTED_TERRITORY_CLAIMANT[owner]
            ? `Disputed (${DISPUTED_TERRITORY_CLAIMANT[owner]})`
            : contextualPolityLabels.get(owner) || polityOverrides?.[owner]?.name || owner;
          return translateLabel(resolveCountryDisplayName(rawName, owner));
        },
      },
    ));
    // labelEpoch: rebuild once new translations land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextualPolityLabels, labelEpoch, polityOverrides, politySurfaceData, vNext]);

  const useLivePolityLabels = vNext && polityLabelCollections.labelData.features.length > 0;

  // R5.4.6: renderer-confirmed polity label handoff.
  //
  // The previous rule hid/demoted point fallbacks once a curve crossed its
  // theoretical zoom threshold. That can still leave a blank label when
  // MapLibre declines to place the line. Keep point fallbacks guaranteed while
  // the camera moves, then inspect ONLY the two live polity curve layers after
  // MapLibre reaches idle. No source mutation, no setData(), and no movement-
  // time renderer scan.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!vNext || !customFlag || !useLivePolityLabels || !mapInstance?.on) {
      setRenderConfirmedCurveOwners((current) => (current.length ? [] : current));
      return undefined;
    }

    const clearRenderConfirmation = () => {
      // During camera movement prefer a brief point+curve duplicate over a
      // missing polity name. This is one bounded filter-state change at movement
      // start; it does not rebuild either GeoJSON source.
      setRenderConfirmedCurveOwners((current) => (current.length ? [] : current));
    };

    const confirmRenderedCurves = () => {
      if (mapInstance.isMoving?.() || mapInstance.isZooming?.()) return;
      if (!mapInstance.queryRenderedFeatures) return;

      const curveLayers = [
        "country-line-labels-live-world",
        "country-line-labels-live-detail",
      ].filter((layerId) => mapInstance.getLayer?.(layerId));

      if (!curveLayers.length) {
        clearRenderConfirmation();
        return;
      }

      let rendered = [];
      try {
        rendered = mapInstance.queryRenderedFeatures({ layers: curveLayers }) ?? [];
      } catch {
        // A style remount can invalidate a layer between getLayer() and query.
        // Fail safe to the guaranteed point labels and wait for the next idle.
        clearRenderConfirmation();
        return;
      }

      const nextOwners = [...new Set(
        rendered
          .map((feature) => String(feature?.properties?.owner ?? "").trim())
          .filter(Boolean),
      )].sort();

      setRenderConfirmedCurveOwners((current) => {
        if (
          current.length === nextOwners.length
          && current.every((owner, index) => owner === nextOwners[index])
        ) return current;
        return nextOwners;
      });
    };

    mapInstance.on("movestart", clearRenderConfirmation);
    mapInstance.on("idle", confirmRenderedCurves);
    return () => {
      mapInstance.off("movestart", clearRenderConfirmation);
      mapInstance.off("idle", confirmRenderedCurves);
    };
  }, [customFlag, map, useLivePolityLabels, vNext]);

  // Development-time proof instead of screenshot guesswork. One authoritative
  // record per polity is exposed for inspection and the known regression set is
  // printed whenever live label geometry changes.
  useEffect(() => {
    if (!import.meta.env.DEV || !useLivePolityLabels || globalThis.__OH_MAP_LABEL_DEBUG__ !== true) return;
    const diagnostics = summarizePolityLabelDiagnostics(polityLabelCollections);
    globalThis.__OH_POLITY_LABEL_DIAGNOSTICS__ = diagnostics;
    const watch = new Set([
      "russia", "canada", "china", "united states", "united states of america",
      "brazil", "kazakhstan", "ukraine", "poland", "germany", "france",
      "democratic republic of the congo", "latvia",
    ]);
    const rows = diagnostics.filter((entry) => {
      const owner = String(entry.owner ?? "").toLocaleLowerCase();
      const name = String(entry.name ?? "").toLocaleLowerCase();
      return watch.has(owner) || watch.has(name);
    });
    const duplicates = diagnostics.filter((entry) => entry.labelCount !== 1);
    if (duplicates.length) {
      console.error("[OH map labels] invariant violation: duplicate/missing polity labels", duplicates);
    }
    if (rows.length) console.table(rows);
  }, [polityLabelCollections, useLivePolityLabels]);

  // Start a campaign with its player polity inside the composition instead of
  // blindly centring longitude zero (which wastes half a wide screen on the
  // Atlantic in European scenarios). This runs only while the camera is still
  // at the untouched legacy default; an early user pan always wins.
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (
      !vNext
      || isGlobe
      || initialFramingAppliedRef.current
      || !polityLabelCollections.labelData.features.length
      || !mapInstance?.jumpTo
    ) return undefined;

    let cancelled = false;
    const center = mapInstance.getCenter?.();
    const zoom = mapInstance.getZoom?.() ?? 3.5;
    if (!center || Math.abs(center.lng) > 0.25 || Math.abs(center.lat) > 0.25 || Math.abs(zoom - 3.5) > 0.12) {
      initialFramingAppliedRef.current = true;
      return undefined;
    }

    readJson(JSON_URLS.game, { defaultValue: {} }).then((game) => {
      if (cancelled || initialFramingAppliedRef.current) return;
      const player = String(game?.country ?? "").trim().toLocaleLowerCase();
      if (!player) {
        initialFramingAppliedRef.current = true;
        return;
      }

      const owner = politySurfaceData.features
        .map((feature) => String(feature?.properties?.owner ?? "").trim())
        .find((candidate) => {
          const override = polityOverrides?.[candidate] ?? {};
          return [candidate, override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]
            .some((value) => String(value ?? "").trim().toLocaleLowerCase() === player);
        });
      const focus = polityLabelCollections.labelData.features
        .find((feature) => feature?.properties?.owner === owner);
      const focusCoordinates = focus?.geometry?.type === "Point"
        ? focus.geometry.coordinates
        : [focus?.properties?.anchorLng, focus?.properties?.anchorLat];
      const [lng, lat] = focusCoordinates ?? [];
      initialFramingAppliedRef.current = true;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      const width = mapInstance.getCanvas?.()?.clientWidth || 1440;
      const responsiveZoom = Math.max(3.5, Math.min(3.92, 3.55 + Math.log2(Math.max(900, width) / 1440) * 0.22));
      mapInstance.jumpTo({
        center: [lng, Math.max(-70, Math.min(70, lat - 5))],
        zoom: responsiveZoom,
        bearing: 0,
        pitch: 0,
      });
    }).catch(() => {
      initialFramingAppliedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [isGlobe, map, polityLabelCollections, polityOverrides, politySurfaceData, vNext]);

  // On custom maps the stock modern-country labels are replaced wholesale by the
  // owner labels (no more "Russia"/"Ukraine" floating over the Soviet Union).
  // Keyed on the FLAG (not customActive): while a custom world's geometry is
  // still loading, and before the world is known at all, stock labels must
  // not flash in.
  const rawLivePolityPointLabelData = worldKnown && customFlag && useLivePolityLabels
    ? polityLabelCollections.pointLabelData
    : EMPTY_FEATURE_COLLECTION;
  const rawLivePolityLineLabelData = worldKnown && customFlag && useLivePolityLabels
    ? polityLabelCollections.lineLabelData
    : EMPTY_FEATURE_COLLECTION;
  const currentLabelZoom = Number(labelZoom ?? 3.5);

  // R5.4.6: render-confirmed handoff. Curve-capable polities never enter the
  // collision-managed fallback layer. Their point label remains in the
  // guaranteed overlap layer until an idle-time renderer check confirms that
  // MapLibre actually drew the curve for that owner.
  const renderedCurveOwnersLiteral = useMemo(
    () => ["literal", renderConfirmedCurveOwners],
    [renderConfirmedCurveOwners],
  );

  const livePointManagedFilter = useMemo(() => [
    "all",
    ["<=", ["coalesce", ["get", "minZoom"], 0], currentLabelZoom],
    ["==", ["coalesce", ["get", "curveBand"], "none"], "none"],
    ["!=", ["coalesce", ["get", "allowOverlap"], false], true],
    [">", ["coalesce", ["get", "forceOverlapZoom"], 99], currentLabelZoom],
  ], [currentLabelZoom]);

  const livePointOverlapFilter = useMemo(() => [
    "all",
    ["<=", ["coalesce", ["get", "minZoom"], 0], currentLabelZoom],
    [
      "any",
      // Every curve-capable polity is guaranteed until its curve is visibly
      // present in one of the two live curve layers after MapLibre reaches idle.
      [
        "all",
        ["!=", ["coalesce", ["get", "curveBand"], "none"], "none"],
        ["!", ["in", ["get", "owner"], renderedCurveOwnersLiteral]],
      ],
      // Point-only polities preserve their existing overlap policy.
      [
        "all",
        ["==", ["coalesce", ["get", "curveBand"], "none"], "none"],
        [
          "any",
          ["==", ["coalesce", ["get", "allowOverlap"], false], true],
          ["<=", ["coalesce", ["get", "forceOverlapZoom"], 99], currentLabelZoom],
        ],
      ],
    ],
  ], [currentLabelZoom, renderedCurveOwnersLiteral]);

  const liveWorldLineFilter = useMemo(() => [
    "all",
    ["==", ["get", "safeWarp"], true],
    ["==", ["coalesce", ["get", "curveBand"], "detail"], "world"],
    ["<=", ["coalesce", ["get", "curveMinZoom"], 99], currentLabelZoom],
  ], [currentLabelZoom]);

  const liveDetailLineFilter = useMemo(() => [
    "all",
    ["==", ["get", "safeWarp"], true],
    ["!=", ["coalesce", ["get", "curveBand"], "detail"], "world"],
    // Do not ask MapLibre to place the non-world curve at the exact theoretical
    // threshold. Give it a small camera-space buffer, while the point label
    // remains guaranteed through the same interval.
    [
      "<=",
      ["+", ["coalesce", ["get", "curveMinZoom"], 99], 0.45],
      currentLabelZoom,
    ],
  ], [currentLabelZoom]);

  const activePointLabelData = !worldKnown
    ? EMPTY_FEATURE_COLLECTION
    : customFlag
      ? useLivePolityLabels
        ? EMPTY_FEATURE_COLLECTION
        : ownerLabelData
      : pointLabelData;

  // Stock curved-label data remains separate. R5.4.6 renderer confirmation
  // applies only to the two live custom-polity curve layers above.
  const activeCurvedLabelData = worldKnown && !customFlag
    ? curvedLabelData
    : EMPTY_FEATURE_COLLECTION;
  const handleRegionClick = useCallback(async (event) => {
    const unitsAt = () =>
      map.getLayer("units-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["units-fill"] })
        : [];

    // Resolve the province under this click using the existing region layer
    // stack. Fully authored worlds must never fall through to leftover GADM Earth.
    const resolveRegionHit = () => {
      const candidateLayers = (hasDrawnGeometry
        ? [
          "custom-regions-fill",
          "custom-regions-disputed-vnext",
          "custom-regions-disputed",
          "custom-regions-fill-far",
          "custom-regions-disputed-far",
        ]
        : [
          "custom-regions-fill",
          "custom-regions-disputed-vnext",
          "custom-regions-disputed",
          "regions-fill",
          "regions-disputed",
          "custom-regions-fill-far",
          "custom-regions-disputed-far",
        ]
      ).filter((id) => map.getLayer(id));
      if (!candidateLayers.length) return null;
      const hits = map.queryRenderedFeatures(event.point, { layers: candidateLayers });
      if (!hits.length) return null;
      const props = hits[0].properties ?? {};
      const regionId = String(props.GID_1 ?? props.id ?? "");
      if (!regionId) return null;
      const lookupOwner = ownerLookupRef.current.size
        ? ownerLookupRef.current.get(regionId)
        : undefined;
      const owner = lookupOwner !== undefined ? lookupOwner : props.owner;
      const gid0 = String(props.gid0 ?? props.GID_0 ?? "");
      return {
        props,
        regionId,
        gid0,
        owner: owner ?? "",
        regionName: resolveRegionName(regionId, props.NAME_1 ?? props.name ?? ""),
        country: props.COUNTRY ?? toCountryName(gid0),
        lngLat: event.lngLat,
      };
    };

    // A city or built structure under the cursor. Query only the point glyphs,
    // not city text: a giant label bounding box should not steal a province click.
    const featureAt = () => {
      const featureLayers = [
        ...V_NEXT_MARKER_SHAPE_LAYER_IDS,
        "markers-shapes",
        "cities-shapes",
      ].filter((id) => map.getLayer(id));
      const featureHits = featureLayers.length
        ? map.queryRenderedFeatures(event.point, { layers: featureLayers })
        : [];
      if (!featureHits.length) return null;
      const hit = featureHits.find((entry) => entry.layer.id.startsWith("markers-shapes")) ?? featureHits[0];
      const props = hit.properties ?? {};
      const [lng, lat] = hit.geometry?.coordinates ?? [event.lngLat.lng, event.lngLat.lat];
      const host = resolveRegionHit();
      const hostCountry = host?.owner || (host?.owner === "" ? "" : toCountryName(host?.gid0 ?? ""));
      return hit.layer.id.startsWith("markers-shapes")
        ? {
          source: "marker",
          id: props.id,
          name: props.name,
          kind: props.kind,
          ownerCode: props.ownerCode || hostCountry,
          note: props.note || "",
          hostRegionId: host?.regionId || "",
          hostRegionName: host?.regionName || "",
          lng,
          lat,
        }
        : {
          source: "city",
          name: props.city || props.name || "",
          population: props.population,
          capital: props.capital,
          tier: props.tier,
          ownerCode: hostCountry,
          hostRegionId: host?.regionId || "",
          hostRegionName: host?.regionName || "",
          lng,
          lat,
        };
    };

    const mode = getInteractionMode();

    if (mode.kind === "admin-place") {
      placeUnitAdmin(mode.unitId, event.lngLat.lng, event.lngLat.lat);
      clearInteractionMode();
      return;
    }

    if (mode.kind === "deploy") {
      deployUnit({ ...mode.params, lng: event.lngLat.lng, lat: event.lngLat.lat });
      clearInteractionMode();
      return;
    }
    if (mode.kind === "move") {
      const hit = resolveRegionHit();
      moveUnitTo(mode.unitId, event.lngLat.lng, event.lngLat.lat, hit);
      clearInteractionMode();
      return;
    }
    if (mode.kind === "attack") {
      const target = unitsAt();
      if (target.length) {
        attackWith(mode.unitId, target[0].properties.id);
        clearInteractionMode();
        return;
      }
      const feature = featureAt();
      if (feature) {
        const result = await attackFeature(mode.unitId, feature);
        if (!result?.ownTarget) clearInteractionMode();
        return;
      }
      const hit = resolveRegionHit();
      if (hit) {
        const result = await attackRegion(mode.unitId, {
          regionId: hit.regionId,
          regionName: hit.regionName,
          owner: hit.owner,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        });
        if (!result?.ownTarget) clearInteractionMode();
      }
      return;
    }

    const unitHits = unitsAt();
    if (unitHits.length) {
      dismissRegionPopup();
      dismissFeaturePopup();
      onUnitSelected({ id: unitHits[0].properties.id, lngLat: event.lngLat });
      return;
    }

    dismissUnitPopup();

    const featureHit = featureAt();
    if (featureHit) {
      dismissRegionPopup();
      onFeatureSelected(featureHit);
      return;
    }

    dismissFeaturePopup();
    const hit = resolveRegionHit();
    if (!hit) {
      onOceanClicked();
      return;
    }

    const { props, regionId, gid0, owner } = hit;
    const rawClaimants = regionClaimants?.[regionId] ?? (Array.isArray(props.claimants) ? props.claimants : []);
    const claimants = Array.isArray(rawClaimants) ? rawClaimants : [];
    onRegionSelected({
      GID_0: owner || (owner === "" ? "" : toCountryName(gid0)),
      COUNTRY: hit.country,
      NAME_1: hit.regionName,
      GID_1: regionId,
      gid0,
      owner,
      claimants,
      isDisputed: Boolean(props._stripes || claimants.length > 0),
      lngLat: event.lngLat,
    });
  }, [hasDrawnGeometry, map, regionClaimants]);

  useEffect(() => {
    if (!map) return;
    map.on("click", handleRegionClick);
    return () => map.off("click", handleRegionClick);
  }, [handleRegionClick, map]);

  // The palette is re-read whenever colors.json is written (every AI turn can mint
  // or recolour a polity, and the main menu's faction creator writes the player's
  // own colour over an already-mounted map). Fetching once on mount left any
  // owner coloured after mount painting a procedural fallback for the rest of the
  // session — healed only by a reload. `oh:colors-updated` is dispatched by the
  // asset layer's write path; the epoch re-runs this effect.
  const [colorsEpoch, setColorsEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setColorsEpoch((n) => n + 1);
    window.addEventListener("oh:colors-updated", bump);
    return () => window.removeEventListener("oh:colors-updated", bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNationColors()
      .then((next) => {
        if (cancelled) return;
        // Only swap the object when the contents actually differ — a new identity
        // rebuilds every MapLibre match expression below.
        setColorMap((prev) => (shallowEqualColors(prev, next) ? prev : next));
      })
      .catch((error) => console.error("Error loading colors:", error));
    return () => {
      cancelled = true;
    };
  }, [colorsEpoch]);

  // ONE owner -> rgb resolver for every paint path. colors.json and the live
  // polity registry (world.polityOverrides) are two different namespaces: a
  // polity can be correctly NAMED by the registry while colors.json has no key
  // for it — shipped example: "British Empire" owns 426 regions in
  // world-war-ii-1939-copy with its colour (#c0507a) only in polityOverrides.
  // Resolving the name but not the colour painted those regions a muddy
  // procedural fallback, which reads to a player as "the map didn't annex it".
  const resolveOwnerRgb = useCallback(
    (rawOwner) => {
      if (!rawOwner) return null;
      // Canonicalize an owner CODE ("ESP" from a transfer override) to the NAME the palette
      // is keyed by ("Spain") so a captured region takes its true owner's colour.
      const owner = toCountryName(rawOwner);
      const exact = colorMap[owner];
      if (exact) return exact;
      const registry = parseColorToRgb(polityOverrides?.[owner]?.color);
      if (registry) return registry;
      const fold = ownerFoldKey(owner);
      if (fold) {
        for (const [key, rgb] of Object.entries(colorMap)) {
          if (ownerFoldKey(key) === fold) return rgb;
        }
        for (const [key, entry] of Object.entries(polityOverrides ?? {})) {
          const names = [key, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
          if (!names.some((name) => ownerFoldKey(name) === fold)) continue;
          const rgb = parseColorToRgb(entry?.color);
          if (rgb) return rgb;
          const palette = colorMap[key];
          if (palette) return palette;
        }
      }
      return fallbackRgbFromOwner(owner);
    },
    [colorMap, polityOverrides],
  );

  const ownerColorCss = useCallback(
    (owner) => {
      const rgb = normalizePoliticalRgb(resolveOwnerRgb(owner));
      return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : NEUTRAL_LAND_COLOR;
    },
    [resolveOwnerRgb],
  );

  const enrichedPolitySurfaceData = useMemo(() => ({
    ...politySurfaceData,
    features: (politySurfaceData?.features ?? []).map((feature) => {
      const owner = feature.properties?.owner ?? "";
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          _fillColor: ownerColorCss(owner),
        },
      };
    }),
  }), [ownerColorCss, politySurfaceData]);
  const hasPolitySurfaces = vNext && enrichedPolitySurfaceData.features.length > 0;


  // Legacy map only: preserve the old main-thread GeoJSON path for the non-vNext
  // renderer. R5.0's live map never JSON.parse()s the authored region archive on
  // the UI thread.
  useEffect(() => {
    let cancelled = false;

    if (!customFlag || vNext) {
      setCustomRegionData(EMPTY_FEATURE_COLLECTION);
      return undefined;
    }

    readJson(regionsGeojsonUrl, {
      defaultValue: EMPTY_FEATURE_COLLECTION,
      force: true,
      clone: false,
    })
      .then((data) => {
        if (cancelled) return;
        const resolved = data && Array.isArray(data.features) ? data : EMPTY_FEATURE_COLLECTION;
        primeCustomRegionCatalog(resolved, { url: regionsGeojsonUrl });
        setCustomRegionData(resolved);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading legacy custom regions:", error);
        setCustomRegionData(EMPTY_FEATURE_COLLECTION);
      });

    return () => {
      cancelled = true;
    };
  }, [customFlag, regionsGeojsonUrl, vNext]);

  // R5.0: the worker owns the giant authored-region fetch + JSON parse. The main
  // thread receives only compact metadata plus dissolved polity surfaces/frontiers.
  // MapLibre separately consumes the same URL in its worker pool, eliminating the
  // old giant main-thread object and two structured clones of it.
  useEffect(() => {
    const previous = polityBoundaryWorkerRef.current;
    if (previous) previous.terminate();
    polityBoundaryWorkerRef.current = null;
    initializedBoundaryOwnershipRef.current = null;
    initializedBoundaryClaimantsRef.current = null;

    if (!vNext || !customFlag) {
      setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
      setDisputedRegionData(EMPTY_FEATURE_COLLECTION);
      setPolityBoundaryData(EMPTY_FEATURE_COLLECTION);
      setPolitySurfaceData(EMPTY_FEATURE_COLLECTION);
      return undefined;
    }

    let worker;
    try {
      worker = new Worker(
        new URL("./vnext/polityBoundariesWorker.js", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      console.warn("Map vNext polity-boundary worker is unavailable:", error);
      setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
      return undefined;
    }

    polityBoundaryWorkerRef.current = worker;
    const ownershipOverrides = regionOwnershipOverridesRef.current;
    const claimants = regionClaimants;
    initializedBoundaryOwnershipRef.current = ownershipOverrides;
    initializedBoundaryClaimantsRef.current = claimants;
    const requestId = latestBoundaryRequestRef.current + 1;
    latestBoundaryRequestRef.current = requestId;

    // A worker the browser kills for memory sends neither a message nor an
    // error; the map would just stay on its per-region fallback fills with
    // no borders and no polity labels. Two minutes of silence is reported so
    // a bug report says what happened (the derivation itself takes well under
    // a minute on the largest maps).
    const WORKER_SILENCE_WARN_MS = 120000;
    const silence = setTimeout(() => {
      if (worker !== polityBoundaryWorkerRef.current) return;
      console.warn("Map vNext polity-boundary worker has not answered in 120s; the map is on its fallback fills.");
    }, WORKER_SILENCE_WARN_MS);
    worker.onmessage = ({ data: result }) => {
      clearTimeout(silence);
      if (worker !== polityBoundaryWorkerRef.current) return;
      if (result?.requestId !== latestBoundaryRequestRef.current) return;
      if (result.error) {
        console.warn("Map vNext polity-boundary derivation failed:", result.error);
        setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
        setDisputedRegionData(EMPTY_FEATURE_COLLECTION);
        setPolityBoundaryData(EMPTY_FEATURE_COLLECTION);
        setPolitySurfaceData(EMPTY_FEATURE_COLLECTION);
        return;
      }

      if (result.metadata) {
        const metadata = {
          ...EMPTY_CUSTOM_REGION_META,
          ...result.metadata,
          ready: true,
        };
        setCustomRegionMeta(metadata);
        primeCustomRegionCatalogEntries(metadata.records, { url: regionsGeojsonUrl });
      }
      setDisputedRegionData(result.disputedData?.features ? result.disputedData : EMPTY_FEATURE_COLLECTION);
      setPolityBoundaryData(result.data?.features ? result.data : EMPTY_FEATURE_COLLECTION);
      setPolitySurfaceData(result.polityData?.features ? result.polityData : EMPTY_FEATURE_COLLECTION);

      if (Number.isFinite(result.stats?.parseMs)) {
        globalThis.__OH_MAP_SOURCE_PERF__ = {
          ...(globalThis.__OH_MAP_SOURCE_PERF__ ?? {}),
          authoredRegionsWorkerFetchMs: Number(result.stats.fetchMs ?? 0),
          authoredRegionsWorkerParseMs: Number(result.stats.parseMs ?? 0),
          authoredRegionsBytes: Number(result.stats.bytes ?? 0),
          polityDeriveMs: Number(result.stats.elapsedMs ?? 0),
        };
      }
      if (Number.isFinite(result.stats?.elapsedMs)) {
        reportPerfOperation("map polity boundary derivation", result.stats.elapsedMs, {
          warnAt: PERF_MAP_WARN_MS,
        });
      }
    };
    worker.onerror = (error) => {
      clearTimeout(silence);
      if (worker !== polityBoundaryWorkerRef.current) return;
      console.warn("Map vNext polity-boundary worker failed:", error);
      setCustomRegionMeta(EMPTY_CUSTOM_REGION_META);
      setDisputedRegionData(EMPTY_FEATURE_COLLECTION);
      setPolityBoundaryData(EMPTY_FEATURE_COLLECTION);
      setPolitySurfaceData(EMPTY_FEATURE_COLLECTION);
    };
    worker.postMessage({
      type: "initialize",
      requestId,
      regionsUrl: regionsGeojsonUrl,
      ownershipOverrides,
      regionClaimants: claimants,
    });

    return () => {
      clearTimeout(silence);
      worker.terminate();
      if (polityBoundaryWorkerRef.current === worker) polityBoundaryWorkerRef.current = null;
    };
  }, [customFlag, regionsGeojsonUrl, vNext]);

  useEffect(() => {
    const worker = polityBoundaryWorkerRef.current;
    if (!vNext || !customFlag || !worker || !customRegionMeta.ready) return;
    if (
      initializedBoundaryOwnershipRef.current === regionOwnershipOverrides
      && initializedBoundaryClaimantsRef.current === regionClaimants
    ) return;
    initializedBoundaryOwnershipRef.current = regionOwnershipOverrides;
    initializedBoundaryClaimantsRef.current = regionClaimants;
    const requestId = latestBoundaryRequestRef.current + 1;
    latestBoundaryRequestRef.current = requestId;
    worker.postMessage({
      type: "update-ownership",
      requestId,
      ownershipOverrides: regionOwnershipOverrides,
      regionClaimants,
    });
  }, [customFlag, customRegionMeta.ready, regionClaimants, regionOwnershipOverrides, vNext]);

  useEffect(() => {
    let cancelled = false;

    // labelEpoch > 0 means translations arrived after the first build: force
    // a rebuild so baked-in label names pick them up.
    loadCountryLabelCollections({
      force: labelEpoch > 0,
      ownedCodes: ownedCountryCodes.size ? ownedCountryCodes : null,
    })
      .then(({ pointLabelData: pointLabels, curvedLabelData: curvedLabels }) => {
        if (cancelled) return;
        setPointLabelData(pointLabels);
        setCurvedLabelData(curvedLabels);
      })
      .catch((error) => console.error("Failed to load country labels:", error));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedCodesKey, labelEpoch]);

  // DEAD as it stands, and deliberately left alone rather than half-fixed. It is
  // the only expression in the game that matches a country CODE — ["get", "GID_0"]
  // off the stock tiles — and it cannot fire: readRuntimeJsonAsset forces
  // customRegions:true onto every world it serves (normalizeRuntimeWorld), so
  // showStockCountries is always false and countries-source never mounts.
  //
  // Its stops would need a code->name bridge to work, which is exactly the thing
  // this rename exists to remove. It belongs in the dead-code sweep with
  // countries-source, not in a patch that keeps codes alive to colour nothing.
  // The layer that DOES paint the political map (stockRegionsFillPaint) matches
  // GID_1 — a region id, not a country — and needs no bridge at all.
  const fillStyle = useMemo(() => {
    const stops = Object.entries(colorMap).flatMap(([owner, rgb]) => {
      const displayRgb = normalizePoliticalRgb(rgb);
      return [owner, `rgb(${displayRgb[0]}, ${displayRgb[1]}, ${displayRgb[2]})`];
    });
    const fallback = buildFallbackColorExpression();
    const regionOverrideStops = Object.entries(regionOwnershipOverrides).flatMap(([regionId, ownerCode]) => [
      regionId,
      ownerColorCss(ownerCode),
    ]);

    return {
      "fill-color": regionOverrideStops.length > 0
        ? [
          "match",
          ["get", "GID_1"],
          ...regionOverrideStops,
          stops.length > 0 ? ["match", ["get", "GID_0"], ...stops, fallback] : fallback,
        ]
        : stops.length > 0
        ? ["match", ["get", "GID_0"], ...stops, fallback]
        : fallback,
      "fill-opacity": vNext ? PAX_POLITICAL_FILL_OPACITY : 0.90,
    };
  }, [colorMap, regionOwnershipOverrides, ownerColorCss, vNext]);

  // Legacy renderer still enriches its in-memory GeoJSON. Map vNext renders the
  // authored URL directly and applies only the tiny live-override table through
  // feature-state; it never clones/maps all 4.8k geometries on the UI thread.
  const enrichedCustomRegionData = useMemo(() => {
    if (vNext) return EMPTY_FEATURE_COLLECTION;
    if (!customRegionData?.features) return customRegionData;
    return measureMapWork("custom region enrichment", () => {
      const overrideColor = {};
      for (const [regionId, ownerCode] of Object.entries(regionOwnershipOverrides)) {
        overrideColor[regionId] = ownerColorCss(ownerCode);
      }

      const rgbForOwner = (owner) => resolveOwnerRgb(owner) ?? fallbackRgbFromOwner(owner);
      return {
        ...customRegionData,
        features: customRegionData.features.map((f) => {
          const props = f.properties || {};
          const id = props.id;
          const fillColor = overrideColor[id]
            || (props.owner ? ownerColorCss(props.owner) : NEUTRAL_LAND_COLOR);
          let stripes = null;
          const claimants = regionClaimants[id]?.length
            ? regionClaimants[id]
            : Array.isArray(props.claimants) && props.claimants.length > 0
              ? props.claimants
              : null;
          if (claimants) {
            const liveOwner = regionOwnershipOverrides[id] ?? props.owner ?? "";
            const seen = new Set();
            const stripeRgbs = [];
            for (const name of (liveOwner ? [liveOwner, ...claimants] : claimants)) {
              const key = String(name ?? "").trim();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              stripeRgbs.push(rgbForOwner(key));
            }
            if (stripeRgbs.length >= 2) stripes = stripeImageId(stripeRgbs);
          }
          return {
            ...f,
            properties: stripes
              ? { ...props, _fillColor: fillColor, _stripes: stripes }
              : { ...props, _fillColor: fillColor },
          };
        }),
      };
    });
  }, [vNext, customRegionData, regionOwnershipOverrides, regionClaimants, ownerColorCss, resolveOwnerRgb]);

  const enrichedDisputedRegionData = useMemo(() => {
    if (!vNext || !disputedRegionData?.features?.length) return EMPTY_FEATURE_COLLECTION;
    return {
      ...disputedRegionData,
      features: disputedRegionData.features.map((feature) => {
        const props = feature?.properties ?? {};
        const liveOwner = String(props._liveOwner ?? props.owner ?? "");
        const claimants = Array.isArray(props._liveClaimants) ? props._liveClaimants : [];
        const seen = new Set();
        const stripeRgbs = [];
        for (const name of (liveOwner ? [liveOwner, ...claimants] : claimants)) {
          const key = String(name ?? "").trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          stripeRgbs.push(resolveOwnerRgb(key) ?? fallbackRgbFromOwner(key));
        }
        const stripes = stripeRgbs.length >= 2 ? stripeImageId(stripeRgbs) : null;
        return {
          ...feature,
          properties: {
            ...props,
            _fillColor: liveOwner ? ownerColorCss(liveOwner) : NEUTRAL_LAND_COLOR,
            ...(stripes ? { _stripes: stripes } : {}),
          },
        };
      }),
    };
  }, [disputedRegionData, ownerColorCss, resolveOwnerRgb, vNext]);

  // GADM disputed regions also paint the stock tiles (the crisp close-detail
  // twin). On vNext this comes from compact worker metadata, not a 190 MB parsed
  // geometry graph retained on the UI thread.
  const disputedTileStops = useMemo(() => {
    if (vNext && fullyAuthoredGeometry) return [];
    const stops = [];
    if (vNext) {
      for (const record of customRegionMeta.records ?? []) {
        const id = String(record?.id ?? "");
        if (!id.includes(".")) continue;
        const claimants = regionClaimants[id]?.length ? regionClaimants[id] : record?.claimants;
        if (!Array.isArray(claimants) || !claimants.length) continue;
        const liveOwner = regionOwnershipOverrides[id] ?? record?.owner ?? "";
        const seen = new Set();
        const stripeRgbs = [];
        for (const name of (liveOwner ? [liveOwner, ...claimants] : claimants)) {
          const key = String(name ?? "").trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          stripeRgbs.push(resolveOwnerRgb(key) ?? fallbackRgbFromOwner(key));
        }
        if (stripeRgbs.length >= 2) stops.push(id, stripeImageId(stripeRgbs));
      }
      return stops;
    }
    for (const f of enrichedCustomRegionData?.features ?? []) {
      const props = f.properties || {};
      if (!props._stripes || !String(props.id ?? "").includes(".")) continue;
      stops.push(String(props.id), props._stripes);
    }
    return stops;
  }, [vNext, fullyAuthoredGeometry, customRegionMeta.records, enrichedCustomRegionData, regionClaimants, regionOwnershipOverrides, resolveOwnerRgb]);

  const ownerByRegionId = useMemo(() => {
    const lookup = new Map();
    if (!customActive) return lookup;
    if (vNext) {
      for (const record of customRegionMeta.records ?? []) {
        const id = String(record?.id ?? "");
        if (!id) continue;
        lookup.set(id, regionOwnershipOverrides[id] ?? record?.owner ?? "");
      }
      return lookup;
    }
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (!props.id) continue;
      lookup.set(props.id, regionOwnershipOverrides[props.id] ?? props.owner ?? "");
    }
    return lookup;
  }, [customActive, customRegionData, customRegionMeta.records, regionOwnershipOverrides, vNext]);

  const ownerLookupRef = useRef(new Map());
  useEffect(() => {
    ownerLookupRef.current = ownerByRegionId;
  }, [ownerByRegionId]);

  const editedStockIds = useMemo(() => {
    if (!customActive) return [];
    if (vNext) return customRegionMeta.editedStockIds ?? [];
    const ids = [];
    for (const f of customRegionData?.features ?? []) {
      const props = f.properties || {};
      if (props.edited && String(props.id ?? "").includes(".")) ids.push(String(props.id));
    }
    return ids;
  }, [customActive, customRegionData, customRegionMeta.editedStockIds, vNext]);

  // Only live ownership overrides touch the URL-backed authored source. Seed
  // colours remain properties of the scenario file; conquests are a tiny state
  // diff rather than a full GeoJSON replacement.
  const appliedCustomFillStateRef = useRef(new Map());
  useEffect(() => {
    if (!vNext || !customFlag) return undefined;
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.setFeatureState) return undefined;
    let cancelled = false;
    let frame = 0;

    const apply = () => {
      if (cancelled) return;
      if (!mapInstance.getSource?.("custom-regions-source")) {
        frame = requestAnimationFrame(apply);
        return;
      }
      const next = new Map();
      for (const [regionId, owner] of Object.entries(regionOwnershipOverrides)) {
        next.set(String(regionId), ownerColorCss(owner));
      }
      const applied = appliedCustomFillStateRef.current;
      for (const [regionId, fillColor] of next) {
        if (applied.get(regionId) === fillColor) continue;
        mapInstance.setFeatureState(
          { source: "custom-regions-source", id: regionId },
          { fillColor },
        );
      }
      for (const regionId of applied.keys()) {
        if (next.has(regionId)) continue;
        mapInstance.removeFeatureState?.({ source: "custom-regions-source", id: regionId }, "fillColor");
      }
      appliedCustomFillStateRef.current = next;
    };

    apply();
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [customFlag, map, ownerColorCss, regionOwnershipOverrides, vNext]);

  // Detailed PMTiles previously evaluated a region-id match table containing
  // thousands of entries on every rendered frame. Store the resolved colour on
  // each promoted GID_1 feature instead, and only touch feature-state when the
  // canonical ownership colour actually changes.
  const appliedTileFillStateRef = useRef(new Map());
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!shouldMountStockRegions || !mapInstance?.setFeatureState) return undefined;

    let cancelled = false;
    let retryFrame = 0;
    let workFrame = 0;

    const begin = () => {
      if (cancelled) return;
      if (!mapInstance.getSource?.("regions-source")) {
        retryFrame = requestAnimationFrame(begin);
        return;
      }

      const applyStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const edited = new Set(editedStockIds);
      const next = new Map();

      for (const [regionId, owner] of ownerByRegionId) {
        if (!regionId.includes(".") || edited.has(regionId)) continue;
        next.set(regionId, owner ? ownerColorCss(owner) : NEUTRAL_LAND_COLOR);
      }

      const applied = appliedTileFillStateRef.current;
      const operations = [];

      for (const [regionId, fillColor] of next) {
        if (applied.get(regionId) === fillColor) continue;
        operations.push({ kind: "set", regionId, fillColor });
      }

      for (const regionId of applied.keys()) {
        if (next.has(regionId)) continue;
        operations.push({ kind: "remove", regionId });
      }

      // Small ownership changes should remain immediate. Initial scenario load can
      // involve several thousand feature-state writes; split that work into tiny
      // frame-budgeted slices so it cannot monopolize pointer input for seconds.
      let cursor = 0;
      const applySlice = () => {
        if (cancelled) return;
        const sliceStart = typeof performance !== "undefined" ? performance.now() : Date.now();
        let processed = 0;

        while (cursor < operations.length) {
          const op = operations[cursor++];
          if (op.kind === "set") {
            mapInstance.setFeatureState(
              { source: "regions-source", sourceLayer: "regions", id: op.regionId },
              { fillColor: op.fillColor },
            );
          } else {
            mapInstance.removeFeatureState?.(
              { source: "regions-source", sourceLayer: "regions", id: op.regionId },
              "fillColor",
            );
          }

          processed += 1;
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (processed >= 180 || now - sliceStart >= 4.5) break;
        }

        if (cursor < operations.length) {
          workFrame = requestAnimationFrame(applySlice);
          return;
        }

        appliedTileFillStateRef.current = next;
        const applyElapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - applyStartedAt;
        reportPerfOperation("map feature-state ownership sync", applyElapsed, { warnAt: PERF_MAP_WARN_MS });
        recordMapWork("Nations:feature-state-sync", applyElapsed, { operations: operations.length });
      };

      if (operations.length <= 180) {
        applySlice();
      } else {
        workFrame = requestAnimationFrame(applySlice);
      }
    };

    begin();

    return () => {
      cancelled = true;
      if (retryFrame) cancelAnimationFrame(retryFrame);
      if (workFrame) cancelAnimationFrame(workFrame);
    };
  }, [map, ownerByRegionId, editedStockIds, ownerColorCss, shouldMountStockRegions]);

  const stockRegionsFillPaint = useMemo(
    () => customActive
      ? {
          "fill-color": DETAIL_FILL_COLOR,
          "fill-opacity": hasPolitySurfaces ? 0 : TILE_FILL_FADE,
          // Adjacent same-owner regions must read as one continuous polity.
          // Their shared administrative edge is drawn separately at local zoom;
          // antialiasing every polygon edge creates the hairline "pixel gaps"
          // visible at continental scale even when the geometry is watertight.
          "fill-antialias": true,
          ...(vNext ? { "fill-outline-color": DETAIL_FILL_COLOR } : {}),
        }
      : { "fill-opacity": 0 },
    [customActive, hasPolitySurfaces, vNext],
  );
  const customRegionFillOpacity = customFlag
    ? hasPolitySurfaces ? 0 : vNext ? PAX_POLITICAL_FILL_OPACITY : BASE_FILL_OPACITY
    : 0;

  // Stock country fills/borders render ONLY once the world is known to be a
  // stock world. Gating on the customRegions FLAG (not customActive, which
  // additionally waits for geometry) means a custom world never flashes the
  // modern map — not before the world loads, and not while its geometry does.
  const showStockCountries = worldKnown && !customFlag;
  const countriesFillPaint = showStockCountries ? fillStyle : { ...fillStyle, "fill-opacity": 0 };
  const countriesOutlinePaint = {
    "line-color": "rgba(7, 10, 14, 0.90)",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.62, 8, 0.96, 12, 1.25],
    "line-opacity": showStockCountries ? 0.82 : 0,
  };
  // Region hairlines serve both map kinds, but nothing renders pre-worldKnown.
  // Tile hairlines fade in alongside the tile fills. The seed hairlines stay
  // underneath for a little longer as a safety net: if a vector tile is late,
  // the fallback fill should not turn into one borderless slab while panning.
  const regionsOutlinePaint = {
    "line-color": "rgba(7, 10, 14, 0.88)",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.22, 6, 0.32, 8, 0.48, 12, 0.78],
    "line-opacity": worldKnown
      ? vNext
        ? customActive
          ? 0
          : ["interpolate", ["linear"], ["zoom"], 6.8, 0, 7.4, 0.08, 8.2, 0.16, 10, 0.28, 12, 0.42]
        : ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.34, 8, 0.44, 12, 0.56]
      : 0,
  };

  // Scenario-authored label styling (world.labelFont/labelTextColor/
  // labelHaloColor). The style has no glyphs endpoint, so MapLibre v5 draws
  // every glyph locally with this stack as a CSS font-family — any font on the
  // PLAYER's machine works, with the trailing names as fallbacks where the
  // first is not installed.
  const labelFontStack = useMemo(
    // Pax-style political labels read more like atlas typography than delicate
    // annotations. Georgia is a heavier default on Windows while authored
    // scenario fonts still win when explicitly provided.
    () => [labelFont || "Georgia", "Georgia", "Times New Roman", "Palatino Linotype", "serif"],
    [labelFont],
  );

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(vNext ? 0.72 : 0.86, isGlobe, vNext ? 64 : 254),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-letter-spacing": vNext ? ["coalesce", ["get", "letterSpacing"], 0.12] : 0.10,
    ...(vNext ? { "text-max-width": 100 } : {}),
    "text-padding": vNext ? 6 : 8,
    ...(vNext ? { "symbol-sort-key": ["-", ["coalesce", ["get", "priorityScale"], ["get", "areaScale"]]] } : {}),
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels, vNext]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(vNext ? 0.78 : 0.86, isGlobe, vNext ? 78 : 254),
    "text-rotate": ["get", "rotation"],
    "text-offset": ["coalesce", ["get", "textOffset"], ["literal", [0, 0]]],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-ignore-placement": vNext,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels, vNext]);

  const livePointLabelLayerLayout = useMemo(() => ({
    ...pointLabelLayerLayout,
    // fitScale is solved from the actual territory width + name width at z4;
    // it then scales with the map at the same 2^zoom rate as the geometry.
    "text-size": buildCountryTextSize(1, isGlobe, 148, "fitScale"),
    "text-letter-spacing": ["coalesce", ["get", "letterSpacing"], 0.18],
    "text-allow-overlap": false,
    // Important tiers may still opt into overlap, but every placed polity label
    // now reserves collision space. R3 used ignore-placement=true, which let the
    // Balkans/microstates pile on top of one another at regional zoom.
    "text-ignore-placement": false,
    "text-padding": 2,
  }), [isGlobe, pointLabelLayerLayout]);

  const liveLineLabelLayerLayout = useMemo(() => ({
    "symbol-placement": "line-center",
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    // Unlike R1, fitScale is the TARGET territory occupancy, not an area-based
    // size that is merely capped by the spine. This is what makes RUSSIA stretch.
    "text-size": buildCountryTextSize(1, isGlobe, 300, "fitScale"),
    "text-letter-spacing": ["coalesce", ["get", "letterSpacing"], 0.18],
    // Pax-like warping should follow a territory, not corkscrew through it.
    // A moderate max-angle keeps long labels visibly shaped by the polity while
    // rejecting the extreme bends that previously made Bosnia-like cases ugly.
    "text-max-angle": 48,
    "text-padding": 1,
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "symbol-sort-key": ["-", ["coalesce", ["get", "visibilityScale"], ["get", "priorityScale"]]],
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": true,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const labelLayerPaint = useMemo(() => ({
    "text-color": labelTextColor || "rgba(247, 246, 240, 0.98)",
    "text-halo-color": labelHaloColor || "rgba(7, 10, 14, 0.92)",
    "text-halo-width": 1.1,
    "text-halo-blur": 0.32,
    "text-opacity": vNext
      ? [
          "interpolate", ["linear"], ["zoom"],
          4, 0.98,
          5.8, 0.90,
          6.6, 0.52,
          7.1, 0,
        ]
      : [
          "interpolate", ["linear"], ["zoom"],
          4, 0.98,
          6, 0.92,
          8, 0.28,
          9, 0,
        ],
  }), [labelHaloColor, labelTextColor, vNext]);
  const curvedLabelLayerPaint = useMemo(() => ({
    ...labelLayerPaint,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      3.85, 0,
      4.15, 0.98,
      5.8, 0.90,
      6.6, 0.52,
      7.1, 0,
    ],
  }), [labelLayerPaint]);
  const integratedLabelLayerPaint = useMemo(() => ({
    // Stronger atlas treatment: the polity name is a primary political layer,
    // not a faint annotation. Keep a crisp dark edge so large white serif text
    // survives both pale and saturated polity fills like the Pax reference.
    "text-color": labelTextColor || "rgba(250, 249, 244, 0.995)",
    "text-halo-color": labelHaloColor || "rgba(4, 6, 9, 0.96)",
    "text-halo-width": 1.45,
    "text-halo-blur": 0.18,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      2.0, 0.90,
      3.2, 0.985,
      5.8, 0.96,
      6.55, 0.72,
      7.1, 0,
    ],
  }), [labelHaloColor, labelTextColor]);

  return (
    <>
      {/* maxzoom 8, not the archive's 10, because 8 is what the editor can
          actually author against. z10 cannot be stitched into a seed at all —
          extract-regions.mjs completes and then dies in JSON.stringify, over V8's
          512MB max string length. z9 stitches, but 4.1M vertices then ran the
          editor's tab out of heap: Chrome killed the renderer with "Aw, Snap"
          while the machine still had 3GB free, because the cap is per-renderer.
          z8's 2.6M is stable. Rendering finer than the editor can edit only draws
          detail no map can be built against. Past z8 MapLibre overzooms, exactly
          as it already did past z10. */}
      {!customFlag && (
      <Source id="countries-source" type="vector" url={countriesUrl} maxzoom={8}>
        <Layer
          id="countries-fill"
          type="fill"
          source-layer="countries"
          paint={countriesFillPaint}
        />
        <Layer
          id="countries-outline"
          type="line"
          source-layer="countries"
          paint={countriesOutlinePaint}
        />
      </Source>
      )}

      {vNext && (
        <Source id="polity-surfaces-source" type="geojson" data={enrichedPolitySurfaceData} tolerance={0.25}>
          <Layer
            id="polity-surfaces-fill"
            type="fill"
            paint={{
              "fill-color": CUSTOM_FILL_COLOR,
              "fill-opacity": customActive && worldKnown
                ? PAX_POLITICAL_FILL_OPACITY
                : 0,
              "fill-antialias": true,
            }}
          />
        </Source>
      )}

      {/* Deliberately NOT gated on customFlag, unlike countries-source above —
          this source is not decoration on a custom map, it is the close-detail
          political layer for re-ownership scenarios. The seed GeoJSON now stays
          underneath as a fallback if a vector tile is late, while regions-fill
          sharpens the map once the tile is present. Keeping this source mounted
          also preserves high-zoom hit-testing and the stock-region hairlines. */}
      {shouldMountStockRegions && (
      <Source id="regions-source" type="vector" url={regionsUrl} maxzoom={8} promoteId="GID_1">
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          filter={editedStockIds.length ? ["!", ["in", ["get", "GID_1"], ["literal", editedStockIds]]] : ["all"]}
          paint={stockRegionsFillPaint}
        />
        {/* Striped fill for disputed GADM regions on the crisp tile geometry —
            fades in with the tile fills, exactly like the color layer above. */}
        {disputedTileStops.length > 0 && (
          <Layer
            id="regions-disputed"
            type="fill"
            source-layer="regions"
            filter={editedStockIds.length
              ? ["all",
                ["in", ["get", "GID_1"], ["literal", disputedTileStops.filter((_, i) => i % 2 === 0)]],
                ["!", ["in", ["get", "GID_1"], ["literal", editedStockIds]]]]
              : ["in", ["get", "GID_1"], ["literal", disputedTileStops.filter((_, i) => i % 2 === 0)]]}
            paint={{
              "fill-pattern": ["match", ["get", "GID_1"], ...disputedTileStops, disputedTileStops[1]],
              "fill-opacity": customActive && worldKnown ? TILE_FILL_FADE : 0,
            }}
          />
        )}
        <Layer
          id="regions-outline"
          type="line"
          minzoom={vNext ? 8.25 : undefined}
          source-layer="regions"
          filter={editedStockIds.length ? ["!", ["in", ["get", "GID_1"], ["literal", editedStockIds]]] : ["all"]}
          paint={regionsOutlinePaint}
        />
      </Source>
      )}

      {/* Author-DRAWN geometry only (splits/new regions) — GADM regions paint the
          stock tiles above for crisp borders at every zoom. Empty (and inert)
          unless world.customRegions is set. */}
      {/* tolerance 0: GeoJSON sources simplify geometry per zoom by default,
          and each region simplifies independently — shared borders drift
          apart at low zoom. Full resolution keeps them connected everywhere;
          the seed geometry is coarse enough that this stays cheap. */}
      {customFlag && (
      <Source
        id="custom-regions-source"
        type="geojson"
        data={vNext ? regionsGeojsonUrl : enrichedCustomRegionData}
        promoteId={vNext ? "id" : undefined}
        tolerance={0.6}
      >
        {/* coarse seed geometry sits underneath the tile layer as a safety net.
            black holes are a worse fallback than slightly soft borders. */}
        <Layer
          id="custom-regions-fill-far"
          type="fill"
          beforeId={shouldMountStockRegions ? "regions-fill" : undefined}
          filter={STOCK_GEOMETRY_FILTER}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customRegionFillOpacity,
            "fill-antialias": true,
            ...(vNext ? { "fill-outline-color": CUSTOM_FILL_COLOR } : {}),
          }}
        />
        {/* Seed hairlines stay beneath the detailed tile outlines through the
            handoff window. A late tile can then lose detail, not the border
            itself; once close-detail tiles are established this fades away. */}
        <Layer
          id="custom-regions-hairline-far"
          type="line"
          beforeId={shouldMountStockRegions ? "regions-outline" : undefined}
          minzoom={vNext ? 8.25 : undefined}
          maxzoom={9}
          filter={STOCK_GEOMETRY_FILTER}
          paint={{
            "line-color": "rgba(7, 10, 14, 0.88)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.26, 6.5, 0.42, 9, 0.58],
            "line-opacity": customActive
              ? vNext
                ? 0
                : ["interpolate", ["linear"], ["zoom"],
                    3, 0.32,
                    5.5, 0.42,
                    6.5, 0.30,
                    8, 0.18,
                    9, 0]
              : 0,
          }}
        />
        {/* Striped fill over disputed regions: far twin for GADM seed geometry,
            all-zoom twin for author-drawn shapes. The stripes REPLACE the solid
            look (they sit above it at the same opacity, administrator's color
            first), so a contested border reads at a glance. */}
        {!vNext && (
          <Layer
            id="custom-regions-disputed-far"
            type="fill"
            maxzoom={7}
            filter={["all", STOCK_GEOMETRY_FILTER, ["has", "_stripes"]]}
            paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? FAR_OVERLAY_FADE : 0 }}
          />
        )}
        <Layer
          id="custom-regions-fill"
          type="fill"
          filter={AUTHORED_GEOMETRY_FILTER}
          paint={{
            "fill-color": CUSTOM_FILL_COLOR,
            "fill-opacity": customRegionFillOpacity,
            "fill-antialias": true,
            ...(vNext ? { "fill-outline-color": CUSTOM_FILL_COLOR } : {}),
          }}
        />
        {!vNext && (
          <Layer
            id="custom-regions-disputed"
            type="fill"
            filter={["all", AUTHORED_GEOMETRY_FILTER, ["has", "_stripes"]]}
            paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? 0.90 : 0 }}
          />
        )}
        <Layer
          id="custom-regions-outline"
          type="line"
          minzoom={vNext ? 8.25 : undefined}
          filter={AUTHORED_GEOMETRY_FILTER}
          paint={{
            "line-color": "rgba(7, 10, 14, 0.88)",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              3, 0.22,
              8, 0.46,
              12, 0.78,
            ],
            "line-opacity": customActive
              ? vNext
                ? 0
                : ["interpolate", ["linear"], ["zoom"], 3, 0.26, 4, 0.34, 8, 0.46, 12, 0.56]
              : 0,
          }}
        />
        {/* Provinces are a local interaction grid, not part of the political
            silhouette. R18 brings them in at regional zoom instead of waiting
            for an already-close camera. The first appearance is deliberately
            faint, then ramps smoothly into a proper province grid.
            This remains ONE canonical scenario-geometry outline layer; the old
            duplicate tile/authored outline paths stay silent in vNext. */}
        {vNext && (
          <Layer
            id="custom-regions-local-outline"
            type="line"
            minzoom={4.20}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "rgba(8, 12, 18, 0.90)",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                4.20, 0.14,
                4.75, 0.17,
                5.25, 0.21,
                6.0, 0.27,
                7.0, 0.35,
                8.0, 0.45,
                10, 0.61,
                12, 0.79,
                14, 0.96,
              ],
              "line-opacity": customActive && worldKnown
                ? [
                    "interpolate", ["linear"], ["zoom"],
                    4.20, 0.00,
                    4.45, 0.045,
                    4.85, 0.075,
                    5.25, 0.11,
                    5.75, 0.16,
                    6.25, 0.22,
                    7.0, 0.30,
                    8.0, 0.39,
                    10, 0.49,
                    12, 0.58,
                    14, 0.67,
                  ]
                : 0,
            }}
          />
        )}
      </Source>
      )}

      {vNext && enrichedDisputedRegionData.features.length > 0 && (
        <Source id="custom-regions-disputed-source" type="geojson" data={enrichedDisputedRegionData} tolerance={0.6}>
          <Layer
            id="custom-regions-disputed-vnext"
            type="fill"
            filter={["has", "_stripes"]}
            paint={{
              "fill-pattern": ["get", "_stripes"],
              "fill-opacity": customActive && worldKnown ? 0.90 : 0,
            }}
          />
        </Source>
      )}

      {vNext && (
        <Source id="polity-boundaries-source" type="geojson" data={polityBoundaryData} tolerance={0.25}>
          <Layer
            id="polity-boundaries-shadow"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "rgba(1, 4, 8, 0.72)",
              "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.8, 3, 2.5, 6, 3.6, 9, 4.7, 12, 5.8],
              "line-blur": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 6, 1.15, 12, 1.5],
              "line-opacity": customActive && worldKnown ? 0.52 : 0,
            }}
          />
          <Layer
            id="polity-boundaries"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "rgba(5, 8, 13, 0.96)",
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                1, 0.58,
                3, 0.92,
                6, 1.34,
                9, 1.72,
                12, 2.08,
              ],
              "line-opacity": customActive && worldKnown ? 0.94 : 0,
            }}
          />
        </Source>
      )}

      <Source id="country-curved-label-source" type="geojson" data={activeCurvedLabelData}>
        <Layer
          id="country-curved-labels"
          type="symbol"
          minzoom={vNext && customFlag && useLivePolityLabels ? 3.85 : undefined}
          maxzoom={vNext ? 7.1 : undefined}
          layout={curvedLabelLayerLayout}
          paint={vNext && customFlag && useLivePolityLabels ? curvedLabelLayerPaint : labelLayerPaint}
        />
      </Source>

      {/*
          R5.0: same label geometry/policy, radically thinner renderer.
          The previous implementation expanded five tiers × multiple handoff
          bands into ~38 live country symbol layers. Current-zoom filtering now
          happens once in React after camera settle, leaving four constant
          MapLibre symbol layers and no motion-time visual degradation.
      */}
      <Source
        id="country-live-polity-line-label-source"
        type="geojson"
        data={rawLivePolityLineLabelData}
        // R5.4.5: label geometry is static vector cartography, not terrain.
        // Stop GeoJSON-VT at z3 and overzoom those stable source tiles above it.
        // This prevents Ukraine-class label spines from being re-clipped at
        // progressively finer tile boundaries as the camera zooms.
        maxzoom={3}
        buffer={256}
      >
        {vNext && customFlag && useLivePolityLabels && (
          <Layer
            id="country-line-labels-live-world"
            source="country-live-polity-line-label-source"
            type="symbol"
            maxzoom={7.1}
            filter={liveWorldLineFilter}
            layout={{
              ...liveLineLabelLayerLayout,
              "text-max-angle": 28,
              "text-allow-overlap": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
        {vNext && customFlag && useLivePolityLabels && (
          <Layer
            id="country-line-labels-live-detail"
            source="country-live-polity-line-label-source"
            type="symbol"
            maxzoom={7.1}
            filter={liveDetailLineFilter}
            layout={{
              ...liveLineLabelLayerLayout,
              "text-max-angle": 48,
              "text-allow-overlap": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
      </Source>

      <Source
        id="country-live-polity-point-label-source"
        type="geojson"
        data={rawLivePolityPointLabelData}
        // Point anchors are equally static. Keep them on the same fixed source
        // grid so zooming does not build another polity-label tile pyramid.
        maxzoom={3}
        buffer={256}
      >
        {vNext && customFlag && useLivePolityLabels && (
          <Layer
            id="country-labels-live-managed"
            source="country-live-polity-point-label-source"
            type="symbol"
            maxzoom={7.1}
            filter={livePointManagedFilter}
            layout={{
              ...livePointLabelLayerLayout,
              "text-allow-overlap": false,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
        {vNext && customFlag && useLivePolityLabels && (
          <Layer
            id="country-labels-live-overlap"
            source="country-live-polity-point-label-source"
            type="symbol"
            maxzoom={7.1}
            filter={livePointOverlapFilter}
            layout={{
              ...livePointLabelLayerLayout,
              // R5.4.6: this is a genuine guarantee layer. A failed curve must
              // not let a city/neighbor collision erase the polity fallback.
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={integratedLabelLayerPaint}
          />
        )}
      </Source>

      <Source id="country-point-label-source" type="geojson" data={activePointLabelData}>
        <Layer
          id="country-labels"
          type="symbol"
          maxzoom={vNext ? 7.1 : undefined}
          layout={pointLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>
    </>
  );
};

export default WorldMap;
