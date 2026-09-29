import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const prompts = fs.readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");
const channels = fs.readFileSync(new URL("../../runtime/institutionalChannels.js", import.meta.url), "utf8");

test("world-change validation enforces Political World structural completeness through transient claims", () => {
  assert.match(gameplay, /preparePoliticalClaimContext\(candidate\)/);
  assert.match(gameplay, /validatePoliticalImpactCompleteness\(candidate,\s*\{\s*world,\s*claimContext:\s*politicalClaimContext\s*\}\)/);
  assert.match(gameplay, /validatePolityImpactCompleteness\(candidate\)/);
  assert.match(gameplay, /Always return politicalClaims: transient validation/);
});

test("jump political claims bind before event sorting and are removed before persistence", () => {
  assert.match(
    gameplay,
    /preparePoliticalClaimContext\(candidate\)[\s\S]{0,1200}sortTimelineEventsChronologically\(candidate\)/,
  );
  assert.match(
    gameplay,
    /validateGeneratedWorldChanges\(candidate,[\s\S]{0,800}politicalClaimContext,[\s\S]{0,500}clearPoliticalClaimBindings\(candidate\);[\s\S]{0,120}delete candidate\.politicalClaims/,
  );
});

test("lifecycle invitation hearings are gated away from formal Council governance", () => {
  assert.match(gameplay, /const lifecycleGovernanceThread = Boolean/);
  assert.match(gameplay, /stored\.institutionId && !lifecycleGovernanceThread/);
  assert.match(gameplay, /formalBusinessRequested && stored\.institutionId && !lifecycleGovernanceThread/);
});

test("GM exhaustive territory uses territorialScopes and native base-geography expansion", () => {
  assert.match(gameplay, /expandGameMasterTerritorialScopes/);
  assert.match(gameplay, /requestDemandsExhaustiveTerritorialScope\(request\)/);
  assert.match(gameplay, /resolveGameMasterBaseGeographyScope\(scope\.baseCountries, catalog\)/);
  assert.match(prompts, /EXHAUSTIVE TERRITORY IS A SET CONTRACT/);
  assert.match(prompts, /ONLY WHEN TERRITORY ACTUALLY CHANGES/);
  assert.match(prompts, /keeps all of its territory/);
  assert.match(prompts, /territorialScopesJson/);
  assert.match(prompts, /Rendered base-geography catalog/);
});

test("pregame Gemini transport is decoded before native validation", () => {
  assert.match(gameplay, /taskKey === "pregameHistory"[\s\S]*decodePregameHistoryTransportPayload/);
});


test("permanent institution channel materialization keys by thread identity, not loose institutionId", () => {
  assert.match(channels, /chatThreadIdentityKey\(chat, world\) === institutionThreadKey/);
  assert.doesNotMatch(channels, /existingByInstitution = chats\.find\(\(chat\) => lower\(chat\?\.institutionId\)/);
});

test("generated and GM politicalActorOps decode argsJson and validate native operation shape before acceptance", () => {
  assert.match(gameplay, /validatePoliticalActorOperationShape\(operation,\s*\{\s*allowNativeDerived:\s*false\s*\}\)/);
  assert.match(gameplay, /politicalActorOps\[\$\{index\}\].*was refused/s);
});


test("GM and ordinary turn prompts share the native politicalActorOps argsJson guidance", () => {
  assert.match(prompts, /POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE/);
  assert.match(prompts, /Never guess the decoded argsJson shape/);
  assert.match(gameplay, /POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE/);
  assert.match(gameplay, /Never guess the decoded argsJson shape/);
});

test("structural scripted political beats block prose-only deterministic fallback", () => {
  assert.match(gameplay, /scriptedPoliticalImpactRequirements\(scriptedBeats/);
  assert.match(gameplay, /buildScriptedPoliticalImpactInstruction\(scriptedPoliticalRequirements,\s*\{\s*world:\s*ledgerWorld\s*\}\)/);
  assert.match(gameplay, /state\.structuralScriptedFallbackBlocked = scriptedPoliticalRequirements\.length > 0/);
  assert.match(gameplay, /if \(state\.structuralScriptedFallbackBlocked\) throw error/);
  assert.match(gameplay, /politicalClaimContext\.legacyEvents\.add\(event\)/);
});
