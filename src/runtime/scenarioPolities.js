/*! Open Historia — canonical active scenario polity roster */

const TECHNICAL_POLITY_KEYS = new Set([
  "NA", "XCA", "Z01", "Z02", "Z03", "Z04", "Z05", "Z06", "Z07", "Z08", "Z09",
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isTechnicalPolity = (value) => TECHNICAL_POLITY_KEYS.has(clean(value).toUpperCase());

/**
 * Resolve scenario aliases to the canonical polity key owned by polityOverrides.
 * Unknown non-technical tokens are returned unchanged so campaign-created actors
 * can still enter the roster through canonical world ledgers.
 */
export const createScenarioPolityResolver = (world = {}) => {
  const aliases = new Map();
  for (const [rawKey, rawOverride] of Object.entries(world?.polityOverrides ?? {})) {
    const key = clean(rawKey);
    if (!key || isTechnicalPolity(key)) continue;
    aliases.set(key.toLocaleLowerCase(), key);
    const override = isPlainObject(rawOverride) ? rawOverride : {};
    for (const token of [override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]) {
      const alias = clean(token);
      if (alias) aliases.set(alias.toLocaleLowerCase(), key);
    }
  }
  return (value) => {
    const token = clean(value);
    if (!token || isTechnicalPolity(token)) return "";
    return aliases.get(token.toLocaleLowerCase()) ?? token;
  };
};

const addPolity = (map, resolver, rawValue, extra = {}) => {
  const polityKey = resolver(rawValue);
  if (!polityKey) return;
  const current = map.get(polityKey) ?? { polityKey, sovereign: true, hasTerritory: false, active: true };
  map.set(polityKey, { ...current, ...extra, polityKey });
};

/**
 * Canonical scenario polity roster.
 *
 * IMPORTANT: countryStats and powerStatus are deliberately NOT membership
 * sources. They are derived ledgers and may contain stock/legacy rows that are
 * not actors in the current scenario. Allowing those rows to define the world
 * caused the 202-polity Fault Lines map to expand into a 381-actor power
 * calibration universe.
 */
export const collectScenarioPoliticalPolities = (world = {}) => {
  const resolve = createScenarioPolityResolver(world);
  const collected = new Map();

  for (const owner of Array.isArray(world?.ownerCodes) ? world.ownerCodes : []) {
    addPolity(collected, resolve, owner, { hasTerritory: true, sovereign: true });
  }
  for (const owner of Object.values(world?.regionOwnershipOverrides ?? {})) {
    addPolity(collected, resolve, owner, { hasTerritory: true, sovereign: true });
  }
  for (const [key, override] of Object.entries(world?.polityOverrides ?? {})) {
    const status = clean(override?.status).toLocaleLowerCase();
    addPolity(collected, resolve, key, {
      sovereign: status !== "dissolved" && status !== "inactive",
      active: status !== "dissolved" && status !== "inactive",
    });
  }
  for (const key of Object.keys(world?.politicalActors?.byPolity ?? {})) {
    addPolity(collected, resolve, key, {});
  }
  for (const war of Array.isArray(world?.wars) ? world.wars : []) {
    for (const side of [war?.sideA, war?.sideB]) {
      for (const polity of Array.isArray(side) ? side : []) addPolity(collected, resolve, polity, {});
    }
  }

  return [...collected.values()].sort((left, right) => left.polityKey.localeCompare(right.polityKey));
};

export const collectActiveScenarioPolityKeys = (world = {}) => (
  collectScenarioPoliticalPolities(world)
    .filter((entry) => entry.active !== false)
    .map((entry) => entry.polityKey)
);
