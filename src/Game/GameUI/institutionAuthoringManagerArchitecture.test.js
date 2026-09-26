import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "./InstitutionAuthoringPanel.jsx"), "utf8");

test("scenario institution authoring uses a dedicated OH-style manager", () => {
  assert.match(source, /createPortal/);
  assert.match(source, /data-institution-authoring-manager="true"/);
  assert.match(source, /Manage institutions/);
  assert.match(source, /Search institutions/);
  assert.match(source, /position:\s*"sticky"/);
  assert.match(source, /Identity & lifecycle/);
  assert.match(source, /Starting membership/);
  assert.match(source, /Visual identity/);
});

test("institution manager preserves canonical save and explicit dark select option styling", () => {
  assert.match(source, /worldPatch:\s*\{\s*institutions:/);
  assert.match(source, /upsertScenarioInstitution/);
  assert.match(source, /colorScheme:\s*"dark"/);
  assert.match(source, /const optionStyle/);
  assert.match(source, /<option key=\{kind\} style=\{optionStyle\}/);
  assert.match(source, /BUILTIN_INSTITUTION_LOGOS/);
  assert.match(source, /Upload small logo/);
});

test("institution starting membership is constrained to the canonical scenario polity roster", () => {
  assert.match(source, /collectScenarioPoliticalPolities/);
  assert.match(source, /Search scenario polities for institution membership/);
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /Only canonical polities in this scenario can be added/);
  assert.match(source, /Typing text does not create a membership record/);
  assert.match(source, /Advanced bulk edit member list/);
  assert.match(source, /Unknown names or IDs are rejected/);
});
