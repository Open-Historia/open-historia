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

import { catalogText, extractTree } from "../../scripts/i18n/extractStrings.mjs";

const ROOT = url.fileURLToPath(new URL("../../", import.meta.url));
const CATALOG = JSON.parse(fs.readFileSync(new URL("../../public/lang/catalog-en.json", import.meta.url), "utf8"));

// The catalog is rebuilt when a batch of changes lands (build-catalog.mjs,
// then generate-lang-packs.mjs), not by every change, and this branch's source
// is ahead of it. Until that rebuild the test runs and lists what is missing
// without failing the suite; after it, delete this and the option below.
const TODO_UNTIL_THE_CATALOG_IS_REBUILT = "the catalog has not been rebuilt since the last interface changes";

test("every interface string in the source is in the committed catalog", { todo: TODO_UNTIL_THE_CATALOG_IS_REBUILT }, () => {
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

test("catalog entries are trimmed, and text with no word in it is left out", () => {
  assert.equal(catalogText("  Save the game \n"), "Save the game");
  assert.equal(catalogText("{{count}} regions"), "{{count}} regions");
  assert.equal(catalogText("—"), null);
  assert.equal(catalogText("x"), null);
  assert.equal(catalogText(" 12 "), null);
});
