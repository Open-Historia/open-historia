/*! Open Historia — the Game Master's panels in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Force Manager (the Forces panel: edit any unit, place it by hand) is the
// Cheats panel's, and opens only from it. In a shared game the Game Master's
// tools are not offered, so one left open when a shared game begins closes with
// the Cheats panel ("isnt this a cheats thing tho", the owner, 2026-11-16).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("the Game Master's panels, its Force Manager with them, close when a shared game begins", () => {
  assert.match(main, /if \(!sharedRole\) return;\s*setIsCheatsOpen\(false\);\s*setIsForcesOpen\(false\);/);
  // The Forces panel opens only from the Cheats panel's Force Manager.
  assert.equal((main.match(/setIsForcesOpen\(true\)/g) ?? []).length, 1);
  assert.match(main, /onOpenForces=\{\(\) => \{ setIsCheatsOpen\(false\); setIsForcesOpen\(true\); \}\}/);
});
