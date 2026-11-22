// A region name the model wrote, against the regions a scenario actually
// renders. Import-free so it runs in node tests and in the resolver alike.
//
// What moves a border is only ever an exact name: the map's own name or
// alias, written with its marks, case or spacing different (foldRegionKey),
// and only when one region alone answers to it (regionNamedIn,
// foldedRegionIndex). The model writes the map's names because it is given
// them and told so; one it gets wrong is left out and said in the receipt with
// the map's nearest names (nearestRegionNames), and the next answer writes it
// right. "there should be absolutely no keywording done in this game
// anywhere" (the owner, 2026-11-13): an English administrative word stripped
// off ("Kharkiv Oblast" to Kharkiv), one name found inside another, or a
// spelling one or two edits away, took the wrong province in English and never
// fired for "Oblast de Kharkiv". Nothing here knows a word of any language.
// matchRegionName and nearestRegionNames only search, by spelling alone (one
// name's whole words inside the other's, a letter or two apart): what the
// model's own lookup functions and its receipts offer it to choose from
// (lookupTools.js); the resolver of transfers and control never asks them.

// What a string folds to is remembered. One name is looked up against every
// city and every region on the map, several times over (exact, affix,
// substring, fuzzy), and a placement phrase such as "Fort Drum, New York" asks
// for several names: folding each of the map's ten thousand names afresh every
// time cost five seconds of a time skip on the built-in map, after its last
// event had already arrived. The answer depends on the string alone, so the
// memo changes nothing but the time. It is emptied when it grows past any real
// map, so text a model made up cannot pile up in it.
const MEMO_LIMIT = 60_000;
const memoized = (compute) => {
  const memo = new Map();
  return (value) => {
    const text = String(value ?? "");
    const known = memo.get(text);
    if (known !== undefined) return known;
    const answer = compute(text);
    if (memo.size >= MEMO_LIMIT) memo.clear();
    memo.set(text, answer);
    return answer;
  };
};

const foldText = (text) =>
  text
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´.]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const foldRegionKey = memoized(foldText);

// The same fold with nothing remembered, for a list far longer than any map
// that is folded once and let go: the world's seventy thousand towns
// (worldCities.js). Through the memo they would empty it of the map's own
// names on the way in and sit in it afterwards.
export const foldRegionKeyOnce = (value) => foldText(String(value ?? ""));

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

// The whole map by each region's name and aliases as foldRegionKey folds
// them: "Chisinau", "chişinău" and "CHIŞINĂU" are one key, and so are
// "Karbala" and "Karbala'". A name the map spells with marks the model left
// off (or the other way round) is still that region's name, map-wide, as
// long as one region alone folds to it (regionsFoldedAs); the resolver asks
// this after the exact spelling and before anything that guesses.
export const foldedRegionIndex = (regions) => {
  const index = new Map();
  for (const region of Array.isArray(regions) ? regions : []) {
    if (!region?.id) continue;
    for (const key of namesOf(region)) {
      const bucket = index.get(key);
      if (!bucket) index.set(key, [region]);
      else if (!bucket.some((entry) => entry.id === region.id)) bucket.push(region);
    }
  }
  return index;
};

export const regionsFoldedAs = (index, query) => {
  const key = foldRegionKey(query);
  return key ? index?.get(key) ?? [] : [];
};

// The one region of `pool` (the regions a written name may mean: the losing
// side's) whose name or alias is the name written, its marks, case and
// spacing aside; null when none is, or more than one. Exact in every
// language: "Kharkiv Oblast" and "Oblast de Kharkiv" are both not "Kharkiv".
export const regionNamedIn = (query, pool) => {
  const key = foldRegionKey(query);
  if (!key || !Array.isArray(pool)) return null;
  return unique(pool.filter((region) => region?.id && namesOf(region).includes(key)));
};

// One name's whole words inside the other's, in any language that spaces its
// words: "kharkiv" stands inside "kharkiv oblast" and "oblast de kharkiv";
// "zaporizhzhya" does NOT hold "pori" just because the letters sit inside it
// (that mistake once resolved a Ukrainian oblast to a Finnish town).
export const containsWords = (outer, inner) => outer === inner || outer.startsWith(`${inner} `) || outer.endsWith(` ${inner}`) || outer.includes(` ${inner} `);

// How far apart two folded names are by spelling, bounded by `max`: the whole
// names, or one against a single word of the other (five letters or more):
// "basra" is one letter from the "basrah" of "al basrah", and "kharkov" one
// from the "kharkiv" of "oblast de kharkiv". Spelling alone, never a word of
// any language: the leading "al" was once set aside by a list of Arabic
// articles, and "oblast" by a list of English administrative words.
const SPELLED_WORD = 5;
export const spellingDistance = (key, name, max = Infinity) => {
  let best = editDistance(key, name, max);
  for (const word of name.split(" ")) {
    if (word.length >= SPELLED_WORD && word !== name) best = Math.min(best, editDistance(key, word, max));
  }
  for (const word of key.split(" ")) {
    if (word.length >= SPELLED_WORD && word !== key) best = Math.min(best, editDistance(word, name, max));
  }
  return best;
};

// The map's own names nearest a name it does not know, for telling the model
// what it may have meant (the receipt of a dropped transfer or capture, a
// lookup that found no region): from the regions it could have meant, the
// closest by spelling, a shared start counting before edits. Names only, at
// most `limit`.
export const nearestRegionNames = (query, pool, { limit = 3 } = {}) => {
  const key = foldRegionKey(query);
  if (!key || !Array.isArray(pool) || pool.length === 0) return [];
  const scored = [];
  const seen = new Set();
  for (const region of pool) {
    const name = String(region?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const bare = foldRegionKey(name);
    if (!bare) continue;
    let shared = 0;
    while (shared < key.length && shared < bare.length && key[shared] === bare[shared]) shared += 1;
    const words = containsWords(bare, key) || containsWords(key, bare);
    const distance = spellingDistance(key, bare, Math.max(key.length, 3));
    // A close spelling, a common start of three letters, or one name inside the other.
    if (distance > Math.max(2, Math.floor(key.length / 2)) && shared < 3 && !words) continue;
    scored.push({ name, score: (words ? 0 : distance) - Math.min(shared, 4) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => entry.name);
};

// A search, for what the model looks up (lookupTools.js find_region, and the
// lookups that take a region by name): `query` (a name the model typed) inside
// `pool`, widened step by step, by spelling alone. It offers the map's own
// names for the model to choose from, and every answer gives the region's own
// name; the resolver of transfers and control never asks it (regionNamedIn
// above is the resolver's). Returns { region, rule } or null. Rules, in order:
//   exact   folded name or alias equals the query
//   words   one name's whole words stand inside the other's (four characters or more)
//   fuzzy   one or two edits apart (short names allow one), as spellingDistance measures
// Every rule requires a single surviving region.
export const matchRegionName = (query, pool, { allowFuzzy = true, minSubstring = 4, maxFuzzy = 2 } = {}) => {
  const key = foldRegionKey(query);
  if (!key || !Array.isArray(pool) || pool.length === 0) return null;

  const exact = pool.filter((region) => namesOf(region).includes(key));
  if (exact.length) {
    const hit = unique(exact);
    return hit ? { region: hit, rule: "exact" } : null;
  }

  if (key.length >= minSubstring) {
    const contains = pool.filter((region) => namesOf(region).some((name) => name.length >= minSubstring && (containsWords(name, key) || containsWords(key, name))));
    // Several hits mean the model wrote a word shared by neighbours ("Kremenchuk"
    // over Kremenchuk North and Kremenchuk South when no plain Kremenchuk
    // exists): stop here rather than let the fuzzy rule pick one of them.
    if (contains.length) {
      const hit = unique(contains);
      return hit ? { region: hit, rule: "words" } : null;
    }
  }

  // maxFuzzy lets a caller with a wide pool (the whole map) allow a single
  // edit only; inside one power's regions two edits are safe.
  if (allowFuzzy && key.length >= 5 && maxFuzzy >= 1) {
    const budget = Math.min(maxFuzzy, key.length >= 8 ? 2 : 1);
    let best = [];
    let bestDistance = budget + 1;
    for (const region of pool) {
      for (const name of namesOf(region)) {
        if (name.length < 5) continue;
        const distance = spellingDistance(key, name, budget);
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
