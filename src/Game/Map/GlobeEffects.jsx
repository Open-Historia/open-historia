/*! Open Historia — globe skybox alignment, day/night lighting + orbit © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import { SKYBOX_SIZE } from "./skybox.js";
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
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

const ROTATION_DEG_PER_MS = 360 / (10 * 60 * 1000);
const INTERACTION_GRACE_MS = 3000;
const SUN_DECLINATION_DEG = 18;

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
      sunWorldPosition = {
        lng: normalizeLongitude(mapInstance.getCenter().lng + 70),
        lat: SUN_DECLINATION_DEG,
      };
    }

    let frameId = 0;
    let lastTick = performance.now();
    let lastInteraction = 0;
    let disposed = false;
    let contextLost = false;

    const markInteraction = () => {
      lastInteraction = performance.now();
    };
    const interactionEvents = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "wheel"];
    for (const event of interactionEvents) mapInstance.on(event, markInteraction);

    const syncVisuals = () => {
      if (disposed || contextLost || !mapInstance.style) return;
      const space = document.getElementById("oh-globe-space");
      if (!space) return;
      const sunElement = document.getElementById("oh-globe-sun");
      const lightingCanvas = document.getElementById("oh-globe-lighting");
      const canvas = mapInstance.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const center = mapInstance.getCenter();
      const bgX = width / 2 - SKYBOX_SIZE * (normalizeLongitude(center.lng) / 360 + 0.5);
      const desiredBgY = height / 2 + center.lat * SKYBOX_SIZE / 180 - SKYBOX_SIZE / 2;
      const bgY = Math.max(height - SKYBOX_SIZE, Math.min(0, desiredBgY));
      space.style.backgroundSize = `${SKYBOX_SIZE}px ${SKYBOX_SIZE}px`;
      space.style.backgroundPosition = `${bgX.toFixed(1)}px ${bgY.toFixed(1)}px`;

      if (sunElement) {
        const projectionTransition = globeTransitionOpacity(
          mapInstance.transform
            ?.getProjectionDataForCustomLayer?.(true)
            ?.projectionTransition,
        );
        const projected = projectGlobeSun({
          sunLng: sunWorldPosition.lng,
          sunLat: sunWorldPosition.lat,
          matrix: mapInstance.transform?.modelViewProjectionMatrix,
          width,
          height,
        });
        if (projected) {
          sunElement.style.opacity = String(projectionTransition);
          sunElement.style.transform = `translate3d(${projected.x.toFixed(1)}px, ${projected.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${projected.scale.toFixed(3)})`;
        } else {
          sunElement.style.opacity = "0";
        }

        drawGlobeLighting({
          canvas: lightingCanvas,
          matrix: mapInstance.transform?.modelViewProjectionMatrix,
          cameraPosition: mapInstance.transform?.cameraPosition,
          sunDirection: directionFromLngLat(sunWorldPosition.lng, sunWorldPosition.lat),
          width,
          height,
          opacity: projectionTransition,
        });
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

    mapInstance.on("render", syncVisuals);
    const mapCanvas = mapInstance.getCanvas();
    const handleContextLost = () => {
      contextLost = true;
      cancelAnimationFrame(frameId);
      const sunElement = document.getElementById("oh-globe-sun");
      if (sunElement) sunElement.style.opacity = "0";
      releaseGlobeLighting(document.getElementById("oh-globe-lighting"));
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
      mapInstance.off("render", syncVisuals);
      for (const event of interactionEvents) mapInstance.off(event, markInteraction);
      mapCanvas.removeEventListener("webglcontextlost", handleContextLost);
      mapCanvas.removeEventListener("webglcontextrestored", handleContextRestored);
      releaseGlobeLighting(document.getElementById("oh-globe-lighting"));
    };
  }, [active, map, autoRotateDisabled]);

  return null;
};

export default GlobeEffects;
