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
  TERRAIN_TILE_TEMPLATE,
  basemapMaxZoom,
  basemapProtocolTemplate,
  ensureBasemapProtocol,
  esriTileTemplate,
} from "../../runtime/assets.js";
import { SKYBOX_SIZE, getSkyboxUrl } from "./skybox.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

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

const buildWorldStyle = (basemapId) => ({
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
});

function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {
  const hasReportedInitialIdleRef = useRef(false);
  const basemapId = useMapSetting(MAP_SETTING_KEYS.basemapStyle);
  const worldStyle = useMemo(() => buildWorldStyle(basemapId), [basemapId]);

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
