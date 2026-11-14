// The Game Master's territorial scopes, resolved on the rendered map.
//
// A GM request that covers whole countries' land ("the Baltic states", "all of
// Ukraine", "every North Korean province") is answered in the transaction's
// territorialScopes: the model names the base geographies, the countries the
// rendered map draws, and native code hands every rendered region in them to
// the recipient (gameplay.js expandGameMasterTerritorialScopes). That field is
// all that is read.
//
// The request's own words were read too. An English phrase ("all ... states",
// "every ... region") made the engine move a whole footprint by itself, and
// refused an answer that had no territorialScopes; neither ever fired in
// another language, and in English both misread the phrasings they did not
// expect. The model reads the request, in any language, and fills the field.
//
// A name in territorialScopes is looked up exactly: the base geography's code
// or its name as the catalog the GM is shown lists it, with case and spacing
// folded and nothing else. It was matched by word stems with English filler
// words dropped, where "Korea" was either Korea.

const clean = (value) => String(value ?? "").trim();

// A name as written, with case and spacing folded and nothing else.
const nameKey = (value) => clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

const baseGeographyGroups = (catalog = []) => {
  const groups = new Map();
  for (const region of Array.isArray(catalog) ? catalog : []) {
    const id = clean(region?.id);
    const code = clean(region?.countryCode);
    const name = clean(region?.country);
    const key = nameKey(code || name);
    if (!id || !key || !name) continue;
    const row = groups.get(key) || { code, name, regions: [] };
    row.regions.push(region);
    groups.set(key, row);
  }
  return [...groups.values()];
};

// Resolve the model's compact GM scope declaration against immutable rendered
// base geography, never against the polity that happens to own the land today:
// a request may say "the Baltic states" and the model names Estonia, Latvia
// and Lithuania once; native code then expands EVERY rendered region in those
// three footprints. A name that is no base geography's code or name, or is
// more than one's, fails closed before preview.
export const resolveGameMasterBaseGeographyScope = (baseCountries, catalog = []) => {
  const groups = baseGeographyGroups(catalog);
  const requested = [...new Set((Array.isArray(baseCountries) ? baseCountries : [])
    .map(clean).filter(Boolean))];
  if (!requested.length) return { regions: [], countries: [], error: "territorial scope requires at least one base country/geography" };

  const countries = [];
  const regions = [];
  const seenRegionIds = new Set();
  for (const token of requested) {
    const key = nameKey(token);
    const matches = groups.filter((group) => key === nameKey(group.code) || key === nameKey(group.name));
    if (matches.length !== 1) {
      const suffix = matches.length
        ? `matched more than one rendered base geography: ${matches.map((entry) => entry.name).join(", ")}`
        : "did not match any rendered base geography; use a name or code exactly as the base-geography catalog lists it";
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
