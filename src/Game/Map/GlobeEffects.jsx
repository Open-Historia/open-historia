/*! Open Historia — globe skybox alignment, day/night lighting + orbit © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import { SKYBOX_SIZE } from "./skybox.js";
import {
  globeTransitionOpacity,
  normalizeLongitude,
  projectGlobeSun,
} from "./globeSunMath.js";
import {
  createGlobeLightingLayer,
  GLOBE_LIGHTING_LAYER_ID,
} from "./globeLightingLayer.js";
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
    let lightingUnavailable = false;
    const lightingLayer = createGlobeLightingLayer(() => sunWorldPosition);

    const ensureLightingLayer = () => {
      if (lightingUnavailable
        || !mapInstance.isStyleLoaded()
        || mapInstance.getLayer(GLOBE_LIGHTING_LAYER_ID)) return;
      try {
        mapInstance.addLayer(lightingLayer);
      } catch (error) {
        lightingUnavailable = true;
        if (mapInstance.getLayer(GLOBE_LIGHTING_LAYER_ID)) {
          try {
            mapInstance.removeLayer(GLOBE_LIGHTING_LAYER_ID);
          } catch {
            /* a concurrent style teardown already owns cleanup */
          }
        }
        console.warn("Globe surface lighting is unavailable:", error);
      }
    };

    const syncLightingLayer = () => {
      ensureLightingLayer();
      const layers = mapInstance.getStyle()?.layers ?? [];
      const lastLayer = layers[layers.length - 1];
      if (mapInstance.getLayer(GLOBE_LIGHTING_LAYER_ID)
        && lastLayer?.id !== GLOBE_LIGHTING_LAYER_ID) {
        try {
          mapInstance.moveLayer(GLOBE_LIGHTING_LAYER_ID);
        } catch {
          /* a concurrent style update will retry through styledata */
        }
      }
    };

    const markInteraction = () => {
      lastInteraction = performance.now();
    };
    const interactionEvents = ["dragstart", "zoomstart", "rotatestart", "pitchstart", "wheel"];
    for (const event of interactionEvents) mapInstance.on(event, markInteraction);

    const syncVisuals = () => {
      const space = document.getElementById("oh-globe-space");
      if (!space) return;
      const sunElement = document.getElementById("oh-globe-sun");
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
      }
    };

    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      if (idle && !autoRotateDisabled && !mapInstance.isMoving()) {
        const center = mapInstance.getCenter();
        mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * dt, center.lat] });
      }
      frameId = requestAnimationFrame(tick);
    };

    const slowSync = () => {
      ensureLightingLayer();
      syncVisuals();
    };

    syncLightingLayer();
    mapInstance.on("styledata", syncLightingLayer);
    mapInstance.on("move", syncVisuals);
    syncVisuals();
    frameId = requestAnimationFrame(tick);
    const intervalId = setInterval(slowSync, 500);

    return () => {
      cancelAnimationFrame(frameId);
      clearInterval(intervalId);
      mapInstance.off("styledata", syncLightingLayer);
      mapInstance.off("move", syncVisuals);
      for (const event of interactionEvents) mapInstance.off(event, markInteraction);
      if (mapInstance.getLayer(GLOBE_LIGHTING_LAYER_ID)) {
        mapInstance.removeLayer(GLOBE_LIGHTING_LAYER_ID);
      }
    };
  }, [active, map, autoRotateDisabled]);

  return null;
};

export default GlobeEffects;
