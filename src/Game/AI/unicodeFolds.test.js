/*! Open Historia — titles and names are compared in every script: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/unicodeFolds.test.js
//
// The engine compares what a model or a player wrote (the title of a treaty, a
// war, a storyline, an event; the name of a Project, an institution, a
// structure; an order) by folding it to a key: lower case, accents off,
// punctuation out. Each of those folds kept `a-z0-9` and nothing else. A game
// played in Russian, Arabic or Chinese writes none of those, so its keys were
// all the same empty key: every title was every other title, and no name was
// ever found in a text. A player's log (beta 0.0.66, 2026-10-05, in Russian)
// has the titles: "Договор о дружбе, сотрудничестве и партнерстве между
// Российской Федерацией и Украиной" and "Договор о создании Союзного
// государства" were both "".
//
// Every such fold now keeps the letters, marks and digits of any script. Most
// are private one-liners, so each is cut out of its file and run here beside
// itself as it was, on the two things that matter:
//   - ASCII in, the same key out as before, byte for byte;
//   - two different titles in another script, two different keys.
// What the folds are FOR is tested where each is used (the Round-Zero compiler,
// the timeline cleanup, the player's share, the Board, polls, the map search…).

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { foldName } from "./regionFocus.js";
import { normalizePlaceText } from "../../runtime/placeSearch.js";

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
    ["src/Game/AI/chatActions.js", "refFromLabel", { fold: (value) => trimmed(value).toLowerCase() }, false],
    ["src/runtime/projects.js", "foldWords", {}, true],
    ["src/runtime/demandCheck.js", "shorn", { norm: (value) => trimmed(value).toLocaleLowerCase() }, false],
    ["src/runtime/institutions.js", "textToken", { clean: cleaned }, false],
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
    const { now } = folds.find((fold) => fold.label.startsWith("pregameTitleKey "));
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
