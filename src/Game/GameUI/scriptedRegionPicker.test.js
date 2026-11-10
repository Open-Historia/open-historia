/*! Open Historia — the scripted events' region picker and impacts editor © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/scriptedRegionPicker.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  insertAtCursor,
  pickerOwnerOptions,
  pickerRegionRows,
  regionNameList,
  searchPickerRegions,
  toggleOwnerRegions,
  togglePickerRegion,
} from "./scriptedEventAuthoring.js";

const source = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");

const geojson = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { id: "MDA.1_1", owner: "Moldova", gid0: "MDA", name: "Chişinău" } },
    { type: "Feature", geometry: null, properties: { id: "MDA.22_1", owner: "Moldova", gid0: "MDA", name: "Ialoveni" } },
    { type: "Feature", geometry: null, properties: { id: "MDA.32_1", owner: "Moldova", gid0: "MDA", name: "Ştefan Voda" } },
    { type: "Feature", geometry: null, properties: { id: "ROU.1_1", owner: "Romania", gid0: "ROU", name: "Iaşi" } },
    { type: "Feature", geometry: null, properties: { id: "GBR.1_1", owner: "United Kingdom", gid0: "GBR", name: "NA" } },
  ],
};

test("the picker's rows are the map's regions, named as the map spells them, owned as the world now has them", () => {
  const rows = pickerRegionRows({ geojson, ownerOverrides: { "MDA.32_1": "Romania" } });
  assert.deepEqual(rows.map((row) => row.name), ["Chişinău", "England", "Ialoveni", "Iaşi", "Ştefan Voda"]);
  const stefan = rows.find((row) => row.id === "MDA.32_1");
  assert.equal(stefan.owner, "Romania");
  assert.equal(stefan.baseOwner, "Moldova");
  const stock = pickerRegionRows({ catalog: [{ id: "FRA.1_1", name: "Auvergne-Rhône-Alpes", country: "France" }] });
  assert.deepEqual(stock, [{ id: "FRA.1_1", name: "Auvergne-Rhône-Alpes", owner: "France", baseOwner: "France" }]);
});

test("search finds a region without its accents, names that start with the query first", () => {
  const rows = pickerRegionRows({ geojson });
  assert.deepEqual(searchPickerRegions(rows, "chisinau").map((row) => row.name), ["Chişinău"]);
  assert.deepEqual(searchPickerRegions(rows, "i").map((row) => row.name), ["Ialoveni", "Iaşi", "Chişinău"]);
  assert.deepEqual(searchPickerRegions(rows, "  "), []);
  assert.deepEqual(searchPickerRegions(rows, "stefan").map((row) => row.id), ["MDA.32_1"]);
});

test("a click toggles a region; a single pick keeps only the one clicked", () => {
  const rows = pickerRegionRows({ geojson });
  const [chisinau, england, ialoveni] = rows;
  let selected = togglePickerRegion([], chisinau);
  selected = togglePickerRegion(selected, ialoveni);
  assert.deepEqual(selected.map((entry) => entry.name), ["Chişinău", "Ialoveni"]);
  selected = togglePickerRegion(selected, chisinau);
  assert.deepEqual(selected.map((entry) => entry.name), ["Ialoveni"]);
  assert.deepEqual(togglePickerRegion(selected, england, { single: true }).map((entry) => entry.id), ["GBR.1_1"]);
  assert.deepEqual(togglePickerRegion([{ id: "GBR.1_1", name: "England" }], england, { single: true }), []);
});

test("a country picks all its regions, and picks them all out again once all are in", () => {
  const rows = pickerRegionRows({ geojson });
  assert.deepEqual(pickerOwnerOptions(rows), [
    { owner: "Moldova", count: 3 },
    { owner: "Romania", count: 1 },
    { owner: "United Kingdom", count: 1 },
  ]);
  let selected = togglePickerRegion([], rows.find((row) => row.name === "Iaşi"));
  selected = toggleOwnerRegions(selected, rows, "Moldova");
  assert.deepEqual(selected.map((entry) => entry.name), ["Iaşi", "Chişinău", "Ialoveni", "Ştefan Voda"]);
  selected = toggleOwnerRegions(selected, rows, "Moldova");
  assert.deepEqual(selected.map((entry) => entry.name), ["Iaşi"]);
});

test("Insert writes the exact names, comma-separated, where the cursor was", () => {
  const names = regionNameList([{ name: "Chişinău" }, { name: "Ialoveni" }, { name: "Anenii Noi" }]);
  assert.equal(names, "Chişinău, Ialoveni, Anenii Noi");
  const text = "[In terms of map changes: Republic of Moldova gets the regions of ]";
  const at = text.indexOf("]");
  assert.deepEqual(insertAtCursor(text, names, at), {
    value: "[In terms of map changes: Republic of Moldova gets the regions of Chişinău, Ialoveni, Anenii Noi]",
    cursor: at + names.length,
  });
  assert.equal(insertAtCursor("regions of:", "Ialoveni", 11).value, "regions of: Ialoveni");
  assert.equal(insertAtCursor("gets Chisinau and more", "Chişinău", 5, 13).value, "gets Chişinău and more");
  assert.equal(insertAtCursor("Moldova", "Ialoveni", 0).value, "Ialoveni Moldova");
  assert.equal(insertAtCursor("", "Ialoveni", null).value, "Ialoveni");
  assert.equal(insertAtCursor("Text", "Ialoveni").value, "Text Ialoveni");
});

test("the picker is lazy-loaded and wired into event text, outcome text, impacts and region conditions", () => {
  const editor = source("./ScriptedEventsEditor.jsx");
  assert.match(editor, /const ScriptedRegionPicker = lazy\(\(\) => import\("\.\/ScriptedRegionPicker\.jsx"\)\);/);
  assert.doesNotMatch(editor, /^import ScriptedRegionPicker/m);
  assert.doesNotMatch(editor, /CountryPickerMap/);
  assert.match(editor, /<Suspense fallback=\{null\}>\s*<ScriptedRegionPicker/);
  assert.match(editor, /pickRegionsButton\(\(\) => openTextPicker\(index\)\)/);
  assert.match(editor, /pickRegionsButton\(\(\) => openTextPicker\(index, outcomeIndex\)\)/);
  assert.match(editor, /setRegionPicker\(\{ kind: "condition", eventIndex: index, conditionIndex \}\)/);
  assert.match(editor, /single=\{regionPicker\.kind === "condition"\}/);
  assert.match(editor, /insertAtCursor\(holder\?\.text \|\| "", regionNameList\(regions\), picker\.start, picker\.end\)/);
  assert.match(editor, /regionId: region\.id,\s*regionName: region\.name/);
  assert.match(editor, /<ScriptedImpactsEditor[\s\S]*?onPickRegions=\{\(rowIndex\) => setRegionPicker\(\{ kind: "impact", eventIndex: index, outcomeIndex: null, rowIndex \}\)\}/);
  assert.match(editor, /impactRows: rows, impacts: compileImpactRows\(rows\)/);
  assert.match(source("./FeaturesSectionEditor.jsx"), /scenarioId=\{scenarioId\}/);
  assert.match(source("./libraryBar.jsx"), /scenarioId=\{details\?\.scenario\?\.id \|\| details\?\.game\?\.scenarioId \|\| ""\}/);
});

test("the picker draws the scenario's own regions on desktop and web through the scenario's assets", () => {
  const picker = source("./ScriptedRegionPicker.jsx");
  assert.match(picker, /import CountryPickerMap from "\.\/CountryPickerMap\.jsx";/);
  assert.match(picker, /downloadScenarioJsonAsset\(scenarioId, "regionsGeojson", \{ coarse: true \}\)/);
  assert.match(picker, /downloadScenarioJsonAsset\(scenarioId, "colors"\)/);
  assert.match(picker, /buildRegionCatalogForMap\(null\)/);
  assert.match(picker, /selectionMode="regions"/);
  assert.match(picker, /selectionColor=\{ACCENT_HEX\}/);
  assert.match(picker, /const ACCENT_HEX = "#2bc1f3";/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(picker, /window\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(picker, /aria-label=\{`Remove \$\{entry\.name\}`\}/);
  assert.match(picker, /aria-label="Search regions"/);
});
