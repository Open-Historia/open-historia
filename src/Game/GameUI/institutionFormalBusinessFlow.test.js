import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("institution agenda offers an explicit debate-first or immediate-vote path", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /data-institution-table-proposal="true"/);
  assert.match(source, /Open for debate/);
  assert.match(source, /Put to vote now/);
  assert.match(source, /createProposal\("debate"\)/);
  assert.match(source, /createProposal\("vote"\)/);
  assert.match(source, /onRequestCouncilTurn\?\.\(\{ institutionId, proposalId, kind: mode === "vote" \? "vote" : "debate"/);
});

test("a sponsor can call a native vote with an optional Council closing comment", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /data-institution-call-vote="true"/);
  assert.match(source, /Closing comment before the vote \(optional\)/);
  assert.match(source, />Call vote<\/button>/);
  assert.match(source, /commitInstitutionalPlayerVoteRequest/);
  assert.match(source, /playerComment, source: "call-vote"/);
});

test("live Council automation keeps one chatActions request and never revives a selector request", () => {
  const source = read("./chat.jsx");
  assert.match(source, /const runInstitutionCouncilTurn = async/);
  assert.match(source, /institutionDebateRequested: mode === "debate"/);
  assert.match(source, /formalBusinessRequested: mode === "vote"/);
  assert.match(source, /formalBusinessInteractive: mode === "vote"/);
  assert.match(source, /institutionProposalId: proposal/);
  assert.match(source, /commitInstitutionalPlayerMessage/);
  assert.match(source, /const expectedGameId = String\(getLibraryState\(\)\?\.activeGameId \|\| ""\);[\s\S]*if \(Number\(delayMs\) > 0\)/);
  assert.match(source, /onRequestCouncilTurn=\{runInstitutionCouncilTurn\}/);
  assert.doesNotMatch(source, /chooseNextDiplomaticSpeaker/);
});

test("background Council automation publishes its committed channel into the live Diplomacy state", () => {
  const source = read("./chat.jsx");
  assert.match(source, /else if \(result\?\.channel\) \{/);
  assert.match(source, /const committedChannel = result\.channel/);
  assert.match(source, /setChats\(\(prev\) => \{[\s\S]*next\[index\] = committedChannel/);
  assert.match(source, /adoptInstitutionalResult\(\{ \.\.\.result, channel: result\?\.channel \|\| materialized\.channel \}\)/);
});

test("accepted lifecycle cases can immediately hand their exact accession ballot to Council processing", () => {
  const source = read("./chat.jsx");
  const gameplay = read("../AI/gameplay.js");
  const triggers = source.match(/onInstitutionBusinessOpened\?\.\(\{/g) ?? [];
  assert.ok(triggers.length >= 2, `expected AI and player lifecycle acceptance triggers, got ${triggers.length}`);
  assert.match(source, /source: "lifecycle-acceptance"/);
  assert.match(source, /proposalId: openedVote\.id/);
  assert.match(source, /proposalId: result\.proposal\.id/);
  assert.match(source, /onInstitutionBusinessOpened=\{runInstitutionCouncilTurn\}/);
  assert.match(gameplay, /if \(stored\.institutionId && !lifecycleGovernanceThread\) \{[\s\S]*commitInstitutionalChatGovernanceBatch/);
  assert.match(gameplay, /else if \(stored\.lifecycleInstitutionId && lifecycleActions\.length\) \{[\s\S]*commitInstitutionLifecycleChatBatch/);
});

test("gameplay separates opening debate from interactive native ballots and targets an exact proposal", () => {
  const source = read("../AI/gameplay.js");
  assert.match(source, /institutionDebateRequested = false/);
  assert.match(source, /formalBusinessInteractive = false/);
  assert.match(source, /institutionBallotWorkForProposal\(bundle\.world, stored\.institutionId, institutionProposalId, player/);
  assert.match(source, /interactiveInstitutionBallotDirective\(autonomousBallotWork\)/);
  assert.match(source, /do NOT lodge a duplicate and do NOT submit it for voting yet/);
});
