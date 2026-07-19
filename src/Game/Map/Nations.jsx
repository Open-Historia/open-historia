/*! Open Historia — portions (custom-regions tier-2 rendering) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected, dismissRegionPopup } from "../Selection/Regions";
import { onUnitSelected, dismissUnitPopup } from "../Selection/Units";
import {
  getInteractionMode,
  clearInteractionMode,
  deployUnit,
  moveUnitTo,
  attackWith,
} from "./unitsController.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  getNationColors,
  readJson,
  resolveCountryDisplayName,
} from "../../runtime/assets.js";
import COUNTRY_NAMES from "../../runtime/generated/countryNames.js";
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

// GADM region ids contain a dot ("DEU.2_1"); author-drawn regions ("reg_...")
// don't. On custom maps, GADM regions crossfade between two sources: the seed
// GeoJSON when zoomed OUT (the stock tiles are too simplified out there and
// show sliver gaps) and the stock vector tiles when zoomed IN (the z5 seed is
// too coarse up close). Author-drawn geometry renders from the GeoJSON at every
// zoom, on top — the tiles don't know those shapes.
const CUSTOM_GEOMETRY_FILTER = ["==", ["index-of", ".", ["get", "id"]], -1];
const GADM_GEOMETRY_FILTER = [">=", ["index-of", ".", ["get", "id"]], 0];
// Crossfade band: seed geometry was extracted at tile-zoom 5, so hand off to
// the tiles just past that.
const FAR_FILL_FADE = ["interpolate", ["linear"], ["zoom"], 5.5, 0.72, 6.5, 0];
const TILE_FILL_FADE = ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.72];

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
    const owner = overrides?.[props.id] ?? props.owner;
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


const WorldMap = ({ isGlobe = false }) => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const {
    worldState,
    worldKnown,
    customRegions: customFlag,
    regionOwnershipOverrides,
    polityOverrides,
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
    () => (customActive ? buildRegionAdjacency(customRegionData) : null),
    [customActive, customRegionData],
  );

  const ownerLabelData = useMemo(() => {
    if (!customActive) return EMPTY_FEATURE_COLLECTION;
    return buildOwnerLabelCollection(
      customRegionData,
      regionOwnershipOverrides,
      polityOverrides,
      (raw, owner) => translateLabel(resolveCountryDisplayName(raw, owner)),
      regionAdjacency,
    );
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

    const mode = getInteractionMode();

    // Active troop command modes intercept the click as a target, not a selection.
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
      const target = unitsAt();
      if (target.length) attackWith(mode.unitId, target[0].properties.id);
      clearInteractionMode();
      return;
    }

    // Normal selection: a unit click wins over the region beneath it.
    const unitHits = unitsAt();
    if (unitHits.length) {
      dismissRegionPopup();
      onUnitSelected({ id: unitHits[0].properties.id, lngLat: event.lngLat });
      return;
    }

    dismissUnitPopup();
    // Custom (editor) regions render on top of the stock regions. On a map with its
    // OWN drawn/generated geometry, query only the custom layers — a click on empty
    // sea must resolve to nothing, not the leftover Earth country underneath. On a
    // re-ownership map (stock GADM geometry), keep querying regions-fill: it IS the
    // map, and its high-zoom hit-testing has no custom-layer equivalent.
    const queryLayers = (hasDrawnGeometry
      ? ["custom-regions-fill", "custom-regions-fill-far"]
      : ["custom-regions-fill", "regions-fill"]
    ).filter((id) => map.getLayer(id));
    const features = map.queryRenderedFeatures(event.point, { layers: queryLayers });
    if (!features.length) return;

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
      GID_0: owner || (owner === "" ? "" : COUNTRY_NAMES[gid0] || gid0),
      // A stock-tile hit carries GADM's own COUNTRY attribute; a custom region has
      // no such property (and no longer carries `country` at all), so name it from
      // the provenance rather than handing the panel a blank.
      COUNTRY: props.COUNTRY ?? COUNTRY_NAMES[gid0] ?? "",
      NAME_1: props.NAME_1 ?? props.name ?? "",
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

  useEffect(() => {
    getNationColors()
      .then(setColorMap)
      .catch((error) => console.error("Error loading colors:", error));
  }, []);


  // Load custom region geometry once, only when the active map declares it. Stock
  // scenarios never hit the network for this. Ownership recolors live via the
  // world poll above; the geometry itself is static per scenario.
  useEffect(() => {
    let cancelled = false;

    if (!customFlag) {
      setCustomRegionData(EMPTY_FEATURE_COLLECTION);
      return undefined;
    }

    readJson(regionsGeojsonUrl, { defaultValue: EMPTY_FEATURE_COLLECTION, force: true })
      .then((data) => {
        if (cancelled) return;
        setCustomRegionData(data && Array.isArray(data.features) ? data : EMPTY_FEATURE_COLLECTION);
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
    const stops = Object.entries(colorMap).flatMap(([owner, rgb]) => [
      owner, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);
    const fallback = buildFallbackColorExpression();
    const regionOverrideStops = Object.entries(regionOwnershipOverrides).flatMap(([regionId, ownerCode]) => [
      regionId,
      colorMap[ownerCode]
        ? `rgb(${colorMap[ownerCode][0]}, ${colorMap[ownerCode][1]}, ${colorMap[ownerCode][2]})`
        : fallbackColorFromOwner(ownerCode),
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
  }, [colorMap, regionOwnershipOverrides]);

  // Fill for custom (editor) regions: we pre-compute a _fillColor property onto
  // every feature so the MapLibre paint expression is just ["get", "_fillColor"]
  // — a constant GL expression that never needs recompilation. Ownership-override
  // colours, owner-based colours, and the neutral fallback are all computed in
  // fast JS and baked into the GeoJSON data itself.
  const enrichedCustomRegionData = useMemo(() => {
    if (!customRegionData?.features) return customRegionData;

    const colorByOwner = {};
    for (const [iso, rgb] of Object.entries(colorMap)) {
      colorByOwner[iso] = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    const overrideColor = {};
    for (const [regionId, ownerCode] of Object.entries(regionOwnershipOverrides)) {
      overrideColor[regionId] = colorMap[ownerCode]
        ? `rgb(${colorMap[ownerCode][0]}, ${colorMap[ownerCode][1]}, ${colorMap[ownerCode][2]})`
        : fallbackColorFromOwner(ownerCode);
    }

    const rgbForOwner = (owner) => colorMap[owner] ?? fallbackRgbFromOwner(owner);

    return {
      ...customRegionData,
      features: customRegionData.features.map((f) => {
        const props = f.properties || {};
        const id = props.id;
        let fillColor;
        if (overrideColor[id]) {
          fillColor = overrideColor[id];
        } else if (props.owner && colorByOwner[props.owner]) {
          fillColor = colorByOwner[props.owner];
        } else if (props.owner) {
          fillColor = fallbackColorFromOwner(props.owner);
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
  }, [customRegionData, colorMap, regionOwnershipOverrides, regionClaimants]);

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
  const stockRegionsFillPaint = useMemo(() => {
    if (!customActive) return { "fill-opacity": 0 };
    const stops = [];
    for (const [regionId, owner] of ownerByRegionId) {
      if (!regionId.includes(".")) continue; // drawn regions aren't in the tiles
      stops.push(
        regionId,
        owner
          ? colorMap[owner]
            ? `rgb(${colorMap[owner][0]}, ${colorMap[owner][1]}, ${colorMap[owner][2]})`
            : fallbackColorFromOwner(owner)
          : NEUTRAL_LAND_COLOR,
      );
    }
    if (!stops.length) return { "fill-opacity": 0 };
    return {
      "fill-color": ["match", ["get", "GID_1"], ...stops, NEUTRAL_LAND_COLOR],
      // Fades in as the seed-geometry far layer fades out.
      "fill-opacity": TILE_FILL_FADE,
    };
  }, [customActive, ownerByRegionId, colorMap]);

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
  // Tile hairlines only fade in alongside the tile FILLS (z5.5-6.5): below
  // that the fills come from the seed geometry, and hairlines from the
  // simplified low-zoom tiles sit visibly off those fills — disconnected
  // borders. The far hairlines come from the seed geometry itself instead.
  const regionsOutlinePaint = {
    "line-color": "#000",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.2, 8, 0.6, 12, 1.0],
    "line-opacity": worldKnown
      ? ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.6, 8, 0.7]
      : 0,
  };

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(1, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(1, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.hideCountryLabels]);

  const labelLayerPaint = useMemo(() => ({
    "text-color": "#FFFFFF",
    "text-halo-color": "rgba(0, 0, 0, 0.5)",
    "text-halo-width": 1,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      5, 0.75,
      8, 0,
    ],
  }), []);

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
          nothing hand-drawn) regions-fill is the ONLY thing painting owners
          above z6.5, because custom-regions-fill-far stops at maxzoom 7 and
          FAR_FILL_FADE has already faded it to 0 by 6.5 — the crossfade hands
          off to these tiles by design. Unmounting it here left every such map
          blank past 6.5 and, via the getLayer() filter at the click handler,
          unclickable too. The hairlines are needed on stock maps as well:
          regionsOutlinePaint is gated on worldKnown, not on customActive. */}
      <Source id="regions-source" type="vector" url={regionsUrl} maxzoom={8}>
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          paint={stockRegionsFillPaint}
        />
        {/* Striped fill for disputed GADM regions on the crisp tile geometry —
            fades in with the tile fills, exactly like the color layer above. */}
        {disputedTileStops.length > 0 && (
          <Layer
            id="regions-disputed"
            type="fill"
            source-layer="regions"
            filter={["in", ["get", "GID_1"], ["literal", disputedTileStops.filter((_, i) => i % 2 === 0)]]}
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
      <Source id="custom-regions-source" type="geojson" data={enrichedCustomRegionData} tolerance={0}>
        {/* Zoomed-out fill for GADM regions from the seed geometry — the stock
            tiles are too simplified at low zoom and show sliver gaps there. */}
        <Layer
          id="custom-regions-fill-far"
          type="fill"
          maxzoom={7}
          filter={GADM_GEOMETRY_FILTER}
          paint={{ "fill-color": CUSTOM_FILL_COLOR, "fill-opacity": customActive ? FAR_FILL_FADE : 0 }}
        />
        {/* Far hairlines from the SAME seed geometry as the far fills, so
            zoomed-out region borders sit exactly on the colored areas. They
            hand off to the stock-tile hairlines with the fill crossfade. */}
        <Layer
          id="custom-regions-hairline-far"
          type="line"
          maxzoom={7}
          filter={GADM_GEOMETRY_FILTER}
          paint={{
            "line-color": "#000",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 6.5, 0.6],
            "line-opacity": customActive
              ? ["interpolate", ["linear"], ["zoom"], 3, 0.35, 5.5, 0.55, 6.5, 0]
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
          filter={["all", GADM_GEOMETRY_FILTER, ["has", "_stripes"]]}
          paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? FAR_FILL_FADE : 0 }}
        />
        <Layer
          id="custom-regions-fill"
          type="fill"
          filter={CUSTOM_GEOMETRY_FILTER}
          paint={{ "fill-color": CUSTOM_FILL_COLOR, "fill-opacity": 0.72 }}
        />
        <Layer
          id="custom-regions-disputed"
          type="fill"
          filter={["all", CUSTOM_GEOMETRY_FILTER, ["has", "_stripes"]]}
          paint={{ "fill-pattern": ["get", "_stripes"], "fill-opacity": customActive ? 0.72 : 0 }}
        />
        <Layer
          id="custom-regions-outline"
          type="line"
          filter={CUSTOM_GEOMETRY_FILTER}
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
