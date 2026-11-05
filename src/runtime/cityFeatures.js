export const EMPTY_CITY_FEATURE_COLLECTION = Object.freeze({
  type: "FeatureCollection",
  features: Object.freeze([]),
});

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const isPrimaryCityCapital = (properties = {}) => {
  const value = properties.capital;
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["primary", "capital", "true", "yes", "1"].includes(normalized)) return true;
  }
  return Array.isArray(properties.tags)
    && properties.tags.some((tag) => String(tag).trim().toLowerCase() === "capital");
};

export const normalizeCustomCityFeature = (feature) => {
  if (!feature || feature?.geometry?.type !== "Point") return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const properties = feature.properties && typeof feature.properties === "object"
    ? feature.properties
    : {};
  const label = String(properties.city ?? properties.name ?? "").trim();
  if (!label) return null;

  const primaryCapital = isPrimaryCityCapital(properties);
  const authoredTier = Math.trunc(toFiniteNumber(properties.tier, 0));
  const normalizedTier = Math.max(
    1,
    Math.min(4, primaryCapital ? Math.max(3, authoredTier || 3) : authoredTier || 1),
  );

  return {
    ...feature,
    properties: {
      ...properties,
      city: label,
      name: label,
      population: Math.max(0, toFiniteNumber(properties.population, 0)),
      tier: normalizedTier,
      _ohTier: normalizedTier,
      _ohCapital: primaryCapital,
    },
  };
};

export const normalizeCustomCityFeatureCollection = (value) => ({
  type: "FeatureCollection",
  features: Array.isArray(value?.features)
    ? value.features.map(normalizeCustomCityFeature).filter(Boolean)
    : [],
});

export const customCityFeatureCount = (value) =>
  Array.isArray(value?.features) ? value.features.length : 0;

// A failed read is served the same empty collection as a deliberately emptied one.
export const resolveCityLayerSource = ({ customCities, collection, readSucceeded }) => {
  if (!customCities) return "stock";
  if (collection === null || collection === undefined) return "loading";
  return readSucceeded ? "custom" : "stock";
};

// The name a city is drawn with, as the map layers read it.
export const cityFeatureName = (properties = {}) => {
  const name = properties?.city ?? properties?.name;
  return typeof name === "string" ? name : "";
};

// Adds to `into` (name → translation) every name that `lookup` translates;
// true when one was added. `lookup` must never queue a name for the AI.
export const addCityNameTranslations = (into, names, lookup) => {
  let added = false;
  for (const name of names) {
    if (typeof name !== "string" || !name || into.has(name)) continue;
    const translated = lookup(name);
    if (typeof translated !== "string" || !translated.trim() || translated === name) continue;
    into.set(name, translated);
    added = true;
  }
  return added;
};

// The city label: an AI rename (world.cityRenames, keyed by the lower-cased
// name) as it was written, else the language pack's name, else the name in the
// tiles or the scenario's cities.geojson.
export const cityLabelExpression = (renames, translations = null) => {
  const baseLabel = ["coalesce", ["get", "city"], ["get", "name"], ""];
  let label = baseLabel;
  if (translations?.size) {
    label = ["match", baseLabel];
    for (const [name, translated] of translations) label.push(name, translated);
    label.push(baseLabel);
  }
  const pairs = Object.entries(renames || {});
  if (!pairs.length) return label;
  const expr = ["match", ["downcase", baseLabel]];
  for (const [from, to] of pairs) expr.push(from, to);
  expr.push(label);
  return expr;
};
