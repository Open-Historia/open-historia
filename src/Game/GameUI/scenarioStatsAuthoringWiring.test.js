/*! Contract checks against the actual scenario-authoring UI integration. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./ScenarioStatsAuthoringPanel.jsx", import.meta.url),"utf8");
const library = readFileSync(new URL("./libraryBar.jsx", import.meta.url),"utf8");

test("Statistics starts with starting-country authoring while retaining the advanced custom-sheet editor",()=>{
  assert.match(library, /<ScenarioStatsAuthoringPanel/);
  assert.match(library, /advancedEditor=\{<StatsSheetEditor/);
  assert.match(library, /<StatsSheetEditor value={statsValue}/);
  assert.match(library, /statsDefinitionDirty={formDiffers\(editorStats, editorStatsSavedRef.current\)}/);
  assert.match(library, /Unsaved edits and unapplied AI proposals will be lost/);
});

test("generation reads scenario geography and applies reviewed baselines to scenario, never running game",()=>{
  assert.match(panel,/downloadScenarioJsonAsset\(scenarioId, "regionsGeojson"\)/);
  assert.match(panel,/buildTargetStatsTerritorialBasisKernel/);
  assert.match(panel,/createReviewedScenarioStatsSheet/);
  assert.match(panel,/saveScenario\(scenarioId, \{ world: nextWorld \}\)/);
  assert.doesNotMatch(panel,/saveGame\(/);
  assert.match(panel,/loadScenarioDetails\(scenarioId\)/);
  assert.match(panel,/countryStats\?\.\[code\]\) !== prior/);
  assert.match(panel,/statsDefinitionUnavailable/);
});

test("AI proposals remain pending explicit author review and bounded batch budgets",()=>{
  assert.match(panel,/from "\.\/scenarioStatsGenerationBudget\.js"/);
  assert.match(panel,/const \[callBudget, setCallBudget\] = useState\(DEFAULT_CALLS_PER_RUN\)/);
  assert.match(panel,/validScenarioStatsCallBudget\(callBudget\)/);
  assert.match(panel,/scenarioStatsGenerationQueue\(wanted, callBudget\)/);
  assert.match(panel,/scenarioStatsGenerationCandidates\(coverage, proposals, \{ selectedOnly, activeCode, onlyMissing, retryFailedOnly \}\)/);
  assert.match(panel,/onClick=\{\(\) => runGeneration\(\{ retryFailedOnly: true \}\)\}/);
  assert.match(panel,/Retry failed AI proposals \(paid\)/);
  assert.match(panel,/Object.values\(proposals\).some\(\(row\) => row.error && !row.sheet\)/);
  assert.match(panel,/scenarioStatsNeedsCostConfirmation\(queue\)/);
  assert.match(panel,/scenarioStatsPlannedCalls\(queue\)/);
  assert.match(panel,/window\.confirm\(/);
  assert.match(panel,/type="number" min="1" max=\{MAX_CALLS_PER_RUN\} step="1"/);
  assert.match(panel,/aria-label="AI requests this run"/);
  assert.match(panel,/disabled=\{busy \|\| authoringBlocked \|\| !callBudgetValid/);
  assert.match(panel,/Choose 1–\{MAX_CALLS_PER_RUN\} AI requests per click/);
  assert.doesNotMatch(panel,/wanted\.slice\(0, MAX_BATCH_COUNTRIES \* MAX_CALLS_PER_RUN\)/);
  assert.match(panel,/Apply selected reviewed baselines/);
  assert.match(panel,/window.confirm\(`Save/);
  assert.match(panel,/No automatic application/);
});

test("live AI generation reports progress next to the buttons and parses bounded identities",()=>{
  assert.match(panel,/interpretScenarioStatsAiResponse\(response, prepared,/);
  assert.match(panel,/setProgress\("Preparing starting Statistics…"\)/);
  assert.match(panel,/role="status" aria-live="polite" aria-busy={busy}/);
  const nearButtons = panel.indexOf('role="status" aria-live="polite"');
  const form = panel.indexOf('Edit one country\'s starting values');
  assert.ok(nearButtons > 0 && form > nearButtons);
  assert.doesNotMatch(panel,/matches\.length !== 1/);
});

// The authoring path is separate from in-game countryStatSheet generation.
// Comparability is checked across pending drafts and already-approved sheets,
// as optional author context; it never changes canonical totals or vetoes Save.
test("scenario-wide economic comparability is integrated into review rather than gameplay", () => {
  assert.match(panel, /auditScenarioEconomicComparability/);
  assert.match(panel, /planned\[code\] = proposal\.sheet/);
  assert.match(panel, /economicOverview\.comparisons/);
  assert.doesNotMatch(panel, /chosenCodes\.has\(warning\.lowerCode\)/);
  assert.match(panel, /window\.confirm\(`Save/);
  assert.match(panel, /SCENARIO_GDP_ACCOUNTING_UNIT/);
  assert.match(panel, /serializeScenarioEconomicComparabilityCsv/);
  assert.doesNotMatch(panel, /countryStats\s*=\s*economicComparability/);
});

// Regression: a modified dashboard definition plus paid, valid AI proposals
// previously deadlocked: scenario Save rejected proposals while Apply rejected
// the unsaved definition. The independent asset-only save keeps drafts intact.
test("pending AI proposals can coexist with a definition-only Save, with no implicit approval", () => {
  assert.match(panel, /Save Statistics sheet definition \(keep proposals\)/);
  assert.match(panel, /await onSaveStatsDefinition\(\)/);
  assert.match(library, /const handleSaveStatsDefinitionOnly = async \(\) =>/);
  assert.match(library, /const persistScenarioStatsDefinition = async/);
  assert.match(library, /onSaveStatsDefinition=\{handleSaveStatsDefinitionOnly\}/);
  assert.match(library, /setEditorDetails\(saved\)/);
  assert.doesNotMatch(library.slice(library.indexOf("const handleSaveStatsDefinitionOnly"), library.indexOf("const handleSave = async")), /countryStats:\s*\{/);
  assert.match(panel, /await applyToScenario\(patches, guards\)/);
});

test("comparison flags stay review-only and proposals cannot bypass changed metric definitions", () => {
  assert.match(panel, /Disparity alone is not an error/);
  assert.match(panel, /generatedDate: scenarioDate, authoringContract: proposalContract/);
  assert.match(panel, /const staleProposal = \(row\) =>/);
  assert.match(panel, /row\.sheet\?\.continuity\?\.assessedDate !== scenarioDate/);
  assert.match(panel, /selectedRows\.find\(staleProposal\)/);
  assert.match(panel, /scenarioStatsRequiredReady\(row\.sheet, customKeys, customDefinition\)/);
  assert.match(panel, /if \(customDefinition\) assertNoLegacyNativeStatCopies\(customDefinition, row\.sheet\)/);
});


test("reviewed scenario baselines cannot bypass the canonical Political World leadership owner", () => {
  assert.match(panel, /legacyPoliticalStatsProjectionWriteError/);
  assert.match(panel, /for \(const \[code, sheet\] of Object\.entries\(patches\)\)/);
  const guardAt = panel.indexOf("legacyPoliticalStatsProjectionWriteError(freshWorld, code, sheet)");
  const saveAt = panel.indexOf("const saved = await saveScenario(scenarioId, { world: nextWorld });");
  assert.ok(guardAt > 0 && saveAt > guardAt, "the Political World check must reject before scenario persistence");
});

test('country baseline approval reads actual current Statistics asset content before the scenario write',()=>{
  assert.match(panel,/downloadScenarioJsonAsset\(scenarioId, "stats", \{ fresh: true \}\)/);
  assert.match(panel,/assertScenarioStatsDefinitionContentsCurrent\(statsValue, currentDefinition\)/);
  const contentCheck=panel.indexOf('assertScenarioStatsDefinitionContentsCurrent(statsValue, currentDefinition)');
  const save=panel.indexOf('await saveScenario(scenarioId, { world: nextWorld })');
  assert.ok(contentCheck > 0 && contentCheck < save,'a same-presence Stats asset replacement must block Save');
  const librarySource=readFileSync(new URL('../../runtime/library.js',import.meta.url),'utf8');
  assert.match(librarySource,/downloadScenarioJsonAsset = async \(scenarioId, assetKey, \{ coarse = false, fresh = false \} = \{\}\)/);
  assert.match(librarySource,/cache: fresh \? "no-store" : "default"/);
});

test("provider failures become failed review rows and do not abort later paid batches", () => {
  const generation=panel.slice(panel.indexOf("const runGeneration = async"),panel.indexOf("const applyReviewed = async"));
  assert.match(generation,/try\s*\{\s*response\s*=\s*await callAI\(/,
    "each paid request must have its own catch boundary");
  assert.match(generation,/catch\s*\(problem\)\s*\{[\s\S]*?scenarioStatsFailedCallProposals\(prepared, world\.countryStats, reason\)/,
    "provider exceptions must be made retryable per country");
  assert.match(generation,/setProposals\(\{\s*\.\.\.all\s*\}\);\s*continue;/,
    "after recording failed rows the next bounded paid batch must still run");
  assert.match(generation,/calls \+= 1;\s*try\s*\{/,
    "attempted calls count even if the provider rejects the request");
});

test("custom-sheet editor exposes existing native growth, inflation and unemployment for manual review", () => {
  assert.match(panel, /displayRows\s*=\s*\(customKeys[\s\S]*?"gdpGrowth"[\s\S]*?"inflation"[\s\S]*?"unemployment"/);
});

test("creator GDP presentation regression: optional grouped scale context is not a save veto", () => {
  assert.match(panel, /summarizeScenarioEconomicComparability\(economicComparability\)/);
  assert.match(panel, /<details[\s\S]*?<summary[^>]*>GDP scale context \(optional\)<\/summary>/);
  assert.match(panel, /Disparity alone is not an error/);
  assert.match(panel, /economicOverview\.countries\.slice\(0, 10\)/);
  assert.match(panel, /serializeScenarioEconomicComparabilityCsv\(economicComparability\)/, "full data remains exportable");
  assert.doesNotMatch(panel, /window\.confirm\("Economic comparability review:/,
    "wide differences must not block author-reviewed valid inputs");
  assert.match(panel, /await applyToScenario\(\{ \[activeCode\]: next \}/);
  assert.match(panel, /await applyToScenario\(patches, guards\)/);
});

test('orphan demographic trend UI is explicitly optional and documents annual canonical units', () => {
  assert.match(panel, /Natural population change \(optional\)/);
  assert.match(panel, /Both base rates are required together/);
  assert.match(panel, /Negative annual trends reduce the rate; births and deaths themselves cannot be negative/);
  assert.match(panel, /Leave all four fields blank to keep the demographic process unset/);
});
