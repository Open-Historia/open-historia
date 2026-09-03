/*! Open Historia — portions (custom-regions tier-2 rendering) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected, dismissRegionPopup } from "../Selection/Regions";
import { onUnitSelected, dismissUnitPopup } from "../Selection/Units";
import { onFeatureSelected, dismissFeaturePopup } from "../Selection/Features";
import {
  getInteractionMode,
  clearInteractionMode,
  deployUnit,
  moveUnitTo,
  attackWith,
  attackFeature,
  attackRegion,
} from "./unitsController.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  getNationColors,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import { resolveRegionName } from "../../runtime/regionNameFixes.js";
import { ownerIdentityKey, toCountryName } from "../../runtime/ownerNames.js";
import { loadCountryLabelCollections, loadRegionLabelGeometry } from "../../runtime/countryLabels.js";
import { translateLabel } from "../../runtime/translator.js";
import { loadRegionSeed, emptyRegionSeed } from "../../runtime/regionSeed.js";
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
// and "COTE D'IVOIRE" all reach the same palette entry. Shared with the world
// state's own owner canonicalisation, so the palette and the map agree on what
// counts as one polity.
const ownerFoldKey = ownerIdentityKey;

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

// GADM region ids contain a dot ("DEU.2_1"); author-drawn regions ("reg_...")
// don't. GADM regions paint the pre-tiled `regions.pmtiles` archive at EVERY
// zoom, so the 55-220 MB seed GeoJSON is never handed to MapLibre — only its
// owner/name index and its authored shapes survive (see regionSeedCore.js).
const CUSTOM_GEOMETRY_FILTER = ["==", ["index-of", ".", ["get", "id"]], -1];
// A feature whose geometry lives ONLY in the GeoJSON: author-drawn ("reg_...", no
// dot) OR a GADM region the editor reshaped (dotted id, but `edited`). Both render
// from the GeoJSON at every zoom AND must be kept out of the stock tiles, whose
// geometry is the ORIGINAL shape — painting both stacks two 0.72 fills and darkens
// the reshaped area. A plain unedited GADM region carries no `edited`, so
// ["==", ["get","edited"], true] is false for it and these fall back exactly to the
// dot test — stock and author-only maps render identically to before.
const AUTHORED_GEOMETRY_FILTER = ["any", CUSTOM_GEOMETRY_FILTER, ["==", ["get", "edited"], true]];
// The pre-tiled archive paints all zooms, so the old seed<->tile crossfade
// (FAR_FILL_FADE / TILE_FILL_FADE around z5.5-6.5) is gone: one constant opacity.
const TILE_FILL_OPACITY = 0.72;

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
  firstSeen.clear();
  return neighbors;
};

// Precompute centroids and areas for all features once on load so owner label
// building never re-runs the heavy Shoelace formula across 4,000 multi-polygons
// on ownership changes.
const computeRegionGeometryMetrics = (regionsFC) => {
  const allFeatures = regionsFC?.features ?? [];
  const metrics = new Array(allFeatures.length);
  for (let index = 0; index < allFeatures.length; index += 1) {
    const geom = allFeatures[index]?.geometry;
    if (!geom) {
      metrics[index] = null;
      continue;
    }
    const best = largestRingOf(geom);
    if (best && best.area > 0) {
      metrics[index] = { c: ringCentroidLngLat(best.ring), area: best.area };
    } else {
      metrics[index] = null;
    }
  }
  return metrics;
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

const buildOwnerLabelCollection = (
  regionsFC,
  overrides,
  polityOverrides,
  nameResolver,
  adjacency = null,
  precomputedMetrics = null,
) => {
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

    let entry = precomputedMetrics ? precomputedMetrics[index] : null;
    if (!entry) {
      const best = largestRingOf(allFeatures[index].geometry);
      if (!best || best.area <= 0) continue;
      entry = { c: ringCentroidLngLat(best.ring), area: best.area };
    }
    ownerByIndex[index] = owner;
    entryByIndex[index] = entry;
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
  // Lightweight index over the scenario's regions.geojson (owner map + authored
  // shapes only). Null until the seed finishes loading.
  const [regionSeed, setRegionSeed] = useState(null);
  // Coarse region geometry for labels/adjacency, read from the z0 tile of
  // regions.pmtiles (~15k vertices instead of the seed's millions).
  const [stockLabelRegions, setStockLabelRegions] = useState(EMPTY_FEATURE_COLLECTION);
  const countriesUrl = PMTILES_PROTOCOL_URLS.countries;
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;
  const customActive = customFlag && Boolean(regionSeed);
  // Whether the stock GADM tile layers are this map's actual base and so safe
  // to click-resolve against. True for re-ownership scenarios (Modern Day, Rome,
  // WWII — ids like "USA.1_1") AND hybrid maps that add drawn shapes on top of
  // GADM land (Medieval: 18 drawn regions over 3,644 GADM ones). False only for
  // a fully hand-drawn world (every id dotless), where the stock layers are just
  // leftover Earth underneath — clicking the fantasy ocean there must resolve to
  // nothing, not to whatever real country sits at that lat/lon. While the seed
  // is still loading, default true (mirrors the old behaviour, which only
  // excluded the stock layers once drawn geometry was actually seen).
  const hasStockBase = regionSeed ? regionSeed.hasGadm : true;
  // The complementary question, and NOT the negation of the one above: "does this
  // map contain any author-drawn (dotless-id) region?". Both are true at once on a
  // hybrid map, which is exactly the case that needs them kept apart — hasStockBase
  // decides which layers are QUERIED, hasDrawnGeometry decides which stock hits are
  // KEPT (see resolveRegionHit). The indexer already computes it alongside hasGadm.
  // Defaults false while the seed loads, so nothing is filtered out before we know.
  const hasDrawnGeometry = regionSeed ? regionSeed.hasDrawn : false;
  // Re-read on each render so a runtime token change (switching games/scenarios)
  // refetches the geometry, mirroring the live-URL world poll below.
  const regionsGeojsonUrl = JSON_URLS.regionsGeojson;
  // Countries owning at least one region here — used to hide labels for nations
  // that don't exist in this scenario (e.g. modern states over medieval land).
  const ownedCountryCodes = useMemo(() => {
    const set = new Set();
    if (!regionSeed) return set;
    for (const [id, props] of regionSeed.propsById) {
      const owner = regionOwnershipOverrides[id] ?? props.owner;
      if (owner && props.gid0) set.add(props.gid0);
    }
    return set;
  }, [regionSeed, regionOwnershipOverrides]);
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
  // Geometry comes from the z0 regions tile merged with authored shapes, NOT the
  // 55 MB seed — so these O(vertices) passes run in milliseconds on load.
  // Geometry-only, so it survives ownership polls — rebuilt only when the
  // world's region geometry itself changes.
  const labelRegionData = useMemo(() => {
    if (!customActive) return EMPTY_FEATURE_COLLECTION;
    const authored = regionSeed.authoredFC.features;
    const authoredIds = new Set();
    for (const feature of authored) {
      const id = String(feature.properties?.id ?? "");
      if (id) authoredIds.add(id);
    }
    // An edited GADM region appears in BOTH the z0 tile (original shape) and the
    // authored set (true shape) — the tile copy must not double-enter the label
    // geometry, so the tile copy of any authored id is dropped. The z0 tile bakes
    // the modern country as `owner`; the scenario's real owners live in the seed
    // index, so they are stamped on here (the live ownership overrides are applied
    // later, inside buildOwnerLabelCollection).
    const base = [];
    for (const feature of stockLabelRegions?.features ?? []) {
      const id = String(feature.properties?.id ?? "");
      if (authoredIds.has(id)) continue;
      const seedOwner = regionSeed.ownersById.get(id);
      if (seedOwner === "") continue; // unowned in this scenario — never labelled
      base.push(seedOwner === undefined
        ? feature
        : { ...feature, properties: { ...feature.properties, owner: seedOwner } });
    }
    return {
      type: "FeatureCollection",
      features: [...base, ...authored],
    };
  }, [customActive, regionSeed, stockLabelRegions]);

  const regionAdjacency = useMemo(
    () => (customActive ? buildRegionAdjacency(labelRegionData) : null),
    [customActive, labelRegionData],
  );

  const regionGeometryMetrics = useMemo(
    () => (customActive ? computeRegionGeometryMetrics(labelRegionData) : null),
    [customActive, labelRegionData],
  );

  const ownerLabelData = useMemo(() => {
    if (!customActive) return EMPTY_FEATURE_COLLECTION;
    return buildOwnerLabelCollection(
      labelRegionData,
      regionOwnershipOverrides,
      polityOverrides,
      (raw, owner) => translateLabel(resolveCountryDisplayName(raw, owner)),
      regionAdjacency,
      regionGeometryMetrics,
    );
    // labelEpoch: rebuild once new translations land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customActive, labelRegionData, regionOwnershipOverrides, polityOverrides, regionAdjacency, regionGeometryMetrics, labelEpoch]);

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

  const handleRegionClick = useCallback(async (event) => {
    const unitsAt = () =>
      map.getLayer("units-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["units-fill"] })
        : [];

    // A city or built structure under the cursor. Point features are tiny
    // targets, so a hit is always deliberate; built structures (world.markers)
    // outrank cities when the two overlap. Only point shapes are queried (not
    // text labels which have huge bounding boxes that intercept province clicks).
    const featureAt = () => {
      const featureLayers = ["markers-shapes", "cities-shapes"]
        .filter((id) => map.getLayer(id));
      const featureHits = featureLayers.length
        ? map.queryRenderedFeatures(event.point, { layers: featureLayers })
        : [];
      if (!featureHits.length) return null;
      const hit = featureHits.find((entry) => entry.layer.id === "markers-shapes") ?? featureHits[0];
      const props = hit.properties ?? {};
      const [lng, lat] = hit.geometry?.coordinates ?? [event.lngLat.lng, event.lngLat.lat];

      // Also grab underlying host region if available
      const regLayers = (hasStockBase
        ? ["custom-regions-fill", "regions-fill"]
        : ["custom-regions-fill"]
      ).filter((id) => map.getLayer(id));
      const regHits = regLayers.length ? map.queryRenderedFeatures(event.point, { layers: regLayers }) : [];
      const regProps = regHits[0]?.properties ?? {};
      const hostRegionId = regProps.GID_1 ?? regProps.id ?? "";
      const hostRegionName = regProps.NAME_1 ?? regProps.name ?? "";
      // Same precedence as resolveRegionHit: the live lookup beats the baked
      // `owner` snapshot, so a marker in a transferred province reports the
      // province's CURRENT holder rather than the one it was generated under.
      const hostCountry = (ownerLookupRef.current.size ? ownerLookupRef.current.get(hostRegionId) : undefined)
        ?? regProps.owner
        ?? toCountryName(regProps.gid0 ?? regProps.GID_0 ?? "");

      return hit.layer.id === "markers-shapes"
        ? { 
            source: "marker", 
            id: props.id, 
            name: props.name, 
            kind: props.kind, 
            ownerCode: props.ownerCode || hostCountry, 
            note: props.note || "",
            hostRegionId,
            hostRegionName,
            lng, 
            lat 
          }
        : {
            source: "city",
            name: props.city || props.name || "",
            population: props.population,
            capital: props.capital,
            tier: props.tier,
            ownerCode: hostCountry,
            hostRegionId,
            hostRegionName,
            lng,
            lat,
          };
    };

    // The region (province) beneath the click, resolved from the same layer
    // stack the normal selection path uses. This is what makes troop orders
    // region-aware: "attack Provence in Kingdom of France" instead of a bare
    // lat/lng. Null over ocean / on fully hand-drawn maps outside drawn shapes.
    const resolveRegionHit = () => {
      const candidateLayers = hasStockBase
        ? [
            "custom-regions-fill",
            "custom-regions-disputed",
            "regions-fill",
            "regions-disputed",
          ]
        : [
            "custom-regions-fill",
            "custom-regions-disputed",
          ];
      const queryLayers = candidateLayers.filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, { layers: queryLayers });
      // On a map with its OWN drawn geometry the stock tiles are Earth left over
      // underneath, so a click on fantasy sea must resolve to nothing rather than
      // to whatever real country sits at that lat/lon. Keeping only tile hits the
      // scenario actually knows about draws that line exactly: a GADM region this
      // world contains stays clickable at every zoom, and one it doesn't stays
      // inert. (ownerByRegionId holds every region of the world, unclaimed ones
      // included, so an owner-less region is still a hit.)
      //
      // hasStockBase alone is not enough here: on a HYBRID map (drawn shapes over
      // real GADM land) it is true, so the stock layers are queried — and without
      // this filter a click resolves to a GADM region the scenario never included.
      const kept = hasDrawnGeometry
        ? hits.filter((hit) => hit.layer.id !== "regions-fill"
          || ownerLookupRef.current.has(String(hit.properties?.GID_1 ?? "")))
        : hits;
      if (!kept.length) return null;
      const props = kept[0].properties ?? {};
      const regionId = String(props.GID_1 ?? props.id ?? "");
      if (!regionId) return null;
      // The live lookup WINS over props.owner. `props.owner` is a snapshot baked
      // into the scenario's geometry at generation time and never updated as the
      // game plays out, so reading it first makes a transferred region show its
      // old owner in the popup. props.owner is only a fallback for stock-tile hits
      // (GADM tiles carry no `owner` at all) and for custom regions the lookup has
      // never heard of. `??` (not `||`) so a resolved "" (explicitly unclaimed) is
      // kept rather than falling through.
      const owner = (ownerLookupRef.current.size ? ownerLookupRef.current.get(regionId) : undefined) ?? props.owner;
      return {
        props,
        regionId,
        // The region's underlying real country, as GADM knows it. A code, and staying
        // one: it comes off the baked tiles.
        gid0: String(props.gid0 ?? props.GID_0 ?? ""),
        owner: owner ?? "",
        regionName: resolveRegionName(regionId, props.NAME_1 ?? props.name ?? ""),
        country: props.COUNTRY ?? toCountryName(props.gid0 ?? props.GID_0 ?? ""),
        lngLat: event.lngLat,
      };
    };

    const mode = getInteractionMode();

    // Modes that intercept a click as a TARGET rather than a selection. Deploy
    // exists in both unit systems; move and attack are classic-only, and in beta
    // mode nothing can set them (units depict what the events say, and the AI owns
    // where forces go and what happens when they meet) — so the branches below are
    // simply unreachable there rather than needing a flag check of their own.
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
      // Target priority: an enemy unit, then a city/structure objective, then
      // the province under the cursor — troops can be directed at any of them.
      // An invalid target (troops ordered against a province they already hold)
      // keeps the mode armed so the player can pick again.
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
    const hit = resolveRegionHit();
    if (!hit) return;
    const { props, regionId, gid0, owner } = hit;
    const rawClaimants = regionClaimants?.[regionId] ?? (Array.isArray(props.claimants) ? props.claimants : []);
    const claimants = Array.isArray(rawClaimants) ? rawClaimants : [];
    const isDisputed = Boolean(props._stripes || claimants.length > 0);

    const regionPayload = {
      // Despite the name, this field carries the OWNER — every downstream reader
      // (the flag lookup, the country panel) treats it that way. Resolved to a
      // NAME here so it is one namespace: it used to hand back the owner's name
      // when there was an owner and a raw GADM code when there wasn't, and the
      // difference only showed up as an occasional "RUS" where a country name
      // belonged. owner === "" means genuinely unclaimed and must stay empty.
      // Regions.jsx resolves through `owner` first now (selectionOwner) and only
      // falls back to this field, so the panel is right whichever convention the
      // caller follows. Both are deliberate: this keeps every existing GID_0
      // reader on the live owner, that keeps the panel correct without it.
      GID_0: owner || (owner === "" ? "" : toCountryName(gid0)),
      // A stock-tile hit carries GADM's own COUNTRY attribute; a custom region has
      // no such property (and no longer carries `country` at all), so name it from
      // the provenance rather than handing the panel a blank.
      COUNTRY: hit.country,
      // Corrects the GADM regions whose stored name is the placeholder "NA" (England
      // is one), so the panel names the place instead of showing the marker verbatim.
      NAME_1: hit.regionName,
      GID_1: regionId,
      // Kept as the flag fallback when the owner is an invented polity: "Roman
      // Empire" has no flag, but the land underneath it is still Italy.
      gid0,
      owner,
      claimants,
      isDisputed,
      lngLat: event.lngLat,
    };
    // onRegionSelected runs the cheat click-tools (annex/edit mode) itself and
    // opens the popup only when none of them consumed the click.
    onRegionSelected(regionPayload);
  }, [hasDrawnGeometry, hasStockBase, map, regionClaimants]);

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
          // The DISPLAY name belongs in here too: a rename writes `name`, not an
          // alias, so a legacy save still holding regions under the era name
          // ("Third Reich" beside "Germany") would otherwise paint them a
          // procedural fallback colour instead of the country's own.
          const names = [key, entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
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
      const rgb = resolveOwnerRgb(owner);
      return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : NEUTRAL_LAND_COLOR;
    },
    [resolveOwnerRgb],
  );


  // Load custom region data once, only when the active map declares it. Stock
  // scenarios never hit the network for this. The 55-220 MB FeatureCollection is
  // fetched/parse-indexed in a WORKER (regionSeed.js) — the main thread only
  // ever sees the small seed (owner index + authored shapes), so the full
  // document is never stored in state or handed to MapLibre.
  // Ownership recolors live via the world poll above; geometry is static per
  // scenario.
  useEffect(() => {
    let cancelled = false;

    if (!customFlag) {
      setRegionSeed(null);
      setStockLabelRegions(EMPTY_FEATURE_COLLECTION);
      return undefined;
    }

    loadRegionSeed(regionsGeojsonUrl)
      .then((seed) => {
        if (cancelled) return;
        setRegionSeed(seed);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading custom regions:", error);
        setRegionSeed(emptyRegionSeed());
      });

    // Coarse geometry for labels/adjacency: the z0 tile of the pre-tiled
    // regions archive (already downloaded for rendering), ~15k vertices that
    // decode in tens of milliseconds. loadRegionLabelGeometry memoizes and
    // never rejects (failures resolve to an empty FeatureCollection).
    loadRegionLabelGeometry()
      .then((data) => {
        if (cancelled) return;
        setStockLabelRegions(data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading region label geometry:", error);
        setStockLabelRegions(EMPTY_FEATURE_COLLECTION);
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
    const stops = Object.entries(colorMap).flatMap(([owner, rgb]) => [
      owner, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);
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
      "fill-opacity": 0.66,
    };
  }, [colorMap, regionOwnershipOverrides, ownerColorCss]);

  // Region id -> current owner (live overrides win). Drives the stock-tile fill,
  // the custom-regions fill match expression, and the click handler popup resolution.
  // Seeded from EVERY live override first — a plain stock map (no drawn geometry,
  // so `customActive` is false) still needs GID_1 overrides resolvable here, or a
  // region transferred by ID (e.g. an annexed Irish county) keeps showing its old
  // owner in the click popup even though the fill paint (which reads the override
  // object directly) already shows the new one. Returning an empty map when
  // `!customActive` would now break PAINT as well as the popup, because both fill
  // expressions above are built from this lookup — not only click resolution.
  const ownerByRegionId = useMemo(() => {
    const lookup = new Map();
    for (const [regionId, owner] of Object.entries(regionOwnershipOverrides)) {
      lookup.set(regionId, owner ?? "");
    }
    if (!customActive) return lookup;
    for (const [regionId, seedOwner] of regionSeed.ownersById) {
      lookup.set(regionId, regionOwnershipOverrides[regionId] ?? seedOwner ?? "");
    }
    // Also ensure all live overrides (e.g. stock vector tile regions not in the seed) are present
    for (const [regionId, owner] of Object.entries(regionOwnershipOverrides ?? {})) {
      if (regionId && !lookup.has(regionId)) {
        lookup.set(regionId, owner ?? "");
      }
    }
    return lookup;
  }, [customActive, regionSeed, regionOwnershipOverrides]);

  const ownerLookupRef = useRef(new Map());
  useEffect(() => {
    ownerLookupRef.current = ownerByRegionId;
  }, [ownerByRegionId]);

  // High-performance dynamic GL paint expression for custom regions.
  // Only the authored shapes are in custom-regions-source (a handful of
  // features), so this match stays tiny — tile regions recolor via the
  // GID_0/GID_1 match in stockRegionsFillPaint instead.
  const customRegionsFillColor = useMemo(() => {
    if (!customActive) return NEUTRAL_LAND_COLOR;
    const stops = [];
    for (const feature of regionSeed.authoredFC.features) {
      const regionId = String(feature.properties?.id ?? "");
      if (!regionId) continue;
      const owner = ownerByRegionId.get(regionId) ?? "";
      stops.push(regionId, owner ? ownerColorCss(owner) : NEUTRAL_LAND_COLOR);
    }
    if (!stops.length) return NEUTRAL_LAND_COLOR;
    return ["match", ["get", "id"], ...stops, NEUTRAL_LAND_COLOR];
  }, [customActive, regionSeed, ownerByRegionId, ownerColorCss]);

  // Disputed region stripe stops: builds pairs [regionId, stripeImageId]
  // for both the custom-region GeoJSON layers and the stock vector tile layer.
  const customDisputedStops = useMemo(() => {
    if (!customActive) return [];
    const stops = [];
    const rgbForOwner = (owner) => resolveOwnerRgb(owner) ?? fallbackRgbFromOwner(owner);

    for (const [id, props] of regionSeed.propsById) {
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
        if (stripeRgbs.length >= 2) {
          const imageId = stripeImageId(stripeRgbs);
          stops.push(String(id), imageId);
        }
      }
    }
    return stops;
  }, [customActive, regionSeed, regionOwnershipOverrides, regionClaimants, resolveOwnerRgb]);

  const customDisputedIds = useMemo(() => {
    const ids = [];
    for (let i = 0; i < customDisputedStops.length; i += 2) {
      ids.push(customDisputedStops[i]);
    }
    return ids;
  }, [customDisputedStops]);

  // GADM disputed regions also paint the stock tiles (the crisp z>6.5 layer):
  // GID_1 -> stripe-tile id stops for the tile twin of the disputed layer.
  const disputedTileStops = useMemo(() => {
    const stops = [];
    for (let i = 0; i < customDisputedStops.length; i += 2) {
      const id = customDisputedStops[i];
      if (id.includes(".")) {
        stops.push(id, customDisputedStops[i + 1]);
      }
    }
    return stops;
  }, [customDisputedStops]);



  // GADM regions on custom maps paint the STOCK vector tiles (sharp geometry at
  // every zoom). Only author-drawn/edited shapes still render from the GeoJSON,
  // on top. Dotted (GADM) ids the editor reshaped: their true geometry is the
  // GeoJSON's, so the stock tiles — which still carry the ORIGINAL shape — must
  // not paint them, or the reshaped area fills twice and reads a shade too dark.
  // Empty on stock and author-only maps, where every change below is a no-op.
  const editedStockIds = useMemo(() => {
    if (!customActive) return [];
    const ids = [];
    for (const [id, props] of regionSeed.propsById) {
      if (props.edited && id.includes(".")) ids.push(id);
    }
    return ids;
  }, [customActive, regionSeed]);

  const stockRegionsFillPaint = useMemo(() => {
    if (!customActive) return { "fill-opacity": 0 };
    // Color per GADM region from the seed's owner map (live overrides win).
    // Reshaped regions are skipped — the GeoJSON layer owns their pixels.
    const colorByRegion = new Map();
    const regionGid0 = new Map();
    const colorCountsByGid0 = new Map(); // gid0 -> Map(color -> region count)
    for (const [regionId, owner] of ownerByRegionId) {
      if (!regionId.includes(".")) continue; // drawn regions aren't in the tiles
      if (editedStockIds.includes(regionId)) continue; // reshaped — the GeoJSON owns it
      const color = owner ? ownerColorCss(owner) : NEUTRAL_LAND_COLOR;
      colorByRegion.set(regionId, color);
      const gid0 = String(regionSeed.propsById.get(regionId)?.gid0 ?? "");
      if (!gid0) continue;
      regionGid0.set(regionId, gid0);
      let counts = colorCountsByGid0.get(gid0);
      if (!counts) {
        counts = new Map();
        colorCountsByGid0.set(gid0, counts);
      }
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    // A GADM country whose regions all share one colour is expressed once, as a
    // GID_0 stop on the country (presets: entire countries owned by one polity;
    // modern maps: owner == country). Only deviations from the homogeneous
    // colour need a per-region GID_1 stop, shrinking the match expression from
    // thousands of entries to the exceptions.
    const countryStops = [];
    for (const [gid0, counts] of colorCountsByGid0) {
      if (counts.size !== 1) continue;
      countryStops.push(gid0, counts.keys().next().value);
    }
    const countryColor = new Map();
    for (let i = 0; i < countryStops.length; i += 2) countryColor.set(countryStops[i], countryStops[i + 1]);
    const stops = [];
    for (const [regionId, color] of colorByRegion) {
      const gid0 = regionGid0.get(regionId);
      if (gid0 !== undefined && countryColor.get(gid0) === color) continue; // country stop covers it
      stops.push(regionId, color);
    }
    // Overrides on tile regions absent from the seed still need their own stop.
    for (const [regionId, owner] of Object.entries(regionOwnershipOverrides)) {
      if (!regionId.includes(".") || colorByRegion.has(regionId)) continue;
      stops.push(regionId, owner ? ownerColorCss(owner) : NEUTRAL_LAND_COLOR);
    }
    if (!countryStops.length && !stops.length) return { "fill-opacity": 0 };
    const fallback = countryStops.length
      ? ["match", ["get", "GID_0"], ...countryStops, NEUTRAL_LAND_COLOR]
      : NEUTRAL_LAND_COLOR;
    return {
      "fill-color": stops.length ? ["match", ["get", "GID_1"], ...stops, fallback] : fallback,
      // Never for a reshaped region: its tile still holds the original shape, so
      // painting it here would double-fill the edited area over the GeoJSON that
      // now owns it.
      "fill-opacity": editedStockIds.length
        ? ["case", ["in", ["get", "GID_1"], ["literal", editedStockIds]], 0, TILE_FILL_OPACITY]
        : TILE_FILL_OPACITY,
    };
  }, [customActive, ownerByRegionId, regionSeed, colorMap, ownerColorCss, editedStockIds, regionOwnershipOverrides]);

  // Stock country fills/borders render ONLY once the world is known to be a
  // stock world. Gating on the customRegions FLAG (not customActive, which
  // additionally waits for geometry) means a custom world never flashes the
  // modern map — not before the world loads, and not while its geometry does.
  const showStockCountries = worldKnown && !customFlag;
  const countriesFillPaint = showStockCountries ? fillStyle : { ...fillStyle, "fill-opacity": 0 };
  const countriesOutlinePaint = {
    "line-color": "#000",
    "line-width": 1,
    "line-opacity": showStockCountries ? 1 : 0,
  };
  // Region hairlines serve both map kinds, but nothing renders pre-worldKnown.
  // The tiles paint fills at every zoom now, so the hairlines fade in from world
  // view alongside them (the pre-tiled geometry sits exactly on its own fills —
  // there is no crossfade handoff to mismatch anymore).
  const regionsOutlinePaint = {
    "line-color": "#000",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.2, 8, 0.6, 12, 1.0],
    "line-opacity": worldKnown
      ? ["interpolate", ["linear"], ["zoom"], 2, 0.35, 8, 0.7]
      : 0,
  };

  // Scenario-authored label styling (world.labelFont/labelTextColor/
  // labelHaloColor). The style has no glyphs endpoint, so MapLibre v5 draws
  // every glyph locally with this stack as a CSS font-family — any font on the
  // PLAYER's machine works, with the trailing names as fallbacks where the
  // first is not installed.
  const labelFontStack = useMemo(
    () => [labelFont || "Impact", "Arial Black", "sans-serif"],
    [labelFont],
  );

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(1, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": labelFontStack,
    "text-size": buildCountryTextSize(1, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, labelFontStack, mapDisplaySettings.hideCountryLabels]);

  const labelLayerPaint = useMemo(() => ({
    "text-color": labelTextColor || "#FFFFFF",
    "text-halo-color": labelHaloColor || "rgba(0, 0, 0, 0.5)",
    "text-halo-width": 1,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      5, 0.75,
      8, 0,
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
          this source is not decoration on a custom map, it IS the map. On a
          re-ownership scenario (Modern Day, Rome, WWII: stock GADM geometry,
          nothing hand-drawn) regions-fill is the ONLY thing painting owners,
          because it now paints at every zoom (the old seed-GeoJSON tier is gone).
          Unmounting it here would leave every such map blank and, via the
          getLayer() filter at the click handler, unclickable too. The hairlines
          are needed on stock maps as well: regionsOutlinePaint is gated on
          worldKnown, not on customActive. */}
      <Source id="regions-source" type="vector" url={regionsUrl} maxzoom={8}>
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          paint={stockRegionsFillPaint}
        />
        {/* Striped fill for disputed GADM regions — the tiles paint at every
            zoom, so the stripes do too. */}
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
              "fill-opacity": customActive && worldKnown ? TILE_FILL_OPACITY : 0,
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

      {/* Author-DRAWN / editor-EDITED geometry only — a handful of features
          (0-10 on standard scenarios) instead of the full 4,000-region seed, so
          geojson-vt tiling stays featherweight. GADM regions paint the stock
          tiles above at every zoom. Empty (and inert) unless world.customRegions
          is set. */}
      {/* tolerance 0: GeoJSON sources simplify geometry per zoom by default,
          and each region simplifies independently — shared borders drift
          apart at low zoom. Full resolution keeps them connected everywhere;
          the authored geometry is small enough that this stays cheap. */}
      <Source id="custom-regions-source" type="geojson" data={customActive ? regionSeed.authoredFC : EMPTY_FEATURE_COLLECTION} tolerance={0.6}>
        <Layer
          id="custom-regions-fill"
          type="fill"
          filter={AUTHORED_GEOMETRY_FILTER}
          paint={{ "fill-color": customRegionsFillColor, "fill-opacity": customActive ? 0.72 : 0 }}
        />
        {customDisputedStops.length > 0 && (
          <Layer
            id="custom-regions-disputed"
            type="fill"
            filter={["all", AUTHORED_GEOMETRY_FILTER, ["in", ["get", "id"], ["literal", customDisputedIds]]]}
            paint={{
              "fill-pattern": ["match", ["get", "id"], ...customDisputedStops, customDisputedStops[1]],
              "fill-opacity": customActive ? 0.72 : 0,
            }}
          />
        )}
        <Layer
          id="custom-regions-outline"
          type="line"
          filter={AUTHORED_GEOMETRY_FILTER}
          paint={{
            "line-color": "#000",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              3, 0.2,
              8, 0.6,
              12, 1.0,
            ],
            "line-opacity": customActive
              ? ["interpolate", ["linear"], ["zoom"], 3, 0, 4, 0.35, 8, 0.6]
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

