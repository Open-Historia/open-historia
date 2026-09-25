import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pipeline = fs.readFileSync(new URL("./pipeline.js", import.meta.url), "utf8");
const worklist = fs.readFileSync(new URL("./simpleWorklist.js", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("./simpleRunner.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../../GameUI/PoliticalWorldGenerationPanel.jsx", import.meta.url), "utf8");
const rebase = fs.readFileSync(new URL("./checkpointRebase.js", import.meta.url), "utf8");

test("normal Scenario Editor Generate/Apply path is wired to deterministic Political World v2", () => {
  assert.match(panel, /generateOrResumePoliticalWorldV2/);
  assert.match(panel, /applyPoliticalWorldV2Checkpoint/);
  assert.match(pipeline, /runSimplePoliticalWorldV2/);
  assert.doesNotMatch(pipeline, /from "\.\/planner\.js"/);
  assert.doesNotMatch(pipeline, /from "\.\/jobGraph\.js"/);
  assert.doesNotMatch(pipeline, /from "\.\/repairQueue\.js"/);
  assert.doesNotMatch(pipeline, /runPoliticalWorldV2Jobs/);
});

test("deterministic worklist has fixed domain order and bounded batches", () => {
  const actor = worklist.indexOf('type: "political-actor"');
  const alignment = worklist.indexOf('type: "governing-alignment"');
  const institutions = worklist.indexOf('type: "institution-discovery"');
  const membership = worklist.indexOf('type: "institution-membership-resolution"');
  const agreements = worklist.indexOf('type: "agreement-resolution"');
  const power = worklist.indexOf('type: "power-evidence"');
  const verification = worklist.indexOf('type: "historical-verification"');
  assert.ok(actor < alignment && alignment < institutions && institutions < membership && membership < agreements && agreements < power && power < verification);
  assert.match(worklist, /politicalActor: 12/);
  assert.match(worklist, /temporalSentinel: 12/);
  assert.match(worklist, /historicalVerification: 4/);
});

test("Political World v2 enforces a lifetime call ceiling and accepts actor work only after native behavioral completeness", () => {
  const checkpoint = fs.readFileSync(new URL("./checkpoint.js", import.meta.url), "utf8");
  assert.match(checkpoint, /POLITICAL_WORLD_V2_DEFAULT_TOTAL_MODEL_CALL_CEILING = 100/);
  assert.match(checkpoint, /POLITICAL_WORLD_V2_LEGACY_OVERRUN_ALLOWANCE = 60/);
  assert.match(runner, /total-model-call-budget/);
  assert.match(runner, /acceptedPoliticalWorldV2ActorTargets/);
  assert.match(worklist, /behaviorallyIncompletePoliticalWorldV2Actors/);
});

test("simple runner derives the next task from canon instead of spawning child repair jobs", () => {
  assert.match(runner, /deriveNextPoliticalWorldV2Task/);
  assert.doesNotMatch(runner, /addPoliticalWorldV2Jobs/);
  assert.doesNotMatch(runner, /repair:/);
  assert.doesNotMatch(runner, /dependencies/);
  assert.match(runner, /applySimpleAccounting/);
});

test("v2 Apply remains atomic and materializes canonical owning ledgers only", () => {
  assert.match(pipeline, /materializeScenarioCanon\(freshWorld/);
  assert.match(pipeline, /politicalActors: staged\.politicalActors/);
  assert.match(pipeline, /institutions: staged\.institutions/);
  assert.match(pipeline, /agreements: staged\.agreements/);
  assert.match(pipeline, /powerStatus: staged\.powerStatus/);
  assert.match(pipeline, /initializePoliticalDispositionsForWorld\(materialized, \{ updatedAt: scenarioDate \}\)/);
});


test("bounded domain failures defer targets without silently reopening them on ordinary Resume", () => {
  assert.match(worklist, /politicalWorldV2TargetExhausted/);
  assert.match(worklist, /retryableTargets/);
  assert.doesNotMatch(runner, /bounded-failure:/);
  assert.match(runner, /pauseReason = summary\?\.deferred\?\.length \? "bounded-unresolved"/);
  assert.doesNotMatch(pipeline, /checkpoint\.attempts = \{\};/);
  assert.match(pipeline, /retryDeferred === true/);
  assert.match(pipeline, /resetDeferredPoliticalWorldV2Attempts/);
  assert.match(panel, /Continue Generation/);
  assert.doesNotMatch(panel, /Retry Deferred Targets/);
});

test("provider/executor throws pause the deterministic session instead of penalizing polity attempts", () => {
  assert.match(runner, /current\.pauseReason = providerPauseReason\(error\)/);
  assert.match(runner, /return current;/);
  assert.doesNotMatch(runner, /catch \(error\)[\s\S]{0,500}bumpAttempts\(current, task\.type/);
});

test("v2 owns retries at the checkpoint boundary so one work item can spend only one provider call", () => {
  assert.match(runner, /taskProviderCallCeiling = \(\) => 1/);
  assert.match(runner, /callsRemaining < taskCallCeiling/);
  assert.match(runner, /retryContext/);
  assert.match(runner, /actorFailureErrors/);
  const executor = fs.readFileSync(new URL("./executor.js", import.meta.url), "utf8");
  assert.match(executor, /boundedCallModel/);
  assert.match(executor, /const taskProviderCallCeiling = \(\) => 1/);
  assert.match(executor, /maxAttempts: 1/);
  assert.match(executor, /retryErrorsByPolity: checkpoint\?\.retryContext\?\.politicalActor/);
  assert.match(executor, /retryPoliticalSystemLocksByPolity: checkpoint\?\.retryContext\?\.politicalSystemLocks/);
  assert.match(runner, /retryBucket\(next, "politicalSystemLocks"\)/);
  assert.match(runner, /retryPoliticalSystemLocksByPolity/);
});

test("downloaded v2 diagnostics preserve per-polity retry validation evidence", () => {
  assert.match(pipeline, /unresolvedDetails: buildDiagnosticUnresolvedDetails\(checkpoint\)/);
  assert.match(pipeline, /retryContext: clone\(checkpoint\?\.retryContext \|\| \{\}\)/);
  assert.match(pipeline, /retryContext\?\.politicalActor\?\.\[polityKey\]/);
  assert.match(pipeline, /retryContext\?\.politicalSystemLocks\?\.\[polityKey\]/);
  assert.match(pipeline, /politicalSystemLock/);
  assert.match(pipeline, /validationErrors/);
});


test("PWV2 party coverage is a political-actor Canonical Gate invariant without turning governing alignment into a party generator", () => {
  const executor = fs.readFileSync(new URL("./executor.js", import.meta.url), "utf8");
  assert.match(worklist, /requireRepresentationCoverage: true/);
  assert.match(executor, /requireRepresentationCoverage: true/);
  assert.match(executor, /allowEntityExpansion === true \|\| !authoredActors\?\.\[polity\]/);
  assert.match(executor, /allowEntityExpansionByPolity\?\.\[polityKey\] === true/);
  assert.match(executor, /applyPoliticalGenerationToWorld\(stagedWorld, result\.generation, scenarioDate, \{[\s\S]{0,180}allowEntityExpansionByPolity/);
  assert.match(executor, /generatePoliticalGoverningAlignmentRepair/);
  assert.doesNotMatch(executor, /missingCoalitionEntities/);
});

test("v2 temporal sentinel forwards challenged semantic paths into the existing exact-date adjudicator", () => {
  const executor = fs.readFileSync(new URL("./executor.js", import.meta.url), "utf8");
  assert.match(executor, /challengedFacts/);
  assert.match(executor, /CHALLENGED GENERATED TEMPORAL PATHS/);
  assert.match(executor, /type: "historical-verification"/);
  assert.doesNotMatch(worklist, /semantic-verification/);
});

test("v2 exact-date verification rebases stale proposal material to current staged generated canon before honoring sticky challenges", () => {
  const executor = fs.readFileSync(new URL("./executor.js", import.meta.url), "utf8");
  assert.match(executor, /rebasePoliticalWorldVerificationEntry/);
  assert.match(executor, /historicalChallengeStillAppliesToEntry/);
  assert.match(executor, /staleCorrectionObligations/);
  assert.match(executor, /challenged generated fact changed in current staged canon/);
});

test("v2 reference bootstrap is mandatory canon input and completed checkpoints can rebase only Canon Context", () => {
  assert.match(pipeline, /reconcilePoliticalWorldV2ReferenceState/);
  assert.match(pipeline, /rebasePoliticalWorldV2ReferenceCanon/);
  assert.match(rebase, /canonContextRebased/);
  assert.match(pipeline, /expectedReferenceInstitutionIds/);
  assert.match(pipeline, /missingReferenceInstitutionIds/);
  assert.match(panel, /Always reload the saved scenario before v2 starts\/resumes/);
  assert.match(panel, /Saved (?:Canon Context|world context) does not match the editor's active reference knowledge/);
});

test("late actor repair invalidates stale downstream alignment/verification and exact-date corrections remain durable", () => {
  assert.match(runner, /invalidateDownstreamActorCoverage/);
  assert.match(runner, /\["governing-alignment", "historical-verification"\]/);
  assert.match(runner, /clearAttempts\(checkpoint, "temporal-sentinel", accepted\)/);
  assert.match(runner, /delete checkpoint\.verification\?\.challenges\?\.\[polity\]/);
  assert.match(runner, /storeHistoricalVerificationEntries/);
  assert.match(runner, /checkpoint\.generationEntriesByPolity\[polity\] = clone\(entry\)/);
});
