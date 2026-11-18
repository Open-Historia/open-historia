/*! Open Historia — whose AI makes the readings a shared game makes by itself: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sharedReadings.test.js
//
// After every round, and when a scenario's fronts were built, the engine of a
// shared game read figures on the host's AI whatever "replies" said (the
// review of 2026-11-18, cost 6 and wars 9). They follow the setting now.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { hostReadsFigures, setHostReadsFigures } from "./sharedReadings.js";

const source = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").split("\r\n").join("\n");

test("the game's own readings are made on this device's AI unless the shared game it hosts leaves figures to each player's", () => {
  assert.equal(hostReadsFigures(), true, "single player, and every page, as ever");
  setHostReadsFigures(false);
  assert.equal(hostReadsFigures(), false);
  setHostReadsFigures(true);
  assert.equal(hostReadsFigures(), true);
});

// gameplay.js and the engine do not load in node: where the setting is read is pinned from the source.
test("the readings after a round, when fronts are built, and for an agent's target follow it; the engine sets it from the lobby", () => {
  const gameplay = source("../Game/AI/gameplay.js");
  const conflict = gameplay.slice(gameplay.indexOf("const requestConflictSheets = ("), gameplay.indexOf("const foldName = "));
  assert.match(conflict, /if \(!frontsOn\(\) \|\| !hostReadsFigures\(\)\) return;/, "conflict backends and the figures of those at war");
  assert.match(gameplay, /if \(entry\.op === "deploy" && hostReadsFigures\(\)\) void ensureCountryAssessed\(entry\.target/, "an agent's target");
  const engine = source("../multiplayer/host/engineMain.js");
  assert.match(engine, /setHostReadsFigures\(settings\.replies !== "own"\);\n\s*preparing = true;/, "before the game's start, its fronts' readings too");
  assert.match(engine, /setHostReadsFigures\(status\?\.lobby\?\.settings\?\.replies !== "own"\);/, "and as the host changes it");
  assert.match(engine, /setHostingSharedGame\(false\);\n\s*setHostReadsFigures\(true\);/, "and single player's again once sharing stops");
});
