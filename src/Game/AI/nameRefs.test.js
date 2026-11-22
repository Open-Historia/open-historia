/*! Open Historia — names, said with their kind: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/nameRefs.test.js
//
// Runs without node_modules: nameRefs.js imports nothing.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { findUnitByRef, foldName, kindOfName, plainName, readNameRef, regionNamer, stripKindTags, unitHandles } from "./nameRefs.js";

test("a name is read with the kind it was given", () => {
    assert.deepEqual(readNameRef("region: Georgia"), { kind: "region", name: "Georgia", bracket: "", written: "region: Georgia" });
    assert.deepEqual(readNameRef("country: Georgia"), { kind: "country", name: "Georgia", bracket: "", written: "country: Georgia" });
    assert.equal(readNameRef("Country:North Korea").kind, "country");
    assert.equal(readNameRef("city: Atlanta").kind, "city");
    assert.equal(readNameRef("unit: 3rd Infantry Division").kind, "unit");
    assert.equal(readNameRef("structure: Camp Humphreys").kind, "structure");
    assert.equal(readNameRef("building: Camp Humphreys").kind, "structure", "an event's places write a structure so");
    assert.equal(readNameRef("sea: Black Sea").kind, "sea");
    assert.equal(readNameRef("group: Wagner").kind, "group");
});

// The kinds are the tags the game itself writes and teaches, and nothing a
// model might write instead: an English synonym is no more a kind than a
// French one is (the owner, 2026-11-13: no keywording anywhere).
test("only the game's own tags are kinds: a synonym in any language is part of the name", () => {
    for (const written of ["state: Georgia", "province: Hamhung", "oblast: Kharkiv", "town: Atlanta", "base: Camp Humphreys", "nation: Georgia"]) {
        assert.deepEqual(readNameRef(written), { kind: "", name: written, bracket: "", written }, written);
    }
    for (const written of ["province : Hamhung", "ville: Atlanta", "État: Géorgie", "провинция: Хамхын"]) {
        assert.equal(readNameRef(written).kind, "", written);
    }
    assert.equal(readNameRef("province = Hamhung").name, "province = Hamhung", "a tag is written with a colon");
    assert.equal(stripKindTags("near town: Kharkiv").kinds.size, 0);
});

test("a name with no kind is itself, and a word before a colon that is no kind is part of it", () => {
    assert.deepEqual(readNameRef("Hamhung"), { kind: "", name: "Hamhung", bracket: "", written: "Hamhung" });
    assert.equal(readNameRef("Ost: Mark").name, "Ost: Mark");
    assert.equal(readNameRef("  \"Hamhung\"  ").name, "Hamhung");
    assert.equal(readNameRef("").name, "");
    assert.equal(readNameRef(null).name, "");
});

test("what stands in brackets after a name is kept apart from it", () => {
    // Seen in a 45-skip test (2026-10-09): shown "Hamhung (4441)", the model wrote
    // it back as the region, it matched nothing, and four transfers were dropped.
    assert.deepEqual(readNameRef("Hamhung (4441)"), { kind: "", name: "Hamhung", bracket: "4441", written: "Hamhung (4441)" });
    assert.equal(readNameRef("Pomorskie (POL.11_1)").bracket, "POL.11_1");
    assert.equal(readNameRef("Hamhung [id 4441]").bracket, "4441");
    assert.equal(readNameRef("Hamhung (id: 4441)").bracket, "4441");
    assert.equal(readNameRef("Hamhung (#4441)").bracket, "4441");
    assert.equal(readNameRef("region: Georgia (United States)").name, "Georgia");
    assert.equal(readNameRef("region: Georgia (United States)").bracket, "United States");
    assert.equal(plainName("region: Hamhung (4441)"), "Hamhung");
    assert.equal(plainName("Hamhung"), "Hamhung");
});

test("a phrase gives up its tags and says what kind each name was", () => {
    const address = stripKindTags("Fort Stewart, region: Georgia, country: United States");
    assert.equal(address.text, "Fort Stewart, Georgia, United States");
    assert.equal(kindOfName(address.kinds, "Georgia"), "region");
    assert.equal(kindOfName(address.kinds, "United States"), "country");
    assert.equal(kindOfName(address.kinds, "Fort Stewart"), "");

    const near = stripKindTags("near city: Kharkiv, country: Ukraine");
    assert.equal(near.text, "near Kharkiv, Ukraine");
    assert.equal(kindOfName(near.kinds, "Kharkiv"), "city");

    const vector = stripKindTags("80 km from city: Kyiv, country: Ukraine toward city: Kharkiv, country: Ukraine");
    assert.equal(vector.text, "80 km from Kyiv, Ukraine toward Kharkiv, Ukraine");
    assert.equal(kindOfName(vector.kinds, "Kyiv"), "city");
    assert.equal(kindOfName(vector.kinds, "Ukraine"), "country", "the name ends where the grammar goes on");

    const facing = stripKindTags("region: Donetsk Oblast, country: Ukraine facing country: Russia");
    assert.equal(facing.text, "Donetsk Oblast, Ukraine facing Russia");
    assert.equal(kindOfName(facing.kinds, "Russia"), "country");
    assert.equal(kindOfName(facing.kinds, "Donetsk Oblast"), "region");

    const between = stripKindTags("between city: Kyiv, country: Ukraine and city: Kharkiv, country: Ukraine");
    assert.equal(between.text, "between Kyiv, Ukraine and Kharkiv, Ukraine");

    assert.equal(stripKindTags("sea: Black Sea").text, "Black Sea");
    assert.equal(kindOfName(stripKindTags("sea: Black Sea").kinds, "Black Sea"), "sea");
    // An article is a word of the name like any other: no language's is taken off.
    assert.equal(kindOfName(stripKindTags("sea: Black Sea").kinds, "the Black Sea"), "");
    assert.equal(kindOfName(stripKindTags("sea: la mer Noire").kinds, "la mer Noire"), "sea");
});

test("the words that end a tagged name are the placement grammar's own", () => {
    const opposite = stripKindTags("region: Donetsk Oblast opposite country: Russia");
    assert.equal(kindOfName(opposite.kinds, "Donetsk Oblast"), "", "\"opposite\" is no word of the grammar, so it does not end the name");
    assert.equal(kindOfName(opposite.kinds, "Donetsk Oblast opposite"), "region");
    assert.equal(kindOfName(opposite.kinds, "Russia"), "country");
    const facing = stripKindTags("region: Donetsk Oblast facing country: Russia");
    assert.equal(kindOfName(facing.kinds, "Donetsk Oblast"), "region");
});

test("a script that writes its letters with marks keeps them when a name is folded", () => {
    // दिल्ली and दाल्ला differ only by their vowel signs; so do が and か.
    assert.notEqual(foldName("दिल्ली"), foldName("दाल्ला"));
    assert.notEqual(foldName("がっこう"), foldName("かっこう"));
    assert.equal(foldName("Ｄｉｌｌｉ ").length > 0, true);
    assert.equal(foldName("Кривий  Ріг"), foldName("кривий ріг"));
});

test("a phrase with no tag is left exactly as it was", () => {
    for (const phrase of ["Kharkiv, Ukraine", "off Sevastopol, Ukraine", "[36.2, 50.0]", "12:30 at the bridge", ""]) {
        const read = stripKindTags(phrase);
        assert.equal(read.text, phrase);
        assert.equal(read.kinds.size, 0);
    }
});

test("two spellings of one name fold together", () => {
    assert.equal(foldName("  Côte d’Ivoire "), foldName("cote divoire"));
    assert.equal(foldName("3rd Infantry-Division"), "3rd infantry division");
});

const UNITS = [
    { id: "u-1", name: "3rd Infantry Division", ownerCode: "United States" },
    { id: "u-2", name: "1st Army", ownerCode: "France" },
    { id: "u-3", name: "1st Army", ownerCode: "Germany" },
    { id: "u-4", name: "Carrier Strike Group 5", ownerCode: "United States" },
];

test("a unit is listed by its name, with its owner only where another shares it", () => {
    const handles = unitHandles(UNITS);
    assert.equal(handles.get("u-1"), "3rd Infantry Division");
    assert.equal(handles.get("u-2"), "1st Army (France)");
    assert.equal(handles.get("u-3"), "1st Army (Germany)");
});

test("a unit is found by its name as the roster spells it, case and spacing aside", () => {
    assert.equal(findUnitByRef("3rd Infantry Division", UNITS)?.id, "u-1");
    assert.equal(findUnitByRef("unit: 3rd infantry  division", UNITS)?.id, "u-1");
    assert.equal(findUnitByRef("3rd Infantry Division (United States)", UNITS)?.id, "u-1");
    // The save's own key is still read, for a saved order and a model that has seen one.
    assert.equal(findUnitByRef("u-4", UNITS)?.id, "u-4");
    assert.equal(findUnitByRef("Carrier Strike Group 5 (u-4)", UNITS)?.id, "u-4");
    // A name the roster does not spell is no unit: the model is told, and names it right next time.
    assert.equal(findUnitByRef("the 3rd Infantry Division", UNITS), null, "an article is no part of the roster's name");
    assert.equal(findUnitByRef("US 3rd Infantry Division", UNITS), null, "a name inside a longer one is not that name");
    assert.equal(findUnitByRef("3rd Infantry", UNITS), null);
});

test("a name two units share is told apart by its owner, exactly, and never guessed", () => {
    assert.equal(findUnitByRef("1st Army", UNITS), null);
    assert.equal(findUnitByRef("1st Army (France)", UNITS)?.id, "u-2");
    assert.equal(findUnitByRef("1st Army (Germany)", UNITS)?.id, "u-3");
    assert.equal(findUnitByRef("1st Army", UNITS, { owner: "France" })?.id, "u-2", "the operation's own owner decides");
    assert.equal(findUnitByRef("1st Army (Spain)", UNITS), null);
    // English and other readings of prose are gone alike: neither names the owner.
    assert.equal(findUnitByRef("1st Army, Germany", UNITS), null);
    assert.equal(findUnitByRef("Germany's 1st Army", UNITS), null);
    assert.equal(findUnitByRef("la 1st Army d'Allemagne", UNITS), null);
    assert.equal(findUnitByRef("1st Army", UNITS, { context: "The French government ordered it. France moves north." }), null, "the event's words are not read");
});

test("a unit of any script is found the same way", () => {
    const units = [
        { id: "r-1", name: "1-я гвардейская танковая армия", ownerCode: "Россия" },
        { id: "r-2", name: "1-я армия", ownerCode: "Россия" },
        { id: "u-1", name: "1-я армия", ownerCode: "Україна" },
        { id: "j-1", name: "第1師団", ownerCode: "日本" },
    ];
    assert.equal(findUnitByRef("1-я гвардейская танковая армия", units)?.id, "r-1");
    assert.equal(findUnitByRef("unit: 1-Я Гвардейская Танковая Армия", units)?.id, "r-1");
    assert.equal(findUnitByRef("第1師団", units)?.id, "j-1");
    assert.equal(findUnitByRef("1-я армия", units), null);
    assert.equal(findUnitByRef("1-я армия (Україна)", units)?.id, "u-1");
    assert.equal(findUnitByRef("1-я армия", units, { owner: "Россия" })?.id, "r-2");
    assert.equal(findUnitByRef("гвардейская танковая армия", units), null);
});

test("a name no unit has finds nothing, and neither does another kind of thing", () => {
    assert.equal(findUnitByRef("9th Panzer Division", UNITS), null);
    assert.equal(findUnitByRef("1st", UNITS), null, "a short fragment is in a dozen names");
    assert.equal(findUnitByRef("region: 3rd Infantry Division", UNITS), null);
    assert.equal(findUnitByRef("", UNITS), null);
    assert.equal(findUnitByRef("3rd Infantry Division", null), null);
});

// ---------------------------------------------------------------------------
// Wiring: gameplay.js does not load under bare node, so its use of these is
// checked in its source.
// ---------------------------------------------------------------------------

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("the model is shown names and no ids: regions, units and structures", () => {
    const context = read("./promptContext.js");
    assert.ok(!/\[id \$\{unit\.id\}\]/.test(context), "the unit list carries no unit id");
    assert.ok(!/\[id \$\{marker\.id\}\]/.test(context), "the structures list carries no id");
    assert.ok(!/id \$\{unit\.id\}/.test(context), "standing orders name their unit");
    assert.ok(!/region \$\{unit\.regionId\}/.test(context), "a unit's line carries no region id");
    assert.ok(!/id \$\{unit\.id\}/.test(read("./forcePosture.js")));
    assert.ok(!/\(\$\{row\.regionId\}\)/.test(read("./standingContext.js")));
    const vocab = read("./regionVocab.js");
    assert.match(vocab, /options\.regionIds === true/, "region ids are listed only when a caller asks");
    assert.match(vocab, /region: <name>/);
});

test("what the model writes is turned into the save's keys before anything looks it up", () => {
    const gameplay = read("./gameplay.js");
    const validate = gameplay.slice(gameplay.indexOf("export const validateGeneratedWorldChanges"));
    assert.ok(validate.indexOf("canonicalizeNamedThings(containers, world);") > 0, "validation reads names first");
    assert.ok(validate.indexOf("canonicalizeNamedThings(containers, world);") < validate.indexOf("await resolveRegionTransfers(containers, world"), "before the regions are resolved");
    const placing = gameplay.slice(gameplay.indexOf("const resolvePlacements = async"));
    assert.ok(placing.indexOf("canonicalizeNamedThings(containers, world);") < placing.indexOf("const placing = [];"), "a Director's own placing pass reads them too");
    const canonical = gameplay.slice(gameplay.indexOf("const canonicalizeNamedThings ="), gameplay.indexOf("const resolvePlacements = async"));
    assert.match(canonical, /findUnitByRef\(written, units, \{ owner: normalizeString\(op\.ownerCode \?\? op\.owner\) \}\)/, "a unit by its name and owner, never by the event's words");
    assert.equal(/context/.test(canonical), false);
    assert.match(gameplay, /const plainRegionRef = \(value\) =>/, "a region reference is taken down to its name");
    assert.match(gameplay, /bracketHints\.set\(transfer, bracket\)/, "what stood in brackets is kept as a hint");
    assert.match(gameplay, /\(id\.kind \|\| name\.kind\) === "country"/, "country: <name> is the whole of its land");
});

test("the templates and the schema ask for names", () => {
    const prompts = read("./defaultPrompts.json");
    assert.ok(!prompts.includes("or give its id"));
    assert.ok(!prompts.includes("only ids from Current Military Units"));
    assert.ok(!prompts.includes("by name and id"));
    assert.ok(prompts.includes("never an id"));
    const schemas = read("./gameplaySchemas.js");
    assert.ok(!schemas.includes("The region's id, or its plain name."));
    assert.ok(!schemas.includes("Existing unit identifier."));
    assert.ok(!schemas.includes("Existing marker id"));
    assert.match(schemas, /region: Hamhung/);
});

test("a region is named by its name, with its kind where the name alone could be something else", () => {
    const regions = [
        { id: "2102", name: "Donetsk", country: "Ukraine" },
        { id: "USA.11_1", name: "Georgia", country: "United States" },
        { id: "4441", name: "Lincoln", country: "United States" },
        { id: "4442", name: "Lincoln", country: "United Kingdom" },
        { id: "77", name: "Ruritania", country: "Graustark" },
        { id: "78", name: "Unnamed" },
    ];
    const name = regionNamer(regions, { countries: ["Ruritania"] });
    assert.equal(name("2102"), "Donetsk");
    assert.equal(name("4441"), "region: Lincoln", "a name two regions share");
    assert.equal(name("4442"), "region: Lincoln");
    // Georgia is a country only by a row of another map; here it is no country.
    assert.equal(name("USA.11_1"), "Georgia");
    assert.equal(regionNamer([...regions, { id: "GEO.1_1", name: "Tbilisi", country: "Georgia" }])("USA.11_1"), "region: Georgia", "named like a country of the map");
    assert.equal(name("77"), "region: Ruritania", "named like a polity the game knows");
    assert.equal(name("9999"), "", "an id the map does not have is never handed back");
    assert.equal(regionNamer(null)("2102"), "");
    // A lookup row's base country counts as its country.
    assert.equal(regionNamer([{ id: "a", name: "Poland", base: "Poland" }])("a"), "region: Poland");
});
