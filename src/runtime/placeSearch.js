// Places this world invented rather than inherited, which no geocoder can know: scenario cities and polities, AI-built structures, AI renames, etc

import { getMarkerPresentation } from "../Game/Map/vnext/presentationPolicy.js";
import { isRealCountryName } from "./ownerNames.js";
import { isPrimaryCityCapital } from "./cityFeatures.js";

const TIER_LABEL = { 1: "Town", 2: "City", 3: "Major city", 4: "Capital" };

const STATUS_LABEL = {
  planned: "Planned",
  under_construction: "Under construction",
  active: "Active",
  damaged: "Damaged",
  inactive: "Inactive",
  abandoned: "Abandoned",
  destroyed: "Destroyed",
};

// A country is as prominent as a place gets, and two places of the same name this close together are the same place.
const POLITY_WEIGHT = 100;
const SAME_PLACE_DEGREES = 0.75;

export const normalizePlaceText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const titleCase = (value) =>
  String(value ?? "")
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
    .trim();

const compactPopulation = (population) => {
  const value = Number(population);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
};

const unique = (values) => [...new Set(values.filter(Boolean))];

// world.cityRenames is keyed by the lowercased original name, unfolded, so reindex it the way queries are normalized.
const renameMap = (cityRenames) => {
  const map = new Map();
  for (const [from, to] of Object.entries(cityRenames ?? {})) {
    const key = normalizePlaceText(from);
    const renamed = String(to ?? "").trim();
    if (key && renamed) map.set(key, { from: String(from).trim(), to: renamed });
  }
  return map;
};

// Compact rows, not the features: cities.geojson is deliberately never retained (assets.js).
export const buildCustomCityIndex = (featureCollection) => {
  const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
  const rows = [];

  for (const feature of features) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) continue;

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const properties = feature.properties ?? {};
    const name = String(properties.city ?? properties.name ?? "").trim();
    if (!name) continue;

    const tier = Math.trunc(Number(properties._ohTier ?? properties.tier)) || 1;
    rows.push({
      name,
      lng,
      lat,
      tier: Math.max(1, Math.min(4, tier)),
      capital: Boolean(properties._ohCapital) || isPrimaryCityCapital(properties),
      population: Math.max(0, Number(properties.population) || 0),
    });
  }

  return rows;
};

const cityWeight = (row) =>
  (row.capital ? 100 : Math.max(20, Math.min(80, row.tier * 20)))
  + Math.min(10, Math.log10(Math.max(1, row.population)) * 1.4);

export const buildCityPlaceEntries = (cityIndex, cityRenames) => {
  const renames = renameMap(cityRenames);

  return (cityIndex ?? []).map((row) => {
    const renamed = renames.get(normalizePlaceText(row.name))?.to ?? "";
    const name = renamed || row.name;
    const population = compactPopulation(row.population);
    const detail = [
      row.capital ? "Capital" : TIER_LABEL[row.tier] || "City",
      population ? `${population} people` : "",
      renamed ? `formerly ${row.name}` : "",
    ].filter(Boolean).join(" · ");

    return {
      key: `city:${row.lng.toFixed(4)},${row.lat.toFixed(4)}:${name}`,
      source: "city",
      family: "settlement",
      name,
      aliases: unique([normalizePlaceText(name), normalizePlaceText(row.name)]),
      detail,
      lng: row.lng,
      lat: row.lat,
      weight: cityWeight(row),
      payload: {
        source: "city",
        name,
        population: row.population,
        capital: row.capital ? "primary" : "",
        tier: row.tier,
        lng: row.lng,
        lat: row.lat,
      },
    };
  });
};

// One row per polity, from the map's own label sites: a custom scenario's invented countries live nowhere else.
export const buildPolityIndex = (features) => {
  const byOwner = new Map();

  for (const feature of Array.isArray(features) ? features : []) {
    const properties = feature?.properties ?? {};
    const owner = String(properties.sourceOwner ?? properties.owner ?? "").trim();
    if (!owner) continue;

    const role = String(properties.labelSiteRole ?? "").trim();
    const kind = String(properties.labelKind ?? "").trim();
    if (role && !role.startsWith("sovereign")) continue;
    if (!role && kind && kind !== "polity") continue;

    const point = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lng = Number(point[0] ?? properties.anchorLng);
    const lat = Number(point[1] ?? properties.anchorLat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    // Several label sites per polity; the most prominent one is its home.
    const weight = Number(properties.priorityScale ?? properties.areaScale) || 0;
    const held = byOwner.get(owner);
    if (!held || weight > held.weight) byOwner.set(owner, { owner, lng, lat, weight });
  }

  return [...byOwner.values()];
};

const polityNames = (owner, override) => {
  const named = String(override?.name ?? "").trim();
  const extra = [
    ...(Array.isArray(override?.aliases) ? override.aliases : []),
    ...(Array.isArray(override?.formerNames) ? override.formerNames : []),
  ];
  return { name: named || owner, aliases: unique([named, owner, ...extra].map(normalizePlaceText)) };
};

export const buildPolityPlaceEntries = (polityIndex, polityOverrides) => {
  const overrides = polityOverrides && typeof polityOverrides === "object" ? polityOverrides : {};
  const placed = new Set();
  const entries = [];

  for (const row of polityIndex ?? []) {
    const { name, aliases } = polityNames(row.owner, overrides[row.owner]);
    placed.add(normalizePlaceText(row.owner));
    entries.push({
      key: `polity:${row.owner}`,
      source: "polity",
      family: "polity",
      name,
      aliases,
      detail: "Country",
      lng: row.lng,
      lat: row.lat,
      weight: POLITY_WEIGHT,
    });
  }

  // A renamed country on a stock map has no label site, so geocode the name the tiles still carry.
  for (const [key, override] of Object.entries(overrides)) {
    // The key is the polity's identity (ownerNames.js), and only a real country gives the geocoder something to find.
    const owner = String(key).trim();
    if (!owner || placed.has(normalizePlaceText(owner)) || !isRealCountryName(owner)) continue;

    const { name, aliases } = polityNames(owner, override);
    if (normalizePlaceText(name) === normalizePlaceText(owner)) continue;

    placed.add(normalizePlaceText(owner));
    entries.push({
      key: `polity:${owner}`,
      source: "polity",
      family: "polity",
      name,
      aliases,
      detail: "Country",
      lookup: owner,
      weight: POLITY_WEIGHT,
    });
  }

  return entries;
};

export const buildMarkerPlaceEntries = (markers) =>
  (markers ?? [])
    .filter((marker) => marker?.name && Number.isFinite(marker.lng) && Number.isFinite(marker.lat))
    .map((marker) => {
      const presentation = getMarkerPresentation(marker);
      const status = String(marker.status ?? "").trim().toLowerCase();
      const kind = marker.kind || "landmark";
      const detail = [
        titleCase(kind),
        status && status !== "active" ? STATUS_LABEL[status] || "" : "",
        String(marker.ownerCode ?? "").trim(),
      ].filter(Boolean).join(" · ");

      return {
        key: `marker:${marker.id ?? marker.name}`,
        source: "marker",
        family: presentation.family,
        name: marker.name,
        aliases: [normalizePlaceText(marker.name)],
        detail,
        lng: marker.lng,
        lat: marker.lat,
        weight: presentation.priority,
        payload: {
          source: "marker",
          id: marker.id,
          name: marker.name,
          kind,
          ownerCode: marker.ownerCode || "",
          note: marker.note || "",
          status: marker.status || "active",
          lng: marker.lng,
          lat: marker.lat,
        },
      };
    });

// A renamed stock city has no local coordinates: match the new name, geocode the old one.
export const buildRenamePlaceEntries = (cityRenames, cityIndex) => {
  const known = new Set((cityIndex ?? []).map((row) => normalizePlaceText(row.name)));
  const entries = [];

  for (const [key, { from, to }] of renameMap(cityRenames)) {
    if (known.has(key)) continue;
    entries.push({
      key: `rename:${key}`,
      source: "rename",
      family: "settlement",
      name: to,
      aliases: unique([normalizePlaceText(to), key]),
      detail: `formerly ${titleCase(from)}`,
      lookup: from,
      weight: 60,
    });
  }

  return entries;
};

const isSamePlace = (a, b) => {
  if (!Number.isFinite(a.lng) || !Number.isFinite(b.lng)) return true;
  return Math.abs(a.lng - b.lng) <= SAME_PLACE_DEGREES
    && Math.abs(a.lat - b.lat) <= SAME_PLACE_DEGREES;
};

// A city the AI rebuilt as a structure exists twice in canon; show it once.
const dedupePlaceEntries = (entries) => {
  const byName = new Map();
  const kept = [];

  for (const entry of entries) {
    const name = entry.aliases[0] ?? "";
    const seen = byName.get(name);
    if (seen?.some((other) => isSamePlace(other, entry))) continue;
    if (seen) seen.push(entry);
    else byName.set(name, [entry]);
    kept.push(entry);
  }

  return kept;
};

export const buildLocalPlaceEntries = ({ cities, markers, polities, cityRenames, polityOverrides } = {}) =>
  dedupePlaceEntries([
    ...buildMarkerPlaceEntries(markers),
    ...buildCityPlaceEntries(cities, cityRenames),
    ...buildPolityPlaceEntries(polities, polityOverrides),
    ...buildRenamePlaceEntries(cityRenames, cities),
  ]);

const aliasScore = (alias, needle) => {
  if (!alias) return 0;
  if (alias === needle) return 1000;
  if (alias.startsWith(needle)) return 800;
  if (alias.includes(` ${needle}`)) return 600;
  if (alias.includes(needle)) return 400;
  return 0;
};

// The same rule ranks geocoder results, whose own order ignores what was typed.
export const scorePlaceName = (name, query) =>
  aliasScore(normalizePlaceText(name), normalizePlaceText(query));

export const searchLocalPlaces = (entries, query, limit = 4) => {
  const needle = normalizePlaceText(query);
  if (!needle || !entries?.length || limit <= 0) return [];

  const scored = [];
  for (const entry of entries) {
    let best = 0;
    for (const alias of entry.aliases) {
      const score = aliasScore(alias, needle);
      if (score > best) best = score;
    }
    // Prominence only breaks ties between equally good name matches.
    if (best > 0) scored.push({ entry, score: best + Math.min(entry.weight ?? 0, 110) / 1000 });
  }

  scored.sort((a, b) =>
    b.score - a.score
    || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name));

  return scored.slice(0, limit).map(({ entry }) => entry);
};

// --- The map's published index ---------------------------------------------
// Cities.jsx and Nations.jsx already hold this world's cities and label sites, and cities.geojson is deliberately never retained (assets.js), so they publish compact rows here rather than have the search bar refetch anything.

const EMPTY_ROWS = Object.freeze([]);
const EMPTY_INDEX = Object.freeze({ cities: EMPTY_ROWS, polities: EMPTY_ROWS });

let publishedIndex = EMPTY_INDEX;
const indexSubscribers = new Set();

const publishRows = (key, rows) => {
  const next = rows?.length ? rows : EMPTY_ROWS;
  if (next === publishedIndex[key] || (!next.length && !publishedIndex[key].length)) return;
  publishedIndex = { ...publishedIndex, [key]: next };
  for (const notify of indexSubscribers) notify();
};

export const publishCustomCityIndex = (featureCollection) =>
  publishRows("cities", featureCollection ? buildCustomCityIndex(featureCollection) : EMPTY_ROWS);

export const publishPolityIndex = (features) =>
  publishRows("polities", features ? buildPolityIndex(features) : EMPTY_ROWS);

export const getWorldPlaceIndex = () => publishedIndex;

export const subscribeWorldPlaceIndex = (notify) => {
  indexSubscribers.add(notify);
  return () => {
    indexSubscribers.delete(notify);
  };
};

// These places belong to the save that was open; the next one republishes.
if (typeof window !== "undefined") {
  window.addEventListener("oh:active-game-changed", () => {
    publishCustomCityIndex(null);
    publishPolityIndex(null);
  });
}

// --- Geocoder results ------------------------------------------------------
// Photon (photon.komoot.io) answers in GeoJSON: points whose properties carry the feature's own name, its administrative context and, for areas, an extent.

const SETTLEMENT_KINDS = new Set([
  "city", "town", "municipality", "borough", "village", "hamlet", "suburb",
  "neighbourhood", "quarter", "locality", "island",
]);
const REGION_KINDS = new Set(["state", "region", "province", "county", "district", "administrative"]);

// What kind of place a result is, which decides its rank, its icon and how close the camera gets.
export const geocodedPlaceKind = (feature) => {
  const properties = feature?.properties ?? {};
  const value = normalizePlaceText(properties.osm_value || properties.type);
  if (value === "country") return "country";
  if (REGION_KINDS.has(value)) return "region";
  if (SETTLEMENT_KINDS.has(value)) return "settlement";
  return value || "place";
};

export const geocodedPlaceName = (feature) => String(feature?.properties?.name ?? "").trim();

export const formatGeocodedPlace = (feature) => {
  const properties = feature?.properties ?? {};
  const primary = geocodedPlaceName(feature);

  // Two parts at most, general enough to tell two places of the same name apart.
  const region = [];
  for (const candidate of [
    properties.city,
    properties.state || properties.county || properties.district,
    properties.country,
  ]) {
    const value = String(candidate ?? "").trim();
    const known = [primary, ...region].some((part) => normalizePlaceText(part) === normalizePlaceText(value));
    if (value && !known) region.push(value);
  }

  return {
    primary,
    // A country has nothing above it, so say what it is rather than leave the line blank.
    region: region.slice(-2).join(", ") || titleCase(String(properties.osm_value ?? "").replace(/_/g, " ")),
  };
};

// The same place comes back several times: as the town, as its station, as its boundary.
export const dedupeGeocodedPlaces = (features) => {
  const seen = new Set();
  return (features ?? []).filter((feature) => {
    const { primary, region } = formatGeocodedPlace(feature);
    if (!primary) return false;
    const key = normalizePlaceText(`${primary}|${region}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const PLACE_KINDS = new Set(["country", "region", "settlement"]);

// Photon is built for type-ahead and ranks places well, so its order is kept intact among them: sorting countries above cities would answer "kyot" with Kyoto Prefecture and "rio de" with Rio Negro. This only sinks what is not a place at all, the station or the hospital named after the town.
export const rankGeocodedPlaces = (features) => (features ?? [])
  .map((feature, order) => ({ feature, order, band: PLACE_KINDS.has(geocodedPlaceKind(feature)) ? 0 : 1 }))
  .sort((left, right) => left.band - right.band || left.order - right.order)
  .map(({ feature }) => feature);

const KIND_ZOOM = { country: 4, region: 5, settlement: 7 };
// Fitting an extent that wraps the globe (France, whose territories reach both sides of the antimeridian) would frame the whole world instead of the place.
const MAX_FIT_SPAN_LNG = 120;
const MAX_FIT_SPAN_LAT = 80;

export const geocodedPlaceFraming = (feature) => {
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  const framing = {
    lng: Number(lng),
    lat: Number(lat),
    zoom: KIND_ZOOM[geocodedPlaceKind(feature)] ?? 9,
    bounds: null,
  };

  const extent = feature?.properties?.extent;
  if (!Array.isArray(extent) || extent.length < 4) return framing;

  const [west, north, east, south] = extent.map(Number);
  if (![west, north, east, south].every(Number.isFinite)) return framing;
  if (east <= west || north <= south) return framing;
  if (east - west > MAX_FIT_SPAN_LNG || north - south > MAX_FIT_SPAN_LAT) return framing;

  return { ...framing, bounds: [[west, south], [east, north]] };
};
