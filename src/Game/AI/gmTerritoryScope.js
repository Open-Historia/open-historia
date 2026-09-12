const clean = (value) => String(value ?? "").trim();

const normalize = (value) => clean(value)
  .normalize("NFD")
  .toLowerCase()
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const BROAD_SCOPE_CUE = /\b(?:all|every|entire|whole|full)\b/;
const TERRITORY_NOUN = /\b(?:territor(?:y|ies)|regions?|states?|provinces?|lands?|areas?)\b/;
const GENERIC_COUNTRY_WORDS = new Set([
  "the", "republic", "kingdom", "empire", "federation", "federal", "state", "states",
  "democratic", "people", "peoples", "socialist", "union", "commonwealth", "islamic",
]);

const tokenMatches = (base, requestToken) => {
  if (!base || !requestToken) return false;
  if (base === requestToken) return true;
  const length = Math.min(base.length, requestToken.length);
  if (length < 4) return false;
  const stemLength = length >= 7 ? 5 : 4;
  return base.slice(0, stemLength) === requestToken.slice(0, stemLength);
};

const countryWords = (name) => normalize(name)
  .split(" ")
  .filter(Boolean)
  .filter((word) => !GENERIC_COUNTRY_WORDS.has(word));

// GM requests such as "all North Korean states" describe a BASE-GEOGRAPHY
// footprint, not "every region the current sovereign happens to own". This is
// important in alternate-history maps where the current owner may be a larger
// polity (e.g. the Soviet Union) while the requested independent polity should
// receive only the rendered North-Korean footprint.
//
// The detector is deliberately conservative: it activates only when the user
// explicitly asks for an exhaustive territorial scope AND exactly one rendered
// base-country footprint matches the request. Ambiguity means no expansion.
export const detectExplicitBaseTerritoryScope = (request, catalog = []) => {
  const text = normalize(request);
  if (!text || !BROAD_SCOPE_CUE.test(text) || !TERRITORY_NOUN.test(text)) return null;

  const requestTokens = text.split(" ").filter(Boolean);
  const groups = new Map();

  for (const region of Array.isArray(catalog) ? catalog : []) {
    const code = clean(region?.countryCode);
    const name = clean(region?.country);
    const groupKey = code || normalize(name);
    if (!groupKey || !name || !clean(region?.id)) continue;
    const existing = groups.get(groupKey) || { code, name, regions: [] };
    existing.regions.push(region);
    if (!existing.name && name) existing.name = name;
    if (!existing.code && code) existing.code = code;
    groups.set(groupKey, existing);
  }

  const matches = [];
  for (const group of groups.values()) {
    const words = countryWords(group.name);
    if (!words.length) continue;
    const matched = words.every((word) => requestTokens.some((token) => tokenMatches(word, token)));
    if (!matched) continue;
    // Prefer the most specific multi-word geography when two names share a stem
    // (e.g. North Korea vs South Korea). Every significant word must match, so
    // directional/geographic qualifiers naturally disambiguate.
    const score = words.reduce((sum, word) => sum + Math.min(word.length, 12), 0);
    matches.push({ ...group, score });
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score || b.regions.length - a.regions.length);
  if (matches.length > 1 && matches[0].score === matches[1].score) return null;

  const winner = matches[0];
  return {
    countryCode: winner.code,
    countryName: winner.name,
    regionIds: winner.regions.map((region) => clean(region?.id)).filter(Boolean),
  };
};

export const scopeContainsRegion = (scope, regionId) =>
  Boolean(scope?.regionIds?.includes(clean(regionId)));
