/*! Open Historia — portions (troop system integration + globe sun/stars) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useMemo, useRef } from "react";
import Map from "react-map-gl/maplibre";
import Nations from "./Nations";
import { useCustomBackground } from "./useCustomBackground.js";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import Cities from "./Cities";
import Units from "./Units";
import UnitPopup from "../Selection/Units";
import {
  DEFAULT_BASEMAP_ID,
  TERRAIN_TILE_TEMPLATE,
  basemapMaxZoom,
  basemapProtocolTemplate,
  ensureBasemapProtocol,
  esriTileTemplate,
} from "../../runtime/assets.js";
import { SKYBOX_SIZE, getSkyboxUrl } from "./skybox.js";

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

const buildWorldStyle = (basemapId, customBg, backgroundDeclared, isGlobe) => {
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
  return {
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
    "terrain-source": {
      type: "raster-dem",
      tiles: [
        TERRAIN_TILE_TEMPLATE,
      ],
      encoding: "terrarium",
      maxzoom: 5,
      tileSize: 256,
    },
    "hillshade-source": {
      type: "raster-dem",
      tiles: [
        TERRAIN_TILE_TEMPLATE,
      ],
      encoding: "terrarium",
      maxzoom: 5,
      tileSize: 256,
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
    {
      id: "hills",
      type: "hillshade",
      source: "hillshade-source",
      paint: {
        "hillshade-exaggeration": 0.1,
        "hillshade-shadow-color": "#000",
      },
    },
  ],
  // MapLibre's own atmosphere is OFF: its halo is uniform all the way around
  // the globe regardless of where the sun sits. The directional replacement
  // is the AtmosphereGlow ring below, aimed and faded by GlobeEffects. A
  // side benefit: without the atmosphere pass, space stays transparent, so
  // the starfield and sun shine through at full strength.
  sky: {
    "atmosphere-blend": 0,
  },
  };
};

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  // A custom uploaded map (image or vector) replaces the ESRI basemap; otherwise
  // the world is fixed to the ocean preset (the in-game basemap picker was removed).
  // `declared` flips on from the light world.json poll (before the heavy payload)
  // so the map drops ESRI immediately rather than flashing satellite Earth.
  const { background: customBg, declared: bgDeclared, basemap: worldBasemap } = useCustomBackground();
  const isGlobe = projection === "globe";
  const worldStyle = useMemo(
    () => buildWorldStyle(worldBasemap || DEFAULT_BASEMAP_ID, customBg, bgDeclared, isGlobe),
    [customBg, bgDeclared, isGlobe, worldBasemap],
  );
  // Earth's terrain DEM has no meaning over a custom map, and its source is dropped
  // from the style, so disable 3D terrain whenever a custom background is active.
  const terrain = useMemo(
    () =>
      terrainEnabled && !customBg && !bgDeclared
        ? {
            source: "terrain-source",
            exaggeration: 15,
          }
        : null,
    [terrainEnabled, customBg, bgDeclared],
  );
  const handleIdle = useCallback(() => {
    if (hasReportedInitialIdleRef.current) return;
    hasReportedInitialIdleRef.current = true;
    onInitialIdle?.();
  }, [onInitialIdle]);

  return (
    // The skybox: one panoramic image (stars + nebula + THE SUN) behind the
    // transparent space around the globe. GlobeEffects scrolls it so the
    // baked sun stays aligned with the sunlit side of the earth; the map
    // canvas paints over it wherever the globe is, so the earth occludes
    // the sun naturally.
    <div
      id="oh-globe-space"
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#000",
        position: "relative",
        overflow: "hidden",
        backgroundImage: isGlobe ? `url(${getSkyboxUrl()})` : "none",
        backgroundRepeat: "repeat-x",
        backgroundSize: `${SKYBOX_SIZE}px ${SKYBOX_SIZE}px`,
      }}
    >
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3.5,
        }}
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
        reuseMaps
        fadeDuration={0}
        collectResourceTiming={false}
        renderWorldCopies
        projection={projection}
        terrain={terrain}
        mapStyle={worldStyle}
        onIdle={handleIdle}
      >
        <Nations isGlobe={isGlobe} />
        <Cities />
        <Units />
        <GlobeEffects active={isGlobe} />
        <RegionPopup />
        <CountryInfoPanel />
        <UnitPopup />
      </Map>
    </div>
  );
}

export default World;
