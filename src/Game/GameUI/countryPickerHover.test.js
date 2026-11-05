/*! Open Historia — which country the new-game picker's map highlights: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/countryPickerHover.test.js
//
// Pointing at a country's row in the picker's list highlights that country on
// the picker's map. The first half holds the rules for who has the highlight
// (countryPickerHover.js); the second reads CountryPickerMap.jsx to hold the
// map and the list to them, since nothing here can move a pointer over either.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createPickerHover } from "./countryPickerHover.js";

// A hover that counts how often it asked the map to repaint.
const counted = () => {
  let repaints = 0;
  const hover = createPickerHover(() => { repaints += 1; });
  return { hover, repaints: () => repaints };
};

test("the pointer on a row highlights its country, and leaving the row puts it out", () => {
  const { hover, repaints } = counted();
  assert.equal(hover.code, null);

  hover.enterRow("France");
  assert.equal(hover.code, "France");
  hover.leaveRow("France");
  assert.equal(hover.code, null);
  assert.equal(repaints(), 2);
});

test("the keyboard focus on a row does the same", () => {
  const { hover, repaints } = counted();
  hover.focusRow("Chile");
  assert.equal(hover.code, "Chile");
  hover.focusRow("China");
  assert.equal(hover.code, "China", "Tab to the next row");
  hover.blurRow("China");
  assert.equal(hover.code, null, "and out of the list");
  assert.equal(repaints(), 3);
});

test("one repaint for each change of the highlighted country, and none without one", () => {
  const { hover, repaints } = counted();
  hover.overMap(null);
  hover.leaveRow("France");
  hover.blurRow("France");
  hover.rowsShown(["France", "Gabon"]);
  assert.equal(repaints(), 0, "nothing was lit, and nothing is");

  hover.enterRow("France");
  hover.enterRow("France");
  hover.focusRow("France");
  assert.equal(repaints(), 1, "the same country pointed at again, and by the focus as well");

  hover.overMap("France");
  hover.overMap("France");
  assert.equal(repaints(), 1, "the pointer moving about inside one country on the map");
  hover.overMap("Gabon");
  hover.overMap(null);
  hover.overMap(null);
  assert.equal(repaints(), 3);
});

test("down the list, each row takes the highlight from the one before", () => {
  const { hover } = counted();
  hover.enterRow("Albania");
  hover.leaveRow("Albania");
  hover.enterRow("Algeria");
  assert.equal(hover.code, "Algeria");

  // A leave for a row that is not the one pointed at is old news.
  hover.leaveRow("Albania");
  hover.blurRow("Algeria");
  assert.equal(hover.code, "Algeria");
});

test("the pointer on the map takes the highlight back, over a country and over none", () => {
  const { hover } = counted();
  hover.focusRow("Chile");
  hover.overMap("Brazil");
  assert.equal(hover.code, "Brazil", "the map's own hover, with a row still focused");
  hover.overMap(null);
  assert.equal(hover.code, null, "open sea is nothing, not the focused row");

  hover.enterRow("Peru");
  assert.equal(hover.code, "Peru");
  hover.leaveRow("Peru");
  hover.overMap("Brazil");
  assert.equal(hover.code, "Brazil");
});

test("a country the map left lit does not come back when a row is left", () => {
  const { hover } = counted();
  // The pointer left the map over Brazil; the map never hears that.
  hover.overMap("Brazil");
  hover.enterRow("Peru");
  assert.equal(hover.code, "Peru");
  hover.leaveRow("Peru");
  assert.equal(hover.code, null);
});

test("the focus wins over a pointer resting elsewhere, and hands back when it leaves the list", () => {
  const { hover } = counted();
  hover.enterRow("Albania");
  hover.focusRow("Chile");
  assert.equal(hover.code, "Chile", "the pointer resting on another row");
  hover.blurRow("Chile");
  assert.equal(hover.code, "Albania", "the pointer is still on its row");

  hover.leaveRow("Albania");
  hover.overMap("Brazil");
  hover.focusRow("Chile");
  assert.equal(hover.code, "Chile", "the pointer resting on the map");
  hover.overMap("Brazil");
  assert.equal(hover.code, "Brazil", "until it moves there again");
});

test("the pointer wins over a focused row, and hands back when it leaves", () => {
  const { hover } = counted();
  hover.focusRow("Chile");
  hover.enterRow("Albania");
  assert.equal(hover.code, "Albania");
  hover.leaveRow("Albania");
  assert.equal(hover.code, "Chile", "the focus is still on its row");
  hover.blurRow("Chile");
  assert.equal(hover.code, null);
});

test("a row taken out of the list lets go, as no leave is sent for it", () => {
  const { hover, repaints } = counted();
  hover.enterRow("Albania");
  hover.rowsShown(["Albania", "Algeria"]);
  assert.equal(hover.code, "Albania", "still shown, still lit");
  hover.rowsShown(["France", "Gabon"]);
  assert.equal(hover.code, null, "a search narrowed the list under the pointer");
  assert.equal(repaints(), 2);

  hover.focusRow("France");
  hover.enterRow("Gabon");
  hover.rowsShown(["France"]);
  assert.equal(hover.code, "France", "the row still shown keeps what it had");
  hover.rowsShown([]);
  assert.equal(hover.code, null);
});

test("the list changing never touches the map's own hover", () => {
  const { hover, repaints } = counted();
  hover.overMap("Brazil");
  hover.rowsShown(["France"]);
  hover.rowsShown([]);
  assert.equal(hover.code, "Brazil", "a country need not be among the rows shown to be hovered on the map");
  assert.equal(repaints(), 1);
});

test("a row with no code points at nothing", () => {
  const { hover, repaints } = counted();
  hover.enterRow("");
  hover.focusRow(undefined);
  hover.leaveRow("");
  assert.equal(hover.code, null);
  assert.equal(repaints(), 0);
});

// ---- The picker's map and list ---------------------------------------------

const picker = fs.readFileSync(new URL("./CountryPickerMap.jsx", import.meta.url), "utf8");

test("a change of the highlighted country is one repaint of the region layer, from the map's own pointer too", () => {
  // The layer told it changed, and no more: no state (so no render), nothing
  // reloaded, the map not rebuilt, the view not moved.
  assert.match(picker, /const hover = createPickerHover\(\(\) => layer\.changed\(\)\);\s*hoverRef\.current = hover;/);
  assert.match(picker, /const isHovered = code === hover\.code;/);
  assert.match(picker, /hover\.overMap\(isClickable \? code : null\);/);
  assert.doesNotMatch(picker, /hoveredCodeRef/, "one place holds the highlighted country");
});

test("a row points at its country by its code, with the pointer and with the focus, where a pointer can hover", () => {
  const row = picker.slice(picker.indexOf("{shownOptions.map((c) => ("), picker.indexOf("<span>{c.name}</span>"));
  assert.notEqual(row, "", "the list's rows must be found");
  assert.match(row, /onMouseEnter=\{canHover \? \(\) => hoverRef\.current\?\.enterRow\(c\.code\) : undefined\}/);
  assert.match(row, /onMouseLeave=\{canHover \? \(\) => hoverRef\.current\?\.leaveRow\(c\.code\) : undefined\}/);
  assert.match(row, /onBlur=\{canHover \? \(\) => hoverRef\.current\?\.blurRow\(c\.code\) : undefined\}/);
  assert.match(picker, /const canHover = useCanHover\(\);/);
  // The code is the owner the map's regions carry; a name is only what is shown.
  assert.doesNotMatch(row, /Row\(c\.name\)/);
  // The keyboard's focus only: a row pressed with the mouse takes the focus as
  // well, and keeps it when the press is let go of somewhere else.
  assert.match(row, /onFocus=\{canHover \? \(event\) => \{ if \(hasKeyboardFocus\(event\.currentTarget\)\) hoverRef\.current\?\.focusRow\(c\.code\); \} : undefined\}/);
  assert.match(picker, /const hasKeyboardFocus = \(element\) => element\.matches\(":focus-visible"\);/);
});

test("the rows the list shows are the rows the hover is told about", () => {
  assert.match(picker, /const shownOptions = useMemo\(\(\) => filteredOptions\.slice\(0, rowLimit\), \[filteredOptions, rowLimit\]\);/);
  assert.match(picker, /hoverRef\.current\?\.rowsShown\(shownOptions\.map\(\(c\) => c\.code\)\);\s*\}, \[shownOptions\]\);/);
});
