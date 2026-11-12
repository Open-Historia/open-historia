import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GAME_MASTER_SCHEMA, getGameplayToolForCustomStatSheet } from "../AI/gameplaySchemas.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("GM Direct schema admits bounded canonical intelligence and military edits alongside Stats", () => {
  const patch = GAME_MASTER_SCHEMA.properties.countryStatPatches.items.properties.patch;
  assert.equal(patch.properties.intelligence.minimum, 0);
  assert.equal(patch.properties.intelligence.maximum, 100);
  for (const key of ["quality", "technology", "spending", "land", "sea", "air"]) {
    assert.equal(patch.properties.military.properties[key].minimum, 0);
    assert.equal(patch.properties.military.properties[key].maximum, 100);
  }
  assert.equal(patch.properties.military.properties.manpowerShare.minimum, 0.1);
  assert.equal(patch.properties.warWeariness.maximum, 100);
  assert.equal(patch.properties.warResources.minimum, 0);
  assert.equal(patch.additionalProperties, false);
});

test("GM custom-sheet contract still allows native capability changes without inventing custom stat keys", () => {
  const tool = getGameplayToolForCustomStatSheet("gameMaster", [
    { key: "stabilityCustom", label: "Stability", kind: "index", minimum: 0, maximum: 100 },
  ], { custom: true });
  const description = tool.schema.properties.countryStatPatchesJson.description;
  assert.match(description, /patch\.intelligence/);
  assert.match(description, /patch\.military/);
  assert.match(description, /patch\.warWeariness/);
  assert.match(description, /patch\.warResources/);
  assert.match(description, /customStats/i);
});

test("custom intelligence appears in the native capabilities row, not as a second editable Stats field", () => {
  const editor = read("./cheats.jsx");
  assert.match(editor, /COUNTRY_CAPABILITY_FIELDS\.map\(\(field\) =>/);
  assert.match(editor, /field\.key === "intelligence" && customHasIntelligence\s*\? \(customStatForm\.intelligenceService \?\? ""\)/);
  assert.match(editor, /changeCustomStat\("intelligenceService", event\.target\.value\)/);
  assert.match(editor, /section\.stats\.map\(\(stat\) => stat\.key === "intelligenceService" \? null : \(/);
  assert.doesNotMatch(editor, /if \(field\.key === "intelligence" && customHasIntelligence\) return null/);
});

test("GM and Country Editor validate and apply capabilities via one native helper", () => {
  const gm = read("../AI/gameplay.js");
  const editor = read("./cheats.jsx");
  assert.match(gm, /validateCountryCapabilityPatch\(/);
  assert.match(gm, /applyCountryCapabilityPatchToWorld\(/);
  assert.match(editor, /countryCapabilityPatchFromForm\(/);
  assert.match(editor, /applyCountryCapabilityPatchToWorld\(/);
  assert.match(editor, /COUNTRY_CAPABILITY_FIELDS\.map\(/);
});
