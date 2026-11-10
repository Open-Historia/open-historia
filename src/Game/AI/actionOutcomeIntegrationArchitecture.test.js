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

test("attribution is never a request of its own: a skip's events cite their own orders", () => {
  // With Save AI requests off this used to be one more request after the skip
  // (runStandaloneActionOutcomeReview), and then a job of the turn review a
  // refused skip got. The turn review went on 2026-11-07 ("remove the stuff
  // relating to those things entirely", the owner): a skip's events cite the
  // orders they answer, and nothing repairs the attribution after it.
  assert.doesNotMatch(source, /runStandaloneActionOutcomeReview|ACTION_OUTCOME_ASSOCIATION_TOOL|runTurnReview/);
  assert.doesNotMatch(source, /buildActionOutcomeAssociationPlan\(|applyActionOutcomeAssociations\(/);
});
