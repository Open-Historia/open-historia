/*! Open Historia — first-screen text tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/bootTexts.test.js
//
// The home page, the demo notice and the Android boot screen are the first
// thing a player sees. Their text must reach the language packs (the string
// extractor has to find it) and be looked up whole, falling back to English.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractFromSource, interfaceFiles } from "../../../scripts/i18n/extractStrings.mjs";
import { BOOT_TEXTS, bootText, bootTranslated, setBootTranslations } from "./bootTexts.js";
import { bootStatusText } from "./nativeBoot.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const file = path.join(here, "bootTexts.js");

test("the string extractor collects every first-screen string", () => {
  const rel = "src/runtime/web/bootTexts.js";
  assert.ok(interfaceFiles(root).map((f) => path.relative(root, f).split(path.sep).join("/")).includes(rel));
  const result = extractFromSource(fs.readFileSync(file, "utf8"), rel, { jsx: false, catchAll: false });
  assert.equal(result.error, undefined);
  const collected = new Set(result.exact.keys());
  const missed = Object.values(BOOT_TEXTS).filter((text) => !collected.has(text));
  assert.deepEqual(missed, [], "every string reaches the catalog, so the packs can carry it");
});

test("each string is looked up whole, with the English as the fallback", () => {
  try {
    setBootTranslations(null);
    assert.equal(bootTranslated(), false);
    assert.equal(bootText("demoTitle"), "This is a demo of the game");

    setBootTranslations({
      "This is a demo of the game": "Ceci est une démo du jeu",
      "Everything is on this device": "Tout est sur cet appareil",
      "Privacy": "   ",
    });
    assert.equal(bootTranslated(), true);
    assert.equal(bootText("demoTitle"), "Ceci est une démo du jeu");
    assert.equal(bootText("demoPlay"), "Play the demo anyway", "a string the pack lacks stays English");
    assert.equal(bootText("homePrivacy"), "Privacy", "an empty translation is no translation");
    assert.equal(bootStatusText(true), "Tout est sur cet appareil", "the Android boot screen reads the same pack");

    setBootTranslations({});
    assert.equal(bootTranslated(), false, "an empty pack is English");
  } finally {
    setBootTranslations(null);
  }
});
