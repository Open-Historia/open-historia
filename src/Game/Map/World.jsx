/*! Open Historia — portions (troop system integration + globe sun/stars) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map from "react-map-gl/maplibre";
import { useCustomBackground } from "./useCustomBackground.js";
import MapScene from "./MapScene.jsx";

import { recordMapFreeze, recordMapTrace } from "../../runtime/mapPerfTrace.js";
import {
  DEFAULT_BASEMAP_ID,
  TERRAIN_TILE_TEMPLATE,
  basemapMaxZoom,
  basemapProtocolTemplate,
  buildBasemapRenderKey,
  ensureBasemapProtocol,
  isBuiltinBasemapId,
  resolveBasemapId,
} from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSetting, useMapSettingValue } from "../../runtime/mapSettings.js";
import { markMapIdle } from "../../runtime/mapReadiness.js";

// The high-res source goes through the ohbase protocol so ESRI's "Map Data
// Not Yet Available" placeholders get replaced with upscaled ancestor tiles.
ensureBasemapProtocol();

// Grading applied to whichever ESRI basemap is picked: cap brightness so it
// sits against the dark UI, with a little desaturation/contrast that suits both
// the satellite imagery and the paler cartographic styles.
const SATELLITE_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  // Keep the basemap as subdued geographic context. Political colour, borders,
  // cities and labels should read first at normal strategy-map zooms.
  "raster-saturation": -0.08,
  "raster-contrast": 0.02,
  "raster-brightness-min": 0.04,
  "raster-brightness-max": 0.72,
};

const ATLAS_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  // Preserve the ocean/terrain material in Map vNext. Political colour is now
  // translucent and relief is re-lit above it, so crushing this raster into the
  // old near-black range only makes the world look dead.
  "raster-saturation": 0.08,
  "raster-contrast": 0.20,
  "raster-brightness-min": 0.05,
  "raster-brightness-max": 0.98,
};

// The low-zoom Pax-style foundation is a dedicated global topography +
// bathymetry raster from NOAA/NCEI (ETOPO1). It is label-free, so it cannot
// fight the map's live polity typography. A dark grade keeps it contextual
// while preserving substantially more seabed/relief structure than the old
// nearly-black far-zoom atlas.
const PAX_WORLD_RELIEF_TILES =
  "https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/" +
  "ETOPO1_Global_Relief_Model_Color_Shaded_Relief/MapServer/tile/{z}/{y}/{x}";

const PAX_WORLD_RELIEF_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  "raster-saturation": -0.26,
  "raster-contrast": 0.36,
  "raster-brightness-min": 0.015,
  "raster-brightness-max": 0.68,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 1,
    3.0, 1,
    // R5.4.1: keep the fixed z3 relief only where it is genuinely sharp.
    // Fade it BEFORE overzoom pixels become visible; detailed World Terrain
    // Base takes over through the same regional band.
    3.50, 0.78,
    4.00, 0.42,
    4.45, 0.16,
    4.85, 0,
  ],
};

// World Terrain Base takes over as the player approaches regional/local zoom.
// Crossfading instead of hard-switching avoids the visible material flash that
// the old basemap handoff produced.
const PAX_TERRAIN_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  // R21: World Terrain Base is substantially greyer than the global ETOPO
  // material. Preserve its fine regional detail, but stop it bleaching the
  // physical map as it takes over.
  "raster-saturation": 0.18,
  "raster-contrast": 0.38,
  "raster-brightness-min": 0.025,
  "raster-brightness-max": 0.92,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 0,
    2.75, 0.04,
    3.20, 0.18,
    3.65, 0.52,
    4.10, 0.78,
    4.60, 0.90,
    7.0, 0.92,
    12, 0.92,
  ],
};
// R15: genuinely dark physical variants.
// R12 added the ids to the basemap registry, but R14 was based on the R11
// World.jsx and accidentally dropped their special rendering path. As a result,
// selecting a "Dark" option fell through to the normal bright atlas grade.
const PAX_WORLD_RELIEF_OCEAN_DARK_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  // The source has a strong cyan/green cast. Rotate it toward blue while
  // retaining more chroma than R16 so the regional handoff keeps the ocean
  // physically alive instead of collapsing toward grey.
  "raster-hue-rotate": 34,
  "raster-saturation": -0.34,
  "raster-contrast": 0.64,
  "raster-brightness-min": 0.0,
  "raster-brightness-max": 0.30,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 0.86,
    3.0, 0.86,
    3.50, 0.68,
    4.00, 0.36,
    4.45, 0.14,
    4.85, 0,
  ],
};

const PAX_TERRAIN_OCEAN_DARK_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  "raster-hue-rotate": 34,
  // R21: the close ESRI source was being desaturated twice: once by its own
  // muted material and again by this grade. Restore colour while keeping the
  // deep-night Ocean Dark character.
  "raster-saturation": 0.06,
  "raster-contrast": 0.62,
  "raster-brightness-min": 0.0,
  "raster-brightness-max": 0.39,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 0,
    2.75, 0.03,
    3.20, 0.14,
    3.65, 0.38,
    4.10, 0.58,
    4.60, 0.67,
    7.0, 0.68,
    12, 0.68,
  ],
};

const PAX_WORLD_RELIEF_ATLAS_DARK_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  "raster-saturation": -0.82,
  "raster-contrast": 0.68,
  "raster-brightness-min": 0.0,
  "raster-brightness-max": 0.22,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 0.82,
    3.0, 0.82,
    3.50, 0.62,
    4.00, 0.30,
    4.45, 0.10,
    4.85, 0,
  ],
};

const PAX_TERRAIN_ATLAS_DARK_PAINT = {
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
  "raster-saturation": -0.80,
  "raster-contrast": 0.70,
  "raster-brightness-min": 0.0,
  "raster-brightness-max": 0.27,
  "raster-opacity": [
    "interpolate", ["linear"], ["zoom"],
    0, 0,
    2.75, 0.04,
    3.20, 0.16,
    3.65, 0.42,
    4.10, 0.60,
    4.60, 0.66,
    12, 0.66,
  ],
};

const getPaxReliefPaints = (basemapId) => {
  if (basemapId === "ocean-dark") {
    return {
      world: PAX_WORLD_RELIEF_OCEAN_DARK_PAINT,
      terrain: PAX_TERRAIN_OCEAN_DARK_PAINT,
    };
  }
  if (basemapId === "atlas-relief-dark") {
    return {
      world: PAX_WORLD_RELIEF_ATLAS_DARK_PAINT,
      terrain: PAX_TERRAIN_ATLAS_DARK_PAINT,
    };
  }
  return {
    world: PAX_WORLD_RELIEF_PAINT,
    terrain: PAX_TERRAIN_PAINT,
  };
};
// Full-map image corners (TL, TR, BR, BL). The flat mercator map only reaches
// ±85.0511° (the projection limit), but the globe shows all the way to the poles
// — so on the globe the image stretches nearly to ±90° to cover the pole caps.
// NOT exactly ±90: mercatorYfromLat(±90) is ±Infinity, which makes MapLibre's
// ImageSource.setCoordinates throw — so we stop a hair short (the custom-bg-base
// layer fills the negligible remaining sliver).
const WORLD_IMAGE_COORDS_FLAT = [
  [-180, 85.0511],
  [180, 85.0511],
  [180, -85.0511],
  [-180, -85.0511],
];
const WORLD_IMAGE_COORDS_GLOBE = [
  [-180, 89.9],
  [180, 89.9],
  [180, -89.9],
  [-180, -89.9],
];

const buildWorldStyle = (basemapId, customBg, backgroundDeclared, isGlobe, terrainEnabled, legacy = false) => {
  // A custom uploaded map replaces the ESRI basemap entirely — no satellite or
  // terrain tiles load at all (saves those requests), the uploaded map is the
  // base layer, and the regions/labels from <Nations> paint on top of it.
  if (customBg?.kind === "image" && customBg.imageUrl) {
    return {
      version: 8,
      sources: {
        "custom-bg": {
          type: "image",
          url: customBg.imageUrl,
          coordinates: isGlobe ? WORLD_IMAGE_COORDS_GLOBE : WORLD_IMAGE_COORDS_FLAT,
        },
      },
      layers: [
        // Solid base beneath the image so no edge/pole ever shows a transparent hole.
        { id: "custom-bg-base", type: "background", paint: { "background-color": "#0b1a2b" } },
        { id: "custom-bg-layer", type: "raster", source: "custom-bg", paint: { "raster-fade-duration": 0 } },
      ],
      sky: { "atmosphere-blend": 0 },
    };
  }
  if (customBg?.kind === "vector" && customBg.geojson) {
    return {
      version: 8,
      sources: { "custom-bg-vec": { type: "geojson", data: customBg.geojson } },
      layers: [
        { id: "custom-bg-sea", type: "background", paint: { "background-color": "#0b1a2b" } },
        // A fill layer only draws (Multi)Polygons, so no geometry-type filter is
        // needed — and the old "Polygon"-only filter silently dropped the dissolved
        // MultiPolygon biomes, so the basemap rendered nothing. Each feature carries
        // its own biome colour in `fill`.
        { id: "custom-bg-fill", type: "fill", source: "custom-bg-vec", paint: { "fill-color": ["coalesce", ["get", "fill"], "#33435c"] } },
        { id: "custom-bg-line", type: "line", source: "custom-bg-vec", paint: { "line-color": "rgba(0,0,0,0.18)", "line-width": 0.4 } },
      ],
      sky: { "atmosphere-blend": 0 },
    };
  }
  // A background is declared but its payload hasn't loaded yet — show a neutral
  // placeholder (no ESRI/terrain sources) so a custom-map game never flashes
  // satellite Earth or fires basemap tile requests it won't use.
  if (backgroundDeclared) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: "custom-bg-loading", type: "background", paint: { "background-color": "#0b1a2b" } }],
      sky: { "atmosphere-blend": 0 },
    };
  }
  // The scenario's basemap is the basemap, at every zoom. Only the two "Atlas
  // Relief" presets are a composed look of their own (ETOPO global relief fading
  // into World Terrain Base); every other id renders the ESRI service it names.
  // The renderer used to swap Ocean and a scenario-default Dark Gray for that
  // relief composition too, so a map authored on Ocean or Dark Gray opened on a
  // satellite-looking globe and only showed its real basemap once the relief
  // had faded out around z5.
  // The legacy renderer predates the relief presets and the atlas paint: it drew
  // the basemap raster with SATELLITE_PAINT at whatever id was asked for. Those
  // are the basemap half of its look, so the switch has to reach here as well as
  // MapScene - a legacy map under vNext's relief material is not the old map.
  const usePaxRelief = !legacy && (basemapId === "atlas-relief" || basemapId === "atlas-relief-dark");
  const paxReliefPaints = getPaxReliefPaints(basemapId);
  const basemapPaint = legacy
    ? SATELLITE_PAINT
    : usePaxRelief
      ? paxReliefPaints.terrain
      : basemapId === "imagery" ? SATELLITE_PAINT : ATLAS_PAINT;
  // World_Ocean_Base bakes political names into the raster, while plain shaded
  // relief loses the ocean/bathymetry material that gives Pax-like maps depth.
  // World Terrain Base is the useful middle ground for the relief presets:
  // label-free shaded land relief + bathymetry + coastal water context.
  const renderedBasemapId = usePaxRelief ? "terrain" : basemapId;
  const darkPhysicalVariant = basemapId === "ocean-dark" || basemapId === "atlas-relief-dark";
  const physicalBackground = darkPhysicalVariant
    ? (basemapId === "ocean-dark" ? "#030a14" : "#050609")
    : "#0b1017";

  const style = {
    version: 8,
    sources: {
      ...(usePaxRelief ? {
        "pax-world-relief": {
          type: "raster",
          tiles: [PAX_WORLD_RELIEF_TILES],
          tileSize: 256,
          // R5.4: fixed-resolution relief material. Load ETOPO only through z3;
          // MapLibre overzooms those already-loaded tiles at higher camera zooms.
          // This keeps the global physical/bathymetry texture but prevents the
          // relief source from climbing a new z4/z5/z6 tile pyramid while the
          // player is actively navigating.
          maxzoom: 3,
          attribution: "Relief: NOAA/NCEI ETOPO1",
        },
      } : {}),
      satellite: {
        type: "raster",
        tiles: [basemapProtocolTemplate(renderedBasemapId)],
        tileSize: 256,
        maxzoom: basemapMaxZoom(renderedBasemapId),
      },
    },
    layers: [
      {
        id: "strategy-map-base",
        type: "background",
        paint: { "background-color": physicalBackground },
      },
      {
        id: "satellite-layer",
        type: "raster",
        source: "satellite",
        paint: basemapPaint,
      },
      // R22: keep the detailed ESRI terrain as the regional foundation, then
      // glaze the fading ETOPO colour/bathymetry material above it. Previously
      // ETOPO sat underneath an almost-opaque terrain layer, so only a few percent
      // of its colour survived at the Europe/Poland zoom band.
      ...(usePaxRelief ? [{
        id: "pax-world-relief-layer",
        type: "raster",
        source: "pax-world-relief",
        paint: paxReliefPaints.world,
      }] : []),
      // Do not paint the DEM as a second hillshade pass here. The old DEM overlay
      // produced a rectangular veil at whole-world zoom. Terrain Base supplies the
      // always-on 2D relief/bathymetry; the DEM remains available for optional 3D.
    ],
    // MapLibre's uniform atmosphere is off; GlobeEffects supplies directional
    // surface light instead. Transparent space lets the stars and sun show.
    sky: {
      "atmosphere-blend": 0,
    },
  };

  // Only add the DEM source and hillshade layer when 3D terrain is enabled.
  // This is the same raster-dem source used for the MapLibre `terrain` property
  // on <Map> below (see the `terrain` memo) — the hillshade layer here is what
  // renders the lit relief; the `terrain` property is what deforms the mesh.
  if (terrainEnabled) {
    style.sources["terrain-source"] = {
      type: "raster-dem",
      tiles: [TERRAIN_TILE_TEMPLATE],
      encoding: "terrarium",
      maxzoom: 5,
      tileSize: 256,
    };

    style.layers.push({
      id: "hills",
      type: "hillshade",
      source: "terrain-source",
      paint: {
        "hillshade-exaggeration": 0.1,
        "hillshade-shadow-color": "#000",
      },
    });
  }

  return style;
};

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const loadTimerRef = useRef(null);
  const mapMountedAtRef = useRef(0);
  // Taken in an effect rather than during render: a clock read in render is
  // impure, and this value is only ever compared against later clock reads
  // from the map's own event handlers.
  useEffect(() => {
    if (!mapMountedAtRef.current) {
      mapMountedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
  }, []);
  const sourceReadyRef = useRef(new globalThis.Map());
  const dragPerfRef = useRef({
    active: false,
    startedAt: 0,
    lastFrameAt: 0,
    frameDeltas: [],
    raf: 0,
    sourceEvents: 0,
    sourceLoads: 0,
    sourceLoaded: 0,
    dataEvents: 0,
    styleEvents: 0,
    styleLoadingEvents: 0,
    webglLosses: 0,
    renders: 0,
    idles: 0,
    zoomStarts: 0,
    zoomEnds: 0,
  });
  const viewStateRef = useRef({
    longitude: 0,
    latitude: 0,
    zoom: 3.5,
    bearing: 0,
    pitch: 0,
  });
  // A custom uploaded map (image or vector) replaces the ESRI basemap; otherwise
  // the scenario's basemap does, unless the player picked one in Settings → Map.
  // `declared` flips on from the light world.json poll (before the heavy payload)
  // so the map drops ESRI immediately rather than flashing satellite Earth.
  const { background: customBg, declared: bgDeclared, basemap: worldBasemap } = useCustomBackground();
  const isGlobe = projection === "globe";
  // The player's basemap pick (Settings → Map) is local to this browser and
  // reversible. Empty — the default — leaves the scenario author's background
  // and basemap authoritative; only a real built-in id replaces them, so a
  // stray value left in localStorage by an older build changes nothing.
  // Which renderer MapScene will mount. World only needs it for the basemap
  // material above; everything else about the choice lives in MapScene.
  const legacyRenderer = useMapSetting(MAP_SETTING_KEYS.legacyMapRenderer);
  const basemapOverride = useMapSettingValue(MAP_SETTING_KEYS.basemapStyle);
  const validBasemapOverride = isBuiltinBasemapId(basemapOverride) ? basemapOverride : "";
  const useScenarioBackground = !validBasemapOverride;
  const effectiveCustomBg = useScenarioBackground ? customBg : null;
  const effectiveBgDeclared = useScenarioBackground ? bgDeclared : false;
  const effectiveBasemap = resolveBasemapId({
    overrideId: validBasemapOverride,
    scenarioId: worldBasemap,
    fallbackId: DEFAULT_BASEMAP_ID,
  });
  const mapProjection = useMemo(() => ({ type: projection }), [projection]);
  const styleUsesGlobeCoords = effectiveCustomBg?.kind === "image" && isGlobe;
  const worldStyle = useMemo(
    () => buildWorldStyle(
      effectiveBasemap,
      effectiveCustomBg,
      effectiveBgDeclared,
      styleUsesGlobeCoords,
      terrainEnabled,
      legacyRenderer,
    ),
    [
      effectiveBasemap,
      effectiveBgDeclared,
      effectiveCustomBg,
      styleUsesGlobeCoords,
      terrainEnabled,
      legacyRenderer,
    ],
  );
  const mapInstanceKey = buildBasemapRenderKey({
    projection,
    basemapId: effectiveBasemap,
    backgroundKind: effectiveBgDeclared ? effectiveCustomBg?.kind || "declared" : "builtin",
  });
  // 3D terrain deforms the mesh using the same raster-dem source that drives
  // the "hills" hillshade layer in buildWorldStyle. It only applies against the
  // real ESRI/NOAA basemap — a custom uploaded image or vector background has
  // no DEM data to deform against, so terrain stays off in those cases even if
  // the player has the setting enabled.
  const terrain = useMemo(
    () =>
      terrainEnabled && !effectiveCustomBg && !effectiveBgDeclared
        ? {
            source: "terrain-source",
            exaggeration: 15,
          }
        : null,
    [terrainEnabled, effectiveCustomBg, effectiveBgDeclared],
  );
  // R5.1: use one renderer density for the entire session.
  // R5.0 switched between 1x and native DPR around z4.5/z5.0.
  // MapLibre setPixelRatio() rebuilds its render targets, producing a
  // catastrophic hitch exactly when the player zooms through that boundary.
  // The low-zoom live test showed the 1x framebuffer performs well, so keep it
  // fixed instead of reallocating the renderer during navigation.
  const fixedPixelRatioAppliedRef = useRef(false);
  const applyFixedPixelRatio = useCallback(() => {
    if (fixedPixelRatioAppliedRef.current) return;
    const mapInstance = mapRef?.current?.getMap?.();
    if (!mapInstance || typeof mapInstance.setPixelRatio !== "function") return;
    fixedPixelRatioAppliedRef.current = true;
    mapInstance.setPixelRatio(1);
  }, [mapRef]);

  const emitMapMotion = useCallback((active) => {
    if (typeof window === "undefined") return;
    const moving = Boolean(active);
    window.__OH_MAP_MOVING__ = moving;
    window.dispatchEvent(new CustomEvent("oh:map-motion", {
      detail: { active: moving },
    }));
  }, []);
  const handleMoveStart = useCallback(() => {
    emitMapMotion(true);
    const perf = dragPerfRef.current;
    if (perf.raf) cancelAnimationFrame(perf.raf);
    perf.active = true;
    perf.startedAt = performance.now();
    perf.lastFrameAt = perf.startedAt;
    perf.frameDeltas = [];
    perf.sourceEvents = 0;
    perf.sourceLoads = 0;
    perf.sourceLoaded = 0;
    perf.dataEvents = 0;
    perf.styleEvents = 0;
    perf.styleLoadingEvents = 0;
    perf.webglLosses = 0;
    perf.renders = 0;
    perf.idles = 0;
    perf.zoomStarts = 0;
    perf.zoomEnds = 0;
    recordMapTrace("camera:move-start", {
      zoom: mapRef?.current?.getMap?.()?.getZoom?.() ?? viewStateRef.current?.zoom ?? 0,
    });
    const sample = (now) => {
      if (!perf.active) return;
      const delta = now - perf.lastFrameAt;
      perf.lastFrameAt = now;
      if (delta > 0 && perf.frameDeltas.length < 1200) perf.frameDeltas.push(delta);
      if (delta >= 100) {
        recordMapFreeze({
          deltaMs: delta,
          map: mapRef?.current?.getMap?.(),
          counters: {
            sourceEvents: perf.sourceEvents,
            sourceLoads: perf.sourceLoads,
            sourceLoaded: perf.sourceLoaded,
            dataEvents: perf.dataEvents,
            styleEvents: perf.styleEvents,
            styleLoadingEvents: perf.styleLoadingEvents,
            webglLosses: perf.webglLosses,
            renders: perf.renders,
            idles: perf.idles,
            zoomStarts: perf.zoomStarts,
            zoomEnds: perf.zoomEnds,
          },
        });
      }
      perf.raf = requestAnimationFrame(sample);
    };
    perf.raf = requestAnimationFrame(sample);
  }, [emitMapMotion]);
  const handleMove = useCallback(({ viewState }) => {
    viewStateRef.current = viewState;
  }, []);
  const handleMoveEnd = useCallback(() => {
    emitMapMotion(false);
    const perf = dragPerfRef.current;
    if (!perf.active) return;
    perf.active = false;
    if (perf.raf) cancelAnimationFrame(perf.raf);
    perf.raf = 0;
    const endedAt = performance.now();
    const deltas = perf.frameDeltas.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const percentile = (ratio) => {
      if (!deltas.length) return 0;
      return deltas[Math.min(deltas.length - 1, Math.floor((deltas.length - 1) * ratio))];
    };
    const durationMs = Math.max(0, endedAt - perf.startedAt);
    const averageFrameMs = deltas.length
      ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      : 0;
    const summary = {
      version: "R5.3",
      durationMs: Math.round(durationMs * 10) / 10,
      sampledFrames: deltas.length,
      averageFps: averageFrameMs > 0 ? Math.round((1000 / averageFrameMs) * 10) / 10 : 0,
      p50FrameMs: Math.round(percentile(0.50) * 10) / 10,
      p95FrameMs: Math.round(percentile(0.95) * 10) / 10,
      p99FrameMs: Math.round(percentile(0.99) * 10) / 10,
      maxFrameMs: Math.round((deltas[deltas.length - 1] || 0) * 10) / 10,
      longFrames50ms: deltas.filter((value) => value >= 50).length,
      longFrames100ms: deltas.filter((value) => value >= 100).length,
      sourceReadyMs: Object.fromEntries(sourceReadyRef.current),
      sourceWorker: globalThis.__OH_MAP_SOURCE_PERF__ ?? {},
      sourceEventsDuringMove: perf.sourceEvents,
      sourceLoadsDuringMove: perf.sourceLoads,
      sourceLoadedDuringMove: perf.sourceLoaded,
      dataEventsDuringMove: perf.dataEvents,
      styleEventsDuringMove: perf.styleEvents,
      styleLoadingEventsDuringMove: perf.styleLoadingEvents,
      webglLossesDuringMove: perf.webglLosses,
      rendersDuringMove: perf.renders,
      idlesDuringMove: perf.idles,
      zoomStartsDuringMove: perf.zoomStarts,
      zoomEndsDuringMove: perf.zoomEnds,
    };
    globalThis.__OH_LAST_MAP_PERF__ = summary;
    recordMapTrace("camera:move-end", {
      durationMs: summary.durationMs,
      averageFps: summary.averageFps,
      maxFrameMs: summary.maxFrameMs,
      sourceEvents: summary.sourceEventsDuringMove,
      styleEvents: summary.styleEventsDuringMove,
    });
    console.info(
      `[OH MAP PERF R5.3] ${summary.averageFps} fps avg; `
      + `p95 ${summary.p95FrameMs}ms; max ${summary.maxFrameMs}ms; `
      + `${summary.longFrames100ms} frame(s) >=100ms. Full object: window.__OH_LAST_MAP_PERF__`,
    );
  }, [emitMapMotion]);
  const handleSourceData = useCallback((event) => {
    const sourceId = String(event?.sourceId ?? event?.source?.id ?? "");
    if (!sourceId) return;
    recordMapTrace("map:sourcedata", {
      sourceId,
      sourceDataType: event?.sourceDataType ?? "",
      loaded: event?.isSourceLoaded === true,
    });
    if (sourceReadyRef.current.has(sourceId) || event?.isSourceLoaded !== true) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    sourceReadyRef.current.set(sourceId, Math.round((now - mapMountedAtRef.current) * 10) / 10);
  }, []);
  const handleIdle = useCallback(() => {
    recordMapTrace("map:idle");
    // Every idle, not only the first: the loading screen a game opens under
    // waits for the one that follows the polity layers (mapReadiness.js).
    markMapIdle();
    emitMapMotion(false);
    applyFixedPixelRatio();
    if (hasReportedInitialIdleRef.current) return;
    hasReportedInitialIdleRef.current = true;
    onInitialIdle?.();
    setLoading(false);
  }, [applyFixedPixelRatio, emitMapMotion, onInitialIdle]);
  const handleLoading = useCallback(() => {
    recordMapTrace("map:loading");
    setLoading(true);
    clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => setLoading(false), 8000);
  }, []);

  React.useEffect(() => () => {
    emitMapMotion(false);
    const perf = dragPerfRef.current;
    perf.active = false;
    if (perf.raf) cancelAnimationFrame(perf.raf);
    perf.raf = 0;
  }, [emitMapMotion]);

  React.useEffect(() => {
    fixedPixelRatioAppliedRef.current = false;
    let disposed = false;
    let frame = 0;
    let canvas = null;
    let mapInstance = null;

    const attach = () => {
      if (disposed) return;
      mapInstance = mapRef?.current?.getMap?.() || null;
      canvas = mapInstance?.getCanvas?.() || null;
      if (!canvas || !mapInstance) {
        frame = requestAnimationFrame(attach);
        return;
      }

      const perf = dragPerfRef.current;
      const noteSource = (event) => {
        if (perf.active) {
          perf.sourceEvents += 1;
          if (event?.sourceDataType === "content" || event?.sourceDataType === "metadata") {
            perf.sourceLoads += 1;
          }
          if (event?.isSourceLoaded === true) perf.sourceLoaded += 1;
        }
        const sourceId = String(event?.sourceId ?? "");
        if (sourceId) {
          recordMapTrace("map:source-event", {
            sourceId,
            sourceDataType: event?.sourceDataType ?? "",
            loaded: event?.isSourceLoaded === true,
          });
        }
      };
      const noteData = () => {
        if (perf.active) perf.dataEvents += 1;
      };
      const noteStyle = () => {
        if (perf.active) perf.styleEvents += 1;
        recordMapTrace("map:styledata");
      };
      const noteStyleLoading = () => {
        if (perf.active) perf.styleLoadingEvents += 1;
        recordMapTrace("map:styledataloading");
      };
      const noteRender = () => {
        if (perf.active) perf.renders += 1;
      };
      const noteIdle = () => {
        if (perf.active) perf.idles += 1;
        recordMapTrace("map:idle-event");
      };
      const noteZoomStart = () => {
        if (perf.active) perf.zoomStarts += 1;
        recordMapTrace("camera:zoom-start", { zoom: mapInstance.getZoom?.() ?? 0 });
      };
      const noteZoomEnd = () => {
        if (perf.active) perf.zoomEnds += 1;
        recordMapTrace("camera:zoom-end", { zoom: mapInstance.getZoom?.() ?? 0 });
      };
      const onLost = (event) => {
        if (perf.active) perf.webglLosses += 1;
        recordMapTrace("gpu:webgl-lost", { status: event?.statusMessage ?? "" });
        console.warn(
          `[OH PERF GPU] WebGL context lost${event?.statusMessage ? ` · ${event.statusMessage}` : ""}`,
        );
      };
      const onRestored = () => {
        recordMapTrace("gpu:webgl-restored");
        console.warn("[OH PERF GPU] WebGL context restored");
      };

      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
      mapInstance.on?.("sourcedata", noteSource);
      mapInstance.on?.("data", noteData);
      mapInstance.on?.("styledata", noteStyle);
      mapInstance.on?.("styledataloading", noteStyleLoading);
      mapInstance.on?.("render", noteRender);
      mapInstance.on?.("idle", noteIdle);
      mapInstance.on?.("zoomstart", noteZoomStart);
      mapInstance.on?.("zoomend", noteZoomEnd);

      recordMapTrace("map:instrumentation-attached");

      canvas.__ohPerfGpuCleanup = () => {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        mapInstance?.off?.("sourcedata", noteSource);
        mapInstance?.off?.("data", noteData);
        mapInstance?.off?.("styledata", noteStyle);
        mapInstance?.off?.("styledataloading", noteStyleLoading);
        mapInstance?.off?.("render", noteRender);
        mapInstance?.off?.("idle", noteIdle);
        mapInstance?.off?.("zoomstart", noteZoomStart);
        mapInstance?.off?.("zoomend", noteZoomEnd);
      };
    };

    attach();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      canvas?.__ohPerfGpuCleanup?.();
      if (canvas) delete canvas.__ohPerfGpuCleanup;
    };
  }, [mapRef, projection]);


  return (
    // Stars and the single projected sun sit behind the transparent MapLibre
    // canvas, so the globe itself provides correct sun occlusion.
    <div
      id="oh-globe-space"
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: isGlobe ? "#000" : "#0b1017",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isGlobe && (
        <canvas
          id="oh-globe-stars"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      )}
      {isGlobe && (
        <div
          id="oh-globe-sun"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 88,
            height: 88,
            borderRadius: "50%",
            pointerEvents: "none",
            opacity: 0,
            background: "radial-gradient(circle, #fff 0 7%, #fff6cf 8% 12%, rgba(255,219,142,0.8) 15%, rgba(255,185,93,0.26) 31%, rgba(255,154,65,0.07) 52%, transparent 72%)",
            filter: "drop-shadow(0 0 12px rgba(255,218,145,0.75))",
            willChange: "transform, opacity, filter",
          }}
        />
      )}
      <Map
        key={mapInstanceKey}
        ref={mapRef}
        initialViewState={viewStateRef.current}
        minZoom={2.25}
        maxZoom={16}
        doubleClickZoom={false}
        maxBounds={[
          [-Infinity, -80],
          [Infinity, 85],
        ]}
        cursor="default"
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        dragPan
        fadeDuration={0}
        collectResourceTiming={false}
        // R5.0 keeps the original cross-source collision policy for visual fidelity.
        // The performance win comes from collapsing the country-label layer fanout,
        // not from allowing city/country labels to overlap while the camera moves.
        crossSourceCollisions={true}
        renderWorldCopies
        // Cap MapLibre's per-source out-of-view tile-retention cache. Left unset it
        // sizes dynamically to ~(ceil(w/tileSize)+1)*(ceil(h/tileSize)+1)*5 tiles PER
        // source — ~270 at 1080p but ~800 at a 3840x2160 desktop viewport, and
        // renderWorldCopies feeds successive wrapped world-copy tiles into it as you
        // pan E/W, so retained GPU textures climb until the tab OOMs. 256 caps the 4K
        // case ~3x while barely trimming 1080p, and is a no-op on phone-sized viewports
        // (dynamic size there is well under 256). In-view tiles live in a separate
        // structure and are never evicted by this, so it never re-fetches what's on
        // screen. Orthogonal to the fixed R5.1 framebuffer density.
        maxTileCacheSize={256}
        projection={mapProjection}
        terrain={terrain}
        mapStyle={worldStyle}
        onIdle={handleIdle}
        onLoading={handleLoading}
        onMoveStart={handleMoveStart}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onSourceData={handleSourceData}
      >
        <MapScene isGlobe={isGlobe} />
      </Map>
      {isGlobe && (
        <canvas
          id="oh-globe-lighting"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      )}
      {loading && (
        <div style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 5,
          background: "rgba(0,0,0,0.6)",
          color: "#aab",
          padding: "6px 14px",
          borderRadius: 20,
          fontSize: 13,
          pointerEvents: "none",
          transition: "opacity 0.3s",
          backdropFilter: "blur(4px)",
        }}>
          Loading tiles…
        </div>
      )}
    </div>
  );
}

export default World;
