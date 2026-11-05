/*! Open Historia — a country's military figures, as the Workshop edits them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/militaryForm.test.js
//
// Per-country settings "in the Workshop country panel, next to population,
// defaulting to today's behaviour". What an author types in the Military block
// (MilitaryFields.jsx) is kept on the country's record, saved to the scenario
// (exportPreset.js), read by the game (gameState.js), and given back when the
// scenario's map is opened again.
//
// Needs node_modules: the game's own reading of the world (runtime/gameState.js) reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGameSeed } from "./exportPreset.js";
import { mergePolityRoster } from "./polityRoster.js";
import { MILITARY_FIELD_KINDS, militaryDefaultsFor, militaryFieldText, unitMixEra, withMilitaryField, withMilitaryMuster } from "./militaryForm.js";
import { normalizeWorldState } from "../runtime/gameState.js";
import { normalizeGroups } from "../runtime/groups.js";
import { MILITARY_STAT_FIELDS, militaryLookup } from "../runtime/militaryStats.js";
import { DEFAULT_MUSTER } from "../runtime/mustering.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").replace(/\r\n/g, "\n");

// The Military block, field by field, as useMapDocument's upsertPolity merges each change into the record.
const typeInto = (record, entries) => {
  let next = { ...record };
  for (const [field, text] of entries) {
    const { military, ok } = withMilitaryField(next.military, field, text);
    assert.equal(ok, true, `${field}: ${text}`);
    next = { ...next, military: military ?? undefined };
  }
  return next;
};

test("every figure the game keeps has a field, and what an author types becomes the figure the game keeps", () => {
  assert.deepEqual([...Object.keys(MILITARY_FIELD_KINDS), "muster"].sort(), [...MILITARY_STAT_FIELDS].sort());
  assert.deepEqual(withMilitaryField(null, "quality", "72.6"), { military: { quality: 73 }, ok: true });
  assert.deepEqual(withMilitaryField({ quality: 73 }, "quality", " "), { military: null, ok: true }, "an empty field is the default again");
  assert.deepEqual(withMilitaryField(null, "sea", "150").military, { sea: 100 }, "held in range");
  assert.deepEqual(withMilitaryField(null, "land", "0").military, { land: 0 }, "0 is a figure: no army at all");
  assert.deepEqual(withMilitaryField(null, "cavalryShare", "90").military, { cavalryShare: 0.9 }, "the unit mix is typed in percent");
  assert.deepEqual(withMilitaryField(null, "siegeShare", "12.5%").military, { siegeShare: 0.125 });
  assert.deepEqual(withMilitaryField(null, "manpowerShare", "60").military, { manpowerShare: 60 });
  assert.deepEqual(withMilitaryField(null, "manpowerShare", "12,5").military, { manpowerShare: 12.5 });
  assert.deepEqual(withMilitaryField(null, "menPerCounter", "2k").military, { menPerCounter: 2000 });
  assert.deepEqual(withMilitaryField(null, "menPerCounter", "12,000").military, { menPerCounter: 12000 });
  // What is no figure changes nothing.
  assert.deepEqual(withMilitaryField({ quality: 40 }, "quality", "many"), { military: { quality: 40 }, ok: false });
  assert.deepEqual(withMilitaryField({ quality: 40 }, "menPerCounter", "-5"), { military: { quality: 40 }, ok: false });
  assert.equal(withMilitaryField(null, "bogus", "5").ok, false);
  // And shown again as it was typed.
  const figures = { quality: 73, cavalryShare: 0.125, manpowerShare: 12.5, menPerCounter: 12000 };
  assert.deepEqual(["quality", "cavalryShare", "manpowerShare", "menPerCounter", "sea"].map((field) => militaryFieldText(figures, field)), ["73", "12.5", "12.5", "12,000", ""]);
  // Its own mustering curve, and none again.
  const mustered = withMilitaryMuster({ quality: 73 }, [[0.9, 60], [0.4, 10]]);
  assert.deepEqual(mustered, { quality: 73, muster: [[0.4, 10], [0.9, 60]] });
  assert.deepEqual(withMilitaryMuster(mustered, null), { quality: 73 });
  assert.equal(withMilitaryMuster({ muster: [[0.5, 21], [1, 90]] }, null), null);
});

test("the figures go to the game with the scenario, and come back when its map is opened again", () => {
  // A country made in the Countries panel, and the Military block filled in.
  const created = { name: "Night's Watch", code: "Night's Watch", aliases: ["Night's Watch"], status: "active", note: "" };
  const watch = typeInto(created, [["manpowerShare", "60"], ["quality", "70"], ["sea", "10"], ["air", "0"], ["menPerCounter", "500"], ["cavalryShare", "5"]]);
  const record = { ...watch, military: withMilitaryMuster(watch.military, [[0.5, 7], [1, 30]]) };
  const expected = { quality: 70, sea: 10, air: 0, manpowerShare: 60, cavalryShare: 0.05, menPerCounter: 500, muster: [[0.5, 7], [1, 30]] };
  assert.deepEqual(record.military, expected);
  // A group's own figures, from the Groups panel.
  const groups = { "Free Folk": { name: "Free Folk", description: "", color: "#64748b", military: withMilitaryField(null, "technology", "15").military } };
  const doc = {
    name: "Westeros",
    metadata: { kind: "blank" },
    types: [{ id: "land", name: "Land" }],
    features: [],
    colorOverrides: {},
    flags: {},
    tags: {},
    polities: { "Night's Watch": record, "The North": { name: "The North", aliases: [] } },
    groups,
  };
  const regions = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "reg_wall", owner: "Night's Watch", group: "Free Folk" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: { id: "reg_north", owner: "The North" } },
    ],
  };
  const seed = buildGameSeed(doc, regions);
  assert.deepEqual(seed.world.polityOverrides["Night's Watch"].military, expected);
  assert.equal("military" in seed.world.polityOverrides["The North"], false, "a country nobody gave figures carries none");
  assert.deepEqual(seed.world.groups["Free Folk"].military, { technology: 15 });

  // The game reads the scenario's world, and the engine its figures.
  const world = normalizeWorldState(seed.world);
  assert.deepEqual(world.polityOverrides["Night's Watch"].military, expected);
  assert.deepEqual(world.groups["Free Folk"].military, { technology: 15 });
  const lookup = militaryLookup(world);
  assert.deepEqual(lookup("night's watch"), expected);
  assert.deepEqual(lookup("Free Folk"), { technology: 15 });
  assert.equal(lookup("The North"), null);

  // Opened again: the Workshop takes the world's polities and groups as its own (MapEditor.jsx), and the fields show what was typed.
  const reopened = structuredClone(seed.world.polityOverrides)["Night's Watch"].military;
  assert.deepEqual(["manpowerShare", "quality", "sea", "air", "menPerCounter", "cavalryShare", "technology"].map((field) => militaryFieldText(reopened, field)), ["60", "70", "10", "0", "500", "5", ""]);
  assert.deepEqual(normalizeGroups(seed.world.groups)["Free Folk"].military, { technology: 15 });
  // Taken away again (the panel's upsertPolity({ military: undefined })): the save carries none, and the game reads none.
  const cleared = buildGameSeed({ ...doc, polities: { ...doc.polities, "Night's Watch": { ...record, military: undefined } } }, regions).world;
  assert.equal(JSON.parse(JSON.stringify(cleared)).polityOverrides["Night's Watch"].military, undefined);
  assert.equal("military" in normalizeWorldState(cleared).polityOverrides["Night's Watch"], false);
});

test("a roster import keeps a country's military figures, and leaves those it does not give alone", () => {
  const doc = { polities: { Aland: { name: "Aland", aliases: [], military: { quality: 40 } }, Borduria: { name: "Borduria", aliases: [] } } };
  const { doc: next } = mergePolityRoster(doc, [
    { key: "Aland", name: "Aland" },
    { key: "Borduria", name: "Borduria", military: { quality: 120, sea: "0", bogus: 1 } },
    { key: "Cisland", military: { manpowerShare: 30 } },
  ]);
  assert.deepEqual(next.polities.Aland.military, { quality: 40 }, "a row without figures leaves the country's");
  assert.deepEqual(next.polities.Borduria.military, { quality: 100, sea: 0 });
  assert.deepEqual(next.polities.Cisland.military, { manpowerShare: 30 });
});

test("what an empty field stands for: the scenario's own settings, else its era's, the era read off its date as the engine reads it", () => {
  const medieval = militaryDefaultsFor(null, "1415-10-25");
  assert.deepEqual(medieval, { era: 0, gameDate: "1415-10-25", rules: "", menPerCounter: 2000, manpowerShare: 12, cavalryShare: 0.15, siegeShare: 0.1, muster: DEFAULT_MUSTER, scenarioMuster: false });
  assert.equal(unitMixEra(medieval), "old", "horse and siege engines");
  assert.equal(unitMixEra(militaryDefaultsFor(null, "1916-07-01")), "modern", "armour and artillery from 1850");
  assert.equal(unitMixEra(militaryDefaultsFor({ era: 1 }, "1916-07-01")), "old", "the era the scenario set, over its date");
  assert.equal(unitMixEra(null), "both", "a map with no scenario to say");
  const own = militaryDefaultsFor({ era: 3, menPerCounter: 500, manpowerShare: 20, muster: [[0.5, 10], [1, 40]] }, "1415-10-25");
  assert.deepEqual(own, { era: 3, gameDate: "1415-10-25", rules: "", menPerCounter: 500, manpowerShare: 20, cavalryShare: 0.3, siegeShare: 0.15, muster: [[0.5, 10], [1, 40]], scenarioMuster: true });
  // A calendar of its own reads as the present, as the engine reads it, unless the scenario sets its era.
  assert.equal(militaryDefaultsFor(null, "Year 12 AC").era, 3);
  assert.equal(militaryDefaultsFor({ era: 0 }, "Year 12 AC").era, 0);
});

test("the Countries and Groups panels carry the Military block, and the scenario's map is opened with what it stands for", () => {
  const polities = read("PolitiesPanel.jsx");
  assert.ok(polities.includes("onChange={(military) => upsertPolity?.(current.key, { military: military ?? undefined })}"));
  assert.ok(polities.indexOf("<MilitaryFields") > polities.indexOf("Population when the scenario begins"), "next to the population");
  const groups = read("GroupsPanel.jsx");
  assert.ok(groups.includes("onChange={(military) => patchRecord(current, { military: military ?? undefined })}"));
  const editor = read("MapEditor.jsx");
  assert.equal(editor.split("militaryDefaults={initialMap?.militaryDefaults ?? null}").length - 1, 3, "the Countries and Groups panels, and the selection's");
  // And the selection's own panel, for the country whose land is selected: no need to open the Countries panel
  // ("make it so the military settings per country are availible just by selecting the country", the owner).
  const inspector = read("SelectionInspector.jsx");
  assert.ok(inspector.includes("onChange={(military) => upsertPolity(form.owner, { military: military ?? undefined })}"));
  assert.ok(inspector.includes("value={polities?.[form.owner]?.military}"));
  assert.ok(inspector.indexOf("<MilitaryFields") > inspector.indexOf("<TagField"), "under the country's tags");
  const library = read("../Game/GameUI/libraryBar.jsx");
  assert.ok(library.includes("militaryDefaults: militaryDefaultsFor(warSettings === undefined ? world.warSettings : warSettings, gameDate, { rules: world.simulationRules }),"));
  const fields = read("MilitaryFields.jsx");
  for (const words of ["\"Armour (%)\", \"Artillery (%)\"", "\"Cavalry (%)\", \"Siege (%)\"", "\"Cavalry / armour (%)\", \"Siege / artillery (%)\""]) assert.ok(fields.includes(words), words);
});
