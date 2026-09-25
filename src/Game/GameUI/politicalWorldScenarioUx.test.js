import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("Scenario Politics presents Political World as a player-facing capability, not PWv2", () => {
  const source = read("./PoliticalWorldGenerationPanel.jsx");

  assert.match(source, />Political World<\/div>/);
  assert.match(source, /This scenario has no Political World yet/);
  assert.match(source, /Apply to Scenario/);
  assert.match(source, /Advanced generation settings & repair tools/);
  assert.doesNotMatch(source, /Canonical v2/);
  assert.doesNotMatch(source, /Political World v2 checkpoint/);
  assert.doesNotMatch(source, /Download v2 Diagnostic/);
});

test("Scenario Politics makes institution authoring guided instead of one raw form", () => {
  const source = read("./InstitutionAuthoringPanel.jsx");

  assert.match(source, />Institutions<\/div>/);
  assert.match(source, />Identity<\/div>/);
  assert.match(source, />Members<\/div>/);
  assert.match(source, />Visual identity<\/div>/);
  assert.match(source, /Type a polity name/);
  assert.match(source, /Bulk edit member list/);
  assert.match(source, /Advanced details/);
});

test("Political World status is visible before the longer institution editor", () => {
  const source = read("./libraryBar.jsx");
  const blockStart = source.indexOf('editorSection === "politics"');
  const blockEnd = source.indexOf('editorSection === "stats"', blockStart);
  const politicsBlock = source.slice(blockStart, blockEnd);

  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.ok(politicsBlock.indexOf("<PoliticalWorldGenerationPanel") < politicsBlock.indexOf("<InstitutionAuthoringPanel"));
  assert.match(source, /politics: "No world"/);
  assert.match(source, /politics: "Partial"/);
});

test("applying Political World preserves unrelated canonical world ledgers such as Puppet relationships", () => {
  const source = read("./PoliticalWorldGenerationPanel.jsx");

  assert.match(source, /const freshWorld = freshDetails\?\.data\?\.world \?\? \{\}/);
  assert.match(source, /world:\s*\{\s*\.\.\.freshWorld,\s*politicalActors: application\.politicalActors/);
});
