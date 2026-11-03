// Run: node --test server/mapPolities.test.js
//
// A polity exists on the map or not at all. buildGameSeed (the editor's map →
// scenario seed) used to ship every record in the document's polity registry,
// including ones that owned nothing and claimed nothing, as "governments in
// exile". That is how an empire an author had painted off the map kept its
// polity record, stayed in the model's roster and wrote to the player.

import test from "node:test";
import assert from "node:assert/strict";

import { buildGameSeed } from "../src/Editor/exportPreset.js";

const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const region = (id, owner, extra = {}) => ({
  type: "Feature",
  id,
  properties: { id, name: id, owner, typeId: "land", ...extra },
  geometry: square,
});
const record = (name, extra = {}) => ({ name, code: name, aliases: [name], status: "active", note: "", ...extra });
const doc = (polities) => ({
  name: "punic",
  metadata: { kind: "import-world" },
  types: [{ id: "land", name: "Land" }],
  features: [],
  colorOverrides: {},
  flags: {},
  tags: {},
  polities,
});

test("a registry record that owns no region and claims none still ships: a registered country is a country", () => {
  const seed = buildGameSeed(
    doc({
      Carthage: record("Carthage", { note: "Barcid ascendancy" }),
      "Kushan Empire": record("Kushan Empire", { note: "left over from the template" }),
    }),
    { type: "FeatureCollection", features: [region("r1", "Carthage"), region("r2", "Carthage")] },
  );
  assert.ok(seed.world.polityOverrides.Carthage, "the polity on the map ships");
  assert.equal(seed.world.polityOverrides.Carthage.note, "Barcid ascendancy", "with its metadata");
  // A country registered in the Countries panel is a country to the game whether
  // or not it holds a region yet: a government in exile, a nation waiting to be
  // painted. It ships with its record and a colour; only "Remove from the map"
  // takes it out.
  assert.ok(seed.world.polityOverrides["Kushan Empire"], "the landless record ships too");
  assert.equal(seed.world.polityOverrides["Kushan Empire"].note, "left over from the template", "with its metadata");
  assert.ok(seed.colors["Kushan Empire"], "and a colour");
  assert.deepEqual(seed.world.regionOwnershipOverrides, { r1: "Carthage", r2: "Carthage" });
});

test("a polity present only as a claimant is on the map and ships", () => {
  const seed = buildGameSeed(
    doc({ Carthage: record("Carthage"), Numidia: record("Numidia", { note: "claims the coast" }) }),
    { type: "FeatureCollection", features: [region("r1", "Carthage", { claimants: ["Numidia"] })] },
  );
  assert.ok(seed.world.polityOverrides.Numidia, "a claimant strips the map in its colour, so the game must know it");
  assert.equal(seed.world.polityOverrides.Numidia.note, "claims the coast");
  assert.ok(seed.colors.Numidia);
});

test("an owner with no registry record still ships with a default record", () => {
  const seed = buildGameSeed(doc({}), { type: "FeatureCollection", features: [region("r1", "Winilli Tribe")] });
  assert.equal(seed.world.polityOverrides["Winilli Tribe"]?.name, "Winilli Tribe");
  assert.equal(seed.stats.owners, 1);
});
