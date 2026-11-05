/*! Open Historia — sea battles and blockades on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war at sea on the game's map (seaBattleFeatures.js).
//
// The battles the last turns' fleets fought (runtime/naval/engine.js), each
// marked where it was fought: a ring and a cross in the colour of how it went
// for the player, and under it who fought and when. They are kept for two
// turns (runtime/naval/record.js) and the older turn's are fainter.
//
// The blockades that stand (runtime/naval/blockade.js): round each fleet that
// is blockading, a dashed ring over the water it closes, and under the fleet
// the countries it presses on with how much of each one's trade is cut.
//
// Nothing in it can be clicked: the fleets have counters of their own.

import React, { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { normalizeBlockades } from "../../runtime/naval/blockade.js";
import { normalizeSeaBattles } from "../../runtime/naval/record.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { eraSettingOf } from "../../runtime/warSettings.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";
import { blockadeFeatures, seaBattleFeatures } from "./seaBattleFeatures.js";
import { TRANSPORT_TONES } from "./transportIcons.js";

const SOURCE = "seabattles-source";
const RINGS = "blockades-rings-source";
const LABELS = "blockades-labels-source";
const NONE = Object.freeze([]);
const selectBattles = (world) => (Array.isArray(world?.seaBattles) ? world.seaBattles : NONE);
const selectBlockades = (world) => (Array.isArray(world?.blockades) ? world.blockades : NONE);
const selectUnits = (world) => (Array.isArray(world?.units) ? world.units : NONE);
const selectFlat = (world) => world?.projection?.type === "freeform";
const selectCountry = (game) => String(game?.country ?? "");
const selectDate = (game) => String(game?.gameDate || game?.startDate || "");
const selectEra = (world) => eraSettingOf(world);

// The colours the transporters have: the player's own, an enemy's, anyone else's.
const TONE_COLOUR = ["match", ["get", "tone"], "own", TRANSPORT_TONES.own, "enemy", TRANSPORT_TONES.enemy, TRANSPORT_TONES.other];
const SHOWN = ["case", ["get", "fresh"], 1, 0.5];
const EDGE = "rgba(5, 8, 13, 0.92)";
const FONT = ["Open Sans Bold", "Arial Unicode MS Bold"];

const SeaBattleLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const raw = useRuntimeState("world", selectBattles);
  const laid = useRuntimeState("world", selectBlockades);
  const units = useRuntimeState("world", selectUnits);
  const flat = useRuntimeState("world", selectFlat);
  const country = useRuntimeState("game", selectCountry);
  const date = useRuntimeState("game", selectDate);
  const era = useRuntimeState("world", selectEra);
  const data = useMemo(() => seaBattleFeatures({ battles: normalizeSeaBattles(raw), viewer: country }), [raw, country]);
  const blockades = useMemo(
    () => blockadeFeatures({ blockades: normalizeBlockades(laid), units: laid.length > 0 ? units : NONE, viewer: country, date, flat, era }),
    [laid, units, country, date, flat, era],
  );

  const fought = data.features.length > 0;
  const blockaded = blockades.labels.features.length > 0;
  useEffect(() => {
    if ((!fought && !blockaded) || !map) return;
    try {
      enforceMapLayerOrder(map);
    } catch { /* the map is between styles */ }
  }, [fought, blockaded, map, data, blockades]);

  if (!fought && !blockaded) return null;
  return (
    <>
      {blockaded && (
        <Source id={RINGS} type="geojson" data={blockades.rings}>
          <Layer
            id="blockades-ring"
            type="line"
            layout={{ "line-cap": "butt", "line-join": "round" }}
            paint={{
              "line-color": TONE_COLOUR,
              "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.4, 7, 2.6],
              "line-dasharray": [2, 2.4],
              "line-opacity": 0.9,
            }}
          />
        </Source>
      )}
      {fought && (
        <Source id={SOURCE} type="geojson" data={data}>
          <Layer
            id="seabattles-ring"
            type="circle"
            paint={{
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 7, 6, 11, 9, 14],
              "circle-color": "rgba(5, 8, 13, 0.6)",
              "circle-opacity": SHOWN,
              "circle-stroke-color": TONE_COLOUR,
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 1.5, 7, 2.5],
              "circle-stroke-opacity": SHOWN,
            }}
          />
          <Layer
            id="seabattles-mark"
            type="symbol"
            layout={{
              "text-field": "×",
              "text-font": FONT,
              "text-size": ["interpolate", ["linear"], ["zoom"], 2, 13, 6, 19, 9, 24],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{ "text-color": TONE_COLOUR, "text-opacity": SHOWN }}
          />
          <Layer
            id="seabattles-label"
            type="symbol"
            minzoom={3}
            layout={{
              "text-field": ["get", "label"],
              "text-font": FONT,
              "text-size": 11,
              "text-anchor": "top",
              "text-offset": [0, 1.4],
              "text-max-width": 14,
              "text-optional": true,
            }}
            paint={{ "text-color": TONE_COLOUR, "text-opacity": SHOWN, "text-halo-color": EDGE, "text-halo-width": 1.5 }}
          />
        </Source>
      )}
      {blockaded && (
        <Source id={LABELS} type="geojson" data={blockades.labels}>
          <Layer
            id="blockades-label"
            type="symbol"
            minzoom={2}
            layout={{
              "text-field": ["get", "label"],
              "text-font": FONT,
              "text-size": 11,
              "text-anchor": "top",
              "text-offset": [0, 2.6],
              "text-max-width": 14,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{ "text-color": TONE_COLOUR, "text-halo-color": EDGE, "text-halo-width": 1.5 }}
          />
        </Source>
      )}
    </>
  );
};

export default SeaBattleLayers;
