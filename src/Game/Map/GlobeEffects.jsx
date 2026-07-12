/*! Open Historia — globe celestial rendering, day/night lighting + orbit © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import {
  directionFromLngLat,
  globeTransitionOpacity,
  normalizeLongitude,
  projectGlobeSun,
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
const SUN_INITIAL_SKY_OFFSET_DEG = 10;
const CELESTIAL_FRAME_MS = 1000 / 60;
const LIGHTING_FRAME_MS = 1000 / 60;

// The sun, stars, and surface lighting share one static world frame. Moving
// the camera therefore changes their perspective without sliding the light
// independently across the countries.
let sunWorldPosition = null;

const GlobeEffects = ({ active }) => {
  const { current: map } = useMap();
  const autoRotateDisabled = useMapSetting(MAP_SETTING_KEYS.disableIdleRotation);

  useEffect(() => {
    if (!active || !map) return undefined;
    const mapInstance = map.getMap?.() ?? map;

    if (sunWorldPosition == null) {
      const center = mapInstance.getCenter();
      sunWorldPosition = {
        // Start on the far celestial sphere near the globe's limb, not in a
        // low orbit immediately above the surface.
        lng: normalizeLongitude(center.lng + 150),
        lat: Math.max(-60, Math.min(60, -center.lat + SUN_INITIAL_SKY_OFFSET_DEG)),
      };
    }

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
    const sunElement = document.getElementById("oh-globe-sun");
    const starsCanvas = document.getElementById("oh-globe-stars");
    const lightingCanvas = document.getElementById("oh-globe-lighting");

    const markInteraction = () => {
      lastInteraction = performance.now();
    };
    const interactionEvents = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "wheel"];
    for (const event of interactionEvents) mapInstance.on(event, markInteraction);

    const syncVisuals = (forceLighting = false) => {
      if (disposed || contextLost || !mapInstance.style) return;
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
          sunElement.style.opacity = String(projectionTransition);
          sunElement.style.transform = `translate3d(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${projected.scale.toFixed(3)})`;
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
      if (idle && !autoRotateDisabled && !mapInstance.isMoving()) {
        const center = mapInstance.getCenter();
        mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * dt, center.lat] });
      }
      frameId = requestAnimationFrame(tick);
    };

    const handleRender = () => syncVisuals(false);
    mapInstance.on("render", handleRender);
    const mapCanvas = mapInstance.getCanvas();
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

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(lightingTimer);
      mapInstance.off("render", handleRender);
      for (const event of interactionEvents) mapInstance.off(event, markInteraction);
      mapCanvas.removeEventListener("webglcontextlost", handleContextLost);
      mapCanvas.removeEventListener("webglcontextrestored", handleContextRestored);
      releaseCelestialStars(starsCanvas);
      releaseGlobeLighting(lightingCanvas);
    };
  }, [active, map, autoRotateDisabled]);

  return null;
};

export default GlobeEffects;
