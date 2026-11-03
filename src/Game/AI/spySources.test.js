/*! Open Historia — who plants agents in the player is the model's to say: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/spySources.test.js
//
// "right now it seems like spys are coming from random countries, instead make
// it so the ai makes them come from sources that make sense to the ai" (the
// owner, 2026-10-28).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeSegmentPayloads } from "./jumpSegments.js";
import { GAMEPLAY_TOOLS } from "./gameplaySchemas.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a skip names who spies on the player, once each across its segments, and saying nothing is not saying none", () => {
  const merged = mergeSegmentPayloads([
    { events: [], spiesOnPlayer: "Soviet Union, People's Republic of China" },
    { events: [], spiesOnPlayer: "Soviet Union\nNorth Korea" },
  ]);
  assert.deepEqual(merged.spiesOnPlayer, ["Soviet Union", "People's Republic of China", "North Korea"]);
  assert.deepEqual(mergeSegmentPayloads([{ events: [], spiesOnPlayer: "" }]).spiesOnPlayer, []);
  assert.equal(mergeSegmentPayloads([{ events: [] }]).spiesOnPlayer, null);
  assert.equal(GAMEPLAY_TOOLS.jumpForward.schema.properties.spiesOnPlayer.type, "string");
});

test("the skip is asked who spies, and the game rolls only for those it named", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /\[Who Spies on the Player\]\r?\nWrite spiesOnPlayer: the polities, by exact name and comma-separated, that would really try to place an agent in/);
  assert.match(gameplay, /spiesOnPlayer: merged\.spiesOnPlayer,/);
  assert.match(gameplay, /const spiesNamed = Array\.isArray\(result\.spiesOnPlayer\) \? result\.spiesOnPlayer : null;/);
  assert.match(gameplay, /const espionageCandidates = espionageCandidatesAgainst\(canonicalEspionagePolity\(baseGame\.country\), spiesNamed\);/);
  // Never every polity on the map again.
  assert.doesNotMatch(gameplay, /\.\.\.Object\.keys\(worldWithImpacts\.polityOverrides \?\? \{\}\),\r?\n\s+\.\.\.Object\.keys\(worldWithImpacts\.intelligence/);
  assert.match(gameplay, /\}\)\.filter\(\(candidate\) => named \|\| candidate\.hostility > 0\);/);
  // And the scenario switch it replaces is gone.
  assert.doesNotMatch(read("../../runtime/spycraft.js"), /cannotSpy|noSpies/);
  assert.doesNotMatch(read("../../Editor/PolitiesPanel.jsx"), /noSpies/);
});
