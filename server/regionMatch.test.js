// Run: node --test server/regionMatch.test.js
//
// The model writes region names from its own knowledge; the map names them
// however its author did. The matcher has to bridge the common gaps — an
// appended "Oblast", a transliteration, a stray apostrophe — while never
// picking one region over another it could equally mean.
import assert from "node:assert/strict";
import test from "node:test";

import { editDistance, foldRegionKey, matchRegionName, stripRegionAffixes } from "../src/Game/AI/regionMatch.js";

// A slice of the hand-drawn Fault Lines world: Ukraine's regions are named after towns.
const ukraine = [
  { id: "2026", name: "Kharkiv" },
  { id: "2004", name: "Donetsk" },
  { id: "2040", name: "Zaporizhzhia" },
  { id: "2012", name: "Luhansk" },
  { id: "2103", name: "Kremenchuk" },
  { id: "2030", name: "Dnipro" },
  { id: "2107", name: "Sumy" },
  { id: "2102", name: "Poltava" },
];

test("folding: case, diacritics, apostrophes and hyphens do not matter", () => {
  assert.equal(foldRegionKey("Donets’k"), "donetsk");
  assert.equal(foldRegionKey("  Ivano-Frankivsk "), "ivano frankivsk");
  assert.equal(foldRegionKey("Zürich"), "zurich");
});

test("affixes: administrative words the model appends are stripped, repeatedly", () => {
  assert.equal(stripRegionAffixes("kharkiv oblast"), "kharkiv");
  assert.equal(stripRegionAffixes("the kharkiv region"), "kharkiv");
  assert.equal(stripRegionAffixes("republic of crimea autonomous republic"), "crimea");
  assert.equal(stripRegionAffixes("bayern"), "bayern");
});

test("edit distance is bounded", () => {
  assert.equal(editDistance("zaporizhzhya", "zaporizhzhia"), 1);
  assert.equal(editDistance("kharkiv", "kharkov"), 1);
  assert.equal(editDistance("kharkiv", "poltava", 2), 3, "stops counting past the bound");
});

test("exact and affixed names resolve to the one region they name", () => {
  assert.equal(matchRegionName("Kharkiv", ukraine).region.id, "2026");
  assert.equal(matchRegionName("Kharkiv Oblast", ukraine).rule, "affix");
  assert.equal(matchRegionName("Kharkiv Oblast", ukraine).region.id, "2026");
  assert.equal(matchRegionName("the Donetsk region", ukraine).region.id, "2004");
  assert.equal(matchRegionName("Donets’k", ukraine).region.id, "2004");
});

test("a transliteration one edit away resolves; a name that is not there does not", () => {
  const hit = matchRegionName("Zaporizhzhya", ukraine);
  assert.equal(hit.region.id, "2040");
  assert.equal(hit.rule, "fuzzy");
  assert.equal(matchRegionName("Crimea", ukraine), null, "Ukraine holds no Crimea on this map");
  assert.equal(matchRegionName("Kyiv", ukraine), null, "short names never fuzz onto a neighbour");
});

test("ambiguity resolves to nothing rather than to the wrong region", () => {
  const pool = [...ukraine, { id: "9", name: "Kremenchuk North" }, { id: "10", name: "Kremenchuk South" }];
  assert.equal(matchRegionName("Kremenchuk", pool).region.id, "2103", "an exact name beats the substring pair");
  assert.equal(matchRegionName("Kremenchuk", pool.filter((r) => r.id !== "2103")), null, "two whole-word hits are ambiguous");
  assert.equal(matchRegionName("Sumy", [{ id: "a", name: "Sumy" }, { id: "b", name: "Sumy" }]), null, "two regions with one name");
});

test("substrings are whole words: letters inside a longer name are not a match", () => {
  const world = [...ukraine, { id: "2361", name: "Pori" }, { id: "2362", name: "Turku" }];
  const hit = matchRegionName("Zaporizhzhya", world, { maxFuzzy: 1 });
  assert.equal(hit.region.id, "2040", "one edit from Zaporizhzhia, not the Finnish town hiding inside the word");
  assert.equal(matchRegionName("Zaporizhia", world, { maxFuzzy: 1 }), null, "two edits are refused when the pool is the whole map");
  assert.equal(matchRegionName("Zaporizhia", ukraine, { maxFuzzy: 2 }).region.id, "2040", "and accepted inside the losing side's regions");
});

test("aliases count as names", () => {
  const pool = [{ id: "UKR.4_1", name: "Crimea", aliases: ["Autonomous Republic of Crimea", "Krym"] }];
  assert.equal(matchRegionName("Krym", pool).region.id, "UKR.4_1");
  assert.equal(matchRegionName("Autonomous Republic of Crimea", pool).region.id, "UKR.4_1");
});

test("a substring needs four characters and one survivor", () => {
  assert.equal(matchRegionName("Sum", ukraine), null);
  assert.equal(matchRegionName("Poltava City", ukraine).region.id, "2102");
});
