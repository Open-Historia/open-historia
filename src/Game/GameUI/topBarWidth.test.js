/*! Open Historia — top bar width test © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/topBarWidth.test.js
//
// The date bar's surface has a fixed width, and on desktop the bar with the
// player's country is meant to grow past it up to a cap. With the fixed width
// left in place the cap never applied: "Yugoslavia" read "YUGOS…" and
// "Hellenic Republic" "HELLENIC…" in a bar with room to spare.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./time.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("on desktop the date bar grows with the country's name, from the usual width up to the cap", () => {
  assert.match(source, /: playerCountry\n\s*\? \{ width: "auto", minWidth: widgetSurface\.width, maxWidth: "min\(28rem, calc\(100vw - 8rem\)\)" \}/);
});

test("a name cut at the cap can still be read whole", () => {
  assert.match(source, /title=\{playerCountry\}/);
});
