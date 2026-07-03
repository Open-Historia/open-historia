/*! Open Historia — portions (troop system integration) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useMemo, useRef } from "react";
import Map from "react-map-gl/maplibre";
import Nations from "./Nations";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import Cities from "./Cities";
import Units from "./Units";
import UnitPopup from "../Selection/Units";
import {
  SATELLITE_TILE_MAXZOOM,
  SATELLITE_TILE_TEMPLATE,
  TERRAIN_TILE_TEMPLATE,
} from "../../runtime/assets.js";

const SATELLITE_TILES = [SATELLITE_TILE_TEMPLATE];
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
      tiles: SATELLITE_TILES,
      tileSize: 256,
      maxzoom: 2,
    },
    satellite: {
      type: "raster",
      tiles: SATELLITE_TILES,
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
  sky: {
    "atmosphere-blend": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0, 1,
      5, 1,
      7, 0,
    ],
  },
};

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const terrain = useMemo(
    () =>
      terrainEnabled
        ? {
            source: "terrain-source",
            exaggeration: 30,
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
    <div style={{ height: "100vh", width: "100vw", backgroundColor: "#000" }}>
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
        <RegionPopup />
        <CountryInfoPanel />
        <UnitPopup />
      </Map>
    </div>
  );
}

export default World;
