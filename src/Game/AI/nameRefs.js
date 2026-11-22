/*! Open Historia — names, said with their kind © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything the model refers to, it refers to by NAME. The map's own keys (a
// region's "4441", a unit's "unit-17a…") are the save's business: they are not
// shown to the model and it is not asked for them.
//
// A name alone can be two things. Georgia is a country in the Caucasus and a
// state of the United States, and a move to "Fort Stewart, Georgia, United
// States" was marched to Tbilisi (a 45-skip test, 2026-10-09). So a name may
// be said with its KIND in front of it:
//
//   region: Georgia          the province, state or other region of that name
//   country: Georgia         the country
//   city: Atlanta            a town the map marks
//   sea: Black Sea           open water
//   unit: 3rd Infantry Division
//   structure: Camp Humphreys   (also written "building: Camp Humphreys")
//
// and a place inside another reads outward, each part with its kind:
//
//   "Fort Stewart, region: Georgia, country: United States"
//
// The same test showed what an id beside a name costs. Told that a region was
// "Hamhung (4441)", the model wrote exactly that back as the region, it matched
// nothing, and a treaty's four transfers were dropped. A name written with
// something in brackets after it is still read here, because a model that has
// seen the form once goes on writing it.
//
// DELIBERATELY IMPORT-FREE, like placement.js, so it runs under bare node.

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// The kinds, each by the tag the game itself writes and teaches: the
// placement directive (placement.js PLACEMENT_DIRECTIVE) names country, region,
// city, sea, unit and structure, an event's places write a structure
// "building:" (eventPlaces.js), and a battlefield's side may be a group. A word
// before a colon that is none of these is part of the name: "province:" or
// "town:" is not read as a kind, in English or in any other language, because
// a list of the words a model might use instead is a list that never ends
// (the owner, 2026-11-13: no keywording anywhere).
const KIND_OF_WORD = new Map([
    ["country", "country"],
    ["region", "region"],
    ["city", "city"],
    ["sea", "sea"],
    ["unit", "unit"],
    ["structure", "structure"],
    ["building", "structure"],
    ["group", "group"],
]);
const KIND_WORD_PATTERN = [...KIND_OF_WORD.keys()].join("|");
const WHOLE_TAG = new RegExp(`^(${KIND_WORD_PATTERN})\\s*:\\s*(.+)$`, "i");
// A tag inside a phrase: at its start, or after a space, a comma or a bracket.
const TAG_IN_PHRASE = new RegExp(`(^|[\\s,(\\[])(${KIND_WORD_PATTERN})\\s*:\\s*`, "gi");
// Where a tagged name ends inside a phrase, when no comma or other tag ends it:
// the words that join two places in the placement directive's own grammar
// ("between A and B", "A facing B", "80 km from A toward B").
const NAME_END = /\s+(?:and|facing|toward)\s+/i;
// "Hamhung (4441)", "Hamhung [id 4441]", "Hamhung (#4441)": the ways the game
// itself once wrote a key beside a name.
const TRAILING_BRACKET = /^(.*\S)\s*[([]\s*(?:id\s*[:#]?\s*|#\s*)?([^()[\]]{1,64}?)\s*[)\]]$/i;

// Lower case, accents off, punctuation to spaces: how two spellings of one
// name are told to be the same. The marks a script writes its letters with
// (a Devanagari vowel sign, a Japanese voicing mark) are part of the letter
// and stay, or two names of those scripts would fold together.
export const foldName = (value) => asText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

// One written reference: its kind when it was given one, the name, and what
// stood in brackets after the name (an id the model copied, or the country a
// region is in). `written` is the text as it came.
//   "region: Hamhung"   -> { kind: "region", name: "Hamhung", bracket: "" }
//   "Hamhung (4441)"    -> { kind: "", name: "Hamhung", bracket: "4441" }
//   "country: Georgia"  -> { kind: "country", name: "Georgia", bracket: "" }
export const readNameRef = (value) => {
    const written = asText(value);
    let kind = "";
    let name = written.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    const tagged = name.match(WHOLE_TAG);
    if (tagged) {
        kind = KIND_OF_WORD.get(tagged[1].toLowerCase()) ?? "";
        name = tagged[2].trim();
    }
    let bracket = "";
    const bracketed = name.match(TRAILING_BRACKET);
    if (bracketed) {
        name = bracketed[1].trim();
        bracket = bracketed[2].trim();
    }
    return { kind, name, bracket, written };
};

// The name alone, whatever was written round it. A text with no tag and no
// bracket comes back as it was.
export const plainName = (value) => readNameRef(value).name;

// A placement phrase with its kind tags taken out, and the kind each tagged
// name was given:
//   "Fort Stewart, region: Georgia, country: United States"
//     -> { text: "Fort Stewart, Georgia, United States",
//          kinds: Map { "georgia" => "region", "united states" => "country" } }
// A phrase with no tag in it comes back unchanged with an empty map.
export const stripKindTags = (phrase) => {
    const source = asText(phrase);
    const kinds = new Map();
    if (!source || !source.includes(":")) return { text: source, kinds };
    const tags = [...source.matchAll(TAG_IN_PHRASE)].map((match) => ({
        from: match.index + match[1].length,
        to: match.index + match[0].length,
        kind: KIND_OF_WORD.get(match[2].toLowerCase()) ?? "",
    }));
    if (!tags.length) return { text: source, kinds };
    let text = "";
    let cursor = 0;
    for (const [index, tag] of tags.entries()) {
        text += source.slice(cursor, tag.from);
        cursor = tag.to;
        const rest = source.slice(tag.to, tags[index + 1]?.from ?? source.length);
        const untilComma = rest.split(",")[0];
        const name = untilComma.split(NAME_END)[0].replace(/[)\].;]+$/, "").trim();
        const key = foldName(name);
        if (key && tag.kind && !kinds.has(key)) kinds.set(key, tag.kind);
    }
    text += source.slice(cursor);
    return { text: text.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim(), kinds };
};

// The kind a phrase gave a name, "" when it gave none.
export const kindOfName = (kinds, name) => (kinds?.size ? kinds.get(foldName(name)) ?? "" : "");

// ---------------------------------------------------------------------------
// Regions, by name
// ---------------------------------------------------------------------------
//
// What a region is called where the model is told of it: its name, and
// "region: <name>" where the name alone could be read as something else — a
// name several regions of the map share, or a region named like a country
// (the state of Georgia beside the country). `regions` are catalog rows
// ({ id, name, country }; a lookup row's `base` or `owner` stands for the
// country); `countries` adds the names of polities the rows do not carry.
// Answers "" for an id the rows do not have: the caller says what it can
// instead, never the id. The name counts are kept per rows array, which the
// region catalog hands out once per map.
const regionNameIndex = new WeakMap();
const indexRegionNames = (regions) => {
    const cached = regionNameIndex.get(regions);
    if (cached) return cached;
    const byId = new Map();
    const count = new Map();
    const countries = new Set();
    for (const region of regions) {
        const id = asText(region?.id);
        const name = asText(region?.name);
        if (!id || !name) continue;
        byId.set(id, name);
        const key = foldName(name);
        if (key) count.set(key, (count.get(key) ?? 0) + 1);
        const country = foldName(region?.country ?? region?.base ?? region?.owner);
        if (country) countries.add(country);
    }
    const index = { byId, count, countries };
    regionNameIndex.set(regions, index);
    return index;
};
export const regionNamer = (regions, { countries = [] } = {}) => {
    const index = indexRegionNames(Array.isArray(regions) ? regions : []);
    const extra = new Set(asArray(countries).map(foldName).filter(Boolean));
    return (id) => {
        const name = index.byId.get(asText(id));
        if (!name) return "";
        const key = foldName(name);
        return (index.count.get(key) ?? 0) > 1 || index.countries.has(key) || extra.has(key) ? `region: ${name}` : name;
    };
};

// ---------------------------------------------------------------------------
// Units, by name
// ---------------------------------------------------------------------------
//
// A unit is ordered about by its name: "3rd Infantry Division". Two powers
// can each have a 1st Army, so a name that is not the only one of its kind is
// said with its owner in brackets — "1st Army (France)" — which is how the
// roster lists it (unitHandles below). Its id is still read, for a saved
// order that carries one and for a model that has seen ids before.

// What each unit is called where the model is told of it: its name, and its
// owner after it in brackets when another unit shares the name.
export const unitHandles = (units) => {
    const count = new Map();
    for (const unit of asArray(units)) {
        const key = foldName(unit?.name);
        if (key) count.set(key, (count.get(key) ?? 0) + 1);
    }
    const handles = new Map();
    for (const unit of asArray(units)) {
        const name = asText(unit?.name) || asText(unit?.id);
        const shared = (count.get(foldName(unit?.name)) ?? 0) > 1 && asText(unit?.ownerCode);
        handles.set(unit?.id, shared ? `${name} (${asText(unit.ownerCode)})` : name);
    }
    return handles;
};

// Of units that cannot be told apart (the same name, owner and kind), the one
// raised last, for an order that removes one of them: a twin left on the map by
// an earlier turn goes, and the first of them stays. Null when the written name
// fits units that differ, or none.
export const newestTwinByRef = (written, units) => {
    const ref = readNameRef(asText(written));
    if (!ref.name || (ref.kind && ref.kind !== "unit")) return null;
    const twins = asArray(units).filter((unit) => foldName(unit?.name) === foldName(ref.name)
        && (!ref.bracket || foldName(unit?.ownerCode) === foldName(ref.bracket)));
    if (twins.length < 2) return null;
    const [first] = twins;
    if (!twins.every((unit) => foldName(unit?.ownerCode) === foldName(first?.ownerCode) && foldName(unit?.type) === foldName(first?.type))) return null;
    return [...twins].sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")))[twins.length - 1];
};

// The unit a written reference means, or null when it means none or could
// mean two. It is found by its name exactly as the roster spells it (case,
// accents and spacing aside), and two units of one name are told apart by
// their owner: the one the roster writes after the name ("1st Army (France)",
// unitHandles above), or `owner`, whose unit the operation says it is. Nothing
// else is read: not the event's words for an owner, not "France's 1st Army",
// not a name found inside a longer one. Those were English readings of prose,
// and a name the roster does not have is a name to tell the model it got
// wrong (the owner, 2026-11-13: no keywording anywhere).
export const findUnitByRef = (written, units, { owner = "" } = {}) => {
    const list = asArray(units);
    const raw = asText(written);
    if (!raw) return null;
    const byId = list.find((unit) => asText(unit?.id) === raw);
    if (byId) return byId;
    const ref = readNameRef(raw);
    if (ref.kind && ref.kind !== "unit") return null;
    if (ref.bracket) {
        const bracketId = list.find((unit) => asText(unit?.id) === ref.bracket);
        if (bracketId) return bracketId;
    }
    const key = foldName(ref.name);
    const named = key ? list.filter((unit) => foldName(unit?.name) === key) : [];
    if (named.length === 1) return named[0];
    for (const hint of [ref.bracket, owner]) {
        if (!foldName(hint)) continue;
        const owned = named.filter((unit) => foldName(unit?.ownerCode) === foldName(hint));
        if (owned.length === 1) return owned[0];
    }
    return null;
};
