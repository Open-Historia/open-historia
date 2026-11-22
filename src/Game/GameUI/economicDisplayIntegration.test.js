import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { changedEditorFields, countryStatPatchFromForm } from "./countryEditorStats.js";
import { fromDisplayCurrency, toDisplayCurrency } from "../../runtime/economicDisplayCurrency.js";
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("Country Editor converts a displayed GDP edit back into USD, and never writes an untouched GDP", () => {
  const originalGdp = 1000000;
  const displayBillions = String(Number((toDisplayCurrency(originalGdp, "GBP") / 1e9).toPrecision(12)));
  assert.ok(Number(displayBillions) < 0.001, "small-country GDP must not be forced up to one display billionth");
  const loaded = { gdpB: displayBillions, inflation: "1" };
  const changedNothing = changedEditorFields(loaded, loaded);
  assert.deepEqual(countryStatPatchFromForm({ form: loaded, changed: changedNothing }), null);
  const newGdp = 2750000;
  const edited = { ...loaded, gdpB: String(toDisplayCurrency(newGdp, "GBP") / 1e9) };
  const converted = { ...edited, gdpB: fromDisplayCurrency(Number(edited.gdpB) * 1e9, "GBP") / 1e9 };
  const patch = countryStatPatchFromForm({ form: converted, changed: changedEditorFields(edited, loaded) });
  assert.equal(patch.economy.gdp, newGdp);
  assert.equal(patch.economy.inflation, undefined);
});

test("New Game, scenario editor and campaign Settings persist one independent currency preference", () => {
  const library = read("./libraryBar.jsx");
  const settings = read("./settings.jsx");
  assert.match(library, /economicDisplayCurrency: editorState\.economicDisplayCurrency/);
  assert.match(library, /setPickerEconomicCurrency\(normalizeEconomicDisplayCurrency\(details\?\.data\?\.game\?\.economicDisplayCurrency\)\)/);
  assert.match(library, /startGameForCountry\(countryPicker, countryCode, difficultyId, pickerEconomicCurrency\)/);
  assert.match(library, /startGameForFaction\(countryPicker, draft\.faction, difficultyId, pickerEconomicCurrency\)/);
  assert.match(library, /startGameForGroup\(countryPicker, draft\.group, difficultyId, pickerEconomicCurrency\)/);
  assert.match(settings, /saveGame\(activeGameId, \{ gamePatch: \{ economicDisplayCurrency: next \} \}\)/);
  assert.match(settings, /setActiveEconomicDisplayCurrency\(next\)/);
});

test("existing custom-sheet GDP uses the selected currency in Country, Ranking and Advanced Statistics", () => {
  const stats = read("./stats.jsx");
  assert.match(stats, /const CustomStatsSheet = \(\{ definition, sheet, hiddenKeys = \[\], displayCurrency \}\)/);
  assert.match(stats, /<CustomStatCard key=\{stat\.key\} stat=\{stat\} value=\{values\[stat\.key\]\} displayCurrency=\{displayCurrency\}/);
  assert.match(stats, /const formatRankingValue = \(metric, value, displayCurrency\)/);
  assert.match(stats, /formatRankingValue\(metric, row\.value, displayCurrency\)/);
  assert.match(stats, /advancedMetricGroupsFor\(indexRows, statSheetDefinition, displayCurrency\)/);
  assert.match(stats, /\[indexRows, statSheetDefinition, displayCurrency\]/);
  assert.match(stats, /formatCustomStatValue\(stat, value, \{ economicDisplayCurrency: displayCurrency \}\)/);
  assert.match(stats, /customMetricUnitLabel\(stat, displayCurrency\)/);
});

test("Stats and Country Editor display the chosen denomination; canonical model source is unchanged", () => {
  const stats = read("./stats.jsx");
  const cheats = read("./cheats.jsx");
  const countryStats = read("../../runtime/countryStats.js");
  assert.match(stats, /useSyncExternalStore\(subscribeEconomicDisplayCurrency, getActiveEconomicDisplayCurrency\)/);
  assert.match(stats, /formatEconomicDisplayValue\(value, getActiveEconomicDisplayCurrency\(\)/);
  assert.match(stats, /setActiveEconomicDisplayCurrency\(game\.economicDisplayCurrency\)/);
  assert.match(cheats, /gdpB: fromDisplayCurrency\(Number\(form\.gdpB\) \* 1e9, baseline\.economicDisplayCurrency\)/);
  assert.match(cheats, /toDisplayCurrency\(gdp, displayCurrency\)/);
  assert.ok(countryStats.includes("GDP $${compactEconomicNumber(economy.gdp)}"));
  assert.doesNotMatch(stats, /GDP · 2026-USD equivalent/);
});
