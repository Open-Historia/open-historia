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
  assert.match(source, /Identity & lifecycle/);
  assert.match(source, /Starting membership/);
  assert.match(source, /Visual identity/);
  assert.match(source, /Manage institutions/);
  assert.match(source, /data-institution-authoring-manager="true"/);
  assert.match(source, /Search scenario polities/);
  assert.match(source, /Only canonical polities in this scenario can be added/);
  assert.match(source, /Advanced bulk edit member list/);
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

test("Political World generation recovery is plain-language and polity-oriented", () => {
  const source = read("./PoliticalWorldGenerationPanel.jsx");

  assert.match(source, /v2UnresolvedPolityKeys = \[\.\.\.new Set\(v2Unresolved\.map/);
  assert.match(source, /generatePoliticalWorld\(\{ retryDeferred: v2NeedsRetry \}\)/);
  assert.match(source, /"Continue Generation"/);
  assert.match(source, /polities ready/);
  assert.match(source, /AI request/);
  assert.match(source, /Completed work is saved/);
  assert.match(source, /Continue Generation retries only unfinished polities/);
  assert.match(source, /Political World added to scenario -/);
  assert.match(source, />Pause<\/button>/);
  assert.match(source, /Progress is saved as you go\. You can pause and continue later\./);
  assert.match(source, /width: `\$\{progressReadyPercent\}%`/);
  assert.doesNotMatch(source, /Cancel pauses the run/);
  assert.doesNotMatch(source, />Retry Deferred Targets</);
  assert.doesNotMatch(source, /stubborn target\(s\)/);
  assert.doesNotMatch(source, /AI call\(s\) total/);
});
