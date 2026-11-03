import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelSource = readFileSync(new URL("./ScenarioStatsAuthoringPanel.jsx", import.meta.url), "utf8");

test("legacy review is human-authorized, one native metric at a time, and cannot silently bulk archive mismatches", () => {
  assert.match(panelSource, /reviewScenarioNationalMetricAliases\(statsValue, currentSheet\)/);
  assert.match(panelSource, /aliasReviewRows\.map\(/);
  assert.match(panelSource, /item\.nativePath/);
  assert.match(panelSource, /item\.customPath/);
  assert.match(panelSource, /Canonical conflict/);
  assert.match(panelSource, /planBoundNationalStatsAliasArchival\(\{ definition: statsValue, world, roster: coverage \}\)/);
  assert.match(panelSource, /Archive all only when every duplicate matches/);
  assert.match(panelSource, /aliasArchival\.entries\.some\(\(row\) => !row\.equal\)/);
  assert.match(panelSource, /planBoundNationalStatsAliasReconciliation\(\{/);
  assert.match(panelSource, /await applyToScenario\(plan\.patches, plan\.originals\)/);
  assert.match(panelSource, /Review and save selected metric reconciliation/);
  assert.match(panelSource, /Reconcile legacy copies - explicitly choose one source per metric/);
  assert.match(panelSource, /reconciliationPreview\.error/);
  assert.match(panelSource, /await applyToScenario\(patches, guards\)/);
  assert.match(panelSource, /await applyToScenario\(planned\.patches, planned\.originals\)/);
  assert.match(panelSource, /const conflicting = planned\.entries\.filter\(\(row\) => !row\.equal\)\.length/);
  assert.match(panelSource, /if \(!window\.confirm\(/);
  assert.match(panelSource, /aliasArchival\.error/);
  assert.match(panelSource, /busy \|\| authoringBlocked \|\| dirty \|\| Object\.keys\(proposals\)\.length > 0/);
  assert.match(panelSource, /Save or discard unfinished manual edits and AI proposals before archiving/);
  assert.match(panelSource, /stageExplicitNativeStatsBinding\(statsValue, \{ key: card\.key, nativeMetric \}\)/);
  assert.match(panelSource, /onStatsChange\(next\)/);
  assert.match(panelSource, /Choose canonical source/);
  assert.match(panelSource, /Stage binding for review/);
  assert.match(panelSource, /onSaveStatsDefinition/);
});

test("AI proposals disclose a potential mismatch before author applies them", () => {
  assert.match(panelSource, /reviewScenarioNationalMetricAliases\(statsValue, row\.sheet\)\.some\(/);
  assert.match(panelSource, /item\.status === "different"/);
  assert.match(panelSource, /Apply selected reviewed baselines/);
});
