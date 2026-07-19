/*! Open Historia — globe celestial rendering, day/night lighting + orbit © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import {
  directionFromLngLat,
  globeTransitionOpacity,
  projectGlobeSun,
  subsolarPoint,
  sunLimbBloom,
} from "./globeSunMath.js";
import {
  drawGlobeLighting,
  releaseGlobeLighting,
} from "./globeCanvasLighting.js";
import {
  drawCelestialStars,
  releaseCelestialStars,
} from "./globeCelestialCanvas.js";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

const ROTATION_DEG_PER_MS = 360 / (10 * 60 * 1000);
const INTERACTION_GRACE_MS = 3000;
const CELESTIAL_FRAME_MS = 1000 / 60;
const LIGHTING_FRAME_MS = 1000 / 60;
// The terminator creeps 0.25°/minute as the real Earth turns; refresh on this
// cadence even when the map is fully idle (no render events fire then), so the
// day/night line stays live without a per-frame cost.
const LIVE_SUN_REFRESH_MS = 60 * 1000;

// The sun, stars, and surface lighting share one world frame: the REAL sun.
// sunWorldPosition is the actual subsolar point for the current wall-clock
// moment (seasonal declination + Earth's real rotation), so the day/night
// shadow on the globe matches the planet outside the window; moving the camera
// changes perspective without sliding the light across the countries.
let sunWorldPosition = subsolarPoint();

const GlobeEffects = ({ active }) => {
  const { current: map } = useMap();
  const autoRotateDisabled = useMapSetting(MAP_SETTING_KEYS.disableIdleRotation);

  useEffect(() => {
    if (!active || !map) return undefined;
    const mapInstance = map.getMap?.() ?? map;

    let frameId = 0;
    let lastTick = performance.now();
    let lastInteraction = 0;
    let disposed = false;
    let contextLost = false;
    let lightingTimer = 0;
    let lastLightingDraw = -Infinity;
    let lastCelestialDraw = -Infinity;
    let starsVisible = false;
    let lightingVisible = false;
    let autoRotationActive = false;
    const sunElement = document.getElementById("oh-globe-sun");
    const starsCanvas = document.getElementById("oh-globe-stars");
    const lightingCanvas = document.getElementById("oh-globe-lighting");
    const mapCanvas = mapInstance.getCanvas();

    const markInteraction = () => {
      lastInteraction = performance.now();
      autoRotationActive = false;
    };
    const interactionEvents = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "wheel"];
    for (const event of interactionEvents) mapInstance.on(event, markInteraction);
    const interruptAutoRotation = () => {
      markInteraction();
      const wasMoving = mapInstance.isMoving();
      mapInstance.stop?.();
      if (!wasMoving) syncVisuals(true);
    };
    mapCanvas.addEventListener("pointerdown", interruptAutoRotation, true);

    const syncVisuals = (forceLighting = false) => {
      if (disposed || contextLost || !mapInstance.style) return;
      // Track the real sun every draw — a dozen trig ops, far cheaper than the
      // canvas work below, and it keeps the terminator honest while rendering.
      sunWorldPosition = subsolarPoint();
      const canvas = mapInstance.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const now = performance.now();
      const matrix = mapInstance.transform?.modelViewProjectionMatrix;
      const projectionTransition = globeTransitionOpacity(
        mapInstance.transform
          ?.getProjectionDataForCustomLayer?.(true)
          ?.projectionTransition,
      );
      if (projectionTransition > 0
        && (forceLighting || now - lastCelestialDraw >= CELESTIAL_FRAME_MS)) {
        lastCelestialDraw = now;
        starsVisible = true;
        drawCelestialStars({
          canvas: starsCanvas,
          matrix,
          width,
          height,
          opacity: projectionTransition,
        });
      } else if (projectionTransition <= 0 && starsVisible) {
        starsVisible = false;
        drawCelestialStars({ canvas: starsCanvas, opacity: 0 });
      }

      if (sunElement) {
        const sunDirection = directionFromLngLat(sunWorldPosition.lng, sunWorldPosition.lat);
        const projected = projectGlobeSun({
          sunLng: sunWorldPosition.lng,
          sunLat: sunWorldPosition.lat,
          matrix,
          width,
          height,
        });
        if (projected
          && projected.x > -180 && projected.x < width + 180
          && projected.y > -180 && projected.y < height + 180) {
          const bloom = sunLimbBloom({
            sunX: projected.x,
            sunY: projected.y,
            cameraPosition: mapInstance.transform?.cameraPosition,
            matrix,
            width,
            height,
          });
          sunElement.style.opacity = String(projectionTransition);
          sunElement.style.transform = `translate3d(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${projected.scale.toFixed(3)})`;
          const glowRadius = 12 + bloom * 28;
          const glowOpacity = 0.65 + bloom * 0.3;
          sunElement.style.filter = `drop-shadow(0 0 ${glowRadius.toFixed(1)}px rgba(255,218,145,${glowOpacity.toFixed(3)}))`;
        } else {
          sunElement.style.opacity = "0";
        }
      }

      if (projectionTransition > 0) {
        const lightingDelay = LIGHTING_FRAME_MS - (now - lastLightingDraw);
        if (forceLighting || lightingDelay <= 0) {
          if (lightingTimer) clearTimeout(lightingTimer);
          lightingTimer = 0;
          lastLightingDraw = now;
          lightingVisible = true;
          drawGlobeLighting({
            canvas: lightingCanvas,
            matrix,
            cameraPosition: mapInstance.transform?.cameraPosition,
            sunDirection: directionFromLngLat(sunWorldPosition.lng, sunWorldPosition.lat),
            width,
            height,
            opacity: projectionTransition,
            immediate: autoRotationActive || mapInstance.isMoving(),
          });
        } else if (!lightingTimer) {
          lightingTimer = window.setTimeout(() => {
            lightingTimer = 0;
            syncVisuals(true);
          }, lightingDelay);
        }
      } else if (lightingVisible) {
        lightingVisible = false;
        clearTimeout(lightingTimer);
        lightingTimer = 0;
        releaseGlobeLighting(lightingCanvas);
      }
    };

    const tick = (now) => {
      if (disposed || contextLost || !mapInstance.style) return;
      const dt = now - lastTick;
      lastTick = now;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      autoRotationActive = idle && !autoRotateDisabled && !mapInstance.isMoving();
      if (autoRotationActive) {
        const center = mapInstance.getCenter();
        mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * dt, center.lat] });
      }
      frameId = requestAnimationFrame(tick);
    };

    const handleRender = () => syncVisuals(false);
    const handleMovementEnd = () => {
      if (!autoRotationActive) syncVisuals(true);
    };
    mapInstance.on("render", handleRender);
    mapInstance.on("moveend", handleMovementEnd);
    const handleContextLost = () => {
      contextLost = true;
      cancelAnimationFrame(frameId);
      clearTimeout(lightingTimer);
      lightingTimer = 0;
      if (sunElement) sunElement.style.opacity = "0";
      releaseCelestialStars(starsCanvas);
      releaseGlobeLighting(lightingCanvas);
      starsVisible = false;
      lightingVisible = false;
      lastCelestialDraw = -Infinity;
      lastLightingDraw = -Infinity;
    };
    const handleContextRestored = () => {
      contextLost = false;
      syncVisuals();
      lastTick = performance.now();
      frameId = requestAnimationFrame(tick);
    };
    mapCanvas.addEventListener("webglcontextlost", handleContextLost);
    mapCanvas.addEventListener("webglcontextrestored", handleContextRestored);
    syncVisuals();
    frameId = requestAnimationFrame(tick);
    const liveSunTimer = window.setInterval(() => syncVisuals(true), LIVE_SUN_REFRESH_MS);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearInterval(liveSunTimer);
      clearTimeout(lightingTimer);
      mapInstance.off("render", handleRender);
      mapInstance.off("moveend", handleMovementEnd);
      for (const event of interactionEvents) mapInstance.off(event, markInteraction);
      mapCanvas.removeEventListener("pointerdown", interruptAutoRotation, true);
      mapCanvas.removeEventListener("webglcontextlost", handleContextLost);
      mapCanvas.removeEventListener("webglcontextrestored", handleContextRestored);
      releaseCelestialStars(starsCanvas);
      releaseGlobeLighting(lightingCanvas);
    };
  }, [active, map, autoRotateDisabled]);

  return null;
};

export default GlobeEffects;
