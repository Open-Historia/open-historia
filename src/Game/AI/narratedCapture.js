/*! Open Historia — a capture an event tells of, put on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An event that says a town was taken, and moves the formation that took it
// there, but writes no control operation: the story has the town in new hands
// and the map does not. A strict attempt is told to add the operation
// (gameplay.js CONTROL_CHANGE_LANGUAGE), but a time skip is one request and is
// never sent back, so what the event already says is finished here instead.
//
// It is done only where the event's own operations show who took what:
//
//   1. a sentence STATES the capture of a named place: "captures Raqqa",
//      "Raqqa falls to …", "takes control of Raqqa", "Raqqa was liberated";
//   2. the place is a region, or a city the map puts in one region;
//   3. the same event moves or raises a formation of power O in that region,
//      or within about 60 km of that city (the caller finds those places);
//   4. the region is not O's already, and the event has no operation of its
//      own on it;
//   5. the sentence does not credit somebody else.
//
// A statement, and not an intention. "Launches a ground offensive to secure
// Raqqa" says what the offensive is for and not how it ended, and moves
// nothing: an infinitive ("to seize"), a participle of purpose ("aimed at
// capturing"), a modal, a negation, a failure or a claim is no capture. Nor is
// a part of the place ("the outskirts of Raqqa", "Raqqa's airport").
//
// English only: in a game played in another language no sentence matches and
// nothing is added, which is where things stood before.
//
// DELIBERATELY IMPORT-FREE, like nameRefs.js, so it runs under bare node.

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// How far from a named city a formation's destination may be and still be the
// formation that took it.
export const CAPTURE_REACH_KM = 60;

// Lower case, accents off, a hyphen a space, everything but letters, digits
// and apostrophes a space: "Ar-Raqqa's" -> ["ar", "raqqa's"]. A comma stays, as
// a word of its own: it is where one part of a sentence ends, which is how
// "In northern Syria, the Marines captured Raqqa" is told from "Syrian troops
// captured Raqqa".
const tokensOf = (value) => asText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/,/g, " , ")
    .replace(/[^\p{L}\p{N}',]+/gu, " ")
    .split(" ")
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

// A sentence, for this purpose, ends at a full stop, a question or exclamation
// mark, a semicolon, a colon, a dash between spaces or a line's end. Cutting
// too often only shortens what a cue may reach across.
// "U.S." is one word, "US": its stops end no sentence.
const withoutDottedInitials = (text) => asText(text).replace(/(?<!\p{L})(?:\p{L}\.){2,}/gu, (initials) => initials.replace(/\./g, ""));
const sentencesOf = (text) => withoutDottedInitials(text)
    .split(/[.!?;:\n]+|\s[-–—]+\s/)
    .map((part) => part.trim())
    .filter(Boolean);

// A leading article of a transliterated name, and the administrative word a
// region's name ends in: "Ar-Raqqa" is written "Raqqa", "Kharkiv Oblast" "Kharkiv".
const NAME_ARTICLES = new Set(["al", "ar", "as", "ash", "ad", "an", "at", "az", "el", "the"]);
const NAME_AFFIXES = new Set(["oblast", "governorate", "province", "region", "district", "prefecture", "county", "krai", "city", "state", "republic", "voivodeship"]);
const lettersIn = (tokens) => tokens.join("").length;

// Every way a place's name may stand in a sentence, as token lists.
const nameVariants = (names) => {
    const seen = new Map();
    const add = (tokens) => {
        if (tokens.length && lettersIn(tokens) >= 4) seen.set(tokens.join(" "), tokens);
    };
    for (const name of asArray(names)) {
        const full = tokensOf(name);
        add(full);
        const bare = NAME_ARTICLES.has(full[0]) ? full.slice(1) : full;
        add(bare);
        let cut = bare;
        while (cut.length > 1 && NAME_AFFIXES.has(cut[cut.length - 1])) cut = cut.slice(0, -1);
        add(cut);
    }
    return [...seen.values()];
};
// "Raqqa" and "Raqqah" are one name.
const sameToken = (a, b) => a === b || `${a}h` === b || a === `${b}h`;

// Where a name stands in a sentence: [{ start, end }], `end` exclusive. An
// occurrence written as a possessive ("Raqqa's airport") is a part of the
// place and is left out.
const occurrences = (tokens, variants) => {
    const found = [];
    for (const variant of variants) {
        for (let start = 0; start + variant.length <= tokens.length; start += 1) {
            let fits = true;
            for (let offset = 0; offset < variant.length && fits; offset += 1) {
                const last = offset === variant.length - 1;
                const token = tokens[start + offset];
                fits = sameToken(last ? token.replace(/'s$/, "") : token, variant[offset]);
            }
            if (!fits) continue;
            if (/'s$/.test(tokens[start + variant.length - 1])) continue;
            if (!found.some((entry) => entry.start <= start && entry.end >= start + variant.length)) {
                found.push({ start, end: start + variant.length });
            }
        }
    }
    return found;
};

// ---- the cue ------------------------------------------------------------------

// A finite verb of taking, with the place as its object. The bare forms
// ("forces capture Raqqa") are also the infinitive, so they count only with no
// "to" or modal just before them (BARE_BLOCKERS).
const TOOK = new Set([
    "captures", "captured", "seizes", "seized", "takes", "took", "retakes", "retook",
    "recaptures", "recaptured", "liberates", "liberated", "occupies", "occupied",
    "overruns", "overran", "conquers", "conquered", "secures", "secured",
]);
const TAKE_BARE = new Set(["capture", "seize", "take", "retake", "recapture", "liberate", "occupy", "overrun", "conquer"]);
const BARE_BLOCKERS = new Set(["to", "will", "would", "could", "may", "might", "should", "can", "cannot", "must", "shall", "and", "or", "not"]);
// "the captured city", "in occupied Raqqa": a participle used as a describing
// word, which says the place was already in those hands.
const DESCRIBING_BEFORE = new Set(["the", "a", "an", "in", "into", "of", "from", "to", "near", "around", "at", "toward", "towards", "across", "through", "within", "inside", "newly", "recently", "already", "previously", "formerly"]);
// "takes control of", "assumed full control over".
const CONTROL_VERBS = new Set(["takes", "took", "seizes", "seized", "assumes", "assumed", "establishes", "established", "gains", "gained", "wins", "won", "regains", "regained", "secures", "secured", "wrests", "wrested"]);
const CONTROL_BARE = new Set(["take", "seize", "assume", "establish", "gain", "win", "regain", "wrest"]);
const CONTROL_DEGREE = new Set(["full", "complete", "total", "firm", "effective", "military", "de", "facto", "undisputed"]);
// What may stand between the verb and the name and leave the name its object.
const OBJECT_FILLER = new Set([
    "the", "of", "city", "town", "capital", "provincial", "regional", "port", "stronghold", "fortress", "bastion",
    "strategic", "key", "vital", "entire", "whole", "all", "de", "facto", "held", "besieged", "contested",
    "embattled", "disputed", "ruined", "rebel", "enemy", "northern", "southern", "eastern", "western", "central",
    "ancient", "historic", "coastal", "border", "itself",
]);
// "the Syrian city of Raqqa", "the Islamic State stronghold of Raqqa": after one
// of these nouns a few words of whose it was may come before the verb.
const HEAD_NOUNS = new Set(["city", "town", "capital", "port", "stronghold", "fortress", "bastion"]);
// A part of the place, or somewhere beside it: never the place.
const PART_WORDS = new Set([
    "outskirts", "suburbs", "suburb", "parts", "part", "half", "most", "much", "some", "near", "outside", "around",
    "toward", "towards", "into", "from", "in", "at", "on", "airport", "airfield", "airbase", "district", "districts",
    "villages", "village", "road", "roads", "route", "routes", "bridge", "bridges", "dam", "base", "approaches",
    "north", "south", "east", "west", "province", "countryside", "perimeter", "edge", "above", "below", "beyond",
    "between", "behind", "with", "for", "by", "against", "under", "over", "after", "before",
]);
// Before the cue, any of these says the capture is not a fact: a negation, a
// modal, a condition, a failure, a claim, an intention.
const HEDGE_WORDS = new Set([
    "not", "never", "nor", "neither", "without", "unable", "would", "will", "could", "might", "should",
    "if", "unless", "until", "reportedly", "allegedly", "supposedly", "almost", "nearly", "bid", "poised",
    "sought", "cannot",
]);
const HEDGE_STEMS = ["fail", "claim", "alleg", "rumor", "rumour", "deni", "deny", "attempt", "repel", "repuls", "thwart", "vow", "plan", "aim", "seek", "prepar", "hope", "intend", "pledg", "promis"];
// "may" is also a month: it hedges only as "may have", "may be", "may yet".
const MAY_FOLLOWERS = new Set(["have", "be", "yet", "soon", "well", "still", "now"]);
const hedged = (tokens) => tokens.some((token, index) => (token === "may"
    ? MAY_FOLLOWERS.has(tokens[index + 1])
    : HEDGE_WORDS.has(token) || HEDGE_STEMS.some((stem) => token.startsWith(stem))));

// A bare verb with "to" or a modal within three words before it is not a fact.
const bareIsBlocked = (tokens, index) => {
    for (let back = 1; back <= 3 && index - back >= 0; back += 1) {
        if (BARE_BLOCKERS.has(tokens[index - back])) return true;
    }
    return false;
};

// The name as the object of a verb of taking: the index of that verb, or -1.
const takenAsObject = (tokens, start) => {
    let index = start - 1;
    let filler = 0;
    let headNoun = false;
    while (index >= 0 && OBJECT_FILLER.has(tokens[index]) && filler < 6) {
        if (HEAD_NOUNS.has(tokens[index])) headNoun = true;
        index -= 1;
        filler += 1;
    }
    // "control over <name>" reads as "control of <name>" does.
    if (index > 0 && tokens[index] === "over" && tokens[index - 1] === "control") index -= 1;
    // "… the Syrian city of Raqqa", "the Islamic State stronghold of Raqqa":
    // whose city it was, up to three words, and then the article they follow.
    // Without the article the words are something else that was taken
    // ("captured positions overlooking the city of Raqqa").
    if (headNoun && index >= 0 && !TOOK.has(tokens[index]) && !TAKE_BARE.has(tokens[index]) && tokens[index] !== "control") {
        let whose = 0;
        while (index >= 0 && whose < 3 && tokens[index] !== "the" && !TOOK.has(tokens[index]) && !TAKE_BARE.has(tokens[index])
            && !PART_WORDS.has(tokens[index]) && tokens[index] !== "control" && !/ing$/.test(tokens[index])) {
            index -= 1;
            whose += 1;
        }
        if (index < 0 || tokens[index] !== "the") return -1;
        index -= 1;
    }
    if (index < 0) return -1;
    // "control of <name>", "control over <name>", with the verb that took it before it.
    if (tokens[index] === "control" && ["of", "over"].includes(tokens[index + 1])) {
        let at = index - 1;
        while (at >= 0 && CONTROL_DEGREE.has(tokens[at])) at -= 1;
        if (at >= 0 && CONTROL_VERBS.has(tokens[at])) return at;
        if (at > 0 && CONTROL_BARE.has(tokens[at]) && !bareIsBlocked(tokens, at)) return at;
        return -1;
    }
    // The verb stands directly before the filler: "captured the city of Raqqa".
    // An "of" straight after it belongs to something else ("the capture of").
    const verb = tokens[index];
    if (TOOK.has(verb)) {
        const participle = /ed$/.test(verb);
        if (participle && index > 0 && DESCRIBING_BEFORE.has(tokens[index - 1])) return -1;
        return index;
    }
    if (TAKE_BARE.has(verb)) {
        // "the capture of Raqqa" is a noun, and says nothing of how it ended.
        if (tokens[index + 1] === "of") return -1;
        if (bareIsBlocked(tokens, index)) return -1;
        return index > 0 ? index : -1; // a sentence that opens with it is an order: "Capture Raqqa"
    }
    return -1;
};

// The name as the subject of its own fall: { length, linked }, the tokens the
// cue takes up after the name and whether it ends on the word that brings in
// who took it ("to", "by", "of"); null when there is none. "Raqqa falls to …",
// "Raqqa has fallen", "Raqqa was liberated by …", "Raqqa comes under the
// control of …", and a headline's "Raqqa Captured".
const SUBJECT_FILLER = new Set(["city", "town", "itself", "proper", "finally", "now", "then", "also", "fully", "completely", "officially", "formally"]);
const PARTICIPLES = new Set(["captured", "seized", "taken", "retaken", "recaptured", "liberated", "occupied", "overrun", "conquered", "secured"]);
const AFTER_FALL = new Set(["to", "after", "as", "in", "on", "following", "amid", "when", "with"]);
const AFTER_PARTICIPLE = new Set(["by", "as", "after", "in", "following", "from", "amid", "on", "when"]);
const fellAsSubject = (tokens, end) => {
    let index = end;
    while (index < tokens.length && SUBJECT_FILLER.has(tokens[index]) && index - end < 2) index += 1;
    const [a, b, c, d] = tokens.slice(index, index + 4);
    // `count` tokens of cue from `index`, and the linking word after them if it is there.
    const cue = (count, link) => {
        const linked = tokens[index + count] === link;
        return { length: index - end + count + (linked ? 1 : 0), linked };
    };
    const closes = (next, allowed) => next === undefined || allowed.has(next);
    if ((a === "falls" || a === "fell") && closes(b, AFTER_FALL)) return cue(1, "to");
    if (["has", "have", "had"].includes(a) && b === "fallen" && closes(c, AFTER_FALL)) return cue(2, "to");
    if (["is", "was", "are", "were"].includes(a)) {
        if (PARTICIPLES.has(b)) return cue(2, "by");
        if (SUBJECT_FILLER.has(b) && PARTICIPLES.has(c)) return cue(3, "by");
    }
    if (["has", "have", "had"].includes(a) && b === "been") {
        if (PARTICIPLES.has(c)) return cue(3, "by");
        if (SUBJECT_FILLER.has(c) && PARTICIPLES.has(d)) return cue(4, "by");
    }
    if (["comes", "came", "passes", "passed", "is", "was"].includes(a) && b === "under") {
        let at = index + 2;
        while (at < tokens.length && (tokens[at] === "the" || CONTROL_DEGREE.has(tokens[at]))) at += 1;
        if (tokens[at] === "control" && tokens[at + 1] === "of") return { length: at + 2 - end, linked: true };
    }
    if (PARTICIPLES.has(a) && a !== "taken" && a !== "overrun" && closes(b, AFTER_PARTICIPLE)) return cue(1, "by");
    return null;
};
// Whether the name stands as part of something else: "the outskirts of Raqqa
// were captured" is not Raqqa.
const partOfSomething = (tokens, start) => {
    let index = start - 1;
    while (index >= 0 && OBJECT_FILLER.has(tokens[index])) index -= 1;
    return index >= 0 && PART_WORDS.has(tokens[index]);
};

// Who a sentence says did it. Before the verb: the words back to the last
// comma, or to the last word that starts a where or a when ("After nine days in
// northern Syria the Marines captured …" is the Marines). After "to" or "by":
// the words up to the next comma or the next such word ("… fell to the Marines
// as Syrian troops withdrew" is the Marines).
const DOER_BOUNDS = new Set([",", "in", "at", "near", "after", "as", "while", "when", "following", "amid", "before", "but", "into", "across", "through", "from", "toward", "towards", "outside", "around", "against", "with", "on", "during", "since"]);
const doerBefore = (tokens, verbAt) => {
    let from = verbAt;
    while (from > 0 && verbAt - from < 14 && !DOER_BOUNDS.has(tokens[from - 1])) from -= 1;
    return tokens.slice(from, verbAt);
};
const doerAfter = (tokens, from) => {
    let to = from;
    while (to < tokens.length && to - from < 10 && !DOER_BOUNDS.has(tokens[to])) to += 1;
    return tokens.slice(from, to);
};

// Every sentence of a text that states the capture of a place of these names,
// and who each credits.
//   -> [{ sentence, form: "object" | "subject", doer: [tokens], named: boolean }]
// `doer` is the words that say who took it: before the verb for "X captured
// Raqqa", after "to" or "by" for "Raqqa fell to X". `named` is false when the
// sentence names nobody ("Raqqa falls").
export const statedCaptures = (text, names) => {
    const variants = nameVariants(names);
    const stated = [];
    if (!variants.length) return stated;
    for (const sentence of sentencesOf(text)) {
        const tokens = tokensOf(sentence);
        for (const { start, end } of occurrences(tokens, variants)) {
            const verbAt = takenAsObject(tokens, start);
            if (verbAt >= 0) {
                if (hedged(tokens.slice(0, verbAt))) continue;
                const doer = doerBefore(tokens, verbAt);
                stated.push({ sentence, form: "object", doer, named: doer.length > 0 });
                break;
            }
            const cue = fellAsSubject(tokens, end);
            if (cue) {
                if (hedged(tokens.slice(0, end + cue.length)) || partOfSomething(tokens, start)) continue;
                const doer = cue.linked ? doerAfter(tokens, end + cue.length) : [];
                stated.push({ sentence, form: "subject", doer, named: doer.length > 0 });
                break;
            }
        }
    }
    return stated;
};
// The first of them, or null.
export const statedCapture = (text, names) => statedCaptures(text, names)[0] ?? null;

// Any word a capture could be told with. A text without one is not read
// further, and the map is not opened for it.
const ANY_CUE = /\b(?:captur|seiz|retak|retook|recaptur|liberat|occup|overr[au]n|conquer|secure[sd]|fell\b|falls\b|fallen\b|took\b|takes\b|taken\b|control\b)/i;
export const mayNarrateCapture = (text) => ANY_CUE.test(asText(text));

// ---- who is credited ---------------------------------------------------------------

// Words of a formation's name that say whose it is not: "1st Infantry Division"
// shares all three with a dozen others.
const GENERIC_UNIT_WORDS = new Set([
    "force", "forces", "division", "army", "corps", "brigade", "regiment", "battalion", "fleet", "group", "command",
    "infantry", "armored", "armoured", "mechanized", "mechanised", "airborne", "cavalry", "rifle", "tank", "guards",
    "motor", "motorized", "expeditionary", "task", "squadron", "wing", "strike", "carrier", "joint", "combined",
    "northern", "southern", "eastern", "western", "central", "first", "second", "third", "special", "operations",
]);

// Whether some words name a power: its name as a phrase, or, for a name of one
// word, a word that begins like it ("Syrian" for Syria, "Iraqi" for Iraq).
const mentions = (tokens, name) => {
    const words = tokensOf(name);
    if (!words.length || !tokens.length) return false;
    if (words.length === 1) {
        const word = words[0];
        if (word.length < 4) return tokens.includes(word);
        const stem = word.slice(0, Math.max(4, word.length - 2));
        return tokens.some((token) => token.startsWith(stem));
    }
    for (let start = 0; start + words.length <= tokens.length; start += 1) {
        if (words.every((word, offset) => tokens[start + offset].replace(/'s$/, "") === word)) return true;
    }
    return false;
};
// Whether some words name the power that moved, by its name, another name it
// goes by, the formation's own name or a telling word of it ("Marines").
const mentionsMover = (tokens, move) => [move.owner, ...asArray(move.aliases)].some((name) => mentions(tokens, name))
    || mentions(tokens, move.unitName)
    || tokensOf(move.unitName).some((word) => word.length >= 5 && !GENERIC_UNIT_WORDS.has(word) && tokens.some((token) => token.startsWith(word)));

// The captures an event tells of and does not carry.
//   title, description   the event's own words
//   candidates           what its formations could have taken, found by the
//                        caller from where each one ends up:
//       { regionId, regionName, names: [the place's names], controller,
//         move: { owner, aliases, unitName } }
//     one entry per place per move; `names` are a region's own, or those of a
//     city in it that the formation ends within CAPTURE_REACH_KM of.
//   powers               every power and group the map knows, by name
//   changed              ids of the regions this event already has a control,
//                        transfer or group operation on
//   samePower(a, b)      whether two names are one power
// -> [{ regionId, regionName, place, fromCode, toCode, sentence }], one for a region
export const findNarratedCaptures = ({ title = "", description = "", candidates = [], powers = [], changed = [], samePower = null } = {}) => {
    const text = [asText(title), asText(description)].filter(Boolean).join(". ");
    if (!text || !mayNarrateCapture(text)) return [];
    const same = typeof samePower === "function"
        ? samePower
        : (a, b) => asText(a).toLowerCase() === asText(b).toLowerCase();
    const everything = tokensOf(withoutDottedInitials(text));
    const already = new Set(asArray(changed).map(asText));
    const byRegion = new Map();
    for (const candidate of asArray(candidates)) {
        const regionId = asText(candidate?.regionId);
        const owner = asText(candidate?.move?.owner);
        const controller = asText(candidate?.controller);
        if (!regionId || !owner || !controller || already.has(regionId) || same(owner, controller)) continue;
        const stated = statedCaptures(text, candidate.names);
        if (!stated.length) continue;
        // The mover has to be in the story at all.
        if (!mentionsMover(everything, candidate.move)) continue;
        const others = asArray(powers).filter((power) => asText(power) && !same(power, owner));
        // Every sentence that tells of the capture has to leave it the mover's:
        // a headline's "Raqqa Falls" over a text that gives it to somebody else
        // is somebody else's.
        const moversOwn = (statement) => {
            const creditsMover = mentionsMover(statement.doer, candidate.move);
            const creditsAnother = others.some((power) => mentions(statement.doer, power));
            // "Raqqa fell to …" says who took it: it must be the mover.
            if (statement.form === "subject" && statement.named && !creditsMover) return false;
            // Somebody else doing it, alone or beside the mover: "helped Iraqi
            // forces capture Mosul" is Iraq's, whoever marched in with them,
            // and a town two powers took together is not given to one.
            if (creditsAnother) return false;
            // Nobody named in the sentence: no other side of the story may be in
            // it either, the holder apart.
            if (!creditsMover) {
                const sentence = tokensOf(statement.sentence);
                if (others.some((power) => !same(power, controller) && mentions(sentence, power))) return false;
            }
            return true;
        };
        if (!stated.every(moversOwn)) continue;
        const entry = byRegion.get(regionId) ?? { regionId, regionName: asText(candidate.regionName), place: asText(asArray(candidate.names)[0]), fromCode: controller, sentence: stated[0].sentence, takers: [] };
        if (!entry.takers.some((taker) => same(taker, owner))) entry.takers.push(owner);
        byRegion.set(regionId, entry);
    }
    // Two powers' formations at one captured place, and nothing to say which
    // of them took it: left alone.
    return [...byRegion.values()]
        .filter((entry) => entry.takers.length === 1)
        .map(({ takers, ...entry }) => ({ ...entry, toCode: takers[0] }));
};
