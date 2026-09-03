/*! Open Historia — country picker list assembly © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Merges the AI's polity overrides onto the country list read from the tiles.
//
// Why this exists as its own pure module: it got this wrong in a way that only
// showed up in the UI. world.polityOverrides is keyed by country NAME — the same
// namespace as colors and internationalReputation — and its entries do not carry
// a `code` (checked across real saves: 85 overrides in one campaign, 84 of them
// name-keyed, none with a code). The merge treated that key as a code and did
//
//   merged.set(polity.code || key, { code: polity.code || key, name })
//
// so "Germany" was added ALONGSIDE the tile entry { code: "DEU", name: "Germany" }
// instead of updating it. The list then carried the same name twice, and in a long
// campaign dozens of times over.
//
// That is not cosmetic. The chat and spy pickers key their tiles AND their
// selection by name (`key={c.name}`, `isSelectedName(c.name)`), so duplicate
// names collide React keys: the same country renders repeatedly, a search misses
// the country it matched, and clicking one tile marks a different one selected
// without highlighting anything.

const norm = (value) => String(value ?? "").trim().toLowerCase();
const clean = (value) => String(value ?? "").trim();

export const mergeCountryOverrides = (countries, polityOverrides) => {
  // identity -> entry, plus a name index so an override keyed by name lands on
  // the entry that already carries it rather than creating a twin.
  const byId = new Map();
  const idByName = new Map();

  for (const entry of Array.isArray(countries) ? countries : []) {
    const name = clean(entry?.name);
    const code = clean(entry?.code);
    const id = code || name;
    if (!id || !name) continue;
    byId.set(id, { code, name });
    idByName.set(norm(name), id);
  }

  for (const [overrideKey, polity] of Object.entries(polityOverrides && typeof polityOverrides === "object" ? polityOverrides : {})) {
    const explicitCode = clean(polity?.code);
    const overrideName = clean(polity?.name);
    const key = clean(overrideKey);

    // Which existing entry does this describe? Resolved BEFORE the name, so a
    // nameless override can borrow the name of the entry it lands on instead of
    // degrading it to a bare key. An explicit code that names an entry wins;
    // then the key itself as an id (a code-keyed override); then the entry
    // already holding that name — under the key (the usual case, since the key
    // IS the name) or under the new name, so a rename updates in place rather
    // than splitting in two.
    const id = (explicitCode && byId.has(explicitCode) ? explicitCode : null)
      ?? (byId.has(key) ? key : null)
      ?? idByName.get(norm(key))
      ?? (overrideName ? idByName.get(norm(overrideName)) : null)
      ?? (explicitCode || key);
    if (!id) continue;

    const previous = byId.get(id);
    const name = overrideName || clean(previous?.name) || key;
    if (!name) continue;
    if (previous) idByName.delete(norm(previous.name));
    // Keep the tile's real code where there is one; a polity the AI invented has
    // no code and is identified by its name, as owners are everywhere else.
    byId.set(id, { code: previous?.code || explicitCode || id, name });
    idByName.set(norm(name), id);
  }

  // Unique names, guaranteed. The pickers cannot render a duplicate safely, and
  // this is the one place that can promise they never see one.
  const seen = new Set();
  return [...byId.values()]
    .filter((entry) => {
      const key = norm(entry.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

// Belt and braces for any list handed to a picker, whatever its source.
export const dedupeByName = (countries) => {
  const seen = new Set();
  return (Array.isArray(countries) ? countries : []).filter((entry) => {
    const key = norm(entry?.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
