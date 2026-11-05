import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

test("countryStatSheet recovers omitted population provenance before native calibration validation", () => {
  const recoverAt = gameplay.indexOf("resolveCountryStatsPopulationCalibration(");
  const requiredAt = gameplay.indexOf('statsCalibrationError = "populationCalibration is required');
  assert.ok(recoverAt >= 0, "recovery helper must be wired into countryStatSheet transport");
  assert.ok(requiredAt > recoverAt, "recovery must run before the existing fail-closed requirement");
  assert.match(gameplay, /provider omitted populationCalibration provenance/);
  assert.match(gameplay, /Regional macro estimates remain the numeric authority/);
});
