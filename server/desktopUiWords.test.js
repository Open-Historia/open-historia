/*! Open Historia — the desktop app's own words, translated © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/desktopUiWords.test.js
//
// What the desktop app's main process shows by itself (the right-click menu,
// the box when the page stops or the app cannot start) never passed through the
// page's translator and stayed English in every language. electron/uiWords.cjs
// looks it up in the shipped pack of the language the player chose.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const { configureUiWords, fillWords, uiWord } = createRequire(import.meta.url)("../electron/uiWords.cjs");

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "oh-uiwords-"));

test("the main process's words come from the chosen language's pack, slots filled", () => {
  const dataDir = folder();
  const langDir = folder();
  fs.writeFileSync(path.join(langDir, "de.json"), JSON.stringify({
    Paste: "Einfügen",
    "{{name}} ran out of memory.": "{{name}} hatte keinen Speicher mehr.",
  }));
  configureUiWords({ dataDir, langDirs: [path.join(dataDir, "missing"), langDir] });
  // No choice yet: English.
  assert.equal(uiWord("Paste"), "Paste");
  fs.writeFileSync(path.join(dataDir, "ui-settings.json"), JSON.stringify({ language: "de" }));
  assert.equal(uiWord("Paste"), "Einfügen");
  assert.equal(uiWord("{{name}} ran out of memory.", { name: "Open Historia" }), "Open Historia hatte keinen Speicher mehr.");
  // Not in the pack: the English, filled.
  assert.equal(uiWord("{{name}} could not start", { name: "Open Historia" }), "Open Historia could not start");
  // English, or a language with no pack, is the English.
  fs.writeFileSync(path.join(dataDir, "ui-settings.json"), JSON.stringify({ language: "en" }));
  assert.equal(uiWord("Paste"), "Paste");
  fs.writeFileSync(path.join(dataDir, "ui-settings.json"), JSON.stringify({ language: "../de" }));
  assert.equal(uiWord("Paste"), "Paste");
});

test("a slot with no value is left as it is", () => {
  assert.equal(fillWords("{{a}} and {{b}}", { a: 1 }), "1 and {{b}}");
});

test("every string the desktop app hands to uiWord is in the shipped packs", () => {
  const catalog = new Set(JSON.parse(fs.readFileSync(new URL("../public/lang/catalog-en.json", import.meta.url), "utf8")));
  for (const file of ["main.cjs", "payloadUpdate.cjs", "layeredUpdate.cjs"]) {
    const source = fs.readFileSync(new URL(`../electron/${file}`, import.meta.url), "utf8");
    const words = [...source.matchAll(/uiWord\("((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
    assert.ok(words.length > 0, file);
    for (const word of words) assert.ok(catalog.has(word), `${file}: "${word}" is not in public/lang/catalog-en.json`);
  }
});
