import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("Institutions is restored as a first-class Diplomacy panel tab", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /import InstitutionsWorkspace, \{ Emblem as InstitutionEmblem, Facts as InstitutionFacts, SmallPill as InstitutionPill \} from "\.\/InstitutionsWorkspace\.jsx"/);
  assert.match(chat, /\[\["chats", "Diplomacy"\], \["institutions", institutionUnreadCount \?/);
  assert.match(chat, /currentView === "institutions"/);
  assert.match(chat, /<InstitutionsWorkspace/);
  assert.match(chat, /const openChats = allOpenChats\.filter\(\(chat\) => !chat\.institutionId\)/);
});

test("institution workspace restores browser, logos, governance and documents", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /listInstitutionDiplomacyViews/);
  assert.match(source, /listAllInstitutionDiplomacyViews/);
  assert.match(source, /institutionLogoUrl/);
  assert.match(source, /ensureInstitutionalChannel/);
  assert.match(source, /commitInstitutionalPlayerProposal/);
  assert.match(source, /commitInstitutionalPlayerVoteRequest/);
  assert.match(source, /commitInstitutionGovernanceCommand/);
  assert.match(source, /documentsReadableBy/);
  assert.match(source, /Your institutions/);
  assert.match(source, /View all/);
  assert.match(source, /Agenda/);
  assert.match(source, /Members/);
  assert.match(source, /Charter/);
  assert.match(source, /Decisions/);
  assert.match(source, /Documents/);
  assert.match(source, /Council/);
});

test("institution council remains on Beta one-request diplomacy with native formal authority", () => {
  const gameplay = read("../AI/gameplay.js");
  assert.match(gameplay, /const formalInstitutionPrompt = stored\.institutionId/);
  assert.match(gameplay, /partitionInstitutionChatActions/);
  assert.match(gameplay, /commitInstitutionalChatGovernanceBatch/);
  assert.match(gameplay, /PRIVATE GOVERNMENT DOCUMENTS - COMPARTMENTALIZED/);
  assert.match(gameplay, /Never reveal another participant's private papers/);
  assert.match(gameplay, /Do not use add_member\/remove_member in this channel/);
});

test("formal institution council channels cannot be deleted like disposable diplomacy", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /const isInstitutional = Boolean\(chat\?\.institutionId\)/);
  assert.match(chat, /Institutional councils are canonical records and intentionally expose no delete control/);
  assert.match(chat, /Institution record/);
  assert.match(chat, /Council message/);
  assert.match(chat, /Formal business →/);
});


test("Diplomacy uses the restored workspace-sized shell", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /width: "min\(58rem, calc\(100vw - 1rem\)\)"/);
  assert.match(chat, /height: "min\(50rem, calc\(100vh - 8rem\)\)"/);
  assert.doesNotMatch(chat, /width: "26\.25rem"/);
});

test("Council is always visible and opens the persistent council chat directly for members", () => {
  const source = read("./InstitutionsWorkspace.jsx");
  assert.match(source, /\["overview", "Overview"\], \["council", "Council"\]/);
  assert.match(source, /flexWrap: "wrap"/);
  assert.match(source, /key === "council" && selectedRow\.member \? openCouncil\(\) : setSection\(key\)/);
  assert.match(source, /channelByInstitution\.get\(clean\(selectedView\.institution\.id\)\)/);
});


test("institution council keeps the governance-sized Continuum presentation over Beta chat mechanics", () => {
  const chat = read("./chat.jsx");
  assert.match(chat, /buildInstitutionDiplomacyView/);
  assert.match(chat, /<InstitutionEmblem institution=\{institution\} size=\{48\} \/>/);
  assert.match(chat, /<InstitutionFacts view=\{institutionView\} \/>/);
  assert.match(chat, /Action required/);
  assert.match(chat, /Review agenda →/);
  assert.match(chat, /Institution record/);
  assert.match(chat, /Council message/);
  assert.match(chat, /Speak instead/);
  assert.match(chat, /Formal business →/);
  assert.match(chat, /onInstitutionNavigate/);
});
