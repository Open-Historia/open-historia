/*! Open Historia — queued-order outcome attribution integration guard © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("fallback events cite the exact queued Action they were synthesized from", () => {
  const start = source.indexOf("const fallbackJumpSimulation");
  const end = source.indexOf("const buildGeneratedChat", start);
  const fallback = source.slice(start, end > start ? end : start + 7000);
  assert.match(fallback, /actionIds:\s*normalizeString\(action\.id\)\s*\?\s*\[normalizeString\(action\.id\)\]\s*:\s*\[\]/);
});

test("normal jump validation receives the live Action queue for exact actionId reference integrity", () => {
  assert.match(source, /validateGeneratedWorldChanges\(candidate, bundle\.world, \{[\s\S]{0,300}?actions: bundle\.actions,/);
});

test("saving-mode turn review can carry queued-order attribution and final events receive the validated associations before directors", () => {
  assert.match(source, /key: "actions"[\s\S]{0,350}?ACTION_OUTCOME_ASSOCIATION_SCHEMA/);
  const finish = source.indexOf("const finishTimelineJump");
  const directors = source.indexOf("directGeneratedUnitOps", finish);
  const apply = source.indexOf("applyActionOutcomeAssociations", finish);
  assert.ok(finish >= 0 && apply > finish && directors > apply, "association repair must happen before unit/territory/structure directors and final curation");
});

test("non-saving mode asks for bounded attribution only when the plan finds unresolved orders and candidate events", () => {
  const start = source.indexOf("const runStandaloneActionOutcomeReview");
  const end = source.indexOf("// The agents' reports", start);
  const body = source.slice(start, end);
  assert.match(body, /buildActionOutcomeAssociationPlan/);
  assert.match(body, /if \(!plan\) return null/);
  assert.match(body, /budget\?\.take\("review"\)/);
  assert.match(body, /ACTION_OUTCOME_ASSOCIATION_TOOL/);
});
