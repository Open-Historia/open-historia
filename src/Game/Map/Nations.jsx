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
} from "./unitsController.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  getNationColors,
  primeCustomRegionCatalog,
  readJson,
  reportPerfOperation,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import { resolveRegionName } from "../../runtime/regionNameFixes.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { loadCountryLabelCollections } from "../../runtime/countryLabels.js";
import { translateLabel } from "../../runtime/translator.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";
import { useWorldState } from "./useWorldState.js";

ensurePmtilesProtocol();
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// Globe projection renders a label's own high-latitude countries oversized
// relative to their outline — confirmed (issue #6) to be text-only (fills
// stay correctly scaled) and tied to each FEATURE's own latitude, not the
// camera's. cos(lat) undoes it; only applied in globe mode; flat/mercator
// keeps the exact same sizing it always has (this factor is 1 at lat 0 and
// visibly wrong in mercator at high latitude, so never enable it there).
const GLOBE_LAT_CORRECTION = ["cos", ["*", ["coalesce", ["get", "lat"], 0], Math.PI / 180]];

const buildCountryTextSize = (multiplier = 1, correctForGlobe = false) => {
  const scale = correctForGlobe ? ["*", multiplier, GLOBE_LAT_CORRECTION] : multiplier;
  const atZoom = (power) => [
    "min",
    254,
    ["*", scale, ["*", ["get", "areaScale"], ["^", 2, power]]],
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
const CUSTOM_FILL_COLOR = ["get", "_fillColor"];
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
  return value;
};

const WorldMap = ({ isGlobe = false }) => {
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
  const [customRegionData, setCustomRegionData] = useState(EMPTY_FEATURE_COLLECTION);
  const countriesUrl = PMTILES_PROTOCOL_URLS.countries;
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;
  const customActive = customFlag && Array.isArray(customRegionData?.features) && customRegionData.features.length > 0;
  // True for maps with their OWN drawn/generated geometry (region ids like
  // "reg_fmg_…", no dot) rather than re-ownership on the stock GADM tiles (ids like
  // "USA.1_1"). On such a map the stock regions-fill layer is Earth left over
  // underneath — clicking the fantasy ocean would otherwise resolve to whatever
  // real country sits at that lat/lon (Russia, Canada…), so we must NOT query it.
  const hasDrawnGeometry = useMemo(
    () =>
      customActive &&
      Array.isArray(customRegionData?.features) &&
      customRegionData.features.some((feature) => !/\./.test(String(feature?.properties?.id ?? ""))),
    [customActive, customRegionData],
  );
  // Re-read on each render so a runtime token change (switching games/scenarios)
  // refetches the geometry, mirroring the live-URL world poll below.
  const regionsGeojsonUrl = JSON_URLS.regionsGeojson;
  // Countries owning at least one region here — used to hide labels for nations
  // that don't exist in this scenario (e.g. modern states over medieval land).
  const ownedCountryCodes = useMemo(() => {
    const set = new Set();
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (props.owner && props.gid0) set.add(props.gid0);
    }
    return set;
  }, [customRegionData]);
  const ownedCodesKey = useMemo(() => [...ownedCountryCodes].sort().join(","), [ownedCountryCodes]);

  // Bumped when the translator learns new strings, so labels rebuild with
  // translated names (they're baked into map features, not DOM text).
  const [labelEpoch, setLabelEpoch] = useState(0);
  useEffect(() => {
    const onUpdated = () => setLabelEpoch((epoch) => epoch + 1);
    window.addEventListener("i18n:updated", onUpdated);
    return () => window.removeEventListener("i18n:updated", onUpdated);
  }, []);

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
  const regionAdjacency = useMemo(
    () => (customActive
      ? measureMapWork("region adjacency", () => buildRegionAdjacency(customRegionData))
      : null),
    [customActive, customRegionData],
  );

  const ownerLabelData = useMemo(() => {
    if (!customActive) return EMPTY_FEATURE_COLLECTION;
    return measureMapWork("owner labels", () => buildOwnerLabelCollection(
      customRegionData,
      regionOwnershipOverrides,
      polityOverrides,
      (raw, owner) => translateLabel(resolveCountryDisplayName(raw, owner)),
      regionAdjacency,
    ));
    // labelEpoch: rebuild once new translations land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customActive, customRegionData, regionOwnershipOverrides, polityOverrides, regionAdjacency, labelEpoch]);

  // On custom maps the stock modern-country labels are replaced wholesale by the
  // owner labels (no more "Russia"/"Ukraine" floating over the Soviet Union).
  // Keyed on the FLAG (not customActive): while a custom world's geometry is
  // still loading, and before the world is known at all, stock labels must
  // not flash in.
  const activePointLabelData = !worldKnown
    ? EMPTY_FEATURE_COLLECTION
    : customFlag
      ? ownerLabelData
      : pointLabelData;
  const activeCurvedLabelData = worldKnown && !customFlag ? curvedLabelData : EMPTY_FEATURE_COLLECTION;

  const handleRegionClick = useCallback((event) => {
    const unitsAt = () =>
      map.getLayer("units-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["units-fill"] })
        : [];

    // A city or built structure under the cursor. Point features are tiny
    // targets, so a hit is always deliberate; built structures (world.markers)
    // outrank cities when the two overlap. Shared between normal selection and
    // attack targeting, so anything clickable is also attackable.
    const featureAt = () => {
      const featureLayers = ["markers-shapes", "cities-shapes", "cities-labels"]
        .filter((id) => map.getLayer(id));
      const featureHits = featureLayers.length
        ? map.queryRenderedFeatures(event.point, { layers: featureLayers })
        : [];
      if (!featureHits.length) return null;
      const hit = featureHits.find((entry) => entry.layer.id === "markers-shapes") ?? featureHits[0];
      const props = hit.properties ?? {};
      const [lng, lat] = hit.geometry?.coordinates ?? [event.lngLat.lng, event.lngLat.lat];
      return hit.layer.id === "markers-shapes"
        ? { source: "marker", id: props.id, name: props.name, kind: props.kind, ownerCode: props.ownerCode, lng, lat }
        : {
          source: "city",
          name: props.city || props.name || "",
          population: props.population,
          capital: props.capital,
          tier: props.tier,
          lng,
          lat,
        };
    };

    const mode = getInteractionMode();

    // Active troop command modes intercept the click as a target, not a selection.
    // Cheats 2.0 admin placement is an authoritative relocation, distinct from
    // normal movement: it must work anywhere on the map without creating an
    // order, changing status, or applying era/logistics movement limits.
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
      moveUnitTo(mode.unitId, event.lngLat.lng, event.lngLat.lat);
      clearInteractionMode();
      return;
    }
    if (mode.kind === "attack") {
      // An enemy unit under the cursor is the target; otherwise a city or
      // structure is — troops can be directed against objectives, not just
      // other troops.
      const target = unitsAt();
      const feature = target.length ? null : featureAt();
      if (target.length) {
        attackWith(mode.unitId, target[0].properties.id);
      } else if (feature) {
        attackFeature(mode.unitId, feature);
      }
      clearInteractionMode();
      return;
    }

    // Normal selection: a unit click wins over the region beneath it.
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
    // Custom (editor) regions render on top of the stock regions. On a map with its
    // OWN drawn/generated geometry, query only the custom layers — a click on empty
    // sea must resolve to nothing, not the leftover Earth country underneath. On a
    // re-ownership map (stock GADM geometry), prefer regions-fill but keep the
    // seed layer queryable too. a visible fallback should not become an unclickable
    // patch just because its detail tile is still loading.
    const queryLayers = (hasDrawnGeometry
      ? ["custom-regions-fill", "custom-regions-fill-far"]
      : ["custom-regions-fill", "regions-fill", "custom-regions-fill-far"]
    ).filter((id) => map.getLayer(id));
    const features = map.queryRenderedFeatures(event.point, { layers: queryLayers });
    if (!features.length) {
      onOceanClicked();
      return;
    }

    const props = features[0].properties ?? {};
    const regionId = props.GID_1 ?? props.id ?? "";
    // On custom maps, stock-tile hits carry modern props only — resolve the era
    // owner (possibly "" = unclaimed) from the ownership lookup.
    const owner = props.owner ?? (ownerLookupRef.current.size ? ownerLookupRef.current.get(regionId) : undefined);
    // The region's underlying real country, as GADM knows it. A code, and staying
    // one: it comes off the baked tiles.
    const gid0 = props.gid0 ?? props.GID_0 ?? "";
    onRegionSelected({
      // Despite the name, this field carries the OWNER — every downstream reader
      // (the flag lookup, the country panel) treats it that way. Resolved to a
      // NAME here so it is one namespace: it used to hand back the owner's name
      // when there was an owner and a raw GADM code when there wasn't, and the
      // difference only showed up as an occasional "RUS" where a country name
      // belonged. owner === "" means genuinely unclaimed and must stay empty.
      GID_0: owner || (owner === "" ? "" : toCountryName(gid0)),
      // A stock-tile hit carries GADM's own COUNTRY attribute; a custom region has
      // no such property (and no longer carries `country` at all), so name it from
      // the provenance rather than handing the panel a blank.
      COUNTRY: props.COUNTRY ?? toCountryName(gid0),
      // Corrects the GADM regions whose stored name is the placeholder "NA" (England
      // is one), so the panel names the place instead of showing the marker verbatim.
      NAME_1: resolveRegionName(regionId, props.NAME_1 ?? props.name ?? ""),
      GID_1: regionId,
      // Kept as the flag fallback when the owner is an invented polity: "Roman
      // Empire" has no flag, but the land underneath it is still Italy.
      gid0,
      owner,
      lngLat: event.lngLat,
    });
  }, [hasDrawnGeometry, map]);

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


  // Load custom region geometry once, only when the active map declares it. Stock
  // scenarios never hit the network for this. Ownership recolors live via the
  // world poll above; the geometry itself is static per scenario.
  useEffect(() => {
    let cancelled = false;

    if (!customFlag) {
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
        console.error("Error loading custom regions:", error);
        setCustomRegionData(EMPTY_FEATURE_COLLECTION);
      });

    return () => {
      cancelled = true;
    };
  }, [customFlag, regionsGeojsonUrl]);

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
      "fill-opacity": 0.90,
    };
  }, [colorMap, regionOwnershipOverrides, ownerColorCss]);

  // Fill for custom (editor) regions: we pre-compute a _fillColor property onto
  // every feature so the MapLibre paint expression is just ["get", "_fillColor"]
  // — a constant GL expression that never needs recompilation. Ownership-override
  // colours, owner-based colours, and the neutral fallback are all computed in
  // fast JS and baked into the GeoJSON data itself.
  const enrichedCustomRegionData = useMemo(() => {
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
        let fillColor;
        if (overrideColor[id]) {
          fillColor = overrideColor[id];
        } else if (props.owner) {
          fillColor = ownerColorCss(props.owner);
        } else {
          fillColor = NEUTRAL_LAND_COLOR;
        }
        // Disputed regions carry a stripe-tile id built from the current
        // administrator's color plus every claimant's — the layers below select
        // on _stripes and paint with fill-pattern instead of the solid fill.
        // Claimants come from WORLD data first (regionClaimants — how the
        // modern-world scenario declares its disputes, since its geometry is an
        // immutable seed), then from the region feature's own claimants prop
        // (editor-authored maps).
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
  }, [customRegionData, colorMap, regionOwnershipOverrides, regionClaimants, ownerColorCss, resolveOwnerRgb]);

  // GADM disputed regions also paint the stock tiles (the crisp z>6.5 layer):
  // GID_1 -> stripe-tile id stops for the tile twin of the disputed layer.
  const disputedTileStops = useMemo(() => {
    const stops = [];
    for (const f of enrichedCustomRegionData?.features ?? []) {
      const props = f.properties || {};
      if (!props._stripes || !String(props.id ?? "").includes(".")) continue;
      stops.push(String(props.id), props._stripes);
    }
    return stops;
  }, [enrichedCustomRegionData]);

  // Region id -> current owner (live overrides win). Drives the stock-tile fill,
  // and the click handler uses it to resolve era owner/unclaimed for the popup.
  const ownerByRegionId = useMemo(() => {
    const lookup = new Map();
    if (!customActive) return lookup;
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (!props.id) continue;
      lookup.set(props.id, regionOwnershipOverrides[props.id] ?? props.owner ?? "");
    }
    return lookup;
  }, [customActive, customRegionData, regionOwnershipOverrides]);

  const ownerLookupRef = useRef(new Map());
  useEffect(() => {
    ownerLookupRef.current = ownerByRegionId;
  }, [ownerByRegionId]);



  // GADM regions on custom maps paint the STOCK vector tiles (sharp geometry at
  // every zoom — the coarse seed polygons left sliver gaps up close). Only
  // author-drawn shapes still render from the GeoJSON, on top.
  // Dotted (GADM) ids the editor reshaped: their true geometry is the GeoJSON's, so
  // the stock tiles — which still carry the ORIGINAL shape — must not paint them, or
  // the reshaped area fills twice and reads a shade too dark. Empty on stock and
  // author-only maps, where every change below is a no-op.
  const editedStockIds = useMemo(() => {
    if (!customActive) return [];
    const ids = [];
    for (const f of customRegionData?.features ?? []) {
      const props = f.properties || {};
      if (props.edited && String(props.id ?? "").includes(".")) ids.push(String(props.id));
    }
    return ids;
  }, [customActive, customRegionData]);

  // Detailed PMTiles previously evaluated a region-id match table containing
  // thousands of entries on every rendered frame. Store the resolved colour on
  // each promoted GID_1 feature instead, and only touch feature-state when the
  // canonical ownership colour actually changes.
  const appliedTileFillStateRef = useRef(new Map());
  useEffect(() => {
    const mapInstance = map?.getMap ? map.getMap() : map;
    if (!mapInstance?.setFeatureState) return undefined;

    let cancelled = false;
    let retryFrame = 0;

    const apply = () => {
      if (cancelled) return;
      if (!mapInstance.getSource?.("regions-source")) {
        retryFrame = requestAnimationFrame(apply);
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
      for (const [regionId, fillColor] of next) {
        if (applied.get(regionId) === fillColor) continue;
        mapInstance.setFeatureState(
          { source: "regions-source", sourceLayer: "regions", id: regionId },
          { fillColor },
        );
      }

      for (const regionId of applied.keys()) {
        if (next.has(regionId)) continue;
        mapInstance.removeFeatureState?.(
          { source: "regions-source", sourceLayer: "regions", id: regionId },
          "fillColor",
        );
      }

      appliedTileFillStateRef.current = next;
      const applyElapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - applyStartedAt;
      reportPerfOperation("map feature-state ownership sync", applyElapsed, { warnAt: PERF_MAP_WARN_MS });
    };

    apply();

    return () => {
      cancelled = true;
      if (retryFrame) cancelAnimationFrame(retryFrame);
    };
  }, [map, ownerByRegionId, editedStockIds, ownerColorCss]);

  const stockRegionsFillPaint = useMemo(
    () => customActive
      ? {
          "fill-color": DETAIL_FILL_COLOR,
          "fill-opacity": TILE_FILL_FADE,
        }
      : { "fill-opacity": 0 },
    [customActive],
  );

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
      ? ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.34, 8, 0.44, 12, 0.56]
      : 0,
  };

  // Scenario-authored label styling (world.labelFont/labelTextColor/
  // labelHaloColor). The style has no glyphs endpoint, so MapLibre v5 draws
  // every glyph locally with this stack as a CSS font-family — any font on the
  // PLAYER's machine works, with the trailing names as fallbacks where the
  // first is not installed.
  const labelFontStack = useMemo(
    () => [labelFont || "Georgia", "Times New Roman", "serif"],
    [labelFont],
  );

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(0.86, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-letter-spacing": 0.10,
    "text-padding": 8,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(0.86, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const labelLayerPaint = useMemo(() => ({
    "text-color": labelTextColor || "rgba(247, 246, 240, 0.98)",
    "text-halo-color": labelHaloColor || "rgba(7, 10, 14, 0.92)",
    "text-halo-width": 1.1,
    "text-halo-blur": 0.32,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      4, 0.98,
      6, 0.92,
      8, 0.28,
      9, 0,
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

      {/* Deliberately NOT gated on customFlag, unlike countries-source above —
          this source is not decoration on a custom map, it is the close-detail
          political layer for re-ownership scenarios. The seed GeoJSON now stays
          underneath as a fallback if a vector tile is late, while regions-fill
          sharpens the map once the tile is present. Keeping this source mounted
          also preserves high-zoom hit-testing and the stock-region hairlines. */}
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
          source-layer="regions"
          filter={editedStockIds.length ? ["!", ["in", ["get", "GID_1"], ["literal", editedStockIds]]] : ["all"]}
          paint={regionsOutlinePaint}
        />
      </Source>

      {/* Author-DRAWN geometry only (splits/new regions) — GADM regions paint the
          stock tiles above for crisp borders at every zoom. Empty (and inert)
          unless world.customRegions is set. */}
      {/* tolerance 0: GeoJSON sources simplify geometry per zoom by default,
          and each region simplifies independently — shared borders drift
          apart at low zoom. Full resolution keeps them connected everywhere;
          the seed geometry is coarse enough that this stays cheap. */}
      <Source id="custom-regions-source" type="geojson" data={enrichedCustomRegionData} tolerance={0.6}>
        {/* coarse seed geometry sits underneath the tile layer as a safety net.
            black holes are a worse fallback than slightly soft borders. */}
        <Layer
          id="custom-regions-fill-far"
          type="fill"
          beforeId="regions-fill"
          filter={STOCK_GEOMETRY_FILTER}
          paint={{ "fill-color": CUSTOM_FILL_COLOR, "fill-opacity": customActive ? BASE_FILL_OPACITY : 0 }}
        />
        {/* Seed hairlines stay beneath the detailed tile outlines through the
            handoff window. A late tile can then lose detail, not the border
            itself; once close-detail tiles are established this fades away. */}
        <Layer
          id="custom-regions-hairline-far"
          type="line"
          beforeId="regions-outline"
          maxzoom={9}
          filter={STOCK_GEOMETRY_FILTER}
          paint={{
            "line-color": "rgba(7, 10, 14, 0.88)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.26, 6.5, 0.42, 9, 0.58],
            "line-opacity": customActive
              ? ["interpolate", ["linear"], ["zoom"],
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
        <Layer
          id="custom-regions-disputed-far"
          type="fill"
          maxzoom={7}
          filter={["all", STOCK_GEOMETRY_FILTER, ["has", "_stripes"]]}
          paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? FAR_OVERLAY_FADE : 0 }}
        />
        <Layer
          id="custom-regions-fill"
          type="fill"
          filter={AUTHORED_GEOMETRY_FILTER}
          paint={{ "fill-color": CUSTOM_FILL_COLOR, "fill-opacity": customActive ? BASE_FILL_OPACITY : 0 }}
        />
        <Layer
          id="custom-regions-disputed"
          type="fill"
          filter={["all", AUTHORED_GEOMETRY_FILTER, ["has", "_stripes"]]}
          paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? 0.90 : 0 }}
        />
        <Layer
          id="custom-regions-outline"
          type="line"
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
              ? ["interpolate", ["linear"], ["zoom"], 3, 0.26, 4, 0.34, 8, 0.46, 12, 0.56]
              : 0,
          }}
        />
      </Source>

      <Source id="country-curved-label-source" type="geojson" data={activeCurvedLabelData}>
        <Layer
          id="country-curved-labels"
          type="symbol"
          layout={curvedLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>

      <Source id="country-point-label-source" type="geojson" data={activePointLabelData}>
        <Layer
          id="country-labels"
          type="symbol"
          layout={pointLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>
    </>
  );
};

export default WorldMap;
