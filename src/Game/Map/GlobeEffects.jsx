/*! Open Historia — globe sun, day/night terminator + rotation © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { Source, Layer, useMap } from "react-map-gl/maplibre";

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
// Star parallax: scaled so a full 360° wrap of the camera longitude shifts
// the 512px star tile by exactly two tiles — no snap when the value wraps.
const STAR_PX_PER_DEG = 1024 / 360;

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

      // Stars are pinned to the world frame: orbiting the camera slides them
      // across the view in lockstep with the countries and the night shadow.
      const space = document.getElementById("oh-globe-space");
      if (space) {
        space.style.backgroundPosition =
          `${(-center.lng * STAR_PX_PER_DEG).toFixed(1)}px ${(center.lat * STAR_PX_PER_DEG).toFixed(1)}px`;
      }

      // The globe's rendered silhouette radius: the 0.74 fudge matches the
      // limb measured on screen (constant across zooms — fixed camera FOV).
      const globeRadius = ((512 * 2 ** zoom) / (2 * Math.PI)) * 0.74;

      // The sun: horizontal position from its bearing off the view axis.
      const sun = document.getElementById("oh-sun-glow");
      const sunSize = sun ? sun.offsetWidth : 0;
      const sunX = width * (0.5 + delta / 160);
      const sunY = height * 0.16;
      if (sun) {
        const sunLeft = sunX - sunSize / 2;
        const sunTop = sunY - sunSize / 2;
        sun.style.left = `${sunLeft.toFixed(0)}px`;
        sun.style.top = `${sunTop.toFixed(0)}px`;
        // Eclipse, not fade: the earth's disk is a hard hole punched in the
        // glow's own mask, so the sun is cut off by the limb as it slides
        // behind the planet — and hidden entirely when the camera looks
        // straight down at the surface from a deep zoom.
        const holeX = width / 2 - sunLeft;
        const holeY = height / 2 - sunTop;
        const sunMask =
          `radial-gradient(circle ${(globeRadius + 2).toFixed(0)}px at ${holeX.toFixed(0)}px ${holeY.toFixed(0)}px, ` +
          `rgba(0,0,0,0) 0 ${(globeRadius - 2).toFixed(0)}px, rgba(0,0,0,1) ${(globeRadius + 2).toFixed(0)}px)`;
        sun.style.webkitMaskImage = sunMask;
        sun.style.maskImage = sunMask;
        // Still fades when it would hang in front of the lit face —
        // physically it is behind the camera there.
        const bearing = Math.abs(delta);
        const nearFade = Math.min(1, Math.max(0, (bearing - 20) / 15));
        sun.style.opacity = nearFade.toFixed(2);
      }

      // Atmosphere rim: brightest on the limb facing the sun, fading around
      // to the night side — a masked ring hugging the globe's silhouette.
      const atmo = document.getElementById("oh-atmo-glow");
      if (atmo) {
        const diameter = globeRadius * 2 * 1.1;
        atmo.style.width = `${diameter.toFixed(0)}px`;
        atmo.style.height = `${diameter.toFixed(0)}px`;
        atmo.style.left = `${(width / 2 - diameter / 2).toFixed(0)}px`;
        atmo.style.top = `${(height / 2 - diameter / 2).toFixed(0)}px`;
        // Aim the bright side of the ring at the sun (CSS 0deg points up).
        const cssAngle = 90 + (Math.atan2(sunY - height / 2, sunX - width / 2) * 180) / Math.PI;
        const maskValue = `linear-gradient(${(cssAngle + 180).toFixed(1)}deg, rgba(0,0,0,1) 25%, rgba(0,0,0,0.1) 72%)`;
        atmo.style.webkitMaskImage = maskValue;
        atmo.style.maskImage = maskValue;
        // Gone once the globe outgrows the viewport; a faint band survives on
        // the night side, full burn on the limb the sun is lighting.
        const zoomFade = Math.max(0, Math.min(1, (5.2 - zoom) / 0.8));
        const sunFade = 0.25 + 0.75 * Math.max(0, Math.min(1, (150 - Math.abs(delta)) / 90));
        atmo.style.opacity = (zoomFade * sunFade).toFixed(2);
      }
    };

    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      if (idle && !mapInstance.isMoving()) {
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
