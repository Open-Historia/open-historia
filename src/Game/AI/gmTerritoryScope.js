const clean = (value) => String(value ?? "").trim();

const normalize = (value) => clean(value)
  .normalize("NFD")
  .toLowerCase()
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const BROAD_SCOPE_CUE = /^(?:all|every|entire|whole|full)$/;
const TERRITORY_NOUN = /^(?:territor(?:y|ies)|regions?|states?|provinces?|lands?|areas?)$/;
const TERRITORY_PRESERVATION_VERB = /^(?:keep|keeps|kept|keeping|retain|retains|retained|retaining|preserve|preserves|preserved|preserving|remain|remains|remained|remaining|stay|stays|stayed|staying)$/;
// Words allowed between the cue and the country's own words: "all OF THE north
// korean states". "all of ITS provinces" names no country and never expands.
const PHRASE_FILLER = new Set(["of", "the", "its", "their", "own"]);
// What may follow the noun inside its clause for the phrase to still mean the
// whole footprint: nothing, or the hand-over itself ("... states TO the DPRK").
// Anything else — "east of the Dnieper", "it currently occupies", "in the
// Caribbean" — narrows the scope, and the detector must stay out of it.
const HANDOVER_WORDS = new Set([
  "to", "into", "under", "go", "goes", "shall", "should", "must", "will", "are",
  "is", "become", "becomes", "be", "now", "immediately",
]);
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

// Clauses, not the whole request: "make the DPRK independent, in all north
// korean states. not just contested" must see "in all north korean states" on
// its own, while "all Ukrainian regions east of the Dnieper" keeps its
// qualifier attached to the phrase it narrows.
const clauseTokens = (request) => clean(request)
  .split(/[.,;:!?()[\]\n\r]+|\s+[-–—]+\s+/)
  .map((clause) => normalize(clause).split(" ").filter(Boolean))
  .filter((tokens) => tokens.length > 0);

// True when one clause carries "<cue> [filler] <the country's words> <noun>"
// followed by nothing or a hand-over word — every significant word of the
// country between cue and noun, and nothing else there. "all its eastern
// provinces", "every Ukrainian province it occupies" and "all French overseas
// territories" all fail this on purpose: they describe a part of the country.
const clauseNamesWholeFootprint = (tokens, words) => {
  for (let cue = 0; cue < tokens.length; cue += 1) {
    if (!BROAD_SCOPE_CUE.test(tokens[cue])) continue;
    let noun = -1;
    for (let index = cue + 1; index < tokens.length; index += 1) {
      if (TERRITORY_NOUN.test(tokens[index])) {
        noun = index;
        break;
      }
    }
    if (noun < 0) continue;
    // "all united states territories": the country's own generic word is also a
    // territory noun; the phrase's noun is the last of the run.
    while (noun + 1 < tokens.length && TERRITORY_NOUN.test(tokens[noun + 1])) noun += 1;
    const between = tokens
      .slice(cue + 1, noun)
      .filter((token) => !PHRASE_FILLER.has(token) && !GENERIC_COUNTRY_WORDS.has(token));
    if (!between.length) continue;
    const everyWordNamed = words.every((word) => between.some((token) => tokenMatches(word, token)));
    const nothingElse = between.every((token) => words.some((word) => tokenMatches(word, token)));
    if (!everyWordNamed || !nothingElse) continue;
    const after = tokens[noun + 1];
    if (after !== undefined && !HANDOVER_WORDS.has(after)) continue;
    return true;
  }
  return false;
};

// GM requests such as "all North Korean states" describe a BASE-GEOGRAPHY
// footprint, not "every region the current sovereign happens to own". This is
// important in alternate-history maps where the current owner may be a larger
// polity (e.g. the Soviet Union) while the requested independent polity should
// receive only the rendered North-Korean footprint.
//
// The detector is deliberately conservative: it activates only when the user
// explicitly asks for one country's exhaustive, unqualified territorial scope
// AND exactly one rendered base-country footprint matches the request.
// Ambiguity — or any qualifier narrowing the scope — means no expansion.
export const detectExplicitBaseTerritoryScope = (request, catalog = []) => {
  const clauses = clauseTokens(request);
  if (!clauses.length) return null;

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
    if (!clauses.some((tokens) => clauseNamesWholeFootprint(tokens, words))) continue;
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


// A broad GM instruction such as "all Baltic territories" or "every Ukrainian
// region" is a set-level contract, not permission for the model to sample a few
// representative provinces. The exact semantic membership of a named region group
// may still need the model to spell out its base geographies, but once the request
// uses exhaustive language the provider MUST use the native territorialScopes
// envelope so JavaScript can expand and verify the complete rendered footprint.
export const requestDemandsExhaustiveTerritorialScope = (request) => {
  for (const tokens of clauseTokens(request)) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!BROAD_SCOPE_CUE.test(tokens[index])) continue;
      const nounOffset = tokens.slice(index + 1).findIndex((token) => TERRITORY_NOUN.test(token));
      if (nounOffset < 0) continue;
      const nounIndex = index + 1 + nounOffset;

      // Exhaustive words also appear in preservation constraints such as
      // "Lithuania keeps all of its territory". That sentence explicitly asks
      // for NO territorial mutation, so forcing territorialScopes would turn a
      // Puppet-only GM request into an unrelated map transaction. Treat a nearby
      // preservation verb as a no-change qualifier, not as a scope command.
      const preservationBeforeCue = tokens
        .slice(Math.max(0, index - 3), index)
        .some((token) => TERRITORY_PRESERVATION_VERB.test(token));
      const preservationAfterNoun = TERRITORY_PRESERVATION_VERB.test(tokens[nounIndex + 1] || "");
      if (preservationBeforeCue || preservationAfterNoun) continue;

      // The explicit territory noun is the strongest signal. "all of France" is
      // also exhaustive, but the legacy single-country detector already handles
      // that form; this guard is aimed at the ambiguous/group forms that otherwise
      // degrade into representative province lists.
      return true;
    }
  }
  return false;
};

const baseGeographyGroups = (catalog = []) => {
  const groups = new Map();
  for (const region of Array.isArray(catalog) ? catalog : []) {
    const id = clean(region?.id);
    const code = clean(region?.countryCode);
    const name = clean(region?.country);
    const key = normalize(code || name);
    if (!id || !key || !name) continue;
    const row = groups.get(key) || { code, name, regions: [] };
    row.regions.push(region);
    groups.set(key, row);
  }
  return [...groups.values()];
};

const geographyTokenMatches = (token, group) => {
  const folded = normalize(token);
  if (!folded) return false;
  if (folded === normalize(group.code) || folded === normalize(group.name)) return true;
  const requestedWords = countryWords(token);
  const groupWords = countryWords(group.name);
  if (!requestedWords.length || !groupWords.length) return false;
  return requestedWords.every((word) => groupWords.some((candidate) => tokenMatches(candidate, word)))
    && groupWords.every((word) => requestedWords.some((candidate) => tokenMatches(word, candidate)));
};

// Resolve the model's compact GM scope declaration against immutable rendered
// base geography, never against the polity that happens to own the land today.
// This is the multi-geography counterpart to detectExplicitBaseTerritoryScope: a
// request may say "the Baltic states" and the model can name Estonia, Latvia and
// Lithuania once; native code then expands EVERY rendered region in those three
// footprints. Missing/ambiguous names fail closed before preview.
export const resolveGameMasterBaseGeographyScope = (baseCountries, catalog = []) => {
  const groups = baseGeographyGroups(catalog);
  const requested = [...new Set((Array.isArray(baseCountries) ? baseCountries : [])
    .map(clean).filter(Boolean))];
  if (!requested.length) return { regions: [], countries: [], error: "territorial scope requires at least one base country/geography" };

  const countries = [];
  const regions = [];
  const seenRegionIds = new Set();
  for (const token of requested) {
    const matches = groups.filter((group) => geographyTokenMatches(token, group));
    if (matches.length !== 1) {
      const suffix = matches.length
        ? `matched more than one rendered base geography: ${matches.map((entry) => entry.name).join(", ")}`
        : "did not match any rendered base geography";
      return { regions: [], countries: [], error: `base geography "${token}" ${suffix}` };
    }
    const group = matches[0];
    countries.push({ code: group.code, name: group.name, count: group.regions.length });
    for (const region of group.regions) {
      const id = clean(region?.id);
      if (!id || seenRegionIds.has(id)) continue;
      seenRegionIds.add(id);
      regions.push(region);
    }
  }

  return { countries, regions, error: "" };
};

export const scopeContainsRegion = (scope, regionId) =>
  Boolean(scope?.regionIds?.includes(clean(regionId)));
