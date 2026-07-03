/*! Open Historia — portions (troop system integration + globe sun/stars) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useMemo, useRef } from "react";
import Map from "react-map-gl/maplibre";
import Nations from "./Nations";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import Cities from "./Cities";
import Units from "./Units";
import UnitPopup from "../Selection/Units";
import {
  BASEMAP_PROTOCOL_TEMPLATE,
  SATELLITE_TILE_MAXZOOM,
  SATELLITE_TILE_TEMPLATE,
  TERRAIN_TILE_TEMPLATE,
  ensureBasemapProtocol,
} from "../../runtime/assets.js";
import { SKYBOX_SIZE, getSkyboxUrl } from "./skybox.js";

// The high-res source goes through the ohbase protocol so ESRI's "Map Data
// Not Yet Available" placeholders get replaced with upscaled ancestor tiles.
ensureBasemapProtocol();

// Grading for the World_Terrain_Base style: it's a pale cartographic map, so
// cap brightness to sit against the dark UI and skip the photo-specific
// contrast/hue tweaks the old satellite imagery needed.
const SATELLITE_PAINT = {
  "raster-resampling": "linear",
  "raster-saturation": -0.15,
  "raster-contrast": 0.08,
  "raster-brightness-min": 0.02,
  "raster-brightness-max": 0.78,
};

const WORLD_STYLE = {
  version: 8,
  sources: {
    "satellite-lowres": {
      type: "raster",
      // Levels 0-2 always have real data — no placeholder handling needed.
      tiles: [SATELLITE_TILE_TEMPLATE],
      tileSize: 256,
      maxzoom: 2,
    },
    satellite: {
      type: "raster",
      tiles: [BASEMAP_PROTOCOL_TEMPLATE],
      tileSize: 256,
      maxzoom: SATELLITE_TILE_MAXZOOM,
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

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const isGlobe = projection === "globe";
  const terrain = useMemo(
    () =>
      terrainEnabled
        ? {
            source: "terrain-source",
            exaggeration: 15,
          }
        : null,
    [terrainEnabled],
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
        mapStyle={WORLD_STYLE}
        onIdle={handleIdle}
      >
        <Nations />
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
