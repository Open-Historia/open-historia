/*! Native-bound scenario authoring and player presentation contract wiring. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nationalStatsAuthoringContract, nationalStatsPresentationCoverage, resolveNationalStatReading } from "../../runtime/statsMetricBindings.js";
import { normalizeStatSheetDefinition } from "../../runtime/statIndexDefinitions.js";

const editor = readFileSync(new URL("./StatsSheetEditor.jsx", import.meta.url), "utf8");
const author = readFileSync(new URL("./ScenarioStatsAuthoringPanel.jsx", import.meta.url), "utf8");
const player = readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
const layout = (rows) => normalizeStatSheetDefinition({ custom: true, sections: [{ key: "economy", label: "Economy", stats: rows }] });
const row = (key, kind, nativeMetric) => ({ key, label: key, kind, ...(nativeMetric ? { nativeMetric } : {}) });

test("Scenario Editor exposes allowlisted read-only native metrics without changing existing card types", () => {
  assert.match(editor, /NATIONAL_NATIVE_METRICS/);
  assert.match(editor, /aria-label="Value source"/);
  assert.match(editor, /nativeMetric: metric, kind: native.kind/);
  assert.match(editor, /candidate.maximum = native.maximum/);
  assert.match(editor, /disabled=\{Boolean\(stat.nativeMetric\)\}/);
  assert.match(editor, /disabled=\{Boolean\(stat.nativeMetric\)\}/);
  assert.match(editor, /Independent custom value/);
});

test("country authoring separates native display from independently writable customStats and uses one definition", () => {
  assert.match(author, /nationalStatsAuthoringContract\(statsValue\)/);
  assert.match(author, /contract\.customKeys/);
  assert.match(author, /scenarioStatsCoverage\(world, countryOptions, \{ customKeys, customDefinition \}\)/);
  assert.match(author, /makePrompt\(\{ batch: prepared, scenarioDate, details, customKeys \}\)/);
  assert.match(author, /createReviewedScenarioStatsSheet\(\{ row: answer\.row, basis: item\.basis, date: scenarioDate, customKeys, customDefinition, existing: original \}\)/);
  assert.match(author, /applyScenarioStatsManualEdits\(\{ sheet: base, edits: fields, date: scenarioDate, customKeys, customDefinition \}\)/);
  assert.match(author, /scenarioStatsRequiredReady\(sheet, customKeys, customDefinition\)/);
  assert.match(author, /assertNoLegacyNativeStatCopies/);
  assert.match(author, /fresh\.assetStatus\?\.stats/);
  assert.match(author, /rejected \+= 1;\s*continue;/);
});

test("player panel reads native cards via one resolver and does not turn missing into zero", () => {
  assert.match(player, /resolveNationalStatReading\(stat, sheet\)/);
  assert.match(player, /nationalStatsPresentationCoverage\(definition, sheet\)\.ready/);
  assert.match(player, /nationalStatsPresentationCoverage\(statSheetDefinition, generated\)\.ready/);
  assert.match(player, /const valid = reading\?\.status === "ready"/);
  assert.match(player, /const numeric = valid \? reading.value : null/);
  assert.doesNotMatch(player, /const numeric = Number\(value\);/);
  assert.match(player, /isCompleteCustomCountryStatSheet\(sheet, statSheetKeys\(definition\)\)/); // preserve legacy semantics
});

test("one national GDP can have two cards; uninitialized rate and prior copy require review", () => {
  const definition=layout([row("heroGDP", "currency", "gdp"),row("detailGDP", "currency", "gdp"),row("grain", "number")]);
  assert.deepEqual(nationalStatsAuthoringContract(definition).customKeys,["grain"]);
  const sheet={ economy:{gdp:300000000000},customStats:{grain:0}};
  assert.equal(nationalStatsPresentationCoverage(definition,sheet).ready,true);
  assert.equal(resolveNationalStatReading(definition.sections[0].stats[0],sheet).value,300000000000);
  assert.equal(resolveNationalStatReading(definition.sections[0].stats[1],sheet).value,300000000000);
  assert.equal(nationalStatsPresentationCoverage(definition,{...sheet,customStats:{...sheet.customStats,gdp:299000000000}}).ready,false);
  assert.equal(resolveNationalStatReading(row("rate","percentage","inflation"),sheet).status,"unavailable");
});

// C2A was installed after the captured source export; the new UI layer must
// preserve its saved/proposal conflict warnings rather than overwrite them.
test("binding-aware authoring retains C2A legacy conflict notices", () => {
  assert.match(author, /reviewScenarioNationalMetricAliases\(statsValue, currentSheet\)/);
  assert.match(author, /aliasReviewRows\.map\(/);
  assert.match(author, /reviewScenarioNationalMetricAliases\(statsValue, row\.sheet\)\.some\(/);
  assert.match(author, /item\.nativePath/);
  assert.match(author, /item\.customPath/);
  assert.match(author, /assertNoLegacyNativeStatCopies\(customDefinition, currentSheet\)/);
});

test("definition-only Save rejects a concurrent same-presence Stats asset replacement before uploading",()=>{
  const library=readFileSync(new URL("./libraryBar.jsx",import.meta.url),"utf8");
  const guard=library.slice(library.indexOf("const assertCurrentStatsBeforeScenarioSave = async"),
    library.indexOf("const handleSaveStatsDefinitionOnly = async"));
  assert.match(guard,/downloadScenarioJsonAsset\(scenarioId, "stats", \{ fresh: true \}\)/);
  assert.match(guard,/assertScenarioStatsDefinitionContentsCurrent\(editorStatsSavedRef\.current, currentDefinition\)/);
  const begin=library.indexOf("const handleSaveStatsDefinitionOnly = async () =>");
  const end=library.indexOf("const handleSave = async () =>",begin);
  const action=library.slice(begin,end);
  assert.match(action,/await assertCurrentStatsBeforeScenarioSave\(scenarioId, fresh\)/);
  assert.ok(action.indexOf("await assertCurrentStatsBeforeScenarioSave") < action.indexOf("persistScenarioStatsDefinition"),
    "unchanged library status flags cannot justify replacing another author's definition");
});

test("general Scenario Save also checks the current Stats asset before rewriting the scenario world",()=>{
  const library=readFileSync(new URL("./libraryBar.jsx",import.meta.url),"utf8");
  const begin=library.indexOf("const handleSave = async () =>");
  const end=library.indexOf("const handleDelete = async () =>",begin);
  const action=library.slice(begin,end);
  const check=action.indexOf('await assertCurrentStatsBeforeScenarioSave(editorDetails.scenario.id, fresh)');
  const save=action.indexOf('await saveScenario(editorDetails.scenario.id, {');
  assert.match(action,/if \(!editorStatsFailed\)/);
  assert.ok(check > 0 && check < save,
    'main Scenario Save must not rewrite stale Stats or world data before checking the current definition');
});
