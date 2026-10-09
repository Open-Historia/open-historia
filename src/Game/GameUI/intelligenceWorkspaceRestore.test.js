import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./chat.jsx", import.meta.url), "utf8");

test("diplomacy shell exposes Contacts, Institutions and Intelligence as first-class workspaces", () => {
  assert.match(source, /data-diplomacy-workspace-header="modern"/);
  assert.match(source, /Conversations, institutions and statecraft/);
  assert.match(source, /\["chats", "contacts", "Contacts"/);
  assert.match(source, /\["institutions", "institutions", "Institutions"/);
  assert.match(source, /\["spy", "intelligence", "Intelligence"/);
  assert.doesNotMatch(source, /\[\["spy", "Spy"\]\]/);
});

test("intelligence restores the four-part Continuum command-center information architecture", () => {
  assert.match(source, /data-intelligence-workspace="restored"/);
  assert.match(source, /\["overview", "Overview"\], \["countries", "Countries"\], \["operations", "Operations"\], \["reports", "Reports"\]/);
  assert.match(source, /data-intelligence-section="overview"/);
  assert.match(source, /data-intelligence-section="countries"/);
  assert.match(source, /data-intelligence-section="operations"/);
  assert.match(source, /data-intelligence-section="reports"/);
});

test("country dossiers reconcile PWv2 political knowledge with current HUMINT access", () => {
  assert.match(source, /buildPlayerPoliticalKnowledgeView/);
  assert.match(source, /openPoliticalAssessment/);
  assert.match(source, /Public political picture/);
  assert.match(source, /Intelligence assessment/);
  assert.match(source, /Institutional position/);
  assert.match(source, /institutionPortfolioForPolity/);
  assert.match(source, /Network/);
  assert.match(source, /Political/);
  assert.match(source, /Diplomatic/);
  assert.match(source, /Source/);
});

test("operations preserve current Beta spy mechanics rather than introducing a duplicate secrecy ledger", () => {
  assert.match(source, /deploySpy\(world, target/);
  assert.match(source, /recallSpy\(world, spy\.id\)/);
  assert.match(source, /turnSpy\(world, spy\.id/);
  assert.match(source, /setCoverStory\(world, spy\.id/);
  assert.match(source, /spyOperationOps/);
  assert.match(source, /Deploy a Network/);
  assert.match(source, /Counterintelligence cases/);
});

test("reports use Beta documents and existing intercepts", () => {
  assert.match(source, /documentsReadableBy\(world\?\.reports, playerCountry\)/);
  assert.match(source, /Political assessments/);
  assert.match(source, /Intercepted traffic/);
  assert.match(source, /Documents on file/);
  assert.match(source, /isDocumentExchange\(exchange\)/);
});
