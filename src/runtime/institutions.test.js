import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInstitutionRecord, normalizeInstitutions } from "./institutions.js";

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
