/*! Real disposable desktop library persistence check for reviewed Statistics aliases. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

// libraryStore resolves OH_DATA_DIR at import time. Test in an isolated process
// with a fresh temporary root; never open or mutate a developer's live saves.
const scenarioCase = String.raw`
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const imported = (relative) => import(pathToFileURL(path.join(process.cwd(), relative)).href);
const {createScenario,getScenarioDetails,updateScenario} = await imported("server/libraryStore.js");
const {planBoundNationalStatsAliasArchival} = await imported("src/runtime/statsBoundAliasArchival.js");
const {summarizeScenarioNationalMetricAliasReviews,serializeScenarioNationalMetricReviewCsv} =
  await imported("src/runtime/statsMetricAliasReview.js");
const {assertNoLegacyNativeStatCopies} = await imported("src/runtime/statsMetricBindings.js");
const {normalizeCountryStatSheet} = await imported("src/runtime/countryStats.js");
const definition={custom:true,sections:[{key:"economy",label:"Economy",stats:[
  {key:"gdp",kind:"currency",label:"GDP",nativeMetric:"gdp"},
  {key:"inflation",kind:"percentage",label:"Inflation",nativeMetric:"inflation"},
  {key:"publicDebt",kind:"percentage",label:"Debt",nativeMetric:"publicDebt"},
  {key:"harvest",kind:"number",label:"Harvest"},
]}]};
const original={economy:{gdp:400000000000,inflation:2,publicDebt:40,budgetBalance:-1},
  population:{total:1000000},stability:70,
  customStats:{gdp:360000000000,inflation:0,publicDebt:40,harvest:22}};
const created=createScenario({id:"qa-stats-alias-disposable",name:"Statistics QA disposable"});
const id=created.scenario.id;
updateScenario(id,{world:{...created.data.world,countryStats:{
  ...(created.data.world.countryStats||{}),QA_ARCHIVE_TEST:original}}});
const before=getScenarioDetails(id);
assert.deepEqual(before.data.world.countryStats.QA_ARCHIVE_TEST,original);
const roster=[{code:"QA_ARCHIVE_TEST"}];
const report=summarizeScenarioNationalMetricAliasReviews(definition,before.data.world,roster);
assert.deepEqual([report.rows.length,report.conflicting,report.matching],[3,2,1]);
const csv=serializeScenarioNationalMetricReviewCsv(report);
assert.match(csv,/QA_ARCHIVE_TEST/);
assert.match(csv,/"0"/);
const proposed=planBoundNationalStatsAliasArchival({definition,world:before.data.world,roster});
assert.equal(proposed.entries.length,3);
const expected=proposed.patches.QA_ARCHIVE_TEST;
assertNoLegacyNativeStatCopies(definition,expected);
updateScenario(id,{world:{...before.data.world,countryStats:{
  ...before.data.world.countryStats,QA_ARCHIVE_TEST:expected}}});
const after=getScenarioDetails(id).data.world.countryStats.QA_ARCHIVE_TEST;
assert.deepEqual(after,expected,"real scenario store save and reload must be lossless");
assert.equal(after.customStats.archivedInflation,0);
assert.equal(after.customStats.harvest,22);
assert.equal(after.economy.inflation,2);
assert.deepEqual(normalizeCountryStatSheet(after).customStats,expected.customStats);
assert.deepEqual(planBoundNationalStatsAliasArchival({
  definition,world:{countryStats:{QA_ARCHIVE_TEST:after}},roster,
}).entries,[],"after reload no alias is migrated twice");
`;

test("desktop scenario Store preserves explicit native binding archive, audit CSV, zero and idempotence", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "oh-qa-stats-alias-"));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", scenarioCase], {
      cwd: root,
      env: { ...process.env, OH_DATA_DIR: temp },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0,
      `Disposable server-backed scenario persistence failed:\n${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
