import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, openStoredDocument } from "./useMapDocument.js";
import { buildGameSeed } from "./exportPreset.js";
import { planCountryDraft, emptyCountryDraft } from "./countryCreationDraft.js";
import { applyStartingRelationEdits } from "./scenarioStartingRelations.js";
import { scenarioAfterWorkshopRenames } from "./playerCountryAfterSave.js";

const emptyRegions = { type: "FeatureCollection", features: [] };

test("Map Editor document preserves scenario-authored relations on open and export, including explicit neutral zero", () => {
  const document = createDocument({ name: "Testing", kind: "import-world" });
  document.polities = {
    Latvia: { name: "Republic of Latvia", aliases: ["Latvian Republic"] },
    Estonia: { name: "Republic of Estonia" },
    Lithuania: { name: "Republic of Lithuania" },
  };
  document.relations = [
    { id: "keep", a: "Estonia", b: "Lithuania", score: 65, status: "friendly", summary: "Friendship" },
    { id: "neutral", a: "Latvian Republic", b: "Estonia", score: 0, status: "neutral", summary: "Established" },
  ];
  const reopened = openStoredDocument({ ...document, regions: emptyRegions });
  assert.deepEqual(reopened.doc.relations, document.relations);
  const unchanged = buildGameSeed(reopened.doc, emptyRegions);
  assert.deepEqual(unchanged.world.relations, document.relations);
  reopened.doc.relationEdits = [{ a: "Latvia", b: "Estonia", score: -30 }];
  const changed = buildGameSeed(reopened.doc, emptyRegions);
  assert.equal(changed.world.relations.length, 2);
  assert.deepEqual(changed.world.relations[0], document.relations[0]);
  assert.deepEqual(changed.world.relations[1], {
    ...document.relations[1], a: "Latvia", b: "Estonia", score: -30, status: "cautious",
  });
  assert.equal(document.relations[1].score, 0, "Source document is immutable during preview");
});

test("draft-first country registration creates scored pairs only after explicit preflight", () => {
  const polities = { Latvia: { name: "Latvia" }, Estonia: { name: "Estonia" } };
  const choices = Object.keys(polities).map((key) => ({ key, name: key }));
  const draft = { ...emptyCountryDraft(), name: "Livonia",
    startingRelations: [{ other: "Latvia", score: "0" }, { other: "Estonia", score: "-100" }] };
  const planned = planCountryDraft({ draft, polities, polityChoices: choices });
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.relationEdits, [
    { a: "Livonia", b: "Latvia", score: 0 }, { a: "Livonia", b: "Estonia", score: -100 },
  ]);
  const registered = { ...polities, Livonia: planned.record };
  const document = createDocument();
  document.polities = registered;
  document.relationEdits = planned.relationEdits;
  const seed = buildGameSeed(document, emptyRegions);
  assert.equal(seed.world.relations.length, 2);
  assert.ok(seed.world.relations.some((row) => row.a === "Livonia" && row.b === "Latvia" && row.score === 0));
  assert.equal(planCountryDraft({ draft: { ...draft, startingRelations: [{ other: "Estonia", score: 101 }] },
    polities, polityChoices: choices }).ok, false);
});

test("native scenario rename precedes deliberate bilateral change and keeps unrelated treaty/canon state", () => {
  const original = {
    polityOverrides: { "Old Latvia": { name: "Old Latvia" }, Estonia: { name: "Estonia" } },
    relations: [{ id: "old", a: "Old Latvia", b: "Estonia", score: -12, sourceEventIds: ["event-1"] }],
    agreements: [{ id: "agreement-1", parties: ["Old Latvia", "Estonia"], type: "trade_economic" }],
    politicalActors: { byPolity: {} },
  };
  const { world: renamed } = scenarioAfterWorkshopRenames(original, { country: "Old Latvia" },
    [{ from: "Old Latvia", to: "Latvia" }]);
  assert.equal(renamed.relations[0].a, "Latvia");
  const applied = applyStartingRelationEdits(renamed.relations, [{ a: "Latvia", b: "Estonia", score: 77 }],
    [{ key: "Latvia" }, { key: "Estonia" }]);
  assert.equal(applied.ok, true);
  assert.equal(applied.relations.length, 1);
  assert.equal(applied.relations[0].id, "old");
  assert.equal(applied.relations[0].score, 77);
  assert.deepEqual(renamed.agreements[0].parties, ["Latvia", "Estonia"]);
  assert.deepEqual(original.agreements[0].parties, ["Old Latvia", "Estonia"]);
});

test("unset only removes a specifically authored pair; untouched native metadata and unrelated pairs remain", () => {
  const original = [
    { a: "Latvia", b: "Estonia", score: 0, id: "erase" },
    { a: "Latvia", b: "Lithuania", score: -13, id: "retain" },
  ];
  const applied = applyStartingRelationEdits(original, [{ a: "Latvia", b: "Estonia", score: null }],
    [{ key: "Latvia" }, { key: "Estonia" }, { key: "Lithuania" }]);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.relations, [original[1]]);
});
