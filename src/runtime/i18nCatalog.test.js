/*! Open Historia — language catalog coverage test © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/i18nCatalog.test.js
//
// i18nExtraction.test.js checks the extractor on snippets and
// languagePacks.test.js checks the packs cover the catalog, but nothing checked
// that the committed catalog still holds what the source says. A change could
// add interface text, skip build-catalog.mjs and pass; that is how a branch
// ended up with 31 untranslated strings. Every string missing from the catalog
// is translated by the player's AI provider instead, which spends the requests
// most players have least of.
//
// Reading the whole tree takes a few seconds, so this is one test.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import url from "node:url";

import { catalogText, extractTree, featureDefinitionStrings } from "../../scripts/i18n/extractStrings.mjs";
import { FEATURE_DEFINITIONS } from "../../server/gameFeatures.js";

const ROOT = url.fileURLToPath(new URL("../../", import.meta.url));
const CATALOG = JSON.parse(fs.readFileSync(new URL("../../public/lang/catalog-en.json", import.meta.url), "utf8"));

test("every interface string in the source is in the committed catalog", () => {
  const { exact, patterns, errors } = extractTree(ROOT);
  assert.deepEqual(errors, [], "the extractor could not parse part of src/");
  const catalog = new Set(CATALOG);
  const missing = [];
  for (const table of [exact, patterns]) {
    for (const [text, where] of table) {
      const entry = catalogText(text);
      if (entry && !catalog.has(entry)) missing.push(`${entry}  (${where})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `${missing.length} interface string(s) are not in public/lang/catalog-en.json. Run node scripts/i18n/build-catalog.mjs, then node scripts/generate-lang-packs.mjs.`,
  );
});

// The Features tab of the scenario and game editors renders a list of
// definitions kept under server/ (server/gameFeatures.js), which the extractor
// does not read: for as long as nothing checked them, a new feature's label
// and description were in no catalog and stayed English in every language.
test("every string of the gameplay features' definitions is in the committed catalog", () => {
  const catalog = new Set(CATALOG);
  const strings = featureDefinitionStrings(FEATURE_DEFINITIONS);
  assert.ok(strings.includes("Fronts") && strings.includes("Espionage"), "the definitions were read");
  const missing = strings.map(catalogText).filter((entry) => entry && !catalog.has(entry));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} string(s) of server/gameFeatures.js are not in public/lang/catalog-en.json. Run node scripts/i18n/build-catalog.mjs, then node scripts/generate-lang-packs.mjs.`,
  );
  // Each kind of text a definition carries is read.
  assert.deepEqual(featureDefinitionStrings([{
    label: "A feature",
    description: "What it does.",
    settings: [{ label: "A setting", unit: "per day", description: "What it sets.", options: [{ value: "x", label: "A choice", description: "What it chooses." }] }],
  }, null]), ["A feature", "What it does.", "A setting", "per day", "What it sets.", "A choice", "What it chooses."]);
});

test("catalog entries are trimmed, and text with no word in it is left out", () => {
  assert.equal(catalogText("  Save the game \n"), "Save the game");
  assert.equal(catalogText("{{count}} regions"), "{{count}} regions");
  assert.equal(catalogText("—"), null);
  assert.equal(catalogText("x"), null);
  assert.equal(catalogText(" 12 "), null);
});
