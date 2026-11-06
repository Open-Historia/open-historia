/*! Open Historia — the weather on the map: patches in the climate zones' own shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The weather patches should be drawn by scenario designers who can choose
// the climate regions" (the owner, 2026-10-14). Each climate zone a designer
// painted shows its weather as a patch in the zone's own shape, full in its
// middle and thinning across its edge into the zones beside it, like the
// biomes of a map of the world (weatherPatches.js). Each weather is a still
// speckle, as frost is ("I like how frost looks, the other effects look bad"):
// three tiles of it of prime sizes laid one over another, so it does not
// repeat to the eye (mapPatterns.js). No word of the season or the weather is
// written on the map ("remove all the things that say (winter frost) and other
// weather and seasonal stuff make that just be seen by the visuals or by
// asking the advisor"): the advisor is told them (Game/AI/advisorWeather.js).
// It is shown while the player's Seasons and weather switch is on (Settings →
// Map), and Weather effects under it ("add a setting to turn off the visual
// weather effects"), and the scenario's wars have weather.
//
// Each zone's weather is the one the last turn wrote (world.zoneWeather, the
// same on every screen of a shared game); before the first turn it is worked
// out here as the turn would (runtime/zoneWeather.js), from this game's own id.

import React, { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { useLibraryState } from "../../runtime/library.js";
import { MAP_SETTING_KEYS, useMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { climateZonesOf } from "../../runtime/worldGeographyDefaults.js";
import { zoneWeatherFor } from "../../runtime/zoneWeather.js";
import { WEATHER_DRAWN, WEATHER_LAYERS, weatherImageId, weatherPattern } from "./mapPatterns.js";
import { useLayerOrder } from "./useLayerOrder.js";
import { weatherPatchFeatures, zoneWeatherById } from "./weatherPatches.js";

const AREAS = "fronts-weather-source";
const LAYERS = ["fronts-weather-wash", "fronts-weather-pattern", "fronts-weather-pattern-b", "fronts-weather-pattern-c"];
const EMPTY = Object.freeze({ type: "FeatureCollection", features: Object.freeze([]) });
// The scenario's own zones, or on the built-in basemaps the real world's (runtime/worldGeographyDefaults.js).
const selectZones = (world) => climateZonesOf(world);
const selectRecorded = (world) => world?.zoneWeather ?? null;
const selectWeatherOn = (world) => warSettingsOf(world).mechanics.weather;
const selectDate = (game) => String(game?.gameDate || game?.startDate || "");

// The weather is seen at every zoom, the whole world at once too ("the weather
// effects dissapear at full zoomout, make them not do that", the owner,
// 2026-10-14), and thins as the map comes close, where the troops are looked
// at one by one.
const STRENGTH = ["get", "strength"];
const PATTERN_OPACITY = ["interpolate", ["linear"], ["zoom"], 3, ["*", 0.95, STRENGTH], 7, ["*", 0.8, STRENGTH], 10, ["*", 0.55, STRENGTH]];
const WASH_OPACITY = ["interpolate", ["linear"], ["zoom"], 3, ["*", ["get", "washOpacity"], STRENGTH], 10, ["*", 0.6, ["get", "washOpacity"], STRENGTH]];
// The second and third of a weather's tiles, by the first's id.
const PATTERN_LAYERS = [["get", "pattern"], ["concat", ["get", "pattern"], "-b"], ["concat", ["get", "pattern"], "-c"]];

// Every picture the weather may ask for, by its id: each weather's three tiles.
const PICTURES = new Map(WEATHER_DRAWN.flatMap((state) => WEATHER_LAYERS.map((_, layer) => [weatherImageId(state, layer), () => weatherPattern(state, layer)])));
// Puts a picture on the map when it has not got it.
const provide = (map, id) => {
  try {
    if (!id || !PICTURES.has(id) || map.hasImage(id)) return;
    map.addImage(id, PICTURES.get(id)(), { pixelRatio: 1 });
  } catch { /* the map is between styles: asked again when the next one has loaded */ }
};

const FrontWeatherLayers = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const switchedOn = useMapSettingDefaultOn(MAP_SETTING_KEYS.seasonsWeather);
  const effectsOn = useMapSettingDefaultOn(MAP_SETTING_KEYS.weatherEffects);
  const zones = useRuntimeState("world", selectZones);
  const recorded = useRuntimeState("world", selectRecorded);
  const weatherOn = useRuntimeState("world", selectWeatherOn);
  const date = useRuntimeState("game", selectDate);
  const gameId = String(useLibraryState()?.activeGameId ?? "");
  const shown = switchedOn && effectsOn && weatherOn !== false && zones.length > 0;

  // Each zone's weather: what the last turn wrote, else as the turn would work it out.
  const weather = useMemo(
    () => (shown ? zoneWeatherById(recorded, date, zoneWeatherFor({ climateZones: zones }, { seed: gameId, date })) : new Map()),
    [shown, recorded, date, zones, gameId],
  );
  const areas = useMemo(() => (shown ? weatherPatchFeatures({ zones, weather }).areas : EMPTY), [shown, zones, weather]);
  const states = useMemo(() => [...new Set(areas.features.map((feature) => feature.properties.weather))].sort(), [areas]);

  // The pictures of the weathers on the map: now, after every change of
  // style, and the moment the map asks for one.
  const stateKey = states.join("|");
  useEffect(() => {
    if (!map || !shown) return undefined;
    const ids = stateKey.split("|").filter(Boolean).flatMap((state) => WEATHER_LAYERS.map((_, layer) => weatherImageId(state, layer)));
    const again = () => ids.forEach((id) => provide(map, id));
    const asked = (event) => provide(map, event?.id);
    again();
    map.on("styledata", again);
    map.on("styleimagemissing", asked);
    return () => {
      map.off("styledata", again);
      map.off("styleimagemissing", asked);
    };
  }, [map, shown, stateKey]);

  useLayerOrder(map, LAYERS, shown);

  if (!shown || areas.features.length === 0) return null;
  return (
    <Source id={AREAS} type="geojson" data={areas} tolerance={0.4}>
      <Layer
        id="fronts-weather-wash"
        type="fill"
        filter={["has", "wash"]}
        paint={{
          "fill-color": ["get", "wash"],
          "fill-opacity": WASH_OPACITY,
          "fill-antialias": false,
        }}
      />
      <Layer
        id="fronts-weather-pattern"
        type="fill"
        filter={["has", "pattern"]}
        paint={{ "fill-pattern": PATTERN_LAYERS[0], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
      />
      <Layer
        id="fronts-weather-pattern-b"
        type="fill"
        filter={["has", "pattern"]}
        paint={{ "fill-pattern": PATTERN_LAYERS[1], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
      />
      <Layer
        id="fronts-weather-pattern-c"
        type="fill"
        filter={["has", "pattern"]}
        paint={{ "fill-pattern": PATTERN_LAYERS[2], "fill-opacity": PATTERN_OPACITY, "fill-antialias": false }}
      />
    </Source>
  );
};

export default FrontWeatherLayers;
