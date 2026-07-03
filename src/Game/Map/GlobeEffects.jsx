/*! Open Historia — globe sun, day/night terminator + rotation © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";

// One full rotation of the earth every 10 minutes.
const ROTATION_DEG_PER_MS = 360 / (10 * 60 * 1000);
// Resume the auto-rotation this long after the player stops touching the map.
const INTERACTION_GRACE_MS = 3000;
// Illumination: full daylight up to 78° from the subsolar point, then a
// smooth cosine-eased ramp to full night by 102° (civil twilight, roughly).
const DAY_LIMIT_DEG = 78;
const NIGHT_LIMIT_DEG = 102;
const NIGHT_OPACITY = 0.52;
const RAMP_STEP_DEG = 1;

const NIGHT_LAYER_ID = "globe-night";

// --- The sun lives in WORLD space. Its longitude is the subsolar point; it
// creeps westward so the terminator sweeps the earth once per rotation
// period. The camera's auto-rotation moves at the same rate, so while idle
// the sun hangs still on screen as countries turn beneath it — but panning
// the camera moves you around a night side that stays anchored to the world.
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

// The night shade as a true gradient: thin strips through the twilight zones
// whose opacity follows the smoothed illumination curve, plus one solid core.
const buildNightCollection = (sunLng) => {
  const features = [];
  const rampWidth = NIGHT_LIMIT_DEG - DAY_LIMIT_DEG;
  // Strips share EXACT edge coordinates (antialias is off): any overlap
  // between translucent neighbours would double up into visible seam lines.
  for (let d = DAY_LIMIT_DEG; d < NIGHT_LIMIT_DEG; d += RAMP_STEP_DEG) {
    const opacity = NIGHT_OPACITY * smoothstep((d + RAMP_STEP_DEG / 2 - DAY_LIMIT_DEG) / rampWidth);
    // Dusk side (east of the subsolar point) and dawn side (west), mirrored.
    features.push(bandFeature(sunLng + d, sunLng + d + RAMP_STEP_DEG, opacity));
    features.push(bandFeature(sunLng + 360 - d - RAMP_STEP_DEG, sunLng + 360 - d, opacity));
  }
  features.push(bandFeature(sunLng + NIGHT_LIMIT_DEG, sunLng + 360 - NIGHT_LIMIT_DEG, NIGHT_OPACITY));
  return { type: "FeatureCollection", features };
};

const GlobeEffects = ({ active }) => {
  const { current: map } = useMap();
  const [sunLngState, setSunLngState] = useState(() => sunWorldLng ?? 0);

  useEffect(() => {
    if (!active || !map) return undefined;
    const mapInstance = map.getMap?.() ?? map;

    // First activation: put the sun 55° east of wherever the camera starts,
    // matching its on-screen glow at the upper right. After that it free-runs.
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

    // --- Screen-space visuals: the sun glow, the starfield and the
    // sun-facing atmosphere rim all live outside the WebGL canvas. They are
    // driven from here (plain DOM writes — no React re-render per frame) so
    // they track BOTH camera movement and the sun's own drift.
    const syncVisuals = () => {
      const canvas = mapInstance.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      // Where is the sun relative to the camera? 0 = dead ahead.
      const delta = normalizeLng((sunWorldLng ?? 0) - center.lng);

      // Stars are fixed in inertial space: while the earth spins under an
      // idle camera they hold still; panning the camera slides them.
      const space = document.getElementById("oh-globe-space");
      if (space) {
        space.style.backgroundPosition = `${(delta * 2.4).toFixed(1)}px ${(center.lat * 2.4).toFixed(1)}px`;
      }

      // The sun: horizontal position from its bearing off the view axis;
      // it slips behind the earth (and off screen) as you pan away.
      const sun = document.getElementById("oh-sun-glow");
      const sunSize = sun ? sun.offsetWidth : 0;
      const sunX = width * (0.5 + delta / 160);
      const sunY = height * 0.16;
      if (sun) {
        sun.style.left = `${(sunX - sunSize / 2).toFixed(0)}px`;
        sun.style.top = `${(sunY - sunSize / 2).toFixed(0)}px`;
        const bearing = Math.abs(delta);
        // Gone when it would hang in front of the lit face (physically it is
        // behind the camera there), and gone once the earth eclipses it.
        const nearFade = Math.min(1, Math.max(0, (bearing - 20) / 15));
        const farFade = bearing <= 105 ? 1 : Math.max(0, (135 - bearing) / 30);
        sun.style.opacity = (nearFade * farFade).toFixed(2);
      }

      // Atmosphere rim: brightest on the limb facing the sun, fading around
      // to the night side — a masked ring hugging the globe's silhouette.
      const atmo = document.getElementById("oh-atmo-glow");
      if (atmo) {
        // MapLibre's globe radius tracks the mercator world size; the 0.74
        // fudge matches the rendered silhouette (measured against the actual
        // limb position on screen — constant across zooms, fixed camera FOV).
        const radius = ((512 * 2 ** zoom) / (2 * Math.PI)) * 0.74;
        const diameter = radius * 2 * 1.1;
        atmo.style.width = `${diameter.toFixed(0)}px`;
        atmo.style.height = `${diameter.toFixed(0)}px`;
        atmo.style.left = `${(width / 2 - diameter / 2).toFixed(0)}px`;
        atmo.style.top = `${(height / 2 - diameter / 2).toFixed(0)}px`;
        // Aim the bright side of the ring at the sun (CSS 0deg points up).
        const cssAngle = 90 + (Math.atan2(sunY - height / 2, sunX - width / 2) * 180) / Math.PI;
        const maskValue = `linear-gradient(${(cssAngle + 180).toFixed(1)}deg, rgba(0,0,0,1) 30%, rgba(0,0,0,0.07) 78%)`;
        atmo.style.webkitMaskImage = maskValue;
        atmo.style.maskImage = maskValue;
        // Gone once the globe outgrows the viewport; always a faint night rim.
        const zoomFade = Math.max(0, Math.min(1, (5.2 - zoom) / 0.8));
        const sunFade = 0.35 + 0.65 * Math.max(0, Math.min(1, (150 - Math.abs(delta)) / 90));
        atmo.style.opacity = (zoomFade * sunFade).toFixed(2);
      }
    };

    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      // Time always passes: the subsolar point creeps westward.
      sunWorldLng = normalizeLng((sunWorldLng ?? 0) - ROTATION_DEG_PER_MS * dt);
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      if (idle && !mapInstance.isMoving()) {
        const center = mapInstance.getCenter();
        // West-to-east spin at the sun's own rate: while idle the sun hangs
        // still in the sky and the world turns beneath it.
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
  }, [active, map]);

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
