/*! Open Historia — the season on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The whole map faintly tinted by the season each place is in on the game's
// date (seasonTint.js): winter a cold blue-white, spring green, summer a warm
// yellow, autumn amber, a scenario's own climate zones in their seasons'
// colours, every one of them blending into the next across the map and over
// the days.
//
// One picture of the whole map, a canvas a few hundred pixels a side, worked
// out again only when the date or the zones change; the map reads it as tiles
// cut from it (seasonTintTiles.js), draped on the terrain like the basemap. On
// the globe it reaches to the poles (a taller canvas, the same pixels). It is
// shown while the player's Seasons and weather switch is on (Settings → Map)
// and the scenario fights its wars with seasons and weather
// (runtime/warSettings.js).

import React, { useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { isConstrainedDevice } from "../../runtime/deviceProfile.js";
import { MAP_SETTING_KEYS, useMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { climateZonesOf } from "../../runtime/worldGeographyDefaults.js";
import { GLOBE_TOP_LAT, MERCATOR_TOP_LAT, seasonTintField, seasonTintHeight } from "./seasonTint.js";
import { SEASON_TINT_PROTOCOL, SEASON_TINT_TILE_SIZE, setSeasonTintPicture } from "./seasonTintTiles.js";
import { ensureSeasonTintProtocol } from "./mapLibreSetup.js";
import { useLayerOrder } from "./useLayerOrder.js";

const SOURCE = "seasons-tint-source";
const LAYERS = ["seasons-tint"];
const NONE = Object.freeze([]);
// The scenario's own zones, or on the built-in basemaps the real world's (runtime/worldGeographyDefaults.js).
const selectZones = (world) => climateZonesOf(world);
const selectSeasons = (world) => warSettingsOf(world).mechanics.weather === true;
const selectDate = (game) => String(game?.gameDate || game?.startDate || "");
// A tint, not a colour: a little stronger from far off, where it is the season
// that is being looked at, than close in, where the ground is.
const TINT_OPACITY = ["interpolate", ["linear"], ["zoom"], 2, 0.18, 6, 0.14, 10, 0.1];
// The picture is only a few hundred pixels round the world, so past z2 the map enlarges its tiles.
const TINT_MAX_ZOOM = 2;

ensureSeasonTintProtocol();

const SeasonLayers = ({ isGlobe = false }) => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const switchedOn = useMapSettingDefaultOn(MAP_SETTING_KEYS.seasonsWeather);
  const seasons = useRuntimeState("world", selectSeasons);
  const zones = useRuntimeState("world", selectZones);
  const date = useRuntimeState("game", selectDate);
  const shown = switchedOn && seasons;

  // A phone is given a smaller picture: it is a blend, and a quarter of the pixels blends as well.
  const width = useMemo(() => (isConstrainedDevice() ? 256 : 512), []);
  const topLat = isGlobe ? GLOBE_TOP_LAT : MERCATOR_TOP_LAT;
  const height = seasonTintHeight(width, topLat);
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const made = document.createElement("canvas");
    made.width = width;
    made.height = height;
    return made;
  }, [width, height]);
  // The picture for the date, drawn onto the canvas the map reads.
  const drawn = useMemo(() => {
    if (!shown || !canvas) return null;
    const field = seasonTintField({ zones, date, width, height, topLat });
    if (!field) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const pixels = context.createImageData(width, height);
    pixels.data.set(field.data);
    context.putImageData(pixels, 0, 0);
    // (Each picture is tiles of its own: a new number in their address.)
    return { number: setSeasonTintPicture(canvas, topLat) };
  }, [shown, canvas, zones, date, width, height, topLat]);

  useLayerOrder(map, LAYERS, Boolean(drawn));

  if (!drawn) return null;
  return (
    <Source
      key={drawn.number}
      id={SOURCE}
      type="raster"
      tiles={[`${SEASON_TINT_PROTOCOL}://${drawn.number}/{z}/{x}/{y}`]}
      tileSize={SEASON_TINT_TILE_SIZE}
      maxzoom={TINT_MAX_ZOOM}
    >
      <Layer
        id="seasons-tint"
        type="raster"
        paint={{
          "raster-opacity": TINT_OPACITY,
          "raster-resampling": "linear",
          "raster-fade-duration": 0,
        }}
      />
    </Source>
  );
};

export default SeasonLayers;
