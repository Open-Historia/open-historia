import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getGameplayTool, withRequiredCountryStatsCalibration } from "./gameplaySchemas.js";

test("native tool contract requires exactly the calibration evidence this Stats request needs", () => {
  const base = getGameplayTool("countryStatSheet");
  assert.ok(base?.schema?.properties?.populationCalibration);
  assert.ok(base?.schema?.properties?.economicCalibration);
  const original = [...base.schema.required];
  const unchanged = withRequiredCountryStatsCalibration(base);
  assert.equal(unchanged, base);
  const economic = withRequiredCountryStatsCalibration(base, { economic: true });
  assert.equal(economic.schema.required.includes("economicCalibration"), true);
  assert.equal(economic.schema.required.includes("populationCalibration"), original.includes("populationCalibration"));
  const both = withRequiredCountryStatsCalibration(base, { population: true, economic: true });
  assert.equal(both.schema.required.includes("populationCalibration"), true);
  assert.equal(both.schema.required.includes("economicCalibration"), true);
  assert.equal(both.schema.additionalProperties, false);
  assert.deepEqual(base.schema.required, original, "never mutate the global static schema");
  assert.equal(withRequiredCountryStatsCalibration(null, { economic: true }), null);
});

test("the Stats runtime selects a per-call tool contract for both synchronous and batched requests", () => {
  const engine = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(engine, /withRequiredCountryStatsCalibration\(/);
  assert.match(engine, /statsEconomicCalibrationRequested/);
  assert.match(engine, /statsPopulationCalibrationRequested/);
  assert.match(engine, /const batchTool = withUnitTypeNames\(forActiveFeatures\(/,
    "the batch retains the upstream feature and scenario-unit-type schema");
  assert.match(engine, /return withRequestedStatSheetTool\(taskKey, taskTool, variables, \{ customFullStatSheet \}\)/,
    "synchronous requests use the shared Stats audit requirement");
  assert.match(engine, /const requestedBatchTool = withRequestedStatSheetTool\(taskKey, batchTool, variables, \{ customFullStatSheet \}\)/,
    "background batches use the same Stats calibration and rating requirements");
  assert.match(engine, /tool: requestedBatchTool,/);
  assert.match(engine, /if \(requestedBatchTool && providerSupportsBatch\(taskKey\)\)/);
});
