/*! Open Historia — aircraft over the battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The aircraft airFeatures.js places, drawn: a silhouette in the tone of whose
// they are, with a shadow under it, over the troops and the transporters
// (mapLayerOrder.js). They circle slowly, moved a few times a second rather
// than every frame (the map is redrawn for them no more than that: "its SOO
// LAGGY while in war", the owner, 2026-10-15), and stand still with Reduce
// motion on or while the window is hidden. Nothing is declared while no
// battlefield has aircraft over it.

import React, { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { reduceMotionEnabled } from "../../runtime/mapSettings.js";
import { useActiveGameCountry } from "../../runtime/library.js";
import { airPlanesOf } from "./airFeatures.js";
import { getFrontTargets, subscribeFronts } from "./frontsController.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { TRANSPORT_TONES } from "./transportIcons.js";

export const AIR_SOURCE = "fronts-air-source";
// How often they are moved along, in ms.
const STEP_MS = 140;
const SIZE = 48;
const EDGE = "rgba(5, 8, 13, 0.92)";
// A fuselage, swept wings and a tailplane, nose to the north (transportIcons.js draws the same aircraft).
const OUTLINE = [[24, 2], [27, 10], [28, 19], [45, 29], [45, 33], [28, 29], [27, 38], [33, 43], [33, 45], [24, 43], [15, 45], [15, 43], [21, 38], [20, 29], [3, 33], [3, 29], [20, 19], [21, 10]];
const TONES = { ...TRANSPORT_TONES, shadow: "rgba(5, 8, 13, 0.55)" };

const pictureOf = (colour, edged) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.lineJoin = "round";
  context.beginPath();
  OUTLINE.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
  context.closePath();
  context.fillStyle = colour;
  context.fill();
  if (edged) {
    context.lineWidth = 2.4;
    context.strokeStyle = EDGE;
    context.stroke();
  }
  return context.getImageData(0, 0, SIZE, SIZE);
};

const ensurePictures = (map) => {
  for (const [tone, colour] of Object.entries(TONES)) {
    const id = `air-plane-${tone}`;
    try {
      if (map.hasImage(id)) continue;
      const picture = pictureOf(colour, tone !== "shadow");
      if (picture) map.addImage(id, picture, { pixelRatio: 2 });
    } catch { /* the map is between styles: asked again when the next has loaded */ }
  }
};

const SIZE_AT_ZOOM = ["interpolate", ["linear"], ["zoom"], 3, 0.32, 6, 0.5, 9, 0.78];

const AirLayers = () => {
  const { current: mapRef } = useMap();
  const mine = useActiveGameCountry();
  const [targets, setTargets] = useState(() => getFrontTargets());
  useEffect(() => subscribeFronts(() => setTargets(getFrontTargets())), []);
  const flying = useMemo(() => targets.some((target) => {
    const air = target?.record?.brief?.air;
    return air && [0, 1].some((side) => Number(air.wings?.[side]) > 0 && air.missions?.[side] !== "grounded");
  }), [targets]);
  const [seconds, setSeconds] = useState(0);
  const data = useMemo(() => (flying ? airPlanesOf(targets, { mine, seconds }) : null), [flying, targets, mine, seconds]);

  // The pictures, on the map's style and again on each new one.
  useEffect(() => {
    const map = mapRef?.getMap?.() ?? mapRef;
    if (!map || !flying) return undefined;
    const add = () => {
      if (!map.style) return;
      ensurePictures(map);
      try {
        enforceMapLayerOrder(map);
      } catch { /* the map is between styles */ }
    };
    add();
    map.on("styledata", add);
    return () => map.off("styledata", add);
  }, [mapRef, flying]);

  // Moved along a few times a second, while anything flies and motion is wanted.
  useEffect(() => {
    if (!flying || reduceMotionEnabled()) return undefined;
    let timer = null;
    const step = () => {
      if (globalThis.document?.visibilityState !== "hidden") setSeconds(performance.now() / 1000);
    };
    timer = setInterval(step, STEP_MS);
    return () => clearInterval(timer);
  }, [flying]);

  if (!data) return null;
  return (
    <Source id={AIR_SOURCE} type="geojson" data={data}>
      <Layer
        id="fronts-air-shadow"
        type="symbol"
        layout={{ "icon-image": "air-plane-shadow", "icon-size": SIZE_AT_ZOOM, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true }}
        paint={{ "icon-translate": [3, 4], "icon-opacity": 0.8 }}
      />
      <Layer
        id="fronts-air"
        type="symbol"
        layout={{ "icon-image": ["concat", "air-plane-", ["get", "tone"]], "icon-size": SIZE_AT_ZOOM, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true }}
      />
    </Source>
  );
};

export default AirLayers;
