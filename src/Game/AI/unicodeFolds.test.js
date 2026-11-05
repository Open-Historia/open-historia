/*! Open Historia — titles and names are compared in every script: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/unicodeFolds.test.js
//
// The engine compares what a model or a player wrote (the title of a treaty, a
// storyline, an event; the name of a Project, an institution, a structure, a
// place; a demand) by folding it to a key: lower case, accents off,
// punctuation out. Each of those folds kept `a-z0-9` and nothing else. A game
// played in Russian, Arabic or Chinese writes none of those, so its keys were
// all the same empty key: every title was every other title, and no name was
// ever found in a text. A player's log (2026-10-05, the game in Russian) has
// the titles, the orders and a Projects board written that way.
//
// Every such fold now keeps the letters, marks and digits of any script. Most
// are private one-liners, so each is cut out of its file and run here beside
// itself as it was, on the two things that matter:
//   - ASCII in, the same key out as before, byte for byte;
//   - two different titles in another script, two different keys.
// What the folds are FOR is tested where each is used (the timeline cleanup,
// the player's share, the Board, scripted beats, polls, demands, places in a
// text, power names, the map search…).

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { foldName } from "./regionFocus.js";
import { normalizePlaceText } from "../../runtime/placeSearch.js";
import {
    canonicalInstitutionIdentity,
    institutionIdentityTokens,
    INSTITUTION_MEMBER_STATUSES,
    validateInstitutionTemporalBaseline,
} from "../../runtime/institutions.js";
import { stableAsciiId } from "../../runtime/stableId.js";
import { checkGeneratedAgreementDates } from "./geopoliticalAgreementDates.js";

const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

// `const name = …;` as its file writes it: to the first semicolon that ends a line.
const statementOf = (file, name) => {
    const match = read(file).match(new RegExp(`^(?:export )?const ${name} = [\\s\\S]*?;\\r?$`, "m"));
    assert.ok(match, `${file} no longer defines ${name} as one statement`);
    return match[0].replace(/^export /, "");
};

// The same statement with the a-z0-9 class it had. Nothing else changed in any
// of them, bar a normalize("NFKC") where the fold had no normalizing of its own.
const asItWas = (code) => code
    .replaceAll("[^\\p{L}\\p{M}\\p{N}", "[^a-z0-9")
    .replaceAll("]+/gu", "]+/g")
    .replaceAll("]+/u)", "]+/)")
    .replaceAll('.normalize("NFKC")', "");

const evaluate = (code, name, scope) => new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope));

const trimmed = (value) => String(value ?? "").trim();
const cleaned = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lowered = (value) => cleaned(value).toLocaleLowerCase();

// [file, the fold, what it reads from its file's scope, whether it folds accents away]
const FOLDS = [
    ["src/Game/AI/nativeDiplomaticDirector.js", "pregameTitleKey", { clean: cleaned }, true],
    ["src/Game/AI/nativeDiplomaticDirector.js", "diplomaticSearchText", {}, true],
    ["src/Game/AI/nativeWarLedger.js", "pregameWarTitleKey", { normalizeString: trimmed }, true],
    ["src/Game/AI/nativeWorldDirector.js", "pregameStorylineTitleKey", { normalizeString: trimmed }, true],
    ["src/Game/AI/nativeWorldDirector.js", "storylineLinkText", { normalizeString: trimmed }, true],
    ["src/Game/AI/nativeTimelineCurator.js", "normalizeText", { normalizeString: trimmed }, true],
    ["src/Game/AI/nativeWorldIntegrity.js", "normalizeInstitutionAuthorityPhrase", { normalizeString: trimmed }, true],
    ["src/Game/AI/pregameBootstrapCompiler.js", "titleKey", { lower: lowered }, true],
    ["src/Game/AI/lookupTools.js", "foldForSearch", {}, true],
    ["src/Game/AI/playerFocus.js", "fold", { asText: trimmed }, true],
    ["src/Game/AI/worldDirection.js", "fold", {}, true],
    ["src/Game/AI/worldDirection.js", "words", { STOP_WORDS: new Set() }, true],
    ["src/Game/AI/regionFocus.js", "foldName", {}, true],
    ["src/Game/AI/promptContext.js", "markerAttentionTokens", {
        MARKER_ATTENTION_STOP_WORDS: new Set(),
        markerAttentionKey: evaluate(statementOf("src/Game/AI/promptContext.js", "markerAttentionKey"), "markerAttentionKey", { normalizeString: trimmed }),
    }, true],
    ["src/Game/AI/chatActions.js", "refFromLabel", { asText: trimmed, fold: (value) => trimmed(value).toLowerCase() }, false],
    ["src/runtime/projects.js", "foldWords", {}, true],
    ["src/runtime/demandCheck.js", "shorn", { str: trimmed, norm: (value) => trimmed(value).toLocaleLowerCase() }, false],
    ["src/runtime/placeSearch.js", "normalizePlaceText", {}, true],
];

const folds = FOLDS.map(([file, name, scope, foldsAccents]) => {
    const now = statementOf(file, name);
    const then = asItWas(now);
    assert.notEqual(then, now, `${file} ${name}: no \\p{L}\\p{M}\\p{N} class was found in it`);
    assert.ok(!then.includes("\\p{"), `${file} ${name}: the old form still has a Unicode class`);
    return { label: `${name} (${file})`, now: evaluate(now, name, scope), then: evaluate(then, name, scope), foldsAccents };
});

// A fold answers with a string, a list of words or a set of them.
const shape = (value) => (value instanceof Set ? [...value].sort() : value);
const isEmpty = (value) => (typeof value === "string" ? value.trim() === "" : shape(value).length === 0);

const ASCII = [
    "Treaty of Versailles (1919)", "ANGLO-BOER WAR, 1899-1902", "  spaced   out  ", "under_score and-dash",
    "O'Brien's \"Accord\"", "100% tariffs & 5 yrs", "", "!!!", "a", "Operation \"Sea Lion\" / phase #2",
    "tab\tand\nnewline", "Franco-Russian Alliance", "the Kingdom of Ruritania", "Project LEVIATHAN: Phase II",
    "No changes. No war began, ended or changed in this period.", "war-france-germany-1914", "r0v1~start~A,B~C~1~note",
];
// Printable ASCII in every order a model might put it, the same on every run.
const fuzz = (() => {
    let seed = 20261005;
    const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
    return Array.from({ length: 400 }, () => Array.from({ length: next() % 61 }, () => {
        const roll = next() % 100;
        return roll < 2 ? "\t" : roll < 4 ? "\n" : String.fromCharCode(0x20 + (next() % 95));
    }).join(""));
})();

test("ASCII in, the key it always was out", () => {
    for (const { label, now, then } of folds) {
        for (const text of [...ASCII, ...fuzz]) {
            assert.deepEqual(shape(now(text)), shape(then(text)), `${label} on ${JSON.stringify(text)}`);
        }
    }
});

test("accents the fold used to take off still come off", () => {
    const accented = ["Traité de Paris", "Übereinkunft von Zürich", "Śląsk Agreement", "São Tomé Accord", "Coup d'État à Côte d'Ivoire"];
    for (const { label, now, then, foldsAccents } of folds) {
        if (!foldsAccents) continue;
        for (const text of accented) assert.deepEqual(shape(now(text)), shape(then(text)), `${label} on ${text}`);
    }
});

// Two different titles in each script, none with a Latin letter or a digit in it.
const TITLES = {
    Cyrillic: ["Договор о дружбе, сотрудничестве и партнёрстве", "Договор о создании Союзного государства"],
    Chinese: ["中俄睦邻友好合作条约", "中日和平友好条约"],
    Japanese: ["サンフランシスコ講和条約", "ポーツマス条約"],
    Korean: ["한미상호방위조약", "남북기본합의서"],
    Arabic: ["معاهدة السلام المصرية الإسرائيلية", "اتفاقية الدفاع العربي المشترك"],
    Devanagari: ["भारत-रूस मैत्री संधि", "शिमला समझौता"],
    Greek: ["Συνθήκη της Λωζάνης", "Συνθήκη των Σεβρών"],
    Thai: ["สนธิสัญญาเบาว์ริง", "สนธิสัญญาสันติภาพโตเกียว"],
};

test("two titles in another script are two keys, where they were one empty key", () => {
    for (const { label, now, then } of folds) {
        for (const [script, [first, second]] of Object.entries(TITLES)) {
            assert.ok(isEmpty(then(first)) && isEmpty(then(second)), `${label}: the ${script} titles had keys before; the test is not showing the fault`);
            assert.ok(!isEmpty(now(first)), `${label}: the ${script} title has no key`);
            assert.notDeepEqual(shape(now(first)), shape(now(second)), `${label}: the two ${script} titles are one key`);
            assert.deepEqual(shape(now(first)), shape(now(`  ${first.toUpperCase()}!  `)), `${label}: case and punctuation still fold away in ${script}`);
        }
    }
});

test("a word keeps its marks: a vowel sign or a voicing mark does not cut it in two", () => {
    // Devanagari and Thai write vowels as marks on a consonant, Arabic may, and
    // decomposed kana carry their voicing as one. A fold that kept letters and
    // dropped marks would hand back a string of single consonants.
    const { now } = folds.find((fold) => fold.label.startsWith("normalizeText "));
    assert.equal(now("शिमला समझौता"), "शिमला समझौता");
    assert.equal(now("สนธิสัญญา"), "สนธิสัญญา");
    assert.equal(now("ポーツマス条約").split(" ").length, 1);
    assert.equal(now("مُعَاهَدَة").split(" ").length, 1);
});

test("the two exported folds read the same way", () => {
    assert.equal(foldName("Российская Федерация"), "россииская федерация");
    assert.equal(foldName("Côte d'Ivoire"), "cote divoire", "as before");
    assert.equal(normalizePlaceText("  Санкт-Петербург! "), "санкт петербург");
    assert.equal(normalizePlaceText("São Paulo"), "sao paulo", "as before");
    assert.equal(normalizePlaceText("東京"), "東京");
});

// --- The world generator's ids ----------------------------------------------
//
// One of these folds made an id, not a comparison. At Round Zero the generator
// reads the model's memberships and agreements, and where the model gives a
// name or a title in place of an id, the id is made from that. It was made with
// an a-z0-9 slug of the generator's own: no id at all for a name with no Latin
// letter or digit in it. The catalog a membership is looked up in is built by
// runtime/institutions.js, whose ids come from stableAsciiId: that same slug
// for any name it gives one to, and a hash of the name for one it gives none.
// The generator now makes the id the catalog has.
//
// geopoliticalWorldGenerator.js imports the request path (a .jsx file) and
// cannot be loaded here, so its readers are cut out of it and run, as the folds
// above are, beside themselves as they were.

const GENERATOR = "src/Game/AI/geopoliticalWorldGenerator.js";

// A function its file writes as a block: from `const name = ` to the first line
// that is the closing brace alone.
const blockOf = (file, name) => {
    const source = read(file).replace(/\r\n/g, "\n");
    const start = source.indexOf(`\nconst ${name} = `);
    const end = start === -1 ? -1 : source.indexOf("\n};\n", start);
    assert.ok(end !== -1, `${file} no longer defines ${name} as a block`);
    return source.slice(start + 1, end + 3);
};

const SLUG_AS_IT_WAS = String.raw`const slug = (value) => lower(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);`;

const generatorReaders = (slugCode) => {
    const base = { clean: cleaned, lower: lowered, array: (value) => (Array.isArray(value) ? value : []) };
    const slug = evaluate(slugCode, "slug", { ...base, stableAsciiId });
    const cut = (name, scope = {}) => evaluate(blockOf(GENERATOR, name), name, { ...base, slug, ...scope });
    return {
        slug,
        catalogIndex: cut("buildCatalogIdentityIndex", { institutionIdentityTokens }),
        membership: cut("normalizeMembership", { INSTITUTION_MEMBER_STATUSES, validateInstitutionTemporalBaseline }),
        agreement: cut("normalizeAgreement", {
            checkGeneratedAgreementDates,
            canonicalPolity: cut("canonicalPolity", { resolvePolityIdentity: () => null }),
        }),
    };
};
const generatorNow = generatorReaders(statementOf(GENERATOR, "slug"));
const generatorThen = generatorReaders(SLUG_AS_IT_WAS);

test("the generator's id is the one it made for ASCII, and the catalog's for every name", () => {
    // Any name the old slug made an id from keeps that id, which is the rule
    // stableAsciiId keeps for the catalog: "Договор 1997 года" is still "1997".
    for (const text of [...ASCII, ...fuzz, "Traité de Paris", "Śląsk Agreement", "Договор 1997 года"]) {
        assert.equal(generatorNow.slug(text), generatorThen.slug(text), JSON.stringify(text));
    }
    for (const [script, [first, second]] of Object.entries(TITLES)) {
        assert.equal(generatorThen.slug(first), "", `${script}: the old slug made an id; the test is not showing the fault`);
        assert.match(generatorNow.slug(first), /^u-[a-z0-9]+$/, script);
        assert.notEqual(generatorNow.slug(first), generatorNow.slug(second), script);
        assert.equal(generatorNow.slug(first), canonicalInstitutionIdentity({ name: first }).id, `${script}: the id the catalog gives that name`);
    }
});

test("a membership that names its institution in another script is found in the catalog", () => {
    // The model is shown the catalog and answers with each polity's memberships.
    // In a game played in Russian it may name an institution as the catalog
    // names it, or by its short name, where the id was asked for. A membership
    // that is not found costs the polity its whole answer, and the polity is
    // asked about again.
    const catalog = [
        canonicalInstitutionIdentity({ name: "Евразийский экономический союз", shortName: "ЕАЭС", foundedDate: "2015-01-01" }),
        canonicalInstitutionIdentity({ name: "African Union", shortName: "AU", foundedDate: "2002-07-09" }),
    ];
    const ask = (readers, row) => {
        const warnings = [];
        const membership = readers.membership(row, {
            catalogById: new Map(catalog.map((entry) => [entry.id, entry])),
            catalogByToken: readers.catalogIndex(catalog),
            scenarioDate: "2016-01-01",
            warnings,
            polityKey: "Россия",
        });
        return { id: membership?.institutionId ?? null, warnings: warnings.join("\n") };
    };
    const eurasian = catalog[0].id;
    assert.match(eurasian, /^u-[a-z0-9]+$/);
    for (const row of [
        { institutionId: "Евразийский экономический союз" },
        { name: "Евразийский  экономический союз " },
        { institutionId: "ЕАЭС" },
        { institutionId: eurasian },
    ]) {
        assert.equal(ask(generatorNow, row).id, eurasian, JSON.stringify(row));
    }

    // As it was: found by the catalog's own id and by nothing the model would write.
    assert.equal(ask(generatorThen, { institutionId: eurasian }).id, eurasian);
    const lost = ask(generatorThen, { institutionId: "Евразийский экономический союз" });
    assert.equal(lost.id, null);
    assert.match(lost.warnings, /institution outside fixed catalog: <blank>/);

    // An institution the catalog does not have is still refused, now by an id.
    const unknown = ask(generatorNow, { institutionId: "Шанхайская организация сотрудничества" });
    assert.equal(unknown.id, null);
    assert.match(unknown.warnings, /institution outside fixed catalog: u-[a-z0-9]+\./);

    // A name in ASCII is found the way it always was.
    for (const readers of [generatorNow, generatorThen]) {
        assert.equal(ask(readers, { institutionId: "African Union" }).id, "african-union");
        assert.equal(ask(readers, { institutionId: "AU" }).id, "african-union");
    }
});

test("an agreement the model gave a title in another script, and no id, is kept", () => {
    const allowed = new Map([["россия", "Россия"], ["беларусь", "Беларусь"], ["france", "France"], ["russia", "Russia"]]);
    const ask = (readers, row) => readers.agreement(row, {}, allowed, "2014-01-01", []);
    const union = {
        title: "Договор о создании Союзного государства", type: "alliance", parties: ["Россия", "Беларусь"],
        startedDate: "1999-12-08", terms: "Общее экономическое и оборонное пространство.",
    };
    const friendship = { ...union, title: "Договор о дружбе, добрососедстве и сотрудничестве", type: "friendship_consultation", startedDate: "1995-02-21" };

    assert.equal(ask(generatorThen, union), null, "as it was: no id could be made, and the agreement was dropped");
    const kept = ask(generatorNow, union);
    assert.match(kept.id, /^u-[a-z0-9]+$/);
    assert.deepEqual([kept.title, kept.type, kept.parties, kept.startedDate], [union.title, "alliance", ["Россия", "Беларусь"], "1999-12-08"]);
    assert.notEqual(ask(generatorNow, friendship).id, kept.id, "two titles, two agreements");
    // With no title either, the parties are what it is known by.
    assert.match(ask(generatorNow, { ...union, title: "" }).id, /^u-[a-z0-9]+$/);

    // An agreement titled in ASCII is read exactly as before.
    const ascii = { title: "Franco-Russian Alliance", type: "alliance", parties: ["France", "Russia"], startedDate: "1894-01-04", terms: "Mutual assistance." };
    assert.deepEqual(ask(generatorNow, ascii), ask(generatorThen, ascii));
    assert.equal(ask(generatorNow, ascii).id, "franco-russian-alliance");
});
