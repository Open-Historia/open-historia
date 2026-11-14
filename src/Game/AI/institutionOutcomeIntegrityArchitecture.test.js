import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const governance = fs.readFileSync(new URL("../../runtime/institutionalGovernance.js", import.meta.url), "utf8");

// A time skip's answer was refused, on any attempt, when an event's words read
// as an institution adopting or rejecting one of its open proposals: English
// verbs ("adopts", "ratifies", "vetoes") and tokens of the proposal's title.
// "L'UE adopte le cadre" passed, and "Austria supports the framework's
// adoption" needed its own exception. The ballot owns a proposal's outcome
// (institutionalGovernance.js writes the outcome event when it closes), and an
// event's words never change a proposal's status, so nothing is refused.
test("formal institution outcomes belong to the native ballot, and no answer is refused for its words", () => {
  assert.doesNotMatch(gameplay, /generatedInstitutionOutcomeIntegrityIssue|institutionOutcomeIntegrity\.js|institutionOutcomeError/);
  assert.match(governance, /const appendProposalOutcomeEvent = /);
});
