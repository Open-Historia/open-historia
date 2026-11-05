/*! Open Historia — the weather of each of a scenario's climate zones, as the turn leaves it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "The weather patches should be drawn by scenario designers who can choose
// the climate regions" (the owner, 2026-10-14). A climate zone a designer
// painted (warGeography.js climateZones) has ONE weather at a time, the whole
// of it: every battlefield in it fights in that weather (fronts/weather.js
// skyOver), and the map draws the zone as a patch of it (Game/Map/
// weatherPatches.js), its soft edges running into the zones beside it.
//
// Each zone's weather fits the weather of the zones beside it (fronts/
// climate.js zoneWeathersOn): snow is never beside heat.
//
// The weather is drawn from the campaign's own seed (the land war's: Game/AI/
// frontApply.js turnRunInput climateSeed), which only the screen that plays
// the turn knows: so the turn writes what each zone's weather is as it lands
// (world.zoneWeather).
//
//   world.zoneWeather   { date, zones: [{ id, state, season }] }: the date the
//                       turn landed on and each zone's weather on it; null where
//                       the scenario has no zones or its wars have no weather
//
// Pure, and loads in plain Node.

import { zoneWeathersOn } from "./fronts/climate.js";
import { parseGameDate } from "./gameDates.js";
import { normalizeClimateZones } from "./warGeography.js";
import { warSettingsOf } from "./warSettings.js";
import { climateZonesOf } from "./worldGeographyDefaults.js";

// Each zone's weather on a date: what world.zoneWeather keeps, or null.
//   seed   the campaign's own, as its land war is fought with
export const zoneWeatherFor = (world, { seed = "", date = "" } = {}) => {
  if (!warSettingsOf(world).mechanics.weather) return null;
  // (Its own zones, or on the built-in basemaps the real world's: worldGeographyDefaults.js.)
  const zones = normalizeClimateZones(climateZonesOf(world));
  if (zones.length === 0 || !parseGameDate(date)) return null;
  return {
    date: String(date),
    zones: zoneWeathersOn({ seed: String(seed ?? ""), zones, date }).map(({ zone, state, season }) => ({ id: zone.id, state, season })),
  };
};
