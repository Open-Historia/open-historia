/*! Open Historia - canonical city references for authored capital relocation. AGPL-3.0-or-later. */
// countryStats.capital remains the seat's display name. capitalMap is its
// optional validated map reference and the retired original map marker names.
// It is not a second country registry or another writable capital ledger.

const list = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const fold = (value) => clean(value).toLowerCase();

export const capitalCityId = (name, coordinates) => {
  const base = fold(name);
  if (
    !base
    || !Array.isArray(coordinates)
    || coordinates.length < 2
    || !coordinates.slice(0, 2).every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return "";
  }
  const [lng, lat] = coordinates;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return "";
  const id = `city:${lng.toFixed(6)},${lat.toFixed(6)}:${base}`;
  return id.length <= 160 ? id : "";
};

export const cityReference = (city) => {
  const baseName = clean(list(city?.aliases)[0] || city?.baseName || city?.name);
  const name = clean(city?.name) || baseName;
  const id = capitalCityId(baseName, city?.coordinates);
  return id
    ? {
      id,
      baseName,
      name,
      coordinates: city.coordinates.slice(0, 2),
      capital: city.capital,
      population: Number(city.population) || 0,
    }
    : null;
};

export const capitalCityOptions = (collection, renames = {}) => {
  const raw = Array.isArray(collection)
    ? collection.map((c) => ({ name: c?.name, coordinates: c?.coord, capital: c?.capital, population: c?.population }))
    : list(collection?.features).map((f) => ({
      name: f?.properties?.city || f?.properties?.name,
      coordinates: f?.geometry?.type === "Point" ? f.geometry.coordinates : null,
      capital: f?.properties?.capital,
      population: f?.properties?.population,
    }));
  const cities = raw
    .map((c) => cityReference({ ...c, baseName: c.name, name: clean(renames?.[fold(c.name)]) || c.name }))
    .filter(Boolean);
  const counts = new Map();
  for (const city of cities) {
    counts.set(fold(city.baseName), (counts.get(fold(city.baseName)) || 0) + 1);
  }
  // Current map marker expressions are name based. Ambiguous original names
  // cannot be safely retired or promoted; do not guess a city from the name.
  return cities
    .filter((c) => counts.get(fold(c.baseName)) === 1)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const normalizeCapitalMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const retired = [...new Set(list(value.retired).map(fold).filter((name) => name && name.length <= 160))].slice(-64);
  const candidate = value.current;
  const id = clean(candidate?.id);
  const baseName = clean(candidate?.baseName);
  const regionId = clean(candidate?.regionId);
  const sourceEventId = clean(candidate?.sourceEventId);
  const coords = /^city:([-\d.]+),([-\d.]+):/.exec(id);
  const current = coords
    && id === capitalCityId(baseName, coords.slice(1).map(Number))
    && baseName
    && baseName.length <= 160
    && regionId
    && regionId.length <= 160
    ? { id, baseName, regionId, ...(sourceEventId && sourceEventId.length <= 160 ? { sourceEventId } : {}) }
    : null;
  const remaining = retired.filter((name) => name !== fold(current?.baseName));
  return current || remaining.length
    ? { ...(current ? { current } : {}), ...(remaining.length ? { retired: remaining } : {}) }
    : undefined;
};

export const capitalMapNames = (world) => {
  const current = new Set();
  const retired = new Set();
  for (const [country, sheet] of Object.entries(world?.countryStats || {})) {
    if (fold(world?.polityOverrides?.[country]?.status) === "dissolved") continue;
    const map = normalizeCapitalMap(sheet?.capitalMap);
    if (map?.current) current.add(fold(map.current.baseName));
    for (const name of list(map?.retired)) retired.add(name);
  }
  for (const name of current) retired.delete(name);
  return { current: [...current].sort(), retired: [...retired].sort() };
};

export const capitalNameForReference = (world, ref, fallback = "") => (
  clean(world?.cityRenames?.[fold(ref?.baseName)]) || clean(fallback) || clean(ref?.baseName)
);

// A full Stats refresh measures the country, not its choice of seat. Explicit
// ordinary capital patches may still change it, but cannot retain a stale link.
export const mergeCapitalMap = (base, patch, { nativeCapitalMap, replaceComponents = false } = {}) => {
  const prior = normalizeCapitalMap(base?.capitalMap);
  if (nativeCapitalMap !== undefined) return normalizeCapitalMap(nativeCapitalMap);
  if (!prior) return undefined;
  if (!prior.current || replaceComponents || !clean(patch?.capital) || fold(patch.capital) === fold(base.capital)) {
    return prior;
  }
  return normalizeCapitalMap({ retired: [...list(prior.retired), prior.current.baseName] });
};
