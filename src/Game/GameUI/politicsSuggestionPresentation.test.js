import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizePoliticalChanges } from "./politicsSuggestionPresentation.js";

const court = {
  id: "imperial-court", name: "Imperial Court, Dynasty and Common Ministries",
  shortName: "Imperial Court", politicalResponse: { source: "generated", depth: "rich" },
};

test("screenshot regression: Political World generation provenance never occupies visible review rows", () => {
  const before = { powerBlocs: [court] };
  const after = {
    generationProvenance: {
      byPath: { "powerBlocs[imperial-court].politicalResponse": {
        source: "generated", scenarioDate: "1911-10-08", depth: "rich", confidence: "high",
      } },
    },
    powerBlocs: [{ ...court, politicalResponse: { ...court.politicalResponse, confidence: "high" } }],
  };
  const result = summarizePoliticalChanges({ kind: "politics", field: "politicalActors", from: before, to: after });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].label, "Power blocs");
  assert.equal(result.rows[0].type, "collection");
  assert.deepEqual(result.rows[0].edits, [{
    operation: "updated", names: ["Imperial Court, Dynasty and Common Ministries"], remaining: 0,
  }]);
  assert.equal(result.hiddenCount, 0);
  assert.doesNotMatch(JSON.stringify(result), /generationProvenance|byPath|imperial-court|scenarioDate|confidence/);
});

test("a metadata-only patch does not pretend generated bookkeeping was a political change", () => {
  const result = summarizePoliticalChanges({
    from: { generationProvenance: { source: "initial" }, schemaVersion: 1 },
    to: { generationProvenance: { source: "generated" }, schemaVersion: 2 },
  });
  assert.deepEqual(result.rows, []);
  assert.equal(result.bookkeepingOnly, true);
});

test("power blocs and parties show named additions, removals and updates rather than record JSON", () => {
  const result = summarizePoliticalChanges({
    from: { powerBlocs: [court, { id: "old", name: "Old Chamber" }], parties: [{ id: "party-x", name: "Party X" }] },
    to: { powerBlocs: [{ ...court, name: "Imperial Court Reorganized" }, { id: "new", name: "New Chamber" }], parties: [] },
  });
  assert.deepEqual(result.rows.map((row) => row.label), ["Power blocs", "Political parties"]);
  assert.deepEqual(result.rows[0].edits.map((edit) => edit.operation), ["added", "removed", "updated"]);
  assert.equal(result.rows[0].edits[0].names[0], "New Chamber");
  assert.equal(result.rows[0].edits[1].names[0], "Old Chamber");
  assert.equal(result.rows[0].edits[2].names[0], "Imperial Court Reorganized");
  assert.equal(result.rows[1].edits[0].names[0], "Party X");
});

test("non-collection changes use readable labels and never dump nested JSON or raw unknown paths", () => {
  const result = summarizePoliticalChanges({
    from: { governmentForm: "Monarchy", politicalResponse: { pressure: 20 }, experimentalEngineField: { x: 1 } },
    to: { governmentForm: "Republic", politicalResponse: { pressure: 70 }, experimentalEngineField: { x: 3 } },
  });
  assert.deepEqual(result.rows.map((r) => r.label), ["Government form", "Political response", "Political details"]);
  assert.equal(result.rows[0].before, "Monarchy");
  assert.equal(result.rows[0].after, "Republic");
  assert.equal(result.rows[1].type, "details");
  assert.equal(result.rows[2].type, "details");
  assert.doesNotMatch(JSON.stringify(result.rows.map(({ key: _key, ...visible }) => visible)), /experimentalEngineField/);
});

test("the reviewer limits actual meaningful changes, not bookkeeping, and never shows stable IDs as names", () => {
  const result = summarizePoliticalChanges({
    from: {},
    to: {
      generationProvenance: { byPath: { "a.b": { source: "generated" } } },
      parties: [{ id: "secret-id-123", ideology: "liberal" }],
      powerBlocs: [{ id: "imperial-court" }],
      governmentForm: "Empire",
      goals: ["Protect stability"],
      fears: ["Unrest"],
      ambitions: ["Reform"],
    },
  }, { max: 3 });
  assert.equal(result.rows.length, 3);
  assert.equal(result.hiddenCount, 3);
  const names = result.rows.filter((r) => r.type === "collection").flatMap((r) => r.edits.flatMap((edit) => edit.names));
  assert.ok(names.every((name) => name === "Unnamed entry"));
  assert.doesNotMatch(JSON.stringify(result), /secret-id-123|imperial-court|generationProvenance/);
});

test("Russian pack has native translations for the Politics review labels", () => {
  const ru = JSON.parse(readFileSync(new URL("../../../public/lang/ru.json", import.meta.url), "utf8"));
  for (const label of ["Power blocs", "Political response", "Political details", "Order changed", "Details updated", "Unnamed entry", "More political changes not shown:"]) {
    assert.match(ru[label] || "", /[А-Яа-яЁё]/, label);
  }
});
test("the UI only blocks translation on authored names and values, not the explanatory labels", () => {
  const source = readFileSync(new URL("./ScenarioSuggestions.jsx", import.meta.url), "utf8");
  assert.match(source, /summarizePoliticalChanges/);
  assert.match(source, /change\.kind === "politics"/);
  assert.match(source, /data-no-translate[^>]*>[^<]*\{name\}/);
  assert.doesNotMatch(source, /data-no-translate key=\{entry\.path\}/);
});
