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
  // The Directors run through mapConsequences.js, which a Scene outcome shares.
  const directors = source.indexOf("applyMapConsequences(", finish);
  const apply = source.indexOf("applyActionOutcomeAssociations", finish);
  assert.ok(finish >= 0 && apply > finish && directors > apply, "association repair must happen before unit/territory/structure directors and final curation");
});

test("attribution is never a request of its own: it rides the one review a refused skip gets, in every mode", () => {
  // With Save AI requests off this used to be one more request after the skip
  // (runStandaloneActionOutcomeReview). A skip is one request in every mode now
  // (requestBudget.js): its events cite their own orders, and the association
  // pass exists only as a job of the combined review.
  assert.doesNotMatch(source, /runStandaloneActionOutcomeReview|ACTION_OUTCOME_ASSOCIATION_TOOL/);
  const finish = source.slice(source.indexOf("const finishTimelineJump"), source.indexOf("export const simulateTimelineJump"));
  assert.match(finish, /const actionPlan = review\.actionOutcomePlan \?\? null;/);
  assert.match(finish, /const actionAnswer = review\.parts\?\.actions \?\? null;/);
  // The one place the plan is built is the review, which asks the skip's budget.
  assert.equal(source.match(/buildActionOutcomeAssociationPlan\(/g)?.length, 1);
  const review = source.slice(source.indexOf("const runTurnReview = async"), source.indexOf("const fileReviewedAgentReports"));
  assert.match(review, /buildActionOutcomeAssociationPlan\(/);
  assert.match(review, /requests\.budget\.take\("review"\)/);
});
