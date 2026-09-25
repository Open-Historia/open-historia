import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./libraryBar.jsx", import.meta.url), "utf8");

const functionBody = (name, nextMarker) => {
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${name} must have a stable following marker`);
  return source.slice(start, end);
};

test("country-picker exits clear the scenario basemap as well as scenario geometry", () => {
  const startCountry = functionBody("startGameForCountry", "const startGameForFaction");
  const startFaction = functionBody("startGameForFaction", "const handleCreateScenario");
  const chooseCountry = functionBody("choosePlayCountry", "const pickCountry");

  for (const body of [startCountry, startFaction, chooseCountry]) {
    assert.match(body, /setCustomRegionData\(null\)/);
    assert.match(body, /setPickerOwnerOverrides\(null\)/);
    assert.match(body, /setPickerBackground\(null\)/);
  }
});
