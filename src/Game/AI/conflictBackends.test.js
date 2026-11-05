/*! Open Historia — one request for the backends of every country a player comes into conflict with: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/conflictBackends.test.js
//
// "Can't you merge both AI requests into one?" A country in conflict with the
// player was asked for a whole sheet of statistics, one request a country, two
// at a time. The war reads four figures of it; they are asked of every such
// country in one request.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeCountryStatPatch, isCompleteCountryStatSheet } from "../../runtime/countryStats.js";
import { hasStatsBackend, statsBackendOf, statsBackendPatch } from "../../runtime/statsBackend.js";
import { CONFLICT_BACKENDS_MOST, conflictBackendsRequest, readConflictBackends } from "./conflictBackends.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

test("the request asks for the four figures of every country at once, in one unit", () => {
  const { systemPrompt, userMessage, asked } = conflictBackendsRequest({
    date: "1914-08-01",
    rules: "The Great War: empires, conscript armies, gold-backed currencies.",
    player: "France",
    countries: [{ name: "German Empire" }, { name: "Austria-Hungary", population: 51000000 }, { name: "" }, { name: "Belgium" }],
    known: [{ name: "France", backend: { population: 39600000, gdp: 1.38e11, budgetBalance: -1, publicDebt: 66 } }],
  });
  assert.deepEqual(asked, ["German Empire", "Austria-Hungary", "Belgium"]);
  assert.match(systemPrompt, /gdp: the size of its economy in a year, in ONE unit that you use for every polity of this world \(the unit of the polities already known, where some are shown\)\./);
  assert.match(systemPrompt, /\{"countries":\[\{"country":"the exact name you were given","population":0,"gdp":0,"budgetBalance":0,"publicDebt":0\}\]\}/);
  assert.match(systemPrompt, /One entry for every polity asked of, in the order given, each under the exact name given\./);
  // Who is asked of, with what its scenario's author gave; what is known already, for the unit and the scale.
  assert.ok(userMessage.includes("Game date: 1914-08-01"));
  assert.ok(userMessage.includes("ESTIMATE THESE:\n- German Empire\n- Austria-Hungary (its scenario gives its people as 51000000)\n- Belgium"));
  assert.ok(userMessage.includes('ALREADY KNOWN (for the unit and the scale; do not return these):\n- France: {"population":39600000,"gdp":138000000000,"budgetBalance":-1,"publicDebt":66}'));
  assert.ok(userMessage.includes("ERA & WORLD RULES:\nThe Great War"));
  // With nothing known it is told to choose one unit; and never more than the most at once.
  assert.ok(conflictBackendsRequest({ countries: [{ name: "X" }] }).userMessage.includes("No polity's figures are known yet: choose one unit for gdp and use it for all of these."));
  assert.equal(conflictBackendsRequest({ countries: Array.from({ length: 20 }, (_, index) => ({ name: `Country ${index}` })) }).asked.length, CONFLICT_BACKENDS_MOST);
  assert.equal(CONFLICT_BACKENDS_MOST, 8);
  // Nothing in it is an id.
  assert.doesNotMatch(`${systemPrompt}\n${userMessage}`, /\b(regionId|unitId|id:)\b/);
});

test("the answer is read for the countries that were asked of, under their own names", () => {
  const asked = ["German Empire", "Austria-Hungary", "Belgium"];
  const answer = {
    countries: [
      { country: "german empire", population: 67800000, gdp: 2.4e11, budgetBalance: -2, publicDebt: 44 },
      { country: "Austria-Hungary", population: "51000000", gdp: 1.0e11, budgetBalance: -3.5, publicDebt: 70 },
      // Not asked of, answered twice, and answered with no people: each is left out.
      { country: "Russia", population: 170000000, gdp: 2.3e11 },
      { country: "German Empire", population: 1, gdp: 1 },
      { country: "Belgium", gdp: 1.4e10 },
    ],
  };
  assert.deepEqual(readConflictBackends(answer, asked), [
    { name: "German Empire", backend: { population: 67800000, gdp: 2.4e11, budgetBalance: -2, publicDebt: 44 } },
    { name: "Austria-Hungary", backend: { population: 51000000, gdp: 1.0e11, budgetBalance: -3.5, publicDebt: 70 } },
  ]);
  for (const nothing of [null, {}, { countries: "x" }, { countries: [] }]) assert.deepEqual(readConflictBackends(nothing, asked), []);
});

test("what is kept is the backend alone: the war can read it, and the rest of the sheet is still to be written", () => {
  const sheet = mergeCountryStatPatch(null, statsBackendPatch({ population: 67800000, gdp: 2.4e11, budgetBalance: -2, publicDebt: 44 }));
  assert.ok(hasStatsBackend(sheet));
  assert.deepEqual(statsBackendOf(sheet), { population: 67800000, gdp: 2.4e11, budgetBalance: -2, publicDebt: 44 });
  assert.equal(isCompleteCountryStatSheet(sheet), false, "so whoever opens its statistics is still given a whole sheet");
});

test("it is one request, asked as a first reading is, and it overwrites nobody", () => {
  const turn = read("gameplay.js");
  const start = turn.indexOf("export const ensureConflictBackends = (targets, { reason = \"\" } = {}) => {");
  const body = turn.slice(start, turn.indexOf("// The figures of the countries the game needs and has none for, rated against", start));
  assert.ok(start > 0 && body.length > 500);
  assert.equal(body.split("callAIWithTaskLimit(").length - 1, 1, "one request, whatever the number of countries");
  assert.ok(body.includes('return firstReading("backends", "the countries in conflict", reason, async () => {'), "background AI, one at a time a campaign");
  assert.ok(body.includes("requestKind: BACKGROUND_REQUEST,"));
  assert.ok(body.includes("await waitForSimulationIdle();"));
  // Asked only of those still without, and written only where there is still none.
  assert.ok(body.includes("const wanted = names.filter((name) => !hasStatsBackend(sheetOf(world, name)));"));
  assert.ok(body.includes("if (hasStatsBackend(latest.countryStats?.[key])) continue;"));
  // And no country in a conflict is asked for a whole sheet any more.
  assert.equal(turn.includes('void ensureCountryStatSheet(name, { reason: "in conflict with the player"'), false);
});

// "I meant update both layers of the stats in one request."
test("in a scenario with a sheet of its own the one request writes both layers: the sheet for a country that has none, the backend for all", () => {
  const sheet = { description: "legions (Legions, 0 to 60): standing legions.\ngrain (Grain, 0 to 100): the harvest in store.", keys: ["legions", "grain"] };
  const { systemPrompt, userMessage, asked, sheets } = conflictBackendsRequest({
    date: "0050-03-01",
    player: "Roma",
    countries: [{ name: "Parthia" }, { name: "Armenia", values: { legions: 3, grain: 40 } }, { name: "Dacia", population: 900000 }],
    sheet,
  });
  assert.deepEqual(asked, ["Parthia", "Armenia", "Dacia"]);
  assert.deepEqual(sheets, ["Parthia", "Dacia"], "Armenia's sheet is there already");
  assert.match(systemPrompt, /The two layers are written TOGETHER, in this one answer\./);
  assert.match(systemPrompt, /For a polity marked `and its sheet`: after its four figures, write every value of the scenario's sheet in customStats, under the exact keys, so that the sheet says the same thing as the figures/);
  assert.match(systemPrompt, /For a polity whose sheet is shown: its sheet stands as it is\. Return its four figures only, agreeing with that sheet\./);
  assert.match(systemPrompt, /\{"countries":\[\{"country":"the exact name you were given","population":0,"gdp":0,"budgetBalance":0,"publicDebt":0,"customStats":\{"legions":0\}\}\]\}/);
  assert.ok(userMessage.includes("THE SCENARIO'S OWN SHEET:\nlegions (Legions, 0 to 60): standing legions."));
  assert.ok(userMessage.includes('ESTIMATE THESE:\n- Parthia; and its sheet\n- Armenia; its sheet: {"legions":3,"grain":40}\n- Dacia (its scenario gives its people as 900000); and its sheet'));
  // An ordinary scenario is asked for nothing of the kind: its backend is part of the sheet it shows.
  const plain = conflictBackendsRequest({ countries: [{ name: "Parthia", values: { legions: 3 } }] });
  assert.equal(plain.systemPrompt.includes("customStats"), false);
  assert.deepEqual(plain.sheets, []);
  assert.ok(plain.userMessage.includes("ESTIMATE THESE:\n- Parthia"));

  // The answer carries the sheet beside the backend, for whoever keeps it to hold to the definition.
  const answered = readConflictBackends({ countries: [
    { country: "Parthia", population: 6e6, gdp: 4e9, budgetBalance: 1, publicDebt: 10, customStats: { legions: 20, grain: 55 } },
    { country: "Armenia", population: 1.2e6, gdp: 6e8, budgetBalance: -1, publicDebt: 20 },
  ] }, asked);
  assert.deepEqual(answered.map((entry) => [entry.name, entry.backend.population, entry.customStats ?? null]), [["Parthia", 6000000, { legions: 20, grain: 55 }], ["Armenia", 1200000, null]]);

  // And it is kept as a whole sheet with both layers, dated as a first reading is; a sheet that was there is not written again.
  const turn = read("gameplay.js");
  assert.ok(turn.includes("sheet: definition.custom ? { description: describeStatSheetDefinition(definition), keys } : null,"));
  assert.ok(turn.includes("const values = definition.custom && customStats && !ownSheet(latest, name) ? normalizeCustomStatValues(customStats, definition) : null;"));
  assert.ok(turn.includes("applyCountryStatPatchToWorld(latest, key, { ...(whole ? { customStats: values } : {}), ...statsBackendPatch(backend), ...rated }, whole"));
});

test("weighing countries' military figures, the same request rates those of a country that has none, and they are kept on its sheet", () => {
  const request = conflictBackendsRequest({
    date: "1914-08-01",
    military: true,
    countries: [{ name: "Serbia" }, { name: "Austria-Hungary", rated: true }],
  });
  assert.match(request.userMessage, /- Serbia; and its military/);
  assert.doesNotMatch(request.userMessage, /Austria-Hungary; and its military/);
  assert.match(request.systemPrompt, /quality: how well its soldiers fight/);
  assert.match(request.systemPrompt, /"military":\{"quality":50/);
  assert.deepEqual(request.rated, ["Serbia"]);
  // Off, or nobody without figures: nothing of it is asked.
  assert.doesNotMatch(conflictBackendsRequest({ countries: [{ name: "Serbia" }] }).systemPrompt, /military/);
  assert.doesNotMatch(conflictBackendsRequest({ military: true, countries: [{ name: "Serbia", rated: true }] }).systemPrompt, /and its military/);
  // The answer's figures are read, held in range, and merged onto the sheet beside its backend.
  const [read] = readConflictBackends({ countries: [{ country: "Serbia", population: 4500000, gdp: 1, budgetBalance: 0, publicDebt: 40, military: { quality: 62, technology: 140, sea: 0, cavalryShare: 0.08, bogus: 1 } }] }, ["Serbia"]);
  assert.deepEqual(read.military, { quality: 62, technology: 100, sea: 0, cavalryShare: 0.08 });
  const sheet = mergeCountryStatPatch({}, { ...statsBackendPatch(read.backend), military: read.military });
  assert.deepEqual(sheet.military, read.military);
  assert.deepEqual(mergeCountryStatPatch(sheet, { military: { quality: 70 } }).military, { ...read.military, quality: 70 }, "a later patch moves only what it names");
  // In the game: rated only where the scenario weighs military figures and the country has none.
  const gameplay = fs.readFileSync(path.join(here, "gameplay.js"), "utf8");
  assert.ok(gameplay.includes("const rateMilitary = warSettingsOf(world).mechanics.military;"));
  assert.ok(gameplay.includes("const rated = rateMilitary && military && !militaryLookup(latest)(name) ? { military } : {};"));
});
