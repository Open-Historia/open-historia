import assert from "node:assert/strict";
import test from "node:test";

import { buildInstitutionDrafts, institutionDraftButtonLabel } from "./advisorInstitutionDrafts.js";

test("advisor institution drafts accept only bounded explicit formal actions", () => {
  const drafts = buildInstitutionDrafts([
    { type: "table_proposal", institutionId: "mitteleuropa", title: "Romanian Accession Initiative", summary: "Invite Bucharest into the continental economic framework." },
    { type: "submit-proposal", institutionId: "mitteleuropa", proposalId: "romanian-accession-initiative" },
    { type: "vote", institutionId: "mitteleuropa", proposalId: "romanian-accession-initiative", choice: "YES", reason: "Strategic fit." },
    { type: "invite", institutionId: "mitteleuropa", polity: "Kingdom of Romania", requestedStatus: "member", reason: "Broaden the customs area." },
  ]);

  assert.deepEqual(drafts.map((entry) => entry.type), ["table-proposal", "submit-proposal", "vote", "invite"]);
  assert.equal(drafts[0].proposalType, "resolution");
  assert.equal(drafts[2].choice, "yes");
  assert.equal(drafts[3].requestedStatus, "member");
  assert.equal(institutionDraftButtonLabel(drafts[2]), "Vote YES in mitteleuropa");
});

test("advisor institution drafts fail closed on missing ids, invalid votes and unsupported action kinds", () => {
  const drafts = buildInstitutionDrafts([
    { type: "table-proposal", institutionId: "mitteleuropa", title: "" },
    { type: "vote", institutionId: "mitteleuropa", proposalId: "p1", choice: "maybe" },
    { type: "submit-proposal", institutionId: "", proposalId: "p1" },
    { type: "dissolve", institutionId: "mitteleuropa" },
    { type: "invite", institutionId: "mitteleuropa", polity: "Kingdom of Romania", requestedStatus: "emperor" },
  ]);

  assert.deepEqual(drafts, []);
});
