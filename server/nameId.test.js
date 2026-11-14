/*! Open Historia — the id a name is given: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/nameId.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { isLatinName, latinSlug, nameId } from "./nameId.js";

// The slugs the game's ids were made with, as their files wrote them.
const SLUGS = {
  // runtime/stableId.js, Game/AI/nativeDiplomaticDirector.js, runtime/institutionalAuthority.js
  standard: (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  // runtime/spycraft.js
  agent: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  // server/gameFeatures.js (a scripted beat's own id)
  beat: (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120),
};

const LATIN = ["Baltic & Nordic Union", "Conseil de l'Europe", "Côte d'Ivoire", "São Tomé and Príncipe", "  Bosnia   and Herzegovina ", "Brand™", "beat-1.v2:a", "UN", "1914"];

test("a Latin name keeps the id its slug always gave it, byte for byte", () => {
  for (const name of LATIN) {
    assert.equal(isLatinName(name), true, name);
    for (const [label, slug] of Object.entries(SLUGS)) assert.equal(nameId(name, slug), slug(name), `${label}: ${name}`);
  }
  assert.equal(nameId("Côte d'Ivoire"), "cote-d-ivoire");
  assert.equal(nameId("Baltic & Nordic Union"), "baltic-nordic-union");
  assert.equal(latinSlug("Baltic & Nordic Union", 6), "baltic");
});

test("a name in another script is its own id, the same on every reading", () => {
  const ids = new Map();
  for (const name of ["Россия", "Украина", "中国", "日本", "المغرب", "مصر", "भारत", "Ελλάδα", "საქართველო", "한국"]) {
    const id = nameId(name);
    assert.match(id, /^u-[a-z0-9]+$/, name);
    assert.equal(nameId(` ${name} `), id, `${name}: spacing`);
    for (const slug of Object.values(SLUGS)) assert.equal(nameId(name, slug), id, `${name}: the same id whatever the Latin slug`);
    assert.ok(!ids.has(id), `${name} and ${ids.get(id)} were one id`);
    ids.set(id, name);
  }
  assert.equal(nameId("РОССИЯ"), nameId("Россия"), "case");
  assert.equal(nameId("ΕΛΛΆΔΑ"), nameId("Ελλάδα"), "case and accents");
  // The hash runtime/stableId.js always gave such a name: a save keeps it.
  assert.equal(nameId("Совет Европы"), "u-aabffe122t");
  assert.equal(nameId("中国"), "u-1f432l4qttv");
});

test("a name that mixes scripts is never cut down to its Latin letters or digits", () => {
  // "Событие 1" and "Задача 1" were both "1"; "Пётр I" was "i".
  for (const slug of [undefined, ...Object.values(SLUGS)]) {
    assert.notEqual(nameId("Событие 1", slug), nameId("Задача 1", slug));
    assert.match(nameId("Событие 1", slug), /^u-[a-z0-9]+$/);
    assert.match(nameId("Пётр I", slug), /^u-[a-z0-9]+$/);
  }
  assert.equal(isLatinName("Событие 1"), false);
  // A letter outside a-z is a letter the slug dropped: "Straße" was "stra-e".
  assert.equal(isLatinName("Straße"), false);
  assert.notEqual(nameId("Straße"), nameId("Strae"));
});

test("a name with no letter or digit is no id, for the caller's fallback", () => {
  assert.equal(nameId("— / …"), "");
  assert.equal(nameId(""), "");
  assert.equal(nameId(null), "");
  assert.equal(isLatinName("!!!"), true);
});

test("a Latin form that read nothing of a name with letters gives the hash, never an empty id", () => {
  // As a slug lowered by a Turkish locale does with "IIII".
  const nothing = () => "";
  assert.match(nameId("IIII", nothing), /^u-[a-z0-9]+$/);
  assert.equal(nameId("!!!", nothing), "");
});
