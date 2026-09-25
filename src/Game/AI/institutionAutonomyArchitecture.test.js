import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("completed turns run a bounded autonomous institution ballot pass through existing chatActions", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /export const runPostTurnInstitutionBallots/);
  assert.match(gameplay, /formalBusinessRequested: true/);
  assert.match(gameplay, /useCanonicalState: true/);
  assert.match(gameplay, /await runPostTurnInstitutionBallots\(/);
  assert.match(gameplay, /completed turn remains committed/i);
  assert.match(gameplay, /maxInstitutions: 4/);
  assert.match(gameplay, /jumpTaskOptions\(requests, "institutionBallots"\)/);
  assert.match(gameplay, /requests: state\.requests/);
});

test("autonomous ballot requests are charged to the same completed-turn request budget", () => {
  const budget = read("./requestBudget.js");
  assert.match(budget, /"institutionBallots"/);
  assert.match(budget, /unresolved NPC formal ballots after the new turn is canonical/i);
});

test("autonomous formal pass targets only unresolved voters and keeps player sovereignty", () => {
  const gameplay = read("./gameplay.js");
  const autonomy = read("./institutionAutonomy.js");
  assert.match(gameplay, /autonomousBallotActors/);
  assert.match(gameplay, /!formalBusinessRequested \|\| autonomousBallotActors\.has/);
  assert.match(autonomy, /filter\(\(polity\) => lower\(polity\) !== lower\(playerCountry\)\)/);
  assert.match(autonomy, /recorded\.has/);
  assert.match(autonomy, /Native governance independently validates every ballot and prevents duplicates/);
});

test("Institution UI explains immediate Council ballots and the post-turn safety net", () => {
  const ui = read("../GameUI/InstitutionsWorkspace.jsx");
  assert.match(ui, /one bounded Council round immediately prompts unresolved eligible AI ballots/i);
  assert.match(ui, /post-turn follow-up/i);
});
