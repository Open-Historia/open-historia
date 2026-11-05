/*! Open Historia — the land war a skip fought before its story, for the map: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/foreseenFronts.test.js
//
// "In the first event after a new time skip, units seem to dissapear from the
// battle field and even when they dont, they dont move until like 4-5 more
// events pass and then it all moves at once" (the owner, 2026-10-14).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { foreseeFronts, foreseenFronts, onForeseenFronts } from "./foreseenFronts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");

test("the period's battlefields are kept for the map as the skip fights them, and nothing is kept for a skip that fought none", () => {
  const seen = [];
  const stop = onForeseenFronts((value) => seen.push(value));
  const battlefields = [{ name: "Germany - Poland front" }];
  foreseeFronts({ fromDate: "2017-01-02", toDate: "2017-02-01", days: 30, battlefields, news: [] });
  assert.deepEqual(foreseenFronts(), { fromDate: "2017-01-02", toDate: "2017-02-01", battlefields });
  foreseeFronts(null);
  assert.equal(foreseenFronts(), null);
  foreseeFronts({ fromDate: "2017-01-02", battlefields: [] });
  assert.equal(foreseenFronts(), null, "none fought");
  stop();
  foreseeFronts({ fromDate: "2017-01-02", battlefields });
  assert.equal(seen.length, 3, "told each time until stopped");
  foreseeFronts(null);
});

test("the skip keeps them as it fights the period, and the reveal of a turn being written plays them at each event", () => {
  const gameplay = read("gameplay.js");
  assert.ok(gameplay.includes("  foreseeFronts(foughtBefore);\n"), "as the period is fought before its story");
  assert.ok(gameplay.includes("      Object.assign(forecast, again, { given });\n      foreseeFronts(forecast);"), "and fought again with a player's order");
  const time = read("../GameUI/time.jsx");
  assert.ok(time.includes("setFrontsOverride(usable ? battlefieldsAsSeen(\n                        foreseen.battlefields,"), "the live reveal plays them");
  assert.equal(time.includes("has not been\n                    // fought yet"), false, "and no longer holds the battlefields still");
  // A landed turn is revealed at once on the world the skip found, not after its restore point is read.
  assert.ok(time.includes("const base = record && stagedBase.recordId === record.id && stagedBase.world ? stagedBase.world : landedBaseFor(record);"));
});
