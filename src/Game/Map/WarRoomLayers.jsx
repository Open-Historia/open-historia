/*! Open Historia — the war room's planned movements on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The arrows the war room draws before anything has moved (warRoomGeometry.js):
// the player's own orders and routes, his Board's operations, his diversions,
// and what his agents have of the other side's. They are what the panel hands
// over (warRoomStore.js `plans`, `known`) and nothing is drawn while the war
// room is shut. They lie under the troops that are to make them
// (mapLayerOrder.js).

import React, { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { planFeatures } from "./warRoomGeometry.js";
import { useWarRoom } from "./warRoomStore.js";

const SOURCE = "warroom-plans-source";
const IS_WAY = ["==", ["get", "what"], "way"];
const IS_HEAD = ["==", ["get", "what"], "head"];
const IS_NAME = ["==", ["get", "what"], "name"];
const IS_SPOT = ["==", ["get", "what"], "spot"];
const DECOY = ["==", ["get", "decoy"], true];
const DEPLOY = ["==", ["get", "deploy"], true];
const WIDTH = ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "pointed"], 3.2, 2], 8, ["case", ["get", "pointed"], 6, 4]];

// What is written beside a plan on the map: an operation's own name. (It is
// the model's text, in the language of the game: it is not translated.)
const labelOf = (plan) => (plan.kind === "project" || plan.project ? plan.name : "");

// The ground the room shades (warRoomCells.js): the player's own ground stretched past where supplies come in full
// (amber) or cut off (red), the other side's cut off (pale); and what a rehearsal of the days ahead would gain
// (green) and lose (red). Flat and faint: the battlefield's own paint shows through.
const SHADE_SOURCE = "warroom-shade-source";
const SHADE_COLOURS = ["match", ["get", "kind"],
  "stretched", "rgba(233, 185, 73, 0.34)",
  "cut", "rgba(210, 53, 61, 0.44)",
  "theirs-cut", "rgba(236, 231, 218, 0.34)",
  "gained", "rgba(96, 186, 112, 0.42)",
  "lost", "rgba(210, 53, 61, 0.4)",
  "rgba(0, 0, 0, 0)"];

const WarRoomLayers = () => {
  const { current: mapRef } = useMap();
  const open = useWarRoom((state) => state.open);
  const plans = useWarRoom((state) => state.plans);
  const known = useWarRoom((state) => state.known);
  const pointed = useWarRoom((state) => state.pointed);
  const supplyOn = useWarRoom((state) => state.supply);
  const supplyShade = useWarRoom((state) => state.supplyShade);
  const rehearsalShade = useWarRoom((state) => state.rehearsalShade);
  const data = useMemo(() => planFeatures({ plans, known, pointed, labelOf }), [plans, known, pointed]);
  const shade = useMemo(() => ({
    type: "FeatureCollection",
    features: [...(supplyOn && supplyShade ? supplyShade.features : []), ...(rehearsalShade ? rehearsalShade.features : [])],
  }), [supplyOn, supplyShade, rehearsalShade]);

  // The layers come and go with the war room; the map's own order is put back
  // each time they come.
  useEffect(() => {
    if (!open) return;
    const map = mapRef?.getMap?.() ?? mapRef;
    try {
      enforceMapLayerOrder(map);
    } catch { /* the map is between styles */ }
  }, [open, mapRef, data, shade]);

  if (!open) return null;
  return (
    <>
    <Source id={SHADE_SOURCE} type="geojson" data={shade}>
      <Layer id="warroom-shade-fill" type="fill" paint={{ "fill-color": SHADE_COLOURS, "fill-antialias": false }} />
    </Source>
    <Source id={SOURCE} type="geojson" data={data}>
      <Layer
        id="warroom-plans-casing"
        type="line"
        filter={IS_WAY}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-color": "rgba(5, 8, 13, 0.82)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "pointed"], 5.6, 4], 8, ["case", ["get", "pointed"], 9.5, 7]],
        }}
      />
      <Layer
        id="warroom-plans"
        type="line"
        filter={["all", IS_WAY, ["!", DECOY], ["!", DEPLOY]]}
        layout={{ "line-cap": "butt", "line-join": "round" }}
        paint={{ "line-color": ["get", "colour"], "line-width": WIDTH, "line-dasharray": [2.4, 1.3] }}
      />
      <Layer
        id="warroom-plans-decoy"
        type="line"
        filter={["all", IS_WAY, DECOY]}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": ["get", "colour"], "line-width": WIDTH, "line-dasharray": [0.2, 1.9] }}
      />
      {/* Where the player's new troops come in: a whole line, since nothing moves along it. */}
      <Layer
        id="warroom-plans-deploy"
        type="line"
        filter={["all", IS_WAY, DEPLOY]}
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": ["get", "colour"], "line-width": WIDTH }}
      />
      {/* Where the player's new troops come in as a swarm: a dot, as the line a front's come in on is a line. */}
      <Layer
        id="warroom-plans-spot"
        type="circle"
        filter={IS_SPOT}
        paint={{
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "pointed"], 6, 4.5], 8, ["case", ["get", "pointed"], 9, 7]],
          "circle-color": ["get", "colour"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(5, 8, 13, 0.82)",
          "circle-pitch-alignment": "map",
        }}
      />
      <Layer
        id="warroom-plans-head"
        type="fill"
        filter={IS_HEAD}
        paint={{ "fill-color": ["get", "colour"], "fill-outline-color": "rgba(5, 8, 13, 0.9)" }}
      />
      <Layer
        id="warroom-plans-label"
        type="symbol"
        filter={IS_NAME}
        layout={{
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 13],
          "text-offset": [0, -1.1],
          "text-max-width": 12,
          "text-allow-overlap": false,
        }}
        paint={{ "text-color": ["get", "colour"], "text-halo-color": "rgba(5, 8, 13, 0.92)", "text-halo-width": 1.6 }}
      />
    </Source>
    </>
  );
};

export default WarRoomLayers;
