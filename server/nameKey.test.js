/*! Open Historia — one name fold, in every script: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/nameKey.test.js
//
// The game looks a name up whole: a polity by its key, name, aliases and
// former names; a palette's or flag's key; a political actor; the land a camera
// flies to. Each of those lookups folded the name to a-z and 0-9, so every
// name in Cyrillic, Chinese or Arabic was the same empty key: a renamed
// "Россия" left its regions on the old name, a declared "Россия" resolved to
// nobody, and a programme owned by "中国" counted as the player's own. There is
// one fold now (nameKey.js), of case, accents and spacing, and it keeps every
// script's letters.

import test from "node:test";
import assert from "node:assert/strict";

import { nameKey, sameName } from "./nameKey.js";
import { findPolityKey, renamePolityInWorld, samePolityName } from "./polityRename.js";

test("case, accents and spacing fold away, in every script", () => {
  for (const [left, right] of [
    ["Côte d'Ivoire", "COTE DIVOIRE"],
    ["Guinea-Bissau", "guinea bissau"],
    ["  São   Tomé  ", "sao tome"],
    ["Россия", "РОССИЯ"],
    ["Ελλάδα", "ΕΛΛΑΔΑ"],
    ["İstanbul", "istanbul"],
    ["中国", " 中 国 "],
    ["ＣＨＩＮＡ", "China"],
  ]) {
    assert.ok(sameName(left, right), `${left} / ${right}`);
  }
});

test("two names are two keys: nothing is dropped, added or guessed", () => {
  for (const [left, right] of [
    ["Republic of China", "China"],
    ["Russia", "Russian Federation"],
    ["Kingdom of Greece", "Greece"],
    ["Bosnia & Herzegovina", "Bosnia and Herzegovina"],
    ["Россия", "Российская Федерация"],
    ["中国", "中华民国"],
    ["Россия", "中国"],
  ]) {
    assert.ok(!sameName(left, right), `${left} / ${right}`);
  }
});

test("a vowel sign or a voicing mark is part of its word", () => {
  assert.notEqual(nameKey("भारत"), nameKey("भरत"));
  assert.notEqual(nameKey("ガーナ"), nameKey("カーナ"));
  assert.equal(nameKey("ไทย"), "ไทย");
});

test("a name with no letters or digits is no name, and matches nothing", () => {
  for (const blank of ["", "   ", "!!!", "—", "...", null, undefined]) {
    assert.equal(nameKey(blank), "");
    assert.equal(sameName(blank, blank), false);
    assert.equal(sameName(blank, "Россия"), false);
  }
});

test("the fold remembers its answers and still answers past its store", () => {
  const first = nameKey("Российская Федерация");
  for (let index = 0; index < 25000; index += 1) nameKey(`Polity ${index}`);
  assert.equal(nameKey("Российская Федерация"), first);
  // (The breve of "й" is one of the combining diacritics, as in regionFocus.js foldName.)
  assert.equal(nameKey("Российская Федерация"), "россиискаяфедерация");
});

// The audit's run (2026-11-13): renaming "Россия" to "СССР" left every region on
// the old name and kept both keys, because both folded to "".
const russianWorld = () => ({
  polityOverrides: {
    "Россия": { aliases: [], code: "Россия", color: "#aa0000", name: "Россия", note: "" },
    "Китай": { aliases: [], code: "Китай", color: "#ffcc00", name: "Китай", note: "" },
  },
  regionOwnershipOverrides: { r1: "Россия", r2: "Россия", r3: "Китай" },
  regionClaimants: { r3: ["Россия"] },
  units: [{ id: "u1", ownerCode: "Россия", name: "1-я армия", type: "infantry", lat: 55.7, lng: 37.6, strength: 100, status: "idle" }],
  wars: [{ id: "w1", sideA: ["Россия"], sideB: ["Китай"], status: "active", startedDate: "1969-03-02" }],
  countryStats: { "Россия": { population: 130 } },
});

test("a polity named in Cyrillic renames like its English twin: every store follows, one key is left", () => {
  for (const [world, from, to, other] of [
    [russianWorld(), "Россия", "СССР", "Китай"],
    [JSON.parse(JSON.stringify(russianWorld()).replaceAll("Россия", "Russia").replaceAll("Китай", "China")), "Russia", "Soviet Union", "China"],
  ]) {
    const { world: next, from: oldKey, to: newKey } = renamePolityInWorld(world, from, to);
    assert.equal(oldKey, from);
    assert.equal(newKey, to);
    assert.deepEqual(Object.keys(next.polityOverrides).sort(), [other, to].sort(), `${from}: one key, the new one`);
    assert.deepEqual(next.regionOwnershipOverrides, { r1: to, r2: to, r3: other });
    assert.deepEqual(next.regionClaimants, { r3: [to] });
    assert.equal(next.units[0].ownerCode, to);
    assert.deepEqual(next.wars[0].sideA, [to]);
    assert.deepEqual(Object.keys(next.countryStats), [to]);
    assert.deepEqual(next.polityOverrides[to].formerNames, [from]);
  }
});

test("a rename finds the polity by any spelling of its name, in any script, and never by none", () => {
  const world = russianWorld();
  assert.equal(findPolityKey(world.polityOverrides, "РОССИЯ"), "Россия");
  assert.equal(findPolityKey(world.polityOverrides, "китай"), "Китай");
  assert.equal(findPolityKey(world.polityOverrides, "!!!"), "");
  assert.equal(samePolityName("—", "—"), false);
  // "Китай" is another polity's own name: a rename cannot merge the two.
  assert.throws(() => renamePolityInWorld(world, "Россия", "КИТАЙ"), /already the name of another polity/);
});
