/*! Open Historia — shipped language pack tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/languagePacks.test.js
//
// The shipped packs (public/lang/<code>.json, and the prompts' guidance in
// public/lang/prompts/<code>.json) are the whole interface in those languages:
// with one, the game never asks the AI to translate a button. So a pack must
// cover the catalog it was made from, and every placeholder must survive
// translation, or a number, a name or a prompt's ${PLACEHOLDER} silently
// disappears from what the player (or the model) reads.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SHIPPED_PACK_LANGUAGES, hasShippedPack } from "./i18n.js";

const LANG = new URL("../../public/lang/", import.meta.url);
const read = (relative) => JSON.parse(fs.readFileSync(new URL(relative, LANG), "utf8"));
const tokens = (text) => [
  ...(text.match(/\{\{[^{}]+\}\}/g) ?? []),
  ...(text.match(/\$\{[^{}]+\}/g) ?? []),
].sort().join(" ");

const CATALOG = read("catalog-en.json");
const PROMPT_CATALOG = read("prompts/catalog-en.json");
// A pack made from an older catalog still ships, but not one that has fallen
// this far behind it: regenerate the packs with the catalog (docs/i18n.md).
const MIN_COVERAGE = 0.9;

test("every shipped pack on disk is one the game knows it has, and the other way round", () => {
  const onDisk = fs.readdirSync(LANG).filter((file) => /^[a-z]{2,3}\.json$/.test(file)).map((file) => file.slice(0, -5)).sort();
  assert.deepEqual(onDisk, [...SHIPPED_PACK_LANGUAGES].sort());
  const prompts = fs.readdirSync(new URL("prompts/", LANG)).filter((file) => /^[a-z]{2,3}\.json$/.test(file)).map((file) => file.slice(0, -5)).sort();
  assert.deepEqual(prompts, [...SHIPPED_PACK_LANGUAGES].sort(), "every pack language has its prompts too");
  assert.equal(hasShippedPack("de"), true);
  assert.equal(hasShippedPack("en"), false, "English is the source, not a pack");
  assert.equal(hasShippedPack("sw"), false);
});

for (const code of SHIPPED_PACK_LANGUAGES) {
  test(`${code}: the interface pack covers the catalog and keeps every placeholder`, () => {
    const pack = read(`${code}.json`);
    const problems = [];
    for (const [english, translated] of Object.entries(pack)) {
      if (typeof translated !== "string" || !translated.trim()) problems.push(`${english}: empty`);
      else if (tokens(english) !== tokens(translated)) problems.push(`${english}: ${tokens(english)} became ${tokens(translated)}`);
    }
    assert.deepEqual(problems.slice(0, 10), [], `${problems.length} broken entries`);
    const covered = CATALOG.filter((english) => Object.hasOwn(pack, english)).length;
    assert.ok(covered / CATALOG.length >= MIN_COVERAGE, `${covered} of ${CATALOG.length} catalog strings`);
  });

  test(`${code}: the prompts' guidance keeps every placeholder`, () => {
    const pack = read(`prompts/${code}.json`);
    const problems = Object.entries(pack)
      .filter(([english, translated]) => typeof translated !== "string" || tokens(english) !== tokens(translated))
      .map(([english]) => english.slice(0, 60));
    assert.deepEqual(problems, []);
    const covered = PROMPT_CATALOG.filter((english) => Object.hasOwn(pack, english)).length;
    assert.ok(covered / PROMPT_CATALOG.length >= MIN_COVERAGE, `${covered} of ${PROMPT_CATALOG.length} passages`);
  });
}
