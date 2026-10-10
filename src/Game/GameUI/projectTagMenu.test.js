/*! Open Historia — the Projects board's Tags menu: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/projectTagMenu.test.js
//
// Runs without node_modules: projectTagMenu.js imports nothing.
//
// The invariants: the list is every tag once, the ticked ones first; the
// search finds a tag however it was spelled and never reorders or invents one;
// and an arrow key always lands on a tag that exists, whatever the shape of
// the last row. The last tests read the panel as text (a .jsx file does not
// load under node): they pin the shape of the control, not what it does, which
// still has to be seen in the running game.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { searchTags, stepTagFocus, tickedFirst } from "./projectTagMenu.js";

const TAGS = ["military", "naval", "anti-nato", "Économie", "nuclear deterrent", "ядерный", "核武器", "R&D"];

test("the menu lists what is ticked first, and keeps the board's order within each half", () => {
  assert.deepEqual(
    tickedFirst(TAGS, ["R&D", "naval"]),
    ["naval", "R&D", "military", "anti-nato", "Économie", "nuclear deterrent", "ядерный", "核武器"],
  );
  // Every tag once, none invented: a ticked tag the board no longer carries is
  // not listed.
  assert.deepEqual(tickedFirst(["a", "b", "c"], ["c", "gone"]), ["c", "a", "b"]);
});

test("with nothing ticked the list is the board's own order", () => {
  assert.deepEqual(tickedFirst(TAGS, []), TAGS);
  assert.deepEqual(tickedFirst(TAGS, null), TAGS);
  assert.deepEqual(tickedFirst(null, ["naval"]), []);
});

test("a search keeps the ticked tags first", () => {
  assert.deepEqual(searchTags(tickedFirst(TAGS, ["nuclear deterrent"]), "ar"), ["nuclear deterrent", "military"]);
});

test("nothing typed shows every tag, in the order they came in", () => {
  assert.deepEqual(searchTags(TAGS, ""), TAGS);
  assert.deepEqual(searchTags(TAGS, "   "), TAGS);
  assert.deepEqual(searchTags(TAGS, undefined), TAGS);
});

test("a search ignores case, accents and what separates the words", () => {
  assert.deepEqual(searchTags(TAGS, "NAV"), ["naval"]);
  assert.deepEqual(searchTags(TAGS, "economie"), ["Économie"]);
  assert.deepEqual(searchTags(TAGS, "écon"), ["Économie"]);
  for (const typed of ["anti nato", "antinato", "Anti-NATO", "anti_nato"]) {
    assert.deepEqual(searchTags(TAGS, typed), ["anti-nato"], `"${typed}" did not find anti-nato`);
  }
  assert.deepEqual(searchTags(TAGS, "nuclear-deterrent"), ["nuclear deterrent"]);
});

test("a search matches anywhere in a tag and keeps the board's order", () => {
  // "military" and "nuclear deterrent" both hold "ar"; most used stays first.
  assert.deepEqual(searchTags(TAGS, "ar"), ["military", "nuclear deterrent"]);
  assert.deepEqual(searchTags(TAGS, "submarine"), []);
});

test("tags in other scripts are found: the model writes them in the player's language", () => {
  assert.deepEqual(searchTags(TAGS, "ЯДЕР"), ["ядерный"]);
  assert.deepEqual(searchTags(TAGS, "武器"), ["核武器"]);
  // A dotted capital İ lowers to an i with a combining dot; typed plain it
  // still has to match.
  assert.deepEqual(searchTags(["İstihbarat"], "istih"), ["İstihbarat"]);
});

test("signs the fold drops are still found as written", () => {
  assert.deepEqual(searchTags(TAGS, "&"), ["R&D"]);
  assert.deepEqual(searchTags(TAGS, "-"), ["anti-nato"]);
  assert.deepEqual(searchTags(["🚀", "space"], "🚀"), ["🚀"]);
});

test("a search survives whatever it is handed", () => {
  assert.deepEqual(searchTags(null, "x"), []);
  assert.deepEqual(searchTags(undefined, ""), []);
  assert.deepEqual(searchTags(["naval", null, 7], "nav"), ["naval"]);
});

const step = (key, index, count, columns, rtl = false) => stepTagFocus({ key, index, count, columns, rtl });

test("in one column Up and Down walk the list and stop at its ends", () => {
  assert.equal(step("ArrowDown", 0, 5, 1), 1);
  assert.equal(step("ArrowDown", 4, 5, 1), 4);
  assert.equal(step("ArrowUp", 3, 5, 1), 2);
  assert.equal(step("ArrowUp", 0, 5, 1), 0);
  assert.equal(step("Home", 3, 5, 1), 0);
  assert.equal(step("End", 1, 5, 1), 4);
});

test("in two columns Down and Up keep the column, Left and Right the reading order", () => {
  // 0 1
  // 2 3
  // 4 5
  assert.equal(step("ArrowDown", 0, 6, 2), 2);
  assert.equal(step("ArrowDown", 3, 6, 2), 5);
  assert.equal(step("ArrowDown", 5, 6, 2), 5);
  assert.equal(step("ArrowUp", 5, 6, 2), 3);
  assert.equal(step("ArrowUp", 1, 6, 2), 1);
  assert.equal(step("ArrowRight", 1, 6, 2), 2);
  assert.equal(step("ArrowLeft", 2, 6, 2), 1);
  assert.equal(step("ArrowRight", 5, 6, 2), 5);
  assert.equal(step("ArrowLeft", 0, 6, 2), 0);
});

test("Down from above a short last row goes to the last tag, not nowhere", () => {
  // 0 1 2
  // 3 4 5
  // 6
  assert.equal(step("ArrowDown", 3, 7, 3), 6);
  assert.equal(step("ArrowDown", 4, 7, 3), 6);
  assert.equal(step("ArrowDown", 5, 7, 3), 6);
  assert.equal(step("ArrowDown", 6, 7, 3), 6);
  assert.equal(step("ArrowUp", 6, 7, 3), 3);
});

test("reading right to left, Left is the next tag and Right the one before", () => {
  assert.equal(step("ArrowLeft", 0, 6, 2, true), 1);
  assert.equal(step("ArrowRight", 1, 6, 2, true), 0);
  assert.equal(step("ArrowDown", 0, 6, 2, true), 2);
});

test("every answer is a tag that exists", () => {
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
    for (let count = 1; count <= 9; count += 1) {
      for (let columns = 1; columns <= 4; columns += 1) {
        for (let index = 0; index < count; index += 1) {
          const next = step(key, index, count, columns);
          assert.ok(Number.isInteger(next) && next >= 0 && next < count, `${key} from ${index} of ${count} in ${columns}: ${next}`);
        }
      }
    }
  }
});

test("other keys, and a focus that is not on a tag, are left alone", () => {
  assert.equal(step("Enter", 0, 5, 1), null);
  assert.equal(step("Tab", 0, 5, 1), null);
  assert.equal(step("a", 0, 5, 1), null);
  assert.equal(step("ArrowDown", -1, 5, 1), null);
  assert.equal(step("ArrowDown", 5, 5, 1), null);
  assert.equal(step("ArrowDown", 0, 0, 1), null);
  assert.equal(stepTagFocus(), null);
  // No column count measured yet: one column.
  assert.equal(stepTagFocus({ key: "ArrowDown", index: 0, count: 3, columns: 0 }), 1);
  assert.equal(stepTagFocus({ key: "ArrowDown", index: 0, count: 3 }), 1);
});

// ---------------------------------------------------------------------------
// The panel's side, read as text.

const panel = fs.readFileSync(new URL("./projects.jsx", import.meta.url), "utf8");

test("the filters draw one Tags control, never a chip per tag", () => {
  // A chip per tag is what filled the panel and pushed the projects off it.
  assert.doesNotMatch(panel, /availableTags\.map\(/);
  assert.equal(panel.match(/<TagMenu\b/g)?.length, 1);
});

test("a tag's name is never handed to the translator", () => {
  // Tags are written by the model or the player. Unmarked, each is a string
  // the language pack lacks, and where there is no pack, an AI request.
  const drawn = panel.match(/<span[^>]*>\s*\{tag\}\s*<\/span>/g) ?? [];
  assert.equal(drawn.length, 2, "the menu's row and the card's chip");
  for (const span of drawn) assert.match(span, /\bdata-no-translate\b/);
});

test("the control is a menu button and its tags are toggles that say whether they are ticked", () => {
  assert.match(panel, /aria-haspopup="menu"\s+aria-expanded=\{open\}/);
  assert.match(panel, /role="menuitemcheckbox"\s+aria-checked=\{checked\}/);
});

test("the open menu closes on Back, and with the panel", () => {
  assert.match(panel, /useBackToClose\(open, \(\) => onOpenChange\(false\)\)/);
  // The panel is hidden, never unmounted: a menu left open behind it would
  // keep its Back step.
  assert.match(panel, /if \(isOpen\) return;[\s\S]{0,200}?setTagMenuOpen\(false\);/);
});
