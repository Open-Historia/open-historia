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
//   structure: Camp Humphreys
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

// Each kind, and the words a model writes for it. "state" is a region: the
// states of a country are what the word is used for beside a place name, and
// a country is said "country".
const KIND_WORDS = Object.freeze({
    country: ["country", "nation", "polity", "power"],
    region: ["region", "province", "state", "territory", "oblast", "district", "prefecture", "governorate", "county"],
    city: ["city", "town", "capital", "port", "village"],
    sea: ["sea", "ocean", "waters"],
    unit: ["unit", "formation"],
    structure: ["structure", "base", "facility", "installation", "marker"],
    group: ["group", "faction"],
});
const KIND_OF_WORD = new Map(Object.entries(KIND_WORDS).flatMap(([kind, words]) => words.map((word) => [word, kind])));
const KIND_WORD_PATTERN = [...KIND_OF_WORD.keys()].join("|");
const WHOLE_TAG = new RegExp(`^(${KIND_WORD_PATTERN})\\s*[:=]\\s*(.+)$`, "i");
// A tag inside a phrase: at its start, or after a space, a comma or a bracket.
const TAG_IN_PHRASE = new RegExp(`(^|[\\s,(\\[])(${KIND_WORD_PATTERN})\\s*:\\s*`, "gi");
// Where a tagged name ends inside a phrase, when no comma or other tag ends it.
const NAME_END = /\s+(?:and|facing|toward|towards|opposite|bordering|nearest|closest|on the border with|on the frontier with)\s+/i;
// "Hamhung (4441)", "Hamhung [id 4441]", "Hamhung (#4441)".
const TRAILING_BRACKET = /^(.*\S)\s*[([]\s*(?:(?:id|region id|gid|code|no\.?|number)\s*[:#]?\s*|#\s*)?([^()[\]]{1,64}?)\s*[)\]]$/i;

// Lower case, accents off, punctuation to spaces: how two spellings of one
// name are told to be the same.
export const foldName = (value) => asText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
        const key = foldName(name.replace(/^(?:the|a|an)\s+/i, ""));
        if (key && tag.kind && !kinds.has(key)) kinds.set(key, tag.kind);
    }
    text += source.slice(cursor);
    return { text: text.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim(), kinds };
};

// The kind a phrase gave a name, "" when it gave none.
export const kindOfName = (kinds, name) => (kinds?.size ? kinds.get(foldName(asText(name).replace(/^(?:the|a|an)\s+/i, ""))) ?? "" : "");

// ---------------------------------------------------------------------------
// Units, by name
// ---------------------------------------------------------------------------
//
// A unit is ordered about by its name: "3rd Infantry Division". Two powers
// can each have a 1st Army, so a name that is not the only one of its kind is
// said with its owner — "1st Army (France)", "1st Army, France" — which is how
// the roster lists it (unitHandles below). Its id is still read, for a saved
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

// The unit a written reference means, or null when it means none or could
// mean two. `owner`: whose unit the operation says it is, when it says.
// `context`: the event's own words, which name the owner when nothing else does.
export const findUnitByRef = (written, units, { owner = "", context = "" } = {}) => {
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
    const sameOwner = (unit, name) => Boolean(foldName(name)) && foldName(unit?.ownerCode) === foldName(name);
    const named = (name) => list.filter((unit) => foldName(unit?.name) === foldName(name));
    const choose = (candidates, saidOwner) => {
        if (candidates.length === 1 && !saidOwner) return candidates[0];
        for (const hint of [saidOwner, owner]) {
            if (!foldName(hint)) continue;
            const owned = candidates.filter((unit) => sameOwner(unit, hint));
            if (owned.length === 1) return owned[0];
            // The owner it was said with holds no such unit: the name decides, when it can.
            if (!owned.length && candidates.length === 1) return candidates[0];
        }
        if (candidates.length === 1) return candidates[0];
        const told = ` ${foldName(context)} `;
        const inContext = candidates.filter((unit) => foldName(unit?.ownerCode) && told.includes(` ${foldName(unit.ownerCode)} `));
        return inContext.length === 1 ? inContext[0] : null;
    };
    // The name as written, its owner in brackets after it or not.
    let candidates = named(ref.name);
    if (candidates.length) return choose(candidates, ref.bracket);
    // "1st Army, France" and "France's 1st Army".
    const comma = ref.name.lastIndexOf(",");
    if (comma > 0) {
        candidates = named(ref.name.slice(0, comma));
        if (candidates.length) return choose(candidates, ref.name.slice(comma + 1));
    }
    const possessive = ref.name.match(/^(.+?)['’]s?\s+(.+)$/);
    if (possessive) {
        candidates = named(possessive[2]);
        if (candidates.length) return choose(candidates, possessive[1]);
    }
    // The whole of one unit's name inside what was written, or the other way
    // round ("the 3rd Infantry Division" for "US 3rd Infantry Division"), when
    // exactly one unit fits. Short names are left alone: "1st" is in a dozen.
    const key = foldName(ref.name.replace(/^(?:the|a|an)\s+/i, ""));
    if (key.length >= 8) {
        candidates = list.filter((unit) => {
            const name = foldName(unit?.name);
            return name.length >= 8 && (` ${name} `.includes(` ${key} `) || ` ${key} `.includes(` ${name} `));
        });
        if (candidates.length) return choose(candidates, ref.bracket);
    }
    return null;
};
