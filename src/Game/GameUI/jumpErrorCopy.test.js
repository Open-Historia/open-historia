import assert from "node:assert/strict";
import test from "node:test";
import { playerFacingJumpError } from "./jumpErrorCopy.js";
import { politicalClaimRepairHoldError } from "../AI/politicalClaimRepair.js";

// A failure is known by the status it carries, never by the words of its
// message: an English phrase in it once decided which copy the player read.
test("a turn held for the Political World is explained without exposing internal operation names", () => {
  const result = playerFacingJumpError(politicalClaimRepairHoldError(
    'Political event "Prime Minister resigns" changes a head of state/government or party leader but carries no matching replace-leader, set-government or set-party-leader politicalActorOps.',
  ));
  assert.match(result, /did not update the Political World to match it/);
  assert.match(result, /Nothing was written/);
  assert.match(result, /Diagnostics/);
  assert.doesNotMatch(result, /politicalActorOps|replace-leader|set-government/);
  // The same hold with a message in another language reads the same.
  const french = playerFacingJumpError(Object.assign(new Error("Le Monde politique n'a pas pu être réconcilié."), { canonicalIntegrity: "political-world" }));
  assert.equal(french, result);
});

test("unrelated failures keep their useful original message, whatever words they hold", () => {
  assert.equal(playerFacingJumpError(new Error("No model in your Fallback list can answer.")), "No model in your Fallback list can answer.");
  // Words alone are no status: a message that merely names the ops is shown as it is.
  const named = "AI task \"jumpForward\" failed: an answer listed politicalActorOps in the wrong place.";
  assert.equal(playerFacingJumpError(new Error(named)), named);
});
