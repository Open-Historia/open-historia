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
