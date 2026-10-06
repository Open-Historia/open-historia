import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("Scenario Politics exposes a dedicated manual Political World authoring manager", () => {
  const library = read("./libraryBar.jsx");
  const panel = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(library, /PoliticalWorldAuthoringPanel/);
  assert.match(panel, />Manual Political World authoring</);
  assert.match(panel, />Manage Political World</);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /Search scenario polities/);
});

test("Scenario Political World authoring writes only the canonical politicalActors ledger", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /applyPoliticalEditorStateToWorld\(nextWorld, selectedKey, draft\)/);
  assert.match(source, /worldPatch:\s*\{ politicalActors: nextWorld\.politicalActors \}/);
  assert.doesNotMatch(source, /countryStats\s*:/);
  assert.doesNotMatch(source, /politicsStats/);
});

test("Scenario Political World authoring uses the canonical trait registry and preserves unset values", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /POLITICAL_TRAIT_REGISTRY/);
  assert.match(source, /canonicalPoliticalTraitKey/);
  assert.match(source, /normalizePoliticalTraitValue/);
  assert.match(source, /Blank means <strong>not specified<\/strong>, not 0/);
  assert.match(source, /politicalActorToEditorState/);
});

test("Scenario Political World selects use explicit dark option colors", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /backgroundColor: "#1a1b1f"/);
  assert.match(source, /color: "#f8fafc"/);
  assert.match(source, /<option style=\{optionStyle\}/);
});


test("editable stable party and bloc IDs are not used as React row keys", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");
  assert.match(source, /key=\{party\._editorKey/);
  assert.match(source, /key=\{bloc\._editorKey/);
  assert.doesNotMatch(source, /key=\{party\.id \|\| index\}/);
  assert.doesNotMatch(source, /key=\{bloc\.id \|\| index\}/);
});

test("Scenario Political World authoring uses player-facing language instead of internal ledger jargon", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /starting political facts/);
  assert.match(source, /Save Political World/);
  assert.match(source, /Political traits · full supported catalog/);
  assert.match(source, /Advanced saved state · read-only/);
  assert.doesNotMatch(source, /canonical world\.politicalActors ledger/);
  assert.doesNotMatch(source, />Save Political Actor</);
  assert.doesNotMatch(source, /Political Actor saved to scenario canon/);
  assert.doesNotMatch(source, /Full saved Political Actor JSON/);
});

test("Scenario Political World authoring can delete a profile without deleting the polity", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /removePoliticalActorFromWorld/);
  assert.match(source, />Delete Political World profile<\/button>/);
  assert.match(source, /This does not delete the polity or its map territory/);
  assert.match(source, /worldPatch:\s*\{ politicalActors: removed\.world\.politicalActors \}/);
});

test("Workshop polity renames and removals are replayed into canonical Political World state on scenario save", () => {
  const library = read("./libraryBar.jsx");
  const mapEditor = read("../../Editor/MapEditor.jsx");

  assert.match(mapEditor, /polityAuthoringOpsRef/);
  assert.match(mapEditor, /op: "rename", from, to/);
  assert.match(mapEditor, /op: "remove", key/);
  assert.match(mapEditor, /polityAuthoringOps:/);
  assert.match(library, /reconcileMapPolityAuthoringOps\(currentWorld, seed\.polityAuthoringOps\)/);
  assert.match(library, /\.\.\.reconciledWorld/);
});
