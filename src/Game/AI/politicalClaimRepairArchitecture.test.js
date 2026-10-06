import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const providerConfig = fs.readFileSync(new URL("./providerConfig.js", import.meta.url), "utf8");

test("timeline final-attempt Political World repair is wired through the bounded native-validation seam", () => {
  assert.match(source, /from "\.\/politicalClaimRepair\.js"/);
  assert.match(source, /const repairGeneratedPoliticalClaims = async/);
  assert.match(source, /taskKey: "politicalClaimRepair"/);
  assert.match(source, /tool: POLITICAL_CLAIM_REPAIR_TOOL/);
  assert.match(source, /requests\?\.budget && !requests\.budget\.take\("repair"\)/);
  assert.match(source, /Number\(attempt\) >= 2 && politicalClaimContext\.mode === "structured"/);
  assert.match(source, /politicalClaimRepair: finalAttempt/);
  assert.match(source, /politicalImpactCompletenessFailure\(candidate, \{ world, claimContext: politicalClaimContext \}\)/);
});

test("unresolved canonical Political World repair bypasses canned fallback and is held", () => {
  const noFallbackGate = source.indexOf("if (noFallbackError && [\"jumpForward\", \"autoJumpForward\"].includes(taskKey))");
  const salvage = source.indexOf("if (salvageCandidate)");
  assert.ok(noFallbackGate >= 0, "runJsonTask must recognize the non-cannable canonical error");
  assert.ok(salvage >= 0 && noFallbackGate < salvage, "canonical hold must win before generic salvage/fallback");

  const holdGate = source.indexOf("if (shouldPreventDeterministicFallback(error))");
  const oneSegmentFallback = source.indexOf("if (segmentCount <= 1)", holdGate);
  assert.ok(holdGate >= 0, "runJumpSegments must recognize the canonical error");
  assert.ok(oneSegmentFallback >= 0 && holdGate < oneSegmentFallback, "Political World canonical failure must hold before one-segment canned fallback");
  assert.match(source.slice(holdGate, oneSegmentFallback), /holdTurn\(HELD_TURN\.segment/);
});

test("Political World repair is exposed as its own model-routing task", () => {
  assert.match(providerConfig, /key: "politicalClaimRepair"/);
});

test("late salvage cannot erase a Political World no-fallback hold", () => {
  const salvageStart = source.indexOf("if (salvageCandidate)");
  const fallbackStart = source.indexOf("if (typeof fallback !== \"function\")", salvageStart);
  assert.ok(salvageStart >= 0 && fallbackStart > salvageStart, "late salvage block must precede deterministic fallback");
  const salvageBlock = source.slice(salvageStart, fallbackStart);
  assert.ok(salvageBlock.includes("catch (error)"));
  assert.ok(salvageBlock.includes("if (shouldPreventDeterministicFallback(error)) throw error;"));
});
