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
import { loadCountryLabelCollections } from "../../runtime/countryLabels.js";
import { translateLabel } from "../../runtime/translator.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";
import polygonClipping from "polygon-clipping";

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

  return [
    "interpolate", ["exponential", 2], ["zoom"],
    0, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, -16]]],
    4, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, -12]]],
    8, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, -8]]],
    12, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, -4]]],
    16, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, 0]]],
    20, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, 4]]],
    24, ["*", scale, ["*", ["get", "areaScale"], ["^", 2, 8]]],
  ];
};

const buildFallbackColorExpression = () => ([
  "rgb",
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
]);

const fallbackColorFromCode = (code = "") => {
  const normalized = String(code ?? "").toUpperCase();
  if (normalized.length < 3) {
    return "rgb(96, 96, 96)";
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[2]));
  return `rgb(${64 + a * 5}, ${64 + c * 5}, ${64 + b * 5})`;
};

// Neutral tone for unowned custom regions (land with no owner code).
const NEUTRAL_LAND_COLOR = "rgb(88, 98, 110)";

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

const CLUSTER_JOIN_DEGREES = 28; // centroids closer than this merge into one label cluster
const MIN_CLUSTER_AREA = 6; // in lng/lat degrees^2 — skips tiny extra islands

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

const buildOwnerLabelCollection = (regionsFC, overrides, polityOverrides, nameResolver) => {
  const perOwner = new Map(); // owner -> [{c:[lng,lat], area}]
  const countryNameByCode = new Map(); // gid0 -> modern country name (fallback labels)

  for (const feature of regionsFC?.features ?? []) {
    const props = feature.properties || {};
    const owner = overrides?.[props.id] ?? props.owner;
    if (props.gid0 && props.country && !countryNameByCode.has(props.gid0)) {
      countryNameByCode.set(props.gid0, props.country);
    }
    if (!owner) continue;
    const best = largestRingOf(feature.geometry);
    if (!best || best.area <= 0) continue;
    const entry = { c: ringCentroidLngLat(best.ring), area: best.area };
    if (!perOwner.has(owner)) perOwner.set(owner, []);
    perOwner.get(owner).push(entry);
  }

  const features = [];
  let id = 0;
  for (const [owner, entries] of perOwner) {
    // Greedy proximity clustering, biggest regions first so clusters seed sensibly.
    entries.sort((a, b) => b.area - a.area);
    const clusters = [];
    for (const entry of entries) {
      let best = null;
      let bestDist = Infinity;
      for (const cluster of clusters) {
        const d = Math.hypot(entry.c[0] - cluster.cx, entry.c[1] - cluster.cy);
        if (d < bestDist) {
          bestDist = d;
          best = cluster;
        }
      }
      if (best && bestDist <= CLUSTER_JOIN_DEGREES) {
        const total = best.area + entry.area;
        best.cx = (best.cx * best.area + entry.c[0] * entry.area) / total;
        best.cy = (best.cy * best.area + entry.c[1] * entry.area) / total;
        best.area = total;
      } else {
        clusters.push({ cx: entry.c[0], cy: entry.c[1], area: entry.area });
      }
    }

    mergeOwnerClusters(clusters, CLUSTER_JOIN_DEGREES);
    clusters.sort((a, b) => b.area - a.area);
    const rawName = polityOverrides?.[owner]?.name || countryNameByCode.get(owner) || owner;
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

// Union country borders ship disabled — the Settings toggle is greyed out
// ("coming soon") until the pass is production-ready. Flip the key below in
// localStorage to preview; keep it in sync with settings.jsx.
const COUNTRY_BORDERS_KEY = "country-borders-enabled";
const countryBordersEnabled = () => {
  try {
    return localStorage.getItem(COUNTRY_BORDERS_KEY) === "1";
  } catch {
    return false;
  }
};

// Era country borders (experiment, round 2): every owner's regions are
// geometrically UNIONED and the union outline is the border — continuous by
// construction even where neighbouring regions don't share vertices. Drawn
// at full strength at EVERY zoom level this time.
const computeOwnerBorderCollection = async (regionsFC, ownerById, isCancelled) => {
  const byOwner = new Map();
  for (const feature of regionsFC?.features ?? []) {
    const props = feature.properties || {};
    const id = props.id != null ? String(props.id) : "";
    // Unclaimed land is its own "owner" so its frontier is drawn too.
    const owner = (ownerById.get(id) ?? props.owner ?? "") || "~unclaimed";
    const geometry = feature.geometry;
    const polygons = geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    if (!polygons.length) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(...polygons);
  }

  // Chunked incremental union. One degenerate polygon must never poison a
  // whole owner group — that used to make the huge "unclaimed" group fall
  // back to raw per-region shapes, which drew a country-style border around
  // every single region. Broken shapes are quarantined individually.
  const unionPolygonsSafely = async (polygons, isCancelled) => {
    const CHUNK = 40;
    let merged = null;
    for (let start = 0; start < polygons.length; start += CHUNK) {
      // Yield every chunk: the incremental merge calls grow with the shape,
      // and long synchronous stretches were felt as lag.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled()) return null;
      const chunk = polygons.slice(start, start + CHUNK);
      let chunkResult = null;
      try {
        chunkResult = polygonClipping.union(...chunk);
      } catch {
        chunkResult = null;
        for (const polygon of chunk) {
          try {
            chunkResult = chunkResult
              ? polygonClipping.union(chunkResult, polygon)
              : polygonClipping.union(polygon);
          } catch {
            // Skip just this shape; a hairline hole beats broken borders.
          }
        }
      }
      if (!chunkResult?.length) continue;
      try {
        merged = merged ? polygonClipping.union(merged, chunkResult) : chunkResult;
      } catch {
        // Keep what we have rather than losing the whole owner.
      }
    }
    return merged;
  };

  const features = [];
  for (const [owner, polygons] of byOwner) {
    // Yield between owners so big maps don't freeze the UI while merging.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (isCancelled()) return null;
    const merged = await unionPolygonsSafely(polygons, isCancelled);
    if (isCancelled()) return null;
    if (merged?.length) {
      features.push({
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates: merged },
        properties: { owner },
      });
    } else if (polygons.length) {
      // Total failure for this owner: keep the raw shapes for the FILL but
      // never outline them — regions must not carry country-style borders.
      features.push({
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates: polygons },
        properties: { owner, noOutline: true },
      });
    }
  }

  return { type: "FeatureCollection", features };
};

// Procedural fallback keyed on the custom region's own "owner" property (the
// custom-geometry twin of buildFallbackColorExpression, which reads GID_0).
const buildOwnerFallbackColorExpression = () => ([
  "rgb",
  ["+", 64, ["*", ["index-of", ["slice", ["coalesce", ["get", "owner"], "ZZZ"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["coalesce", ["get", "owner"], "ZZZ"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["coalesce", ["get", "owner"], "ZZZ"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
]);

const WorldMap = ({ isGlobe = false }) => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [worldState, setWorldState] = useState({ regionOwnershipOverrides: {} });
  const mapDisplaySettings = {
    hideCountryLabels: useMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
    featureSize: useMapSetting(MAP_SETTING_KEYS.featureSize),
    borderWidth: useMapSetting(MAP_SETTING_KEYS.borderWidth),
  };
  // False until the first world.json read: before that we can't know whether
  // this game uses the stock map or a custom one, so NO political layer
  // renders — this kills the "modern world flashes, then the real map loads"
  // effect every scenario used to show.
  const [worldKnown, setWorldKnown] = useState(false);
  const [pointLabelData, setPointLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const [curvedLabelData, setCurvedLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const [customRegionData, setCustomRegionData] = useState(EMPTY_FEATURE_COLLECTION);
  const countriesUrl = PMTILES_PROTOCOL_URLS.countries;
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;
  // A map authored in the editor sets world.customRegions; that flag triggers the
  // geometry fetch. We only actually suppress the stock rendering once the custom
  // geometry has loaded, so a missing/empty payload falls back to the base map
  // instead of showing a blank world.
  const customFlag = Boolean(worldState?.customRegions);
  const customActive = customFlag && Array.isArray(customRegionData?.features) && customRegionData.features.length > 0;
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

  // Owner (polity) labels for custom maps — one label per landmass-cluster per
  // owner, named by the scenario's polity registry ("Soviet Union", not "Russia").
  // Recomputed as ownership overrides poll in, so labels follow conquests.
  const ownerLabelData = useMemo(() => {
    if (!customActive) return EMPTY_FEATURE_COLLECTION;
    return buildOwnerLabelCollection(
      customRegionData,
      worldState?.regionOwnershipOverrides ?? {},
      worldState?.polityOverrides ?? {},
      (raw, owner) => translateLabel(resolveCountryDisplayName(raw, owner)),
    );
    // labelEpoch: rebuild once new translations land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customActive, customRegionData, worldState, labelEpoch]);

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
    // Custom (editor) regions render on top of the stock regions; query both so a
    // click resolves against whichever is present. Custom features carry
    // id/owner/name/country; stock features carry GID_1/GID_0/NAME_1/COUNTRY.
    const queryLayers = ["custom-regions-fill", "regions-fill"].filter((id) => map.getLayer(id));
    const features = map.queryRenderedFeatures(event.point, { layers: queryLayers });
    if (!features.length) return;

    const props = features[0].properties ?? {};
    const regionId = props.GID_1 ?? props.id ?? "";
    // On custom maps, stock-tile hits carry modern props only — resolve the era
    // owner (possibly "" = unclaimed) from the ownership lookup.
    const owner = props.owner ?? (ownerLookupRef.current.size ? ownerLookupRef.current.get(regionId) : undefined);
    onRegionSelected({
      COUNTRY: props.COUNTRY ?? props.country ?? "",
      NAME_1: props.NAME_1 ?? props.name ?? "",
      GID_0: owner || (owner === "" ? "" : props.GID_0 ?? props.gid0 ?? ""),
      GID_1: regionId,
      // gid0 = the region's underlying real country (flag fallback when the owner
      // is a custom polity like "HRE"). owner "" flags an unclaimed region.
      gid0: props.gid0 ?? props.GID_0 ?? "",
      owner,
      lngLat: event.lngLat,
    });
  }, [map]);

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

  useEffect(() => {
    let cancelled = false;

    const loadWorldState = () => {
      readJson(JSON_URLS.world, { defaultValue: {}, force: true })
        .then((data) => {
          if (!cancelled) {
            setWorldState(data ?? {});
            // Only now do we KNOW whether this world is stock or custom —
            // nothing world-dependent renders before this (see worldKnown).
            setWorldKnown(true);
          }
        })
        .catch((error) => console.error("Error loading world state:", error));
    };

    loadWorldState();
    const interval = setInterval(loadWorldState, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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

  const fillStyle = useMemo(() => {
    const stops = Object.entries(colorMap).flatMap(([iso, rgb]) => [
      iso, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);
    const fallback = buildFallbackColorExpression();
    const regionOverrideStops = Object.entries(worldState?.regionOwnershipOverrides ?? {}).flatMap(([regionId, ownerCode]) => [
      regionId,
      colorMap[ownerCode]
        ? `rgb(${colorMap[ownerCode][0]}, ${colorMap[ownerCode][1]}, ${colorMap[ownerCode][2]})`
        : fallbackColorFromCode(ownerCode),
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
  }, [colorMap, worldState]);

  // Fill for custom (editor) regions: a live ownership override wins, else the
  // region's own owner color, else a neutral unowned tone. Keyed on the region's
  // "id"/"owner" properties and recomputed as ownership polls in.
  const customFillStyle = useMemo(() => {
    const ownerStops = Object.entries(colorMap).flatMap(([iso, rgb]) => [
      iso, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);
    const ownerFallback = buildOwnerFallbackColorExpression();
    const ownerMatch = ownerStops.length > 0
      ? ["match", ["get", "owner"], ...ownerStops, ownerFallback]
      : ownerFallback;
    const baseColor = [
      "case",
      ["==", ["coalesce", ["get", "owner"], ""], ""], NEUTRAL_LAND_COLOR,
      ownerMatch,
    ];
    const overrideStops = Object.entries(worldState?.regionOwnershipOverrides ?? {}).flatMap(([regionId, ownerCode]) => [
      regionId,
      colorMap[ownerCode]
        ? `rgb(${colorMap[ownerCode][0]}, ${colorMap[ownerCode][1]}, ${colorMap[ownerCode][2]})`
        : fallbackColorFromCode(ownerCode),
    ]);
    return {
      "fill-color": overrideStops.length > 0
        ? ["match", ["get", "id"], ...overrideStops, baseColor]
        : baseColor,
      "fill-opacity": 0.72,
    };
  }, [colorMap, worldState]);

  // Region id -> current owner (live overrides win). Drives the stock-tile fill,
  // and the click handler uses it to resolve era owner/unclaimed for the popup.
  const ownerByRegionId = useMemo(() => {
    const lookup = new Map();
    if (!customActive) return lookup;
    const overrides = worldState?.regionOwnershipOverrides ?? {};
    for (const feature of customRegionData?.features ?? []) {
      const props = feature.properties || {};
      if (!props.id) continue;
      lookup.set(props.id, overrides[props.id] ?? props.owner ?? "");
    }
    return lookup;
  }, [customActive, customRegionData, worldState]);

  const ownerLookupRef = useRef(new Map());
  useEffect(() => {
    ownerLookupRef.current = ownerByRegionId;
  }, [ownerByRegionId]);

  // Stable fingerprint of the ownership map: the world poll rebuilds
  // ownerByRegionId every 5s, but border geometry only needs recomputing
  // when an owner actually changes.
  const ownershipKey = useMemo(() => {
    if (!customActive || !countryBordersEnabled()) return "";
    let key = "";
    for (const [regionId, owner] of ownerByRegionId) key += `${regionId}:${owner};`;
    return key;
  }, [customActive, ownerByRegionId]);

  const [ownerBorderData, setOwnerBorderData] = useState(EMPTY_FEATURE_COLLECTION);
  useEffect(() => {
    if (!customActive || !countryBordersEnabled()) {
      setOwnerBorderData(EMPTY_FEATURE_COLLECTION);
      return undefined;
    }
    let cancelled = false;
    computeOwnerBorderCollection(customRegionData, ownerLookupRef.current, () => cancelled)
      .then((collection) => {
        if (!cancelled && collection) setOwnerBorderData(collection);
      })
      .catch((error) => console.error("Failed to compute era borders:", error));
    return () => {
      cancelled = true;
    };
    // ownershipKey stands in for ownerByRegionId's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customActive, customRegionData, ownershipKey]);


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
            : fallbackColorFromCode(owner)
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
    "line-width": mapDisplaySettings.borderWidth,
    "line-opacity": showStockCountries ? 1 : 0,
  };
  // Region hairlines serve both map kinds, but nothing renders pre-worldKnown.
  // Tile hairlines only fade in alongside the tile FILLS (z5.5-6.5): below
  // that the fills come from the seed geometry, and hairlines from the
  // simplified low-zoom tiles sit visibly off those fills — disconnected
  // borders. The far hairlines come from the seed geometry itself instead.
  const regionsOutlinePaint = {
    "line-color": "#000",
    // "zoom" is only valid as the direct input to a top-level step/interpolate
    // expression — it cannot be wrapped in ["*", ...]. Bake the multiplier
    // into each stop's value instead (still a plain-number expression).
    "line-width": [
      "interpolate", ["linear"], ["zoom"],
      3, 0.2 * mapDisplaySettings.borderWidth,
      8, 0.6 * mapDisplaySettings.borderWidth,
      12, 1.0 * mapDisplaySettings.borderWidth,
    ],
    "line-opacity": worldKnown
      ? ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.6, 8, 0.7]
      : 0,
  };

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(mapDisplaySettings.featureSize, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.featureSize, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(mapDisplaySettings.featureSize, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.featureSize, mapDisplaySettings.hideCountryLabels]);

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
      <Source id="countries-source" type="vector" url={countriesUrl}>
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

      <Source id="regions-source" type="vector" url={regionsUrl}>
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          paint={stockRegionsFillPaint}
        />
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
      <Source id="custom-regions-source" type="geojson" data={customRegionData} tolerance={0}>
        {/* Zoomed-out fill for GADM regions from the seed geometry — the stock
            tiles are too simplified at low zoom and show sliver gaps there. */}
        <Layer
          id="custom-regions-fill-far"
          type="fill"
          maxzoom={7}
          filter={GADM_GEOMETRY_FILTER}
          paint={{ "fill-color": customFillStyle["fill-color"], "fill-opacity": customActive ? FAR_FILL_FADE : 0 }}
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
        <Layer
          id="custom-regions-fill"
          type="fill"
          filter={CUSTOM_GEOMETRY_FILTER}
          paint={customFillStyle}
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

      {/* Era country borders: OUTLINES ONLY of the colored areas. Fills stay
          on the fast tile-painted pipeline (the union fills were the lag);
          the union geometry draws just the lines, with dynamic zoom styling —
          strong at world/mid zoom, fading out up close where the crisp
          tile-rendered region borders take over. */}
      <Source id="owner-zones-source" type="geojson" data={ownerBorderData}>
        <Layer
          id="owner-borders"
          type="line"
          filter={["!=", ["coalesce", ["get", "noOutline"], false], true]}
          paint={{
            "line-color": "#000",
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.9, 6, 1.6],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.85, 7, 0.85, 8.5, 0],
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
