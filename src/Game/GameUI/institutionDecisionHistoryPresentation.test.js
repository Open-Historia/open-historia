import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("closed institution decisions restore formal record presentation and vote tallies", () => {
  const source = read("./InstitutionsWorkspace.jsx");

  assert.match(source, /const DecisionCard = \(\{ proposal \}\) =>/);
  assert.match(source, /data-institution-decision-card="formal"/);
  assert.match(source, /Formal decision/);
  assert.match(source, /Institutional record/);
  assert.match(source, /Passed, failed and implemented matters are preserved as formal history rather than buried in chat/);
  assert.match(source, /data-institution-decision-tally="true"/);
  assert.match(source, /\[\["yes", "For"\], \["no", "Against"\], \["abstain", "Abstain"\], \["veto", "Veto"\]\]/);
});

test("closed ballots can be expanded to inspect each recorded government position and rationale", () => {
  const source = read("./InstitutionsWorkspace.jsx");

  assert.match(source, /View"\} recorded member positions/);
  assert.match(source, /data-institution-recorded-positions-toggle="true"/);
  assert.match(source, /data-institution-recorded-positions="expanded"/);
  assert.match(source, /ballot\.polity/);
  assert.match(source, /ballot\.choice/);
  assert.match(source, /ballot\.government/);
  assert.match(source, /ballot\.reason \|\| "No recorded public rationale\."/);
  assert.match(source, /ballot\.date/);
});

test("decision history remains post-closure only and does not expose live secret ballots", () => {
  const view = fs.readFileSync(new URL("../../runtime/institutionalDiplomacyView.js", import.meta.url), "utf8");

  assert.match(view, /closedBallots: voting\?\.outcome && lower\(proposal\?\.status\) !== "voting"/);
  assert.match(view, /reason: clean\(entry\?\.reason\)/);
});
