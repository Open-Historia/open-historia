import test from "node:test";
import assert from "node:assert/strict";

import { getGameplayToolForCustomStatSheet } from "./gameplaySchemas.js";

const rows = [
  { key: "timber", label: "Timber", kind: "index", minimum: 0, maximum: 100, description: "Usable timber supply." },
  { key: "silver", label: "Treasury", kind: "currency", minimum: 0, maximum: 100000, description: "Treasury in silver marks." },
  { key: "grainYield", label: "Annual grain", kind: "number", minimum: 0, description: "Annual grain yield." },
];

const findCustomStatsSchemas = (value, out = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => findCustomStatsSchemas(entry, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (value.properties?.customStats) out.push(value.properties.customStats);
  Object.values(value).forEach((entry) => findCustomStatsSchemas(entry, out));
  return out;
};

test("custom countryStatSheet tool exposes only the scenario's exact values", () => {
  const tool = getGameplayToolForCustomStatSheet("countryStatSheet", rows, { custom: true });
  assert.deepEqual(Object.keys(tool.schema.properties), ["customStats"]);
  const schema = tool.schema.properties.customStats;
  assert.deepEqual(Object.keys(schema.properties), ["timber", "silver", "grainYield"]);
  assert.deepEqual(schema.required, ["timber", "silver", "grainYield"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(tool.schema.properties.economy, undefined);
  assert.equal(tool.schema.properties.population, undefined);
  assert.equal(schema.properties.timber.type, "integer");
  assert.equal(schema.properties.silver.type, "number");
});

test("custom turn tools advertise exact customStats keys for Stats mutations", () => {
  const tool = getGameplayToolForCustomStatSheet("jumpForward", rows, { custom: true });
  const customSchemas = findCustomStatsSchemas(tool.schema);
  assert.ok(customSchemas.length > 0, "expected at least one customStats schema in jump output");
  for (const schema of customSchemas) {
    assert.deepEqual(Object.keys(schema.properties), ["timber", "silver", "grainYield"]);
    assert.equal(schema.additionalProperties, false);
  }
});

test("standard tools are unchanged when no custom sheet is active", () => {
  const standard = getGameplayToolForCustomStatSheet("countryStatSheet", rows, { custom: false });
  assert.ok(standard.schema.properties.economy);
  assert.ok(standard.schema.properties.territorialMacroComponentsText);
  assert.equal(standard.schema.properties.customStats, undefined);
});

test("custom GM transport advertises exact customStats keys inside its shallow JSON text fields", () => {
  const tool = getGameplayToolForCustomStatSheet("gameMaster", rows, { custom: true });
  const patchField = tool.schema.properties.countryStatPatchesJson;
  const eventsField = tool.schema.properties.eventsJson;

  assert.match(tool.description, /custom National Stats sheet/i);
  assert.match(patchField.description, /patch\.customStats/);
  assert.match(patchField.description, /timber, silver, grainYield/);
  assert.match(patchField.description, /Do not use population, economy, indices, stability, or gdpBreakdown/);
  assert.match(patchField.description, /"customStats":\{"timber":1\}/);
  assert.match(eventsField.description, /impacts\.polityChanges\[\]\.stats/);
  assert.match(eventsField.description, /timber, silver, grainYield/);

  // The provider transport remains shallow; the fix teaches the string fields
  // rather than expanding the huge internal GM transaction schema again.
  assert.equal(patchField.type, "string");
  assert.equal(eventsField.type, "string");
});

test("standard GM transport remains unchanged when no custom sheet is active", () => {
  const standard = getGameplayToolForCustomStatSheet("gameMaster", rows, { custom: false });
  assert.doesNotMatch(standard.schema.properties.countryStatPatchesJson.description, /patch\.customStats/);
});

