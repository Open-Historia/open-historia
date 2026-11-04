// Run: node --test src/runtime/displayModeAndCardDates.test.js
//
// The desktop display mode and the game cards' dates (PR #935 and its review).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatGameDateShort } from "./gameDates.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("a game card's date is in the player's language, and English where it cannot be", () => {
  assert.equal(formatGameDateShort("2016-01-01", "fr"), "1 janv. 2016");
  assert.equal(formatGameDateShort("2016-01-01", "ja"), "2016年1月1日");
  assert.equal(formatGameDateShort("0045-03-15", "en"), "Mar 15, 45", "a year below 100 is that year");
  assert.equal(formatGameDateShort("-0218-03-05", "nl"), "5 Mar 218 BC", "before AD 1: the English form");
  assert.equal(formatGameDateShort("not a date", "en"), "");
  assert.match(read("src/Game/GameUI/libraryBar.jsx"), /formatGameDateShort\(game\.currentDate, getStoredLanguage\(\)\)/);
});

test("only the machine running the game has a window to change", () => {
  const server = read("server/server.js");
  assert.match(server, /const desktopDisplayMode = \(req\) => \(isLoopbackAddress\(req\.socket\?\.remoteAddress\) \? globalThis\.__ohDisplayMode \|\| null : null\);/);
  assert.match(server, /\["fullscreen", "maximized", "windowed"\]\.includes\(mode\)/);
});

test("the display mode is kept and given to the window when it opens", () => {
  const main = read("electron/main.cjs");
  assert.match(main, /const DISPLAY_MODE_FILE = path\.join\(USER_ROOT, "display-mode\.json"\);/);
  assert.match(main, /fs\.writeFileSync\(DISPLAY_MODE_FILE, JSON\.stringify\(\{ mode \}\)\);/);
  assert.match(main, /if \(currentDisplayMode !== "windowed"\) applyDisplayMode\(win, currentDisplayMode\);\s+win\.show\(\);/);
  assert.doesNotMatch(main, /borderless/);
  // Esc, F11 and the window's own buttons change it too: the selector reads it again.
  assert.match(read("src/Game/GameUI/settings.jsx"), /window\.addEventListener\("resize", refresh\);/);
});
