// Run: node --test src/Editor/polityRoster.test.js
//
// The Scenario Workshop's bulk polity import (polityRoster.js): a roster JSON
// from the Polities panel, the Province Map Importer's polity rows, or the
// built-in flags the panel fills in. Polity keys are exact, so the key a row
// is filed under decides which country it becomes.

import test from "node:test";
import assert from "node:assert/strict";
import { mergePolityRoster, normalizeRosterRows, parseRosterColor, rosterRowKey } from "./polityRoster.js";

// ---------------------------------------------------------------------------
// Keys

test("a row is keyed by key, stableKey, stable_key, code, id, then name", () => {
  const full = { key: "k", stableKey: "sk", stable_key: "s_k", code: "c", id: "i", name: "n" };
  assert.equal(rosterRowKey(full), "k");
  assert.equal(rosterRowKey({ ...full, key: undefined }), "sk");
  assert.equal(rosterRowKey({ stable_key: "s_k", code: "c", id: "i", name: "n" }), "s_k");
  assert.equal(rosterRowKey({ code: "c", id: "i", name: "n" }), "c");
  assert.equal(rosterRowKey({ id: 7, name: "n" }), "7");
  assert.equal(rosterRowKey({ name: "  Russian Empire  " }), "Russian Empire");
  assert.equal(rosterRowKey({}), "");
  assert.equal(rosterRowKey(null), "");
});

test("a blank key column falls through to the next spelling", () => {
  assert.equal(rosterRowKey({ key: "", code: " ", name: "Kingdom of Italy" }), "Kingdom of Italy");
  assert.equal(rosterRowKey({ key: null, name: "Kingdom of Italy" }), "Kingdom of Italy");
});

test("keys are exact: no folding of case or near names", () => {
  const rows = normalizeRosterRows([{ name: "Russia" }, { name: "russia" }, { name: "Russian Federation" }]);
  assert.deepEqual(rows.map((row) => row.key), ["Russia", "russia", "Russian Federation"]);
});

test("the first row for a key wins and later duplicates are dropped", () => {
  const rows = normalizeRosterRows([
    { key: "Prussia", name: "Kingdom of Prussia" },
    { key: "Prussia", name: "Duplicate" },
    "not a row",
    ["nor", "this"],
    { name: "" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Kingdom of Prussia");
});

// ---------------------------------------------------------------------------
// Fields

test("the name comes from name, displayName, display_name or label, else the key", () => {
  assert.equal(normalizeRosterRows([{ key: "k", displayName: "Shown" }])[0].name, "Shown");
  assert.equal(normalizeRosterRows([{ key: "k", display_name: "Shown" }])[0].name, "Shown");
  assert.equal(normalizeRosterRows([{ key: "k", label: "Shown" }])[0].name, "Shown");
  assert.equal(normalizeRosterRows([{ key: "k", name: "", label: "Shown" }])[0].name, "Shown");
  assert.equal(normalizeRosterRows([{ key: "k" }])[0].name, "k");
});

test("aliases and tags are arrays or pipe-separated strings", () => {
  const [row] = normalizeRosterRows([{
    key: "Ottoman Empire",
    name: "Sublime State",
    aliases: "Turkey| Porte ||Turkey",
    tags: "monarchy|imperial|Monarchy",
  }]);
  assert.deepEqual(row.aliases, ["Ottoman Empire", "Sublime State", "Turkey", "Porte"]);
  assert.deepEqual(row.tags, ["monarchy", "imperial"]);

  const [fromArrays] = normalizeRosterRows([{ key: "k", aliases: ["a", " b "], tags: ["x"] }]);
  assert.deepEqual(fromArrays.aliases, ["k", "a", "b"]);
  assert.deepEqual(fromArrays.tags, ["x"]);
});

test("colours are read from hex or an [r,g,b] array, under any of three spellings", () => {
  assert.deepEqual(parseRosterColor("#8E1B34"), [142, 27, 52]);
  assert.deepEqual(parseRosterColor("8e1b34"), [142, 27, 52]);
  assert.deepEqual(parseRosterColor([300, -5, 12.6, 99]), [255, 0, 13]);
  assert.equal(parseRosterColor("#abc"), null);
  assert.equal(parseRosterColor(["x", 1, 2]), null);
  assert.equal(parseRosterColor(null), null);
  assert.deepEqual(normalizeRosterRows([{ key: "k", rgb: [1, 2, 3] }])[0].color, [1, 2, 3]);
  assert.deepEqual(normalizeRosterRows([{ key: "k", colour: "#010203" }])[0].color, [1, 2, 3]);
});

test("the flag is read from flag, flagUrl, flag_url or flagDataUrl", () => {
  for (const field of ["flag", "flagUrl", "flag_url", "flagDataUrl"]) {
    assert.equal(normalizeRosterRows([{ key: "k", [field]: " data:x " }])[0].flag, "data:x", field);
  }
  assert.equal(normalizeRosterRows([{ key: "k" }])[0].flag, null);
});

// ---------------------------------------------------------------------------
// Merging into a document

const documentWith = (polities, extra = {}) => ({
  id: "doc",
  polities,
  colorOverrides: { Other: [9, 9, 9] },
  flags: {},
  tags: {},
  ...extra,
});

test("a new polity is created with its colour, flag and tags", () => {
  const doc = documentWith({});
  const { doc: next, summary } = mergePolityRoster(doc, [
    { key: "Kingdom of Italy", color: "#008C45", flag: "data:it", tags: ["monarchy"], mapRefs: { gadm0: ["ITA"] } },
  ]);
  assert.deepEqual(next.polities["Kingdom of Italy"], {
    code: "Kingdom of Italy",
    name: "Kingdom of Italy",
    aliases: ["Kingdom of Italy"],
    status: "active",
    note: "",
    mapRefs: { gadm0: ["ITA"] },
  });
  assert.deepEqual(next.colorOverrides, { Other: [9, 9, 9], "Kingdom of Italy": [0, 140, 69] });
  assert.deepEqual(next.flags, { "Kingdom of Italy": "data:it" });
  assert.deepEqual(next.tags, { "Kingdom of Italy": ["monarchy"] });
  assert.deepEqual(summary, { count: 1, created: 1, updated: 0, colors: 1, flags: 1, tags: 1, firstKey: "Kingdom of Italy" });
  assert.equal(next.id, "doc");
  assert.deepEqual(doc.polities, {}, "the input document is not changed");
});

test("re-importing a roster with no status column keeps each polity's status", () => {
  const doc = documentWith({
    "Kingdom of Sardinia": { code: "SAR", name: "Kingdom of Sardinia", aliases: [], status: "defunct", note: "Merged into Italy" },
  });
  const { doc: next, summary } = mergePolityRoster(doc, [{ key: "Kingdom of Sardinia", name: "Kingdom of Sardinia" }]);
  const record = next.polities["Kingdom of Sardinia"];
  assert.equal(record.status, "defunct");
  assert.equal(record.note, "Merged into Italy");
  assert.equal(record.code, "SAR", "an existing code is kept");
  assert.equal(summary.updated, 1);
  assert.equal(summary.created, 0);
});

test("a row that does give a status sets it", () => {
  const doc = documentWith({ Sardinia: { name: "Sardinia", status: "defunct" } });
  const { doc: next } = mergePolityRoster(doc, [{ key: "Sardinia", status: " active " }]);
  assert.equal(next.polities.Sardinia.status, "active");
});

test("aliases merge into the existing ones, and a changed name keeps the old one as an alias", () => {
  const doc = documentWith({ Prussia: { name: "Prussia", aliases: ["Brandenburg"] } });
  const { doc: next } = mergePolityRoster(doc, [{ key: "Prussia", name: "Kingdom of Prussia", aliases: "Preussen" }]);
  assert.equal(next.polities.Prussia.name, "Kingdom of Prussia");
  assert.deepEqual(next.polities.Prussia.aliases, ["Brandenburg", "Prussia", "Kingdom of Prussia", "Preussen"]);
});

test("a row without a colour, flag or tags leaves the existing ones alone", () => {
  const doc = documentWith(
    { Prussia: { name: "Prussia" } },
    { colorOverrides: { Prussia: [1, 2, 3] }, flags: { Prussia: "data:old" }, tags: { Prussia: ["kingdom"] } },
  );
  const { doc: next, summary } = mergePolityRoster(doc, [{ key: "Prussia" }]);
  assert.deepEqual(next.colorOverrides, { Prussia: [1, 2, 3] });
  assert.deepEqual(next.flags, { Prussia: "data:old" });
  assert.deepEqual(next.tags, { Prussia: ["kingdom"] });
  assert.deepEqual([summary.colors, summary.flags, summary.tags], [0, 0, 0]);
});

test("a roster with no usable rows changes nothing", () => {
  const doc = documentWith({ Prussia: { name: "Prussia" } });
  const result = mergePolityRoster(doc, [{}, null, { key: " " }]);
  assert.equal(result.doc, doc);
  assert.deepEqual(result.summary, { count: 0, created: 0, updated: 0, colors: 0, flags: 0, tags: 0, firstKey: "" });
  assert.equal(mergePolityRoster(doc, "not rows").doc, doc);
});
