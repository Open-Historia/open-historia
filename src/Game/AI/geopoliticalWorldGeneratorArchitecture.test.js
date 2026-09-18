import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const generator = fs.readFileSync(new URL("./geopoliticalWorldGenerator.js", import.meta.url), "utf8");
const coverage = fs.readFileSync(new URL("./geopoliticalMembershipCoverage.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../GameUI/PoliticalWorldGenerationPanel.jsx", import.meta.url), "utf8");
const pipeline = fs.readFileSync(new URL("./politicalWorldPipelineCore.js", import.meta.url), "utf8");
const institutionRuntime = fs.readFileSync(new URL("../../runtime/institutions.js", import.meta.url), "utf8");

test("singleton power recovery uses direct structured tool fields instead of nested JSON-array transport", () => {
  assert.match(generator, /submit_geopolitical_power_record/);
  assert.match(generator, /GEOPOLITICAL_POWER_SINGLETON_TOOL/);
  assert.match(generator, /singleton \? GEOPOLITICAL_POWER_SINGLETON_TOOL : GEOPOLITICAL_POWER_CALIBRATION_TOOL/);
  assert.match(generator, /Do not serialize them into powerJson and do not wrap them in an array/);
  assert.match(generator, /const directSingleton = singleton/);
});

test("geopolitical baseline is institution-centric and native owns final power tiers", () => {
  assert.match(generator, /GEOPOLITICAL_WORLD_BATCH_SIZE = 24/);
  assert.match(generator, /submit_geopolitical_institution_catalog/);
  assert.match(generator, /submit_geopolitical_power_calibration/);
  assert.match(generator, /submit_geopolitical_memberships/);
  assert.match(generator, /submit_geopolitical_institution_members/);
  assert.match(generator, /submit_geopolitical_agreements/);
  assert.match(generator, /institution-catalog-completeness/);
  assert.match(generator, /COMPLETENESS PASS/);
  assert.match(generator, /Native code owns and computes the final/);
  assert.match(generator, /POWER_MAJOR_SCORE_MIN/);
  assert.match(generator, /POWER_REGIONAL_SCORE_MIN/);
  assert.match(generator, /Reserve \$\{POWER_MAJOR_SCORE_MIN\}\+ for actors with genuinely major/);
  assert.match(generator, /ordinary regional importance, alliance membership, diplomatic activism/);
  assert.match(generator, /seedPowerBaselineScore/);
  assert.match(generator, /acceptedAnchors/);
  assert.match(generator, /baselineScore/);
  assert.match(generator, /isFinitePowerScore\(record\?\.baselineScore\)/);
  assert.match(generator, /allPolityKeys\.includes\(entry\.polityKey\)/, "only current active actors may anchor the relative power scale");
  assert.match(generator, /refreshPowerStatus\(world, \{ date, round: 0, immediate: true \}\)/);
  assert.doesNotMatch(generator, /"powerTier":"major-power\|regional-power\|minor-power"/);
  assert.doesNotMatch(generator, /historicalVerification|temporalSentinel|recheckHistory/i);
});

test("202-polity clean path uses smaller normal membership batches and never mega-retries unresolved coverage", () => {
  assert.match(generator, /resolveGeopoliticalMembershipCoverage/);
  assert.match(generator, /batchSize: GEOPOLITICAL_WORLD_BATCH_SIZE/);
  assert.match(coverage, /phase: "memberships-rescue"/);
  assert.match(coverage, /GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE = 16/);
  assert.match(coverage, /phase: "memberships-recovery-split"/);
  assert.match(coverage, /GEOPOLITICAL_MEMBERSHIP_TINY_RETRY_MAX = 2/);
  assert.doesNotMatch(generator, /for \(let attempt = 1; attempt <= 2 && unresolved\.length; attempt \+= 1\)/);
  assert.match(generator, /COVERAGE RECOVERY/);
  assert.match(pipeline, /stage: "geopolitics"/);
  assert.match(panel, /Rescuing unresolved institutional memberships/);
});

test("all geopolitical model surfaces receive the same reference-authority contract, including the legacy one-shot agreement pass", () => {
  assert.match(generator, /buildCatalogPrompt\(\{ scenarioDate, historyAuthority,/);
  assert.match(generator, /buildPowerPrompt\(\{ scenarioDate, historyAuthority,/);
  assert.match(generator, /buildMembershipPrompt\(\{ scenarioDate, historyAuthority,/);
  assert.match(generator, /buildInstitutionMembersPrompt\(\{ scenarioDate, historyAuthority,/);
  assert.match(generator, /buildAgreementsPrompt\(\{ scenarioDate, historyAuthority, scenarioContext, allPolityKeys, catalog: institutionCatalog \}\)/);
});

test("geopolitical baseline is exact-date universal and closes membership identity after catalog phase", () => {
  assert.match(generator, /Never project a current institution name backward/);
  assert.match(generator, /institution catalog below is CLOSED/);
  assert.match(generator, /Every active polity omitted from membersJson is interpreted as a NON-MEMBER/);
  assert.match(generator, /cannot create, rename, split, regionalize or duplicate institutions/);
  assert.match(generator, /SUCCESSOR \/ PREDECESSOR RULE/);
  assert.match(generator, /predecessors\[\]/);
  assert.match(generator, /membershipContinuity/);
  assert.match(generator, /rejected membership-shaped institution identity/);
  assert.match(generator, /leave joinedDate blank rather than inventing the scenario start date/);
  assert.match(generator, /do NOT reclassify it/);
  assert.match(generator, /canonicalPoliticalActorRegimeCharacter/);
  assert.match(generator, /politicalSystem\?\.regimeCharacter/);
  assert.match(generator, /blockingErrors/);
});

test("Scenario Editor keeps one normal Generate/Apply Political World workflow while preserving advanced diagnostics", () => {
  assert.match(panel, />Generate Political World</);
  assert.match(panel, /"Apply Political World"/);
  assert.match(panel, /Advanced \/ repair tools/);
  assert.match(panel, /Generate Missing Politics/);
  assert.match(panel, /Repair Governing Alignment/);
  assert.match(panel, /Generate Geopolitical Baseline/);
  assert.match(panel, /Apply Political World is blocked/);
  assert.match(panel, /Download Combined Diagnostic/);
  assert.match(pipeline, /persisted yet\. This is the key seam/);
  assert.match(generator, /kind: "geopolitical-baseline-diagnostic"/);
  assert.match(generator, /finalNativePowerTiers/);
  assert.match(generator, /unresolvedPolities/);
  assert.match(generator, /temporalCanonicalizationDrops/);
  assert.match(generator, /applyBlockReason/);
});


test("institution runtime and geopolitical generator are universe-agnostic instead of containing named real-world organization rules", () => {
  const forbidden = [
    "North Atlantic Treaty",
    "NATO",
    "European Union",
    "CSTO",
    "African Union",
    "Organization of African Unity",
    "OSCE",
    "CSCE",
    "Warsaw Pact",
    "League of Nations",
    "Comecon",
    "ASEAN",
    "United Nations",
  ];
  for (const token of forbidden) {
    assert.equal(institutionRuntime.includes(token), false, `runtime must not hard-code ${token}`);
    assert.equal(generator.includes(token), false, `generator must not hard-code ${token}`);
  }
  assert.match(institutionRuntime, /normalizeInstitutionPredecessors/);
  assert.match(institutionRuntime, /membershipContinuityWindows/);
  assert.doesNotMatch(institutionRuntime, /KNOWN_INSTITUTION_DEFINITIONS|knownInstitutionDefinition|membershipContinuityDate/);
  assert.match(generator, /institutionReferenceCatalog/);
  assert.match(generator, /Do not assume modern Earth/);
  assert.match(generator, /alternate, fictional, future/);
});
