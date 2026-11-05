import assert from "node:assert/strict";
import test from "node:test";
import { playerFacingJumpError } from "./jumpErrorCopy.js";

test("Political World validation failures are explained without exposing internal operation names", () => {
  const result = playerFacingJumpError(new Error(
    'AI task "jumpForward" failed: Political event "Prime Minister resigns" changes a head of state/government or party leader but carries no matching replace-leader, set-government or set-party-leader politicalActorOps.',
  ));
  assert.match(result, /did not update the Political World to match it/);
  assert.match(result, /Nothing was written/);
  assert.match(result, /Diagnostics/);
  assert.doesNotMatch(result, /politicalActorOps|replace-leader|set-government/);
});

test("unrelated failures keep their useful original message", () => {
  assert.equal(playerFacingJumpError(new Error("No model in your Fallback list can answer.")), "No model in your Fallback list can answer.");
});
