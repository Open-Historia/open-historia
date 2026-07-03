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

// Procedural starfield, generated once and reused as a repeating background
// behind the transparent space around the globe.
const buildStarfieldDataUrl = () => {
  if (typeof document === "undefined") return "";
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  // Deterministic pseudo-random so every load gets the same sky.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 180; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const magnitude = rand();
    const radius = magnitude < 0.92 ? 0.6 + rand() * 0.6 : 1.2 + rand() * 1.1;
    const alpha = 0.25 + rand() * 0.75;
    const tint = rand();
    ctx.fillStyle = tint < 0.75
      ? `rgba(255,255,255,${alpha})`
      : tint < 0.9
        ? `rgba(190,214,255,${alpha})`
        : `rgba(255,232,196,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
};

let starfieldUrl = "";
const getStarfieldUrl = () => {
  if (!starfieldUrl) starfieldUrl = buildStarfieldDataUrl();
  return starfieldUrl;
};

// The sun: a glow whose screen position GlobeEffects drives from the sun's
// WORLD longitude versus the camera — pan around the earth and it slides
// across the sky, sets behind the globe, and rises again. The map canvas
// paints over it wherever the globe is, so it only shines through space.
const SunGlow = () => (
  <div
    id="oh-sun-glow"
    aria-hidden
    style={{
      position: "absolute",
      top: "-30rem",
      left: "-30rem",
      width: "22rem",
      height: "22rem",
      borderRadius: "50%",
      pointerEvents: "none",
      // Above the canvas: MapLibre's globe atmosphere paints space with a
      // dark wash that would crush the soft glow. GlobeEffects fades it out
      // whenever it would sit in front of the earth or behind the camera.
      zIndex: 5,
      background:
        "radial-gradient(circle, rgba(255,252,240,1) 0%, rgba(255,238,180,0.9) 7%, " +
        "rgba(255,214,120,0.5) 16%, rgba(255,190,90,0.18) 34%, rgba(255,180,80,0) 62%)",
    }}
  />
);

// Sun-facing atmosphere: a soft ring hugging the globe's silhouette, masked
// so it burns brightest toward the sun and thins to a faint band on the
// night side. GlobeEffects sizes, aims and fades it every frame.
const AtmosphereGlow = () => (
  <div
    id="oh-atmo-glow"
    aria-hidden
    style={{
      position: "absolute",
      left: "-200vmax",
      top: 0,
      borderRadius: "50%",
      pointerEvents: "none",
      opacity: 0,
      // The div is sized 1.1× the globe's diameter; the bright band sits at
      // 91-96% of the div radius = just OUTSIDE the globe's silhouette.
      background:
        "radial-gradient(circle, rgba(0,0,0,0) 0 86%, rgba(148,196,255,0.07) 89%, " +
        "rgba(160,205,255,0.4) 92%, rgba(120,175,255,0.45) 94%, rgba(80,130,240,0.18) 97%, rgba(0,0,0,0) 100%)",
    }}
  />
);

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
    <div
      id="oh-globe-space"
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#000",
        position: "relative",
        overflow: "hidden",
        backgroundImage: isGlobe ? `url(${getStarfieldUrl()})` : "none",
        backgroundRepeat: "repeat",
      }}
    >
      {isGlobe && <SunGlow />}
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
      {isGlobe && <AtmosphereGlow />}
    </div>
  );
}

export default World;
