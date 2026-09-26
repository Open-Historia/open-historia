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
  assert.match(source, /Blank means <strong>unset<\/strong>, not 0/);
  assert.match(source, /politicalActorToEditorState/);
});

test("Scenario Political World selects use explicit dark option colors", () => {
  const source = read("./PoliticalWorldAuthoringPanel.jsx");

  assert.match(source, /backgroundColor: "#1a1b1f"/);
  assert.match(source, /color: "#f8fafc"/);
  assert.match(source, /<option style=\{optionStyle\}/);
});
