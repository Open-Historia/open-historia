/*! Open Historia — portions (troop system integration + globe sun/stars) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useMemo, useRef, useState } from "react";
import Map from "react-map-gl/maplibre";
import LayerOrder from "./LayerOrder.jsx";
import Nations from "./Nations";
import { useCustomBackground } from "./useCustomBackground.js";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import Cities from "./Cities";
import Units from "./Units";
import UnitPopup from "../Selection/Units";
import MarkersLayer from "./MarkersLayer.jsx";
import FeaturePopup from "../Selection/Features.jsx";
import {
  DEFAULT_BASEMAP_ID,
  TERRAIN_TILE_TEMPLATE,
  basemapMaxZoom,
  basemapProtocolTemplate,
  ensureBasemapProtocol,
  esriTileTemplate,
} from "../../runtime/assets.js";

// The high-res source goes through the ohbase protocol so ESRI's "Map Data
// Not Yet Available" placeholders get replaced with upscaled ancestor tiles.
ensureBasemapProtocol();

// Grading applied to whichever ESRI basemap is picked: cap brightness so it
// sits against the dark UI, with a little desaturation/contrast that suits both
// the satellite imagery and the paler cartographic styles.
const SATELLITE_PAINT = {
  "raster-resampling": "linear",
  "raster-saturation": -0.15,
  "raster-contrast": 0.08,
  "raster-brightness-min": 0.02,
  "raster-brightness-max": 0.78,
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

// Terrain relief is dramatic from orbit and ruinous up close, and MapLibre takes
// a single exaggeration number (no zoom expression), so it is retuned per frame
// from this curve: [zoom, exaggeration], linearly interpolated, flat outside the
// ends. The taper is set so the exaggerated relief stays a small fraction of the
// camera's altitude at every zoom — see applyTerrainExaggeration.
const TERRAIN_EXAGGERATION_STOPS = [
  [4, 15],
  [6, 9],
  [8, 4],
  [10, 1.6],
  [12, 0.8],
];

const terrainExaggerationForZoom = (zoom) => {
  const stops = TERRAIN_EXAGGERATION_STOPS;
  if (!Number.isFinite(zoom) || zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [z0, e0] = stops[i - 1];
    const [z1, e1] = stops[i];
    if (zoom <= z1) return e0 + ((e1 - e0) * (zoom - z0)) / (z1 - z0);
  }
  return stops[stops.length - 1][1];
};

const buildWorldStyle = (basemapId, customBg, backgroundDeclared, isGlobe, terrainEnabled) => {
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
  const style = {
  version: 8,
  sources: {
    "satellite-lowres": {
      type: "raster",
      // Levels 0-2 always have real data — no placeholder handling needed.
      tiles: [esriTileTemplate(basemapId)],
      tileSize: 256,
      maxzoom: 2,
    },
    satellite: {
      type: "raster",
      tiles: [basemapProtocolTemplate(basemapId)],
      tileSize: 256,
      maxzoom: basemapMaxZoom(basemapId),
    },
  },
  layers: [
    {
      id: "satellite-lowres-layer",
      type: "raster",
      source: "satellite-lowres",
      paint: SATELLITE_PAINT,
    },
    {
      id: "satellite-layer",
      type: "raster",
      source: "satellite",
      paint: SATELLITE_PAINT,
    },
  ],
  // MapLibre's uniform atmosphere is off; GlobeEffects supplies directional
  // surface light instead. Transparent space lets the stars and sun show.
  sky: {
    "atmosphere-blend": 0,
  },
  };

  // Only include DEM source and hillshade layer if terrain is enabled
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

  return style
};

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const loadTimerRef = useRef(null);
  const viewStateRef = useRef({
    longitude: 0,
    latitude: 0,
    zoom: 3.5,
    bearing: 0,
    pitch: 0,
  });
  // A custom uploaded map (image or vector) replaces the ESRI basemap; otherwise
  // the world is fixed to the ocean preset (the in-game basemap picker was removed).
  // `declared` flips on from the light world.json poll (before the heavy payload)
  // so the map drops ESRI immediately rather than flashing satellite Earth.
  const { background: customBg, declared: bgDeclared, basemap: worldBasemap } = useCustomBackground();
  const isGlobe = projection === "globe";
  const mapProjection = useMemo(() => ({ type: projection }), [projection]);
  const styleUsesGlobeCoords = customBg?.kind === "image" && isGlobe;
  const worldStyle = useMemo(
    () => buildWorldStyle(worldBasemap || DEFAULT_BASEMAP_ID, customBg, bgDeclared, styleUsesGlobeCoords, terrainEnabled),
                             [customBg, bgDeclared, styleUsesGlobeCoords, worldBasemap, terrainEnabled],
  );
  // Exaggeration is seeded for wherever the camera currently sits;
  // applyTerrainExaggeration keeps it tracking the zoom from there.
  const terrain = useMemo(
    () =>
      terrainEnabled && !customBg && !bgDeclared
        ? {
            source: "terrain-source",
            exaggeration: terrainExaggerationForZoom(viewStateRef.current?.zoom ?? 3.5),
          }
        : null,
    [terrainEnabled, isGlobe, customBg, bgDeclared],
  );
  // Retune the exaggeration as the camera comes in. A fixed 15x is what the
  // whole-world view wants — at 12,000 km across, real relief is invisible —
  // but the same 15x up close raises the Tibetan plateau 67 km and the Alps
  // 60 km, well above the camera by z10, so the view ends up inside/under the
  // mesh: the surface disappears (black) and clicks land nowhere, because
  // queryRenderedFeatures unprojects through the terrain depth buffer and a
  // displaced surface answers for the wrong lat/lng. Terrarium tiles carry
  // bathymetry as well (a mid-Pacific z5 tile is negative across every pixel,
  // down to -5,529 m), so 15x sank the open ocean into an 80 km pit whose
  // walls no tile covers — the black patches at sea, and the reason zooming
  // over water drifted (recalculateZoomAndCenter keeps the camera a fixed
  // height above the point under the cursor, and that point was 60 km down).
  const applyTerrainExaggeration = useCallback((zoom) => {
    const activeTerrain = mapRef?.current?.getMap?.()?.terrain;
    if (!activeTerrain) return;
    const next = terrainExaggerationForZoom(zoom);
    if (Math.abs(next - activeTerrain.exaggeration) < 0.02) return;
    // Assigning is deliberate: Terrain reads .exaggeration live (both the
    // vertex-shader uniform and getElevation), whereas map.setTerrain() would
    // rebuild the terrain and its render-to-texture cache on every zoom tick.
    activeTerrain.exaggeration = next;
    mapRef.current.getMap().triggerRepaint?.();
  }, [mapRef]);
  // Render at reduced pixel density when zoomed far out: the whole-world view
  // draws every region, border and label at once, and full native resolution
  // there spends frames on detail nobody can see at that scale. Hysteresis
  // (re-sharpen at 5, soften below 4.5) prevents flapping at the boundary.
  const pixelRatioModeRef = useRef(null);
  const applyDynamicPixelRatio = useCallback((zoom) => {
    const map = mapRef?.current?.getMap?.();
    if (!map || typeof map.setPixelRatio !== "function") return;
    const mode = zoom <= 4.5 ? "low" : zoom >= 5 ? "native" : pixelRatioModeRef.current;
    if (!mode || mode === pixelRatioModeRef.current) return;
    pixelRatioModeRef.current = mode;
    const native = window.devicePixelRatio || 1;
    map.setPixelRatio(mode === "low" ? Math.min(native, 1) * 0.75 : native);
  }, [mapRef]);

  const handleMove = useCallback(({ viewState }) => {
    viewStateRef.current = viewState;
    applyDynamicPixelRatio(viewState.zoom);
    applyTerrainExaggeration(viewState.zoom);
  }, [applyDynamicPixelRatio, applyTerrainExaggeration]);
  const handleIdle = useCallback(() => {
    // The soft ratio applies from the very first frame settled at world zoom —
    // not only after the player first moves the camera.
    applyDynamicPixelRatio(viewStateRef.current?.zoom ?? 0);
    // Terrain can finish loading after the camera settled (or straight after a
    // projection/style swap re-made it), so the curve is re-applied here too.
    applyTerrainExaggeration(viewStateRef.current?.zoom ?? 3.5);
    if (hasReportedInitialIdleRef.current) return;
    hasReportedInitialIdleRef.current = true;
    onInitialIdle?.();
    setLoading(false);
  }, [applyDynamicPixelRatio, applyTerrainExaggeration, onInitialIdle]);
  const handleLoading = useCallback(() => {
    setLoading(true);
    clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => setLoading(false), 8000);
  }, []);

  return (
    // Stars and the single projected sun sit behind the transparent MapLibre
    // canvas, so the globe itself provides correct sun occlusion.
    <div
      id="oh-globe-space"
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#000",
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
        key={projection}
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
        crossSourceCollisions={false}
        renderWorldCopies
        // Cap MapLibre's per-source out-of-view tile-retention cache. Left unset it
        // sizes dynamically to ~(ceil(w/tileSize)+1)*(ceil(h/tileSize)+1)*5 tiles PER
        // source — ~270 at 1080p but ~800 at a 3840x2160 desktop viewport, and
        // renderWorldCopies feeds successive wrapped world-copy tiles into it as you
        // pan E/W, so retained GPU textures climb until the tab OOMs. 256 caps the 4K
        // case ~3x while barely trimming 1080p, and is a no-op on phone-sized viewports
        // (dynamic size there is well under 256). In-view tiles live in a separate
        // structure and are never evicted by this, so it never re-fetches what's on
        // screen. Orthogonal to applyDynamicPixelRatio (which bounds framebuffer pixels).
        maxTileCacheSize={256}
        projection={mapProjection}
        terrain={terrain}
        mapStyle={worldStyle}
        onIdle={handleIdle}
        onLoading={handleLoading}
        onMove={handleMove}
      >
        <Nations isGlobe={isGlobe} />
        <Cities />
        <MarkersLayer />
        <Units />
        {/* Renders nothing; the sole owner of layer stacking order. Last so it
            mounts after every component that adds layers. */}
        <LayerOrder />
        <GlobeEffects active={isGlobe} />
        <RegionPopup />
        <CountryInfoPanel />
        <UnitPopup />
        <FeaturePopup />
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
