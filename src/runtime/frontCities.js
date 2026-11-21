/*! Open Historia — the map's cities, for whoever names a place on a battlefield © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The cities of the map as the front engine is given them, and as anyone who
// names a place on a battlefield is: by the name each goes by today, with where
// it is, how many live there and whether it is a capital. The turn reads them
// for the engine (Game/AI/frontApply.js); the war room reads them to say where
// a planned movement ends (Game/GameUI/warRoom.jsx). Kept apart from both so
// that the war room does not load the simulation to read a list of cities.

import { JSON_URLS, readJson } from "./assets.js";
import { capitalCityId, capitalMapNames } from "./capitalSeats.js";
import { effectiveCityPopulation } from "./cityPopulation.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const frontCitiesOf = (citiesGeojson, world, game) => {
  const date = clean(game?.gameDate || game?.startDate);
  const renames = isRecord(world?.cityRenames) ? world.cityRenames : {};
  const cities = [];
  const {retired}=capitalMapNames(world);
  const retiredNames=new Set(retired);
  const selected=new Map(Object.entries(world?.countryStats||{})
    .filter(([country,sheet])=>sheet?.capitalMap?.current&&world?.polityOverrides?.[country]?.status!=="dissolved")
    .map(([country,sheet])=>[sheet.capitalMap.current.id,country]));
  for (const feature of asArray(citiesGeojson?.features)) {
    const props = isRecord(feature?.properties) ? feature.properties : {};
    const point = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    const name = clean(props.city || props.name);
    if (!name || !Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) continue;
    const capitalOwner=selected.get(capitalCityId(name,point));
    cities.push({
      name: clean(renames[name.toLowerCase()]) || name,
      lng: Number(point[0]),
      lat: Number(point[1]),
      population: effectiveCityPopulation(props, { date, cityPopulations: world?.cityPopulations, name }),
      capital: Boolean(capitalOwner)||(!retiredNames.has(fold(name))&&Boolean(clean(props.capital))&&!["false","0","no"].includes(fold(props.capital))),
      ...(capitalOwner?{capitalOwner}:{}),
    });
  }
  return cities;
};

// The same list read from the game's own cities file.
export const readFrontCities = async (world, game) => frontCitiesOf(
  await readJson(JSON_URLS.citiesGeojson, { defaultValue: null }).catch(() => null),
  world,
  game,
);
