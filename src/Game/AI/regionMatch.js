// Match a region name the model wrote against the regions a scenario actually
// renders. Import-free so it runs in node tests and in the resolver alike.
//
// The model names regions from its own knowledge — "Kharkiv Oblast",
// "Zaporizhzhya", "Crimea" — while a scenario names them however its author did:
// a hand-drawn world names each region after its town ("Kharkiv", "Zaporizhzhia"),
// GADM after the province with native spelling ("Kharkiv", "Zaporizhzhya"). Exact
// matching alone dropped most of what the model meant, and every dropped
// transfer is a narrated annexation that never moved the map. The rules below
// widen the match one careful step at a time and accept a candidate only when
// it is the single region left standing: an ambiguous name resolves to nothing
// rather than to the wrong province.

export const foldRegionKey = (value) =>
  String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´.]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Administrative words a model appends that a map rarely carries. The
// autonomous-* forms come first so the longer suffix wins.
const REGION_SUFFIX = /\s+(?:autonomous (?:republic|region|oblast|okrug)|federal district|special administrative region|oblast|krai|okrug|voivodeship|governorate|prefecture|province|region|district|county|state|territory|department|canton|municipality|division|emirate|zone|area|city)$/;
const REGION_PREFIX = /^(?:(?:the|republic of|province of|state of|district of|region of|county of|city of|oblast of|governorate of|prefecture of)\s+)+/;

export const stripRegionAffixes = (key) => {
  let next = String(key ?? "");
  let previous;
  do {
    previous = next;
    next = next.replace(REGION_PREFIX, "").replace(REGION_SUFFIX, "").trim();
  } while (next !== previous && next.length > 0);
  return next;
};

// Bounded Levenshtein: stops counting once the distance exceeds `max`, so a
// pool of a few thousand names costs almost nothing.
export const editDistance = (a, b, max = Infinity) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = new Array(b.length + 1);
  let current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length];
};

const namesOf = (region) => {
  const names = [region?.name, ...(Array.isArray(region?.aliases) ? region.aliases : [])];
  return names.map(foldRegionKey).filter(Boolean);
};

const unique = (hits) => {
  const ids = new Set(hits.map((region) => region.id));
  return ids.size === 1 ? hits[0] : null;
};

// Resolve `query` (a name or id the model wrote) inside `pool` (the regions it
// could legitimately mean). Returns { region, rule } or null. Rules, in order:
//   exact      folded name or alias equals the query
//   affix      equal once administrative prefixes/suffixes are stripped from either
//   substring  one name contains the other (four characters or more)
//   fuzzy      one or two edits apart (short names allow one), stripped forms
// Every rule requires a single surviving region.
// One name contains the other as whole words: "kharkiv oblast" contains
// "kharkiv"; "zaporizhzhya" does NOT contain "pori" just because the letters
// sit inside it — that mistake resolved a Ukrainian oblast to a Finnish town.
const containsWords = (outer, inner) => outer === inner || outer.startsWith(`${inner} `) || outer.endsWith(` ${inner}`) || outer.includes(` ${inner} `);

export const matchRegionName = (query, pool, { allowFuzzy = true, minSubstring = 4, maxFuzzy = 2 } = {}) => {
  const key = foldRegionKey(query);
  if (!key || !Array.isArray(pool) || pool.length === 0) return null;
  const stripped = stripRegionAffixes(key);

  const exact = pool.filter((region) => namesOf(region).includes(key));
  if (exact.length) {
    const hit = unique(exact);
    return hit ? { region: hit, rule: "exact" } : null;
  }

  if (stripped && stripped !== key) {
    const affix = pool.filter((region) => namesOf(region).some((name) => name === stripped || stripRegionAffixes(name) === stripped));
    if (affix.length) {
      const hit = unique(affix);
      return hit ? { region: hit, rule: "affix" } : null;
    }
  }
  const affixOnName = pool.filter((region) => namesOf(region).some((name) => stripRegionAffixes(name) === key));
  if (affixOnName.length) {
    const hit = unique(affixOnName);
    return hit ? { region: hit, rule: "affix" } : null;
  }

  const probe = stripped || key;
  if (probe.length >= minSubstring) {
    const contains = pool.filter((region) => namesOf(region).some((name) => {
      const bare = stripRegionAffixes(name) || name;
      return bare.length >= minSubstring && (containsWords(bare, probe) || containsWords(probe, bare));
    }));
    // Several hits mean the model wrote a word shared by neighbours ("Kremenchuk"
    // over Kremenchuk North and Kremenchuk South when no plain Kremenchuk
    // exists): stop here rather than let the fuzzy rule pick one of them.
    if (contains.length) {
      const hit = unique(contains);
      return hit ? { region: hit, rule: "substring" } : null;
    }
  }

  // maxFuzzy lets a caller with a wide pool (the whole map, when the model
  // named no losing side) allow a single edit only; inside one power's
  // regions two edits are safe.
  if (allowFuzzy && probe.length >= 5 && maxFuzzy >= 1) {
    const budget = Math.min(maxFuzzy, probe.length >= 8 ? 2 : 1);
    let best = [];
    let bestDistance = budget + 1;
    for (const region of pool) {
      for (const name of namesOf(region)) {
        const bare = stripRegionAffixes(name) || name;
        if (bare.length < 5) continue;
        const distance = editDistance(probe, bare, budget);
        if (distance > budget) continue;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = [region];
        } else if (distance === bestDistance) {
          best.push(region);
        }
      }
    }
    if (best.length) {
      const hit = unique(best);
      if (hit) return { region: hit, rule: "fuzzy" };
    }
  }

  return null;
};
