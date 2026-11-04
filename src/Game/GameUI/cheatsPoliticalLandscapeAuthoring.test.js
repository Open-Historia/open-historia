import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () => readFileSync(new URL("./cheats.jsx", import.meta.url), "utf8");

test("Cheats Country Editor exposes the same canonical legislature and party fields as scenario authoring", () => {
  const ui = source();
  assert.match(ui, /politicsPairedField\("Legislature", "legislature"\)/);
  assert.match(ui, /politicsPairedField\("Legislature seats", "legislatureSeats"/);
  assert.match(ui, /politicsPairedField\("Next election", "nextElection"\)/);
  for (const label of ["Native name", "Native abbreviation", "Ideology family", "Subideology", "Party role", "Seats held", "Founded", "Party colour (hex)"]) {
    assert.ok(ui.includes(label), `missing ${label}`);
  }
});

test("Cheats Country Editor reuses canonical political composition validation and role membership", () => {
  const ui = source();
  assert.match(ui, /politicalEditorComposition\(politicsForm, \{ asRecorded: baseline\?\.politics \|\| null \}\)/);
  assert.match(ui, /applyPoliticalEditorStateToWorld\(world, target, politicsForm\)/);
  assert.match(ui, /if \(key === "role"\)/);
  assert.match(ui, /ruling: value === "governing"/);
  assert.match(ui, /coalition: value === "coalition"/);
  assert.match(ui, /PARTY_ROLE_LABELS/);
  assert.doesNotMatch(ui, /changeParty\(index, "ruling"/);
  assert.doesNotMatch(ui, /changeParty\(index, "coalition"/);
});
