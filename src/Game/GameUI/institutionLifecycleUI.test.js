import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("Institutions workspace exposes a live founding wizard instead of scenario-authoring-only creation", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /data-institution-founding-wizard="true"/);
  assert.match(source, /＋ Found institution/);
  assert.match(source, /Political character/);
  assert.match(source, /Geographic scope/);
  assert.match(source, /Primary threat \/ adversary model/);
  assert.match(source, /Invite founding governments/);
  assert.match(source, /data-polity-multi-picker="true"/);
  assert.match(source, /data-polity-picker-results="true"/);
  assert.match(source, /Search governments…/);
  assert.match(source, /Selected governments are stored by their exact scenario identity/);
  assert.match(source, /Member vote required/);
  assert.match(source, /Direct after acceptance/);
  assert.match(source, /Notice required/);
  assert.match(source, /Formal vote permitted/);
  assert.match(source, /commitInstitutionLifecycleCommand/);
  assert.match(source, /if \(result\?\.createdChat\) onOpenLifecycleChat\?\.\(result\.createdChat, result\)/);
});

test("membership lifecycle controls remain native formal actions and cover accession, invitation, withdrawal, discipline and dissolution", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /data-institution-accession-controls="true"/);
  assert.match(source, /Request membership/);
  assert.match(source, /Request observer status/);
  assert.match(source, /Send invitation/);
  assert.match(source, /Withdraw from institution/);
  assert.match(source, /Propose suspend/);
  assert.match(source, /Propose reinstate/);
  assert.match(source, /Propose expel/);
  assert.match(source, /Propose dissolution/);
  assert.match(source, /Membership constitution/);
  assert.match(source, /Membership history/);
});

test("institution invitation chats explicitly remain negotiations whose AI response is requested through the existing diplomacy turn", () => {
  const source = read("./chat.jsx");
  assert.match(source, /isLifecycleConversation/);
  assert.match(source, /Institution membership negotiation/);
  assert.match(source, /Continue hearing →/);
  assert.match(source, /Institution accession hearing/);
  assert.match(source, /runGroupTurn\("", messagesRef\.current/);
  assert.match(source, /lifecycleApplied/);
  assert.match(source, /!chat\.institutionId \|\| \(chat\.lifecycleInstitutionId && chat\.lifecycleCaseIds\?\.length\)/);
});

test("country political overview projects canonical institution portfolio and lifecycle history", () => {
  const stats = read("./stats.jsx");
  const overview = read("./PoliticalOverview.jsx");
  assert.match(stats, /institutionPortfolioForPolity/);
  assert.match(stats, /institutions=\{worldSnapshot \? institutionPortfolioForPolity\(worldSnapshot, targetCountry, \{ viewerPolity: player\.code \}\) : \[\]\}/);
  assert.match(overview, /const InstitutionPortfolio/);
  assert.match(overview, /Canonical memberships and institutional history/);
  assert.match(overview, /pending lifecycle matter/);
});


test("founder can reopen pending foreign lifecycle negotiations from institution cards", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /ensureInstitutionLifecycleNegotiationChat/);
  assert.match(source, /canOpenNegotiation=/);
  assert.match(source, /Open negotiation →/);
  assert.match(source, /onOpenNegotiation=/);
});

test("only the lifecycle case actually clicked renders Opening while a grouped negotiation is being recovered", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /opening=\{busy === `open-lifecycle:\$\{entry\.id\}`\}/);
  assert.match(source, /\{opening \? "Opening…" : "Open negotiation →"\}/);
});


test("Request response is an explicit lifecycle-decision request rather than a generic silent chat pulse", () => {
  const source = read("./chat.jsx");
  assert.match(source, /lifecycleResponseRequested = false/);
  assert.match(source, /runGroupTurn\("", messagesRef\.current, \{ lifecycleResponseRequested: true \}\)/);
});


test("group lifecycle loading shows a neutral table-level indicator instead of blaming the first country", () => {
  const source = read("./chat.jsx");
  assert.match(source, /data-lifecycle-group-thinking="true"/);
  assert.match(source, /lifecycleGroupThinking = isLifecycleConversation && isLoading && !speakingCountry && !stagedLifecycleSpeaker && countries\.length > 1/);
  assert.match(source, /Considering membership/);
  assert.match(source, /!lifecycleGroupThinking \? countries\[0\] : null/);
});

test("both overview and members lifecycle cards track Opening state by exact case id", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  const matches = source.match(/opening=\{busy === `open-lifecycle:\$\{entry\.id\}`\}/g) ?? [];
  assert.ok(matches.length >= 2, `expected card-specific opening state in both lifecycle surfaces, got ${matches.length}`);
});

test("resolved membership negotiations replace Request response with a canonical outcome panel", () => {
  const source = read("./chat.jsx");
  assert.match(source, /data-lifecycle-outcome-panel="true"/);
  assert.match(source, /Membership negotiation concluded/);
  assert.match(source, /lifecycleCanRequestResponse/);
  assert.match(source, /lifecycleNegotiationConcluded/);
  assert.match(source, /lifecycleState\.responseCases\.length === 0/);
  assert.match(source, /View institution →/);
});

test("lifecycle batch replies are staged after one canonical group request", () => {
  const source = read("./chat.jsx");
  assert.match(source, /buildLifecycleReplyRevealPlan/);
  assert.match(source, /presentCommittedLifecycleReplies/);
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, row\.gapMs\)\)/);
  assert.match(source, /stagedLifecycleSpeaker/);
});
