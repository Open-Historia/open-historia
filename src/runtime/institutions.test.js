// Run: node --test src/runtime/institutions.test.js
//
// Institution dates go through runtime/gameDates.js: BC years, and a founding
// known only to the year, compare by the calendar.

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInstitutionRecord,
  normalizeInstitutions,
  validateInstitutionTemporalBaseline,
  validateInstitutionUpdates,
} from "./institutions.js";

const league = (overrides = {}) => ({ id: "league-of-corinth", name: "League of Corinth", foundedDate: "-0338", ...overrides });

test("a BC institution founded before the scenario, known only to the year, is valid", () => {
  const result = validateInstitutionTemporalBaseline({ institution: league(), scenarioDate: "-0336-06-01", membershipDate: "-0337-03-01" });
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.membershipDate, "-0337-03-01");
});

test("a BC institution founded after the scenario, or dissolved by it, is refused", () => {
  assert.match(validateInstitutionTemporalBaseline({ institution: league({ foundedDate: "-0300-01-01" }), scenarioDate: "-0336-06-01" }).reason, /not founded until -0300-01-01/);
  assert.match(validateInstitutionTemporalBaseline({ institution: league({ dissolvedDate: "-0337" }), scenarioDate: "-0336-06-01" }).reason, /already dissolved/);
  assert.equal(validateInstitutionTemporalBaseline({ institution: league({ dissolvedDate: "-0336-12" }), scenarioDate: "-0336-06-01" }).valid, true, "a year-month end runs to the month's last day");
});

test("a BC accession after the scenario date is refused", () => {
  const result = validateInstitutionTemporalBaseline({ institution: league(), scenarioDate: "-0336-06-01", membershipDate: "-0335-01-01" });
  assert.equal(result.valid, false);
  assert.match(result.reason, /membership does not begin until -0335-01-01/);
});

test("1 January 1970 is a date like any other", () => {
  const result = validateInstitutionTemporalBaseline({ institution: { id: "x", name: "X", foundedDate: "1970-01-01" }, scenarioDate: "1970-01-01" });
  assert.equal(result.valid, true, result.reason);
  assert.match(validateInstitutionTemporalBaseline({ institution: { id: "x", name: "X", foundedDate: "1971-01-01" }, scenarioDate: "1970-01-01" }).reason, /not founded until/);
});

test("the baseline accepts a BC join dated before it and refuses one after it", () => {
  const world = {
    ownerCodes: ["Macedon", "Athens"],
    polityOverrides: { Macedon: { name: "Macedon" }, Athens: { name: "Athens" } },
    institutions: { byId: { "league-of-corinth": { id: "league-of-corinth", name: "League of Corinth", foundedDate: "-0338", members: [] } } },
  };
  const join = (sinceDate) => validateInstitutionUpdates([{ op: "join", id: "league-of-corinth", polity: "Athens", status: "member", sinceDate }], {
    world, allowUnboundBaseline: true, enforceTemporalBaseline: true, baselineDate: "-0336-06-01",
  });
  assert.equal(join("-0337-03-01"), "");
  assert.match(join("-0335-01-01"), /after\/invalid for baseline -0336-06-01/);
});

test("an old save's agenda-activity counters are dropped on load", () => {
  const record = normalizeInstitutionRecord({
    id: "baltic-union",
    name: "Baltic Union",
    members: [{ polity: "Republic of Latvia", status: "member" }],
    governanceActivity: { lastAgendaDate: "2015-01-01", lastAgendaRound: 4, lastAgendaOutcome: "none", consecutiveEmptyAgendaChecks: 3 },
  });
  assert.equal("governanceActivity" in record, false);
  const ledger = normalizeInstitutions({ byId: { council: { name: "Council", agendaActivity: { consecutiveEmptyAgendaChecks: 2 } } } });
  assert.equal("governanceActivity" in ledger.byId.council, false);
  assert.equal("agendaActivity" in ledger.byId.council, false);
});
