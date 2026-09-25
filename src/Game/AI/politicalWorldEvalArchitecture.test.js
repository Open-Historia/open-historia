import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), "utf8");

const evalSource = read("./politicalWorldEval.js");
const gameplaySource = read("./gameplay.js");
const mainSource = read("./main.jsx");
const settingsSource = read("../GameUI/settings.jsx");
const labSource = read("../GameUI/PoliticalWorldABLab.jsx");

test("Advanced settings exposes a Political World A/B Lab with all agreed evaluation modes", () => {
  assert.match(settingsSource, /Political World A\/B Lab/);
  assert.match(settingsSource, /Open A\/B Lab/);
  for (const token of ["Leader diplomacy", "Group \/ Council response", "Institution vote", "Event generation \/ time skip"]) {
    assert.match(labSource, new RegExp(token));
  }
  assert.match(labSource, /Current Political World vs OFF/);
  assert.match(labSource, /HAWK \/ DOVE/);
  assert.match(labSource, /Evolved canonical goal/);
  assert.match(labSource, /Frozen capsules: autonomy-cost ablation/);
  assert.match(labSource, /Blind labels until reveal/);
  assert.match(labSource, /Save JSON report/);
  assert.match(labSource, /saveTextToDisk/);
  assert.doesNotMatch(labSource, /document\.createElement\("a"\)|URL\.createObjectURL/);
});

test("A/B transport pins one exact fallback entry and captures raw request evidence independent of telemetry", () => {
  assert.match(mainSource, /__forceEntryId: forceEntryId/);
  assert.match(mainSource, /__capture: capture/);
  assert.match(mainSource, /entries = \[pinned\]/);
  assert.match(mainSource, /capture\.rawResponse/);
  assert.match(evalSource, /__forceEntryId: forceEntryId/);
  assert.match(evalSource, /__capture: capture/);
});

test("group and institution evaluation can use a frozen bundle and canonical governance stays dry-run", () => {
  assert.match(gameplaySource, /evaluation\?\.bundleOverride/);
  assert.match(gameplaySource, /evaluation\?\.politicalContextMode === "omit"/);
  assert.match(gameplaySource, /evaluation\?\.dryRun\s*\? applyInstitutionalChatGovernanceBatch/);
  assert.match(gameplaySource, /if \(evaluation\?\.dryRun\) \{[\s\S]*applyInstitutionLifecycleChatBatchCore/);
  assert.match(evalSource, /dryRun: true/);
  assert.doesNotMatch(evalSource, /writeWorldState|writeChatsState|writeCanonicalTurnState|commitInstitutionalChatGovernanceBatch|commitInstitutionLifecycleChatBatch/);
});

test("event evaluation reuses jump generation but returns before live apply/persistence", () => {
  assert.match(gameplaySource, /simulateTimelineJump = async \(\{ days, mode = "jump", onEvents, onProgress, signal, evaluation = null \}/);
  assert.match(gameplaySource, /if \(evaluationMode\) \{[\s\S]*mergeSegmentPayloads[\s\S]*evaluation: true/);
  assert.match(gameplaySource, /if \(!evaluation\) await repairSkipStorylineMotion/);
  assert.match(gameplaySource, /if \(evaluation\) throw error/);
  assert.match(gameplaySource, /if \(!evaluationMode\) endSimulation\(\)/);
  assert.match(evalSource, /simulateTimelineJump\(\{/);
});

test("Political World OFF suppresses only explicit decision context while sensitivity overrides stay projection-only", () => {
  assert.match(evalSource, /politicalContextMode: variant === "off" \? "omit" : "normal"/);
  assert.match(evalSource, /politicalWorldOverride/);
  assert.match(evalSource, /derivePoliticalDispositionForActor/);
  assert.match(evalSource, /liveStateUnchanged/);
  assert.match(evalSource, /non-Political prompt parity/i);
});

test("A/B arms stay isolated from lifecycle commits and from each other", () => {
  assert.match(evalSource, /filter\(\(chat\) => !clean\(chat\?\.lifecycleInstitutionId\)\)/);
  assert.match(evalSource, /Lifecycle invitation\/accession negotiations are excluded from the read-only A\/B lab/);
  assert.match(evalSource, /const source = clone\(snapshot\.seen\)/);
  assert.match(evalSource, /const canonical = clone\(snapshot\.canonical\)/);
});

test("prompt evidence uses the accepted attempt and preserves raw history text for PW-only hashing", () => {
  assert.match(evalSource, /reverse\(\)\.find\(\(attempt\) => attempt\?\.ok\)/);
  assert.match(evalSource, /historyEvidenceText/);
  assert.match(evalSource, /segments\.map\(\(segment\) =>/);
  assert.match(evalSource, /nonPoliticalHash: politicalWorldEvalHash/);
});

test("sensitivity precedence is diagnostic-only and comparison mode remains the original ON/OFF experiment", () => {
  assert.match(evalSource, /politicalWorldEvalSharedDirective\(config\.experimentMode, actorName\)/);
  assert.match(gameplaySource, /normalizeString\(evaluation\?\.sharedDirective\)/);
  assert.doesNotMatch(mainSource, /POLITICAL WORLD SENSITIVITY EVALUATION/);
  assert.doesNotMatch(settingsSource, /POLITICAL WORLD SENSITIVITY EVALUATION/);
  assert.match(evalSource, /politicalContextMode: variant === "off" \? "omit" : "normal"/);
  assert.match(evalSource, /sharedDirective: politicalWorldEvalSharedDirective\(config\.experimentMode, actorName\)/);
});

test("sensitivity reports expose injected traits plus derived and rendered disposition without leaking blind labels", () => {
  assert.match(evalSource, /injectedTraits: clone\(traits\)/);
  assert.match(evalSource, /derivedDisposition: nextActor\.behavioralDisposition/);
  assert.match(evalSource, /renderedDisposition: renderedDispositionFromCapture\(capture\)/);
  assert.match(labSource, /Injected traits:/);
  assert.match(labSource, /Derived disposition:/);
  assert.match(labSource, /Rendered disposition:/);
  assert.match(labSource, /revealed && arm\.sensitivityEvidence/);
});


test("evolved-goal diagnostic keeps PW enabled in both arms, changes one goal only, and locks eight counterbalanced runs", () => {
  assert.match(evalSource, /isGoalExperimentMode\(config\.experimentMode\) && variant === "treatment"/);
  assert.match(evalSource, /politicalWorldEvalReplaceUniqueGoal/);
  assert.match(evalSource, /replacement goal did not survive into the rendered treatment capsule/i);
  assert.match(evalSource, /runsPerArm:\s*8/);
  assert.match(evalSource, /aggregate arm-level outcome frequencies/);
  assert.match(evalSource, /treatment >= 6\/8 qualifying outcomes AND control <= 1\/8 qualifying outcomes/);
  assert.match(evalSource, /control >= 6\/8 qualifying outcomes AND treatment <= 1\/8 qualifying outcomes/);
  assert.match(evalSource, /config\.testType !== "diplomacy"/);
  assert.match(labSource, /Seed goal to replace/);
  assert.match(labSource, /Evolved goal/);
  assert.match(labSource, /Blind-score every completed response before reveal/);
  assert.match(labSource, /Canon\/fabrication issue/);
  assert.match(labSource, /Score all responses first/);
  assert.match(labSource, /Aggregate evolved-goal score/);
  assert.match(labSource, /!isGoalExperimentMode\(report\.config\?\.experimentMode\)/);
});

test("frozen-capsule autonomy-cost ablation changes the proposal while replaying source-selected PDC bytes", () => {
  assert.match(evalSource, /experimentMode === "frozenGoalAblation"/);
  assert.match(evalSource, /playerMessage: config\.frozenSelectionPrompt/);
  assert.match(evalSource, /politicalWorldEvalReplaceContextBlock/);
  assert.match(evalSource, /frozenCapsuleReplayedByteForByte/);
  assert.match(evalSource, /naturalTestPoliticalContextText/);
  assert.match(evalSource, /threshold: "none predeclared for this follow-up diagnostic"/);
  assert.match(labSource, /Frozen capsule source message/);
  assert.match(labSource, /Ablation test message/);
  assert.match(labSource, /no new strong-signal threshold predeclared/i);
  assert.doesNotMatch(mainSource, /frozenGoalAblation/);
});

test("A/B report snapshot identity comes from the live library catalog when available", () => {
  assert.match(evalSource, /getLibraryState/);
  assert.match(evalSource, /politicalWorldEvalSnapshotMetadata\(canonical\.game, getLibraryState\(\)\)/);
  assert.match(labSource, /snapshot\.metadata\.gameName/);
  assert.match(labSource, /snapshot\.metadata\.scenarioName/);
});
