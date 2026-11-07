/*! Open Historia — map/story check counts tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/storyChecks.test.js

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createStoryCheckTally, describeStoryChecks } from "./storyChecks.js";

test("a turn's counts are reported and cleared; the totals run on", () => {
  const tally = createStoryCheckTally();
  tally.note("eventCapture");
  tally.note("filledAnnexation", 2);
  tally.note("filledCapture", 0);
  tally.note("nonsense", 5);
  const first = tally.take();
  assert.deepEqual([first.turn.eventCapture, first.turn.filledAnnexation, first.turns], [1, 2, 1]);
  assert.equal(describeStoryChecks(first),
    "Map/story checks this turn: sent back 1× (1 an event stating a capture with no territory change of its own); filled in 2 (2 annexations written from the event's words). Since the app opened (1 turn): sent back 1×, filled in 2.");
  const second = tally.take();
  assert.equal(second.turn.eventCapture, 0);
  assert.equal(describeStoryChecks(second), "Map/story checks this turn: nothing to correct. Since the app opened (2 turns): sent back 1×, filled in 2.");
});

test("every check notes itself, and the count is logged once per turn", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const kind of ["turnCapture", "turnSettlement", "eventCapture", "eventAnnexation"]) {
    assert.match(gameplay, new RegExp(`storyChecks\\.note\\("${kind}"\\);\\n\\s*return `), `${kind} is counted where it sends the turn back`);
  }
  const body = (name) => gameplay.slice(gameplay.indexOf(`const ${name} = async`), gameplay.indexOf("\n};\n", gameplay.indexOf(`const ${name} = async`)));
  assert.match(body("completeNarratedAnnexations"), /storyChecks\.note\("filledAnnexation", added\);\n  return added;$/);
  assert.match(body("completeNarratedCaptures"), /storyChecks\.note\("filledCapture", added\);\n  return added;$/);
  assert.match(body("marchCapturersIn"), /storyChecks\.note\("marched", moved\);\n  return moved;$/);
  assert.equal((gameplay.match(/logDebugEvent\("story-checks", describeStoryChecks\(/g) ?? []).length, 1);
});
