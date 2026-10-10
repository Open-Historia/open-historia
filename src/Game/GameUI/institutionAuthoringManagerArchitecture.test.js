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

// The manager suggests the scenario's own polities for a member. A name that is
// not among them is kept as written and flagged beside the list, never refused:
// a stock-map scenario's roster is not every country its author may name, and a
// refusal there turned real countries away (institutionAuthoring.js).
test("institution starting membership is suggested from the scenario's polity roster, and an unlisted name is flagged, not refused", () => {
  assert.match(source, /collectScenarioPoliticalPolities/);
  assert.match(source, /<PolityMultiPicker allowUnlisted label="Type a polity name"/);
  assert.match(source, /unmatchedInstitutionMembers\(memberNames, world\)/);
  assert.match(source, /Advanced bulk edit member list/);
  assert.match(source, /One polity name per line/);
  assert.doesNotMatch(source, /Unknown names or IDs are rejected/);
});
