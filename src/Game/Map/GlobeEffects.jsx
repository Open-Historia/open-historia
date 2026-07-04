/*! Open Historia — globe skybox alignment, day/night terminator + orbit © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";
import { SKYBOX_SUN_U, SKYBOX_SUN_V } from "./skybox.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

// The camera orbits the earth once every 10 minutes.
const ROTATION_DEG_PER_MS = 360 / (10 * 60 * 1000);
// Resume the auto-rotation this long after the player stops touching the map.
const INTERACTION_GRACE_MS = 3000;
// Illumination: full daylight up to 78° from the subsolar point, then a
// smooth cosine-eased ramp to full night by 102° (civil twilight, roughly).
const DAY_LIMIT_DEG = 78;
const NIGHT_LIMIT_DEG = 102;
const NIGHT_OPACITY = 0.76;
const RAMP_STEP_DEG = 0.5;
// Vertical drift of the sky when the camera pans in latitude.
const SKYBOX_PX_PER_LAT_DEG = 2;
// Where the sun rides on screen, as a fraction of the viewport height.
const SUN_SCREEN_HEIGHT_FRACTION = 0.4;

const NIGHT_LAYER_ID = "globe-night";

// --- The universe is STATIC and the camera does the moving. The sun holds a
// fixed world longitude (the subsolar point), the night shadow derives from
// it, and the stars are pinned to the same world frame — so sun, sky and
// shadow always agree. Orbiting the earth (the idle auto-orbit or a drag)
// slides all of them across the view together with the countries.
let sunWorldLng = null;

const normalizeLng = (lng) => ((lng + 180) % 360 + 360) % 360 - 180;

const smoothstep = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

// A lat/lng band polygon densified so globe projection curves it correctly.
// Longitudes may exceed ±180 — angles are periodic on the sphere.
const bandFeature = (west, east, opacity) => {
  const top = 89.9;
  const bottom = -89.9;
  const ring = [];
  for (let lng = west; lng < east; lng += 5) ring.push([lng, top]);
  ring.push([east, top]);
  for (let lat = top; lat > bottom; lat -= 5) ring.push([east, lat]);
  ring.push([east, bottom]);
  for (let lng = east; lng > west; lng -= 5) ring.push([lng, bottom]);
  ring.push([west, bottom]);
  for (let lat = bottom; lat < top; lat += 5) ring.push([west, lat]);
  ring.push([west, top]);
  return {
    type: "Feature",
    properties: { opacity },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
};

// The night shade as a true gradient built from NESTED bands, onion-style:
// band i spans from i degrees into the dusk ramp, around the whole night
// side, to the mirrored point in the dawn ramp. Each layer adds a small
// alpha increment and the stack composites to the smoothstep illumination
// curve. No two bands share an adjacent edge, so the projection-subdivision
// cracks that showed as seam lines between side-by-side strips cannot occur
// — at worst a crack loses one thin layer's increment, not the whole shade.
const buildNightCollection = (sunLng) => {
  const features = [];
  const steps = Math.round((NIGHT_LIMIT_DEG - DAY_LIMIT_DEG) / RAMP_STEP_DEG);
  let stacked = 0;
  for (let i = 1; i <= steps; i += 1) {
    const target = NIGHT_OPACITY * smoothstep(i / steps);
    // Per-layer alpha so that 1 - Π(1 - o_i) hits the target curve.
    const layerOpacity = (target - stacked) / (1 - stacked);
    const d = DAY_LIMIT_DEG + i * RAMP_STEP_DEG;
    features.push(bandFeature(sunLng + d, sunLng + 360 - d, layerOpacity));
    stacked = target;
  }
  return { type: "FeatureCollection", features };
};

const GlobeEffects = ({ active }) => {
  const { current: map } = useMap();
  const [sunLngState, setSunLngState] = useState(() => sunWorldLng ?? 0);

  const autoRotateDisabled = useMapSetting(MAP_SETTING_KEYS.disableIdleRotation);

  useEffect(() => {
    if (!active || !map) return undefined;
    const mapInstance = map.getMap?.() ?? map;

    // First activation: fix the sun 55° east of wherever the camera starts —
    // the skybox sun rises at the upper right, the lit hemisphere faces it.
    if (sunWorldLng == null) {
      sunWorldLng = normalizeLng(mapInstance.getCenter().lng + 55);
    }
    setSunLngState(sunWorldLng);

    let frameId = 0;
    let lastTick = performance.now();
    let lastInteraction = 0;

    const markInteraction = () => {
      lastInteraction = performance.now();
    };
    const interactionEvents = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "wheel"];
    for (const event of interactionEvents) mapInstance.on(event, markInteraction);

    // --- The skybox is the whole sky: stars, nebula and the sun in one
    // panoramic strip behind the canvas. It is scaled AND scrolled at the
    // map's own angular scale — the same pixels-per-degree the surface moves
    // at — so the sun, the stars, the night shadow and the countries all
    // sweep the screen in exact lockstep as the camera orbits or drags.
    // (A fixed pixel rate here is what made the sky appear to counter-scroll
    // before: same direction, wrong speed.) Plain DOM writes — no React
    // re-render per frame.
    const syncVisuals = () => {
      const space = document.getElementById("oh-globe-space");
      if (!space) return;
      const canvas = mapInstance.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      // This many pixels span 360° at the current zoom — for the surface at
      // screen center and therefore for the sky too.
      const skyPx = 512 * 2 ** zoom;
      const pxPerDeg = skyPx / 360;
      // Where is the sun relative to the camera? 0 = dead ahead.
      const delta = normalizeLng((sunWorldLng ?? 0) - center.lng);
      // Land the baked sun pixel at screen-center + its bearing off axis.
      // The scaled strip spans exactly 360°, so the modulo can never snap.
      let bgX = width / 2 + delta * pxPerDeg - SKYBOX_SUN_U * skyPx;
      bgX = ((bgX % skyPx) + skyPx) % skyPx;
      // The sun rides at a fixed fraction of the viewport height.
      const bgY =
        height * SUN_SCREEN_HEIGHT_FRACTION
        + center.lat * SKYBOX_PX_PER_LAT_DEG
        - SKYBOX_SUN_V * skyPx;
      space.style.backgroundSize = `${skyPx.toFixed(0)}px ${skyPx.toFixed(0)}px`;
      space.style.backgroundPosition = `${bgX.toFixed(1)}px ${bgY.toFixed(1)}px`;
    };

    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      if (idle && !autoRotateDisabled && !mapInstance.isMoving()) {
        const center = mapInstance.getCenter();
        // The CAMERA orbits the static earth — sun, shadow, stars and
        // countries all hold their world positions and sweep across the
        // view together, day side into night side and back each orbit.
        mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * dt, center.lat] });
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);

    mapInstance.on("move", syncVisuals);
    syncVisuals();

    // Terminator geometry + layer order, every half second: it only moves
    // 0.3°/s, far below what the eye can pick out per step. The night layer
    // rides above everything (fills, borders, labels, units) — the sun's
    // light governs all of it.
    const slowSync = () => {
      setSunLngState(sunWorldLng ?? 0);
      if (mapInstance.getLayer(NIGHT_LAYER_ID)) {
        try {
          mapInstance.moveLayer(NIGHT_LAYER_ID);
        } catch {
          /* layer mid-update — next tick reorders it */
        }
      }
      syncVisuals();
    };
    const intervalId = setInterval(slowSync, 500);

    return () => {
      cancelAnimationFrame(frameId);
      clearInterval(intervalId);
      mapInstance.off("move", syncVisuals);
      for (const event of interactionEvents) mapInstance.off(event, markInteraction);
    };
  }, [active, map, autoRotateDisabled]);

  const nightData = useMemo(() => buildNightCollection(sunLngState), [sunLngState]);

  if (!active) return null;

  return (
    <Source id="globe-night-source" type="geojson" data={nightData}>
      <Layer
        id={NIGHT_LAYER_ID}
        type="fill"
        paint={{
          "fill-color": "#020617",
          "fill-opacity": ["get", "opacity"],
          "fill-antialias": false,
        }}
      />
    </Source>
  );
};

export default GlobeEffects;
