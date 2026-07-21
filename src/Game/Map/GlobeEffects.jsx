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
// While the user is actively dragging/zooming, redraw the sun/lighting every
// frame so it tracks the camera precisely. While idle (including during
// auto-rotate), the same visual result is indistinguishable at a much lower
// rate, so throttle down hard — this is the single biggest lever on
// sustained CPU/GPU load, since idle auto-rotate used to force a full
// MapLibre re-render plus a from-scratch lighting repaint 60 times a second,
// forever, even with the phone just sitting on a table.
const CELESTIAL_FRAME_MS_ACTIVE = 1000 / 60;
const CELESTIAL_FRAME_MS_IDLE = 1000 / 15;
const LIGHTING_FRAME_MS_ACTIVE = 1000 / 60;
const LIGHTING_FRAME_MS_IDLE = 1000 / 15;
// Idle auto-rotation itself doesn't need a fresh jumpTo() every animation
// frame either — updating the camera 15x/sec still reads as smooth rotation
// but avoids tripling MapLibre's re-render work compared to 60x/sec.
const IDLE_ROTATE_FRAME_MS = 1000 / 15;
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
      // The globe<->mercator morph fades the stars/lighting overlays via
      // projectionTransition (an opacity: exactly 1 on the settled globe, 0 on
      // flat mercator, strictly between only mid-fade). That morph isn't driven
      // by a map "move", and toggling projection fires no interaction event, so
      // without this it would read as idle and the fade would step at 15fps.
      // Keep the fade itself at full rate; only the settled globe throttles.
      const isMorphing = projectionTransition > 0 && projectionTransition < 1;
      // Only active dragging/zooming needs full 60fps precision. Idle —
      // whether that's auto-rotating or just sitting still — settles for
      // 15fps, which looks identical but is a fraction of the CPU/GPU cost.
      const isIdle = !isMorphing
        && (autoRotationActive
          || (!mapInstance.isMoving() && now - lastInteraction > INTERACTION_GRACE_MS));
      const celestialFrameMs = isIdle ? CELESTIAL_FRAME_MS_IDLE : CELESTIAL_FRAME_MS_ACTIVE;
      const lightingFrameMs = isIdle ? LIGHTING_FRAME_MS_IDLE : LIGHTING_FRAME_MS_ACTIVE;
      if (projectionTransition > 0
        && (forceLighting || now - lastCelestialDraw >= celestialFrameMs)) {
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
        const lightingDelay = lightingFrameMs - (now - lastLightingDraw);
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

    let lastRotateTick = performance.now();
    const tick = (now) => {
      if (disposed || contextLost || !mapInstance.style) return;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      autoRotationActive = idle && !autoRotateDisabled && !mapInstance.isMoving();
      if (autoRotationActive) {
        // Advancing the camera on every animation frame forces MapLibre to
        // fully re-render 60x/sec forever while idle. Stepping at ~15fps
        // instead (using the real elapsed time so the rotation *speed* is
        // unaffected) looks identical but cuts that sustained render load
        // roughly 4x — the main thing that was cooking phones on this screen.
        const rotateDt = now - lastRotateTick;
        if (rotateDt >= IDLE_ROTATE_FRAME_MS) {
          lastRotateTick = now;
          const center = mapInstance.getCenter();
          mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * rotateDt, center.lat] });
        }
      } else {
        lastRotateTick = now;
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
      // Reset the rotation clock so the first tick after a WebGL context loss
      // doesn't advance the globe by the whole (possibly long) lost interval.
      lastRotateTick = performance.now();
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
