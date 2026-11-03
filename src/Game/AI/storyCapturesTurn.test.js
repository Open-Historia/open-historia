/*! Open Historia — a region the story says was taken, and the troops that took it: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/storyCapturesTurn.test.js
//
// "make sure the simulation ai is able to say that a region is taken by an army
// which causes the nearest troops to move accordingly so when that event
// happens, the region has been taken"; "the max number of nearby units
// redirected should be based on the size of the region. there should also be a
// minimum number and if that minimum is not met then the region transfer
// fails" (the owner, 2026-10-28). The front engine's half is tested in
// runtime/fronts/storyCaptures.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { frontRunSpan, planFrontMoments } from "./frontTurn.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const frontTurn = readFileSync(new URL("./frontTurn.js", import.meta.url), "utf8");

test("the skip is told it may have an army take a region, with enough of its troops near, and to bring them up first", () => {
  assert.match(gameplay, /\[Taking Ground\]\r?\nAn army may take a region in this period wherever what has led up to it makes that likely, or where history took it at this time/);
  assert.match(gameplay, /a regionControlOps control entry, basis occupation, the region by name\. Move the formation that took it there in the same event/);
  assert.match(gameplay, /A region is taken only where enough of the taker's troops stand near it, more for a larger region: where too few do, move them up first, in an earlier event, or the region stays where it was\./);
});

test("a capture is a capture for the engine; a treaty's transfer is not", () => {
  const events = [{ id: "e1", date: "2024-03-06", impacts: {
    regionControlOps: [{ op: "control", regionId: "r1", fromCode: "Ukraine", toCode: "Russia" }],
    regionTransfers: [{ regionId: "r4", toCode: "Poland", fromCode: "Ukraine" }],
  } }];
  const { days, dayOf } = frontRunSpan({ fromDate: "2024-03-01", toDate: "2024-03-31", events });
  const moments = planFrontMoments({ events, fromDate: "2024-03-01", days, dayOf });
  assert.deepEqual(moments.map((moment) => [moment.regionId, moment.capture === true]), [["r1", true], ["r4", false]]);
});

test("a capture the engine refused is not made in the world: its control operation comes off its event, and the receipt says why", () => {
  assert.match(frontTurn, /const failedCaptures = asArray\(result\.notes\)\.filter\(\(note\) => note\?\.kind === "capture-failed" && clean\(note\?\.ref\)\);/);
  assert.match(frontTurn, /events: attachFrontFlips\(kept, result\.flips, \{ dayOf, aboutOf \}\)\.events,/);
  assert.match(frontTurn, /"capture-failed": \(notes\) => notes\.slice\(0, 4\)\.map\(\(note\) => `\$\{clean\(note\?\.taker\)\} could not take \$\{clean\(note\?\.region\) \|\| "a region"\}: too few of its troops near`\)/);
});

test("off any battlefield, as many of the taker's free land formations as the region's size asks march in, and too few take nothing", () => {
  const body = gameplay.slice(gameplay.indexOf("const marchCapturersIn = async"), gameplay.indexOf("// A region's area in km², near enough"));
  assert.ok(body.length > 0);
  // Not a garrison, not covert, not one fighting on a battlefield, and within reach.
  assert.match(gameplay, /const STORY_MARCHERS = new Set\(\["infantry", "armor", "artillery"\]\);/);
  assert.match(gameplay, /const STORY_MARCH_KM = 800;/);
  assert.match(body, /!unit\.covert && !normalizeString\(unit\.committedTo\)/);
  // The region's size sets how many: at least the least, or the control operation comes off the event.
  assert.match(body, /const \{ least, most \} = takersFor\(geometryAreaKm2\(row\.geometry\)\);/);
  assert.match(body, /if \(arriving \+ standing \+ near\.length < least\) \{\r?\n\s+refused\.push\(op\);/);
  assert.match(body, /if \(refused\.length\) impacts\.regionControlOps = normalizeArray\(impacts\.regionControlOps\)\.filter\(\(op\) => !refused\.includes\(op\)\);/);
  assert.match(body, /near\.slice\(0, Math\.max\(0, most - arriving - standing\)\)/);
  // A region on an open battlefield the taker fights on is the engine's.
  assert.match(body, /if \(!row \|\| !taker \|\| onFront\(row, taker\)\) continue;/);
  // Run on the answer that is kept, after the narrated captures.
  assert.match(gameplay, /await completeNarratedCaptures\(containers, world, \{ receipt, renderedRegions, lookupContext \}\);\r?\n  \}\r?\n[\s\S]{0,200}if \(!strict && !resolvedRegionIdsOnly && Array\.isArray\(candidate\?\.events\)\) \{\r?\n    await marchCapturersIn\(containers, world, \{ receipt, renderedRegions, lookupContext \}\);/);
});
