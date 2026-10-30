/*! Open Historia — the website reads its map archives whole: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/wholeArchivesOnWeb.test.js
//
// openhistoria.com serves its own map archives (2026-10-28), and its host
// answers a Range on a large file with the whole file, which pmtiles refuses.
// The website reads them whole, as the Android app does; the desktop keeps Range.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const assets = readFileSync(new URL("./assets.js", import.meta.url), "utf8");

test("the website and the Android app read map archives whole; the desktop keeps Range", () => {
  assert.match(assets, /const BUILD_ENV = import\.meta\.env \?\? \{\};\r?\nconst READ_ARCHIVES_WHOLE = Boolean\(BUILD_ENV\.VITE_OH_NATIVE \|\| BUILD_ENV\.VITE_OH_WEB\);/);
  assert.match(assets, /if \(\(isNativeBuild\(\) \|\| READ_ARCHIVES_WHOLE\) && pmtilesProtocol\.tiles instanceof Map\) \{/);
  assert.match(assets, /: READ_ARCHIVES_WHOLE\s+\? new WholeFileSource\(url, loadWholeArchive\)/);
});
