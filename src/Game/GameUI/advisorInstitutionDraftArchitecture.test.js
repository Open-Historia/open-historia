import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("Advisor formal institution actions are typed drafts with an explicit player-click authority boundary", () => {
  const ai = read("../AI/main.jsx");
  const ui = read("./advisor.jsx");

  assert.match(ai, /ADVISOR_INSTITUTION_DRAFT_DIRECTIVE/);
  assert.match(ai, /institutiondraft/);
  assert.match(ai, /DRAFT ONLY/);
  assert.match(ai, /follow the charter's lifecycle/);

  assert.match(ui, /extractFencedJson\(afterDrafts, "institutiondraft", \{ streaming \}\)/);
  assert.match(ui, /buildInstitutionDrafts\(institutionDraftsRaw\)/);
  assert.match(ui, /AdvisorInstitutionDraftAction/);
  assert.match(ui, /onExecute=\{\(\) => onExecuteInstitutionDraft\(msgIndex, draftIndex, draft\)\}/);
  assert.match(ui, /handleExecuteInstitutionDraft = React\.useCallback/);
  assert.match(ui, /commitInstitutionalPlayerProposal/);
  assert.match(ui, /commitInstitutionalPlayerVoteRequest/);
  assert.match(ui, /commitInstitutionGovernanceCommand/);
  assert.match(ui, /commitInstitutionLifecycleCommand/);
  assert.match(ui, /authority: "player"/);
});

test("Advisor institution draft execution reuses the same native proposal, ballot and invitation seams as the Institutions workspace", () => {
  const advisor = read("./advisor.jsx");
  const workspace = read("./InstitutionsWorkspace.jsx");

  for (const seam of [
    "commitInstitutionalPlayerProposal",
    "commitInstitutionalPlayerVoteRequest",
    "commitInstitutionGovernanceCommand",
    "commitInstitutionLifecycleCommand",
  ]) {
    assert.match(advisor, new RegExp(seam));
    assert.match(workspace, new RegExp(seam));
  }
});
