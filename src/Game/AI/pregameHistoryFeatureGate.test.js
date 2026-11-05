/*! Open Historia — pre-game history feature-gate regression © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/pregameHistoryFeatureGate.test.js
//
// "Pre-game history" (Gameplay features) switches off the ASKING: with it off a
// fresh game sends no request and reads nothing out of the briefing. A
// pre-history the scenario keeps (world.prehistory, written or generated in the
// Workshop) is the author's own and costs nothing, so it is written whatever
// the switch says. The switch used to sit in front of the whole entry point,
// which also dropped the scenario's own record.
//
// gameplay.js cannot be imported without the whole app, so it is read as
// source: what is pinned is the order inside maybeGeneratePregameHistory.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const gameplay = read("./gameplay.js");
const lazy = read("./gameplayLazy.js");

const entry = () => {
  const start = gameplay.indexOf("export const maybeGeneratePregameHistory = async");
  assert.notEqual(start, -1, "the pre-game history entry point is missing");
  const end = gameplay.indexOf("\nexport const ", start + 1);
  return gameplay.slice(start, end === -1 ? undefined : end);
};

test("with the switch off nothing is asked of the model", () => {
  const body = entry();
  const gate = body.indexOf('if (!isActiveFeatureEnabled("pregameHistory")) return null;');
  const request = body.indexOf("await requestPregameHistoryPayload(");
  assert.notEqual(gate, -1, "the feature switch is not enforced");
  assert.notEqual(request, -1, "the entry point no longer asks for a pre-history");
  assert.ok(gate < request, "the request is made before the switch is read");
  // Nor is the briefing read for what a request would have to cover.
  const coverage = body.indexOf("derivePregameBootstrapCoverageRequirements(");
  assert.ok(coverage === -1 || gate < coverage, "the briefing is read before the switch");
});

test("a pre-history the scenario keeps is written whatever the switch says", () => {
  const body = entry();
  const stored = body.indexOf("return await applyScenarioPrehistory(storedPayload,");
  const gate = body.indexOf('if (!isActiveFeatureEnabled("pregameHistory")) return null;');
  assert.notEqual(stored, -1, "the scenario's own record is no longer written");
  assert.ok(stored < gate, "the switch is read before the scenario's own record is written");
});

test("the lazy entry point does not decide for the game: it only forwards", () => {
  const start = lazy.indexOf("export const maybeGeneratePregameHistory = async");
  assert.notEqual(start, -1, "the pre-game history lazy entry point is missing");
  const line = lazy.slice(start, lazy.indexOf("\n", start));
  assert.match(line, /\(await gameplay\(\)\)\.maybeGeneratePregameHistory\(\.\.\.args\)/);
  assert.doesNotMatch(lazy, /isActiveFeatureEnabled\("pregameHistory"\)/);
});
