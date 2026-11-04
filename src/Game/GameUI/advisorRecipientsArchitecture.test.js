import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Advisor panel offers optional recipient conversations but retains chief default", () => {
  const ui = read("./advisor.jsx");
  const contacts = read("./AdvisorRecipients.jsx");
  assert.match(ui, /activeThreadId.*useState\(CHIEF_ADVISOR_THREAD\)/);
  assert.match(ui, /advisorMessagesFor\(saved, CHIEF_ADVISOR_THREAD\)/);
  assert.match(ui, /<AdvisorRecipients/);
  assert.match(contacts, /Chief advisor/);
  assert.match(contacts, /Add recipient/);
  assert.match(contacts, /Retire/);
  assert.match(contacts, /Show retired contacts/);
  assert.match(contacts, /Personality and principles/);
});

test("Advisor runs each recipient using isolated AI conversation state and persistent prompt identity", () => {
  const ui = read("./advisor.jsx");
  const main = read("../AI/main.jsx");
  assert.match(ui, /sendMessage\(text, \{ threadId, recipient,/);
  assert.match(main, /createAdvisorSessionRegistry\(\)/);
  assert.match(main, /advisorState\(threadId\)/);
  assert.match(main, /buildAdvisorSystemPrompt\(\{ recipient: storedRecipient \}\)/);
  assert.match(main, /recipient\.personality/);
  assert.match(main, /loadHistory\(savedMessages, threadId = "chief"\)/);
});

test("Chief and minister Actions require player review while both can auto-apply Projects", () => {
  const ui = read("./advisor.jsx");
  assert.doesNotMatch(ui, /applyAdvisorActions\(/);
  assert.match(ui, /actionProposalsFromReply\(actionsProposal, replyId\)/);
  assert.match(ui, /await approveAdvisorAction\(/);
  assert.match(ui, /onDiscussAction=\{handleDiscussAction\}/);
  assert.match(ui, /onProceedAction=\{handleProceedAction\}/);
  assert.match(ui, /canAdvisorApplyProjectOps\(threadId, recipient\)/);
  assert.match(ui, /await applyAdvisorProjectProposal\(/);
  assert.match(ui, /mutateWorldState,/);
  assert.doesNotMatch(ui, /applyAdvisorProjects\(/);
  assert.match(ui, /mutateAdvisorState\(\(stored\) => replaceAdvisorThread/);
  assert.match(ui, /recipientLocked/);
});

test("recipient personality shows a live Rostra-style used/maximum character counter", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  const state = read("../../runtime/advisorThreads.js");
  assert.match(state, /export const ADVISOR_PERSONALITY_MAX_CHARS = 1200/);
  assert.match(contacts, /maxLength=\{ADVISOR_PERSONALITY_MAX_CHARS\}/);
  assert.match(contacts, /draft\.personality\.length\}\s*\/\s*\{ADVISOR_PERSONALITY_MAX_CHARS\}/);
  assert.match(contacts, /data-no-translate/);
});

test("retiring a contact requires an explicit Cancel or Retire contact choice", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  assert.match(contacts, /role="alertdialog"/);
  assert.match(contacts, /Retire \{contact\.name\}\?/);
  assert.match(contacts, /The conversation and personality will be preserved/);
  assert.match(contacts, /onClick=\{\(\) => retire\(contact, true\)\}/);
  assert.match(contacts, /onClick=\{\(\) => \{ setConfirmArchive\(""\)/);
});

test("chief advisor can be customized and restored but cannot be retired", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  const panel = read("./advisor.jsx");
  const main = read("../AI/main.jsx");
  assert.match(contacts, /onClick=\{openChiefEditor\}/);
  assert.match(contacts, /Edit chief advisor/);
  assert.match(contacts, /Restore scenario defaults/);
  assert.match(contacts, /onSaveChief\(draft\)/);
  assert.match(contacts, /onResetChief\(\)/);
  assert.match(panel, /saveChiefAdvisorProfile\(all, draft\)/);
  assert.match(panel, /resetChiefAdvisorProfile\(all\)/);
  assert.match(main, /describeChiefAdvisorOverride\(chiefAdvisorProfile\(advisorData\)\)/);
});

test("Political World only identifies explicit officeholders; no invented cabinet positions", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  assert.match(contacts, /Link to Political World \(optional\)/);
  assert.match(contacts, /Independent \/ custom official/);
  assert.match(contacts, /A replacement will not inherit this conversation/);
});

test("Recipient Types are explicit without a Political World prerequisite and legacy contacts remain ministers", () => {
  const contacts = read("./AdvisorRecipients.jsx");
  const contract = read("../../runtime/advisorThreads.js");
  assert.match(contacts, /Recipient type/);
  assert.match(contacts, /ADVISOR_RECIPIENT_TYPE_LABELS/);
  assert.match(contacts, /draft.recipientType === ADVISOR_RECIPIENT_TYPES.MINISTER/);
  assert.match(contacts, /speak with this character without a Political World office/);
  for (const label of ["Advisor / Minister", "Citizen / Civilian", "Foreign Official", "Other Character"]) {
    assert.ok(contract.includes(label), label);
  }
  assert.match(contract, /if \(!Object.hasOwn\(contact, "recipientType"\)\) return ADVISOR_RECIPIENT_TYPES.MINISTER/);
});

test("character conversations never enter the government's Advisor prompt or private lookups", () => {
  const panel = read("./advisor.jsx");
  const model = read("../AI/main.jsx");
  const contract = read("../../runtime/advisorThreads.js");
  assert.match(model, /advisorRecipientForReply\(/);
  assert.match(model, /readJson\(JSON_URLS.advisor, \{ defaultValue: \[\], force: true \}\)/);
  assert.match(model, /assertAdvisorRecipientCanReply\(threadId, storedRecipient\)/);
  assert.match(model, /if \(recipient && advisorRecipientType\(recipient\) !== ADVISOR_RECIPIENT_TYPES.MINISTER\)/);
  assert.match(model, /buildCharacterSystemPrompt\(/);
  assert.match(model, /lookups: null/);
  assert.match(contract, /advisorRecipientForReply/);
  assert.match(panel, /publicOnly: Boolean\(recipient/);
  assert.match(panel, /publicCharacterEvents\(events/);
  assert.match(panel, /gmChanges: publicOnly \? \[\]/);
  assert.match(panel, /canDraft=\{activeThreadId === CHIEF_ADVISOR_THREAD/);
  assert.match(panel, /canExecute=\{activeThreadId === CHIEF_ADVISOR_THREAD\}/);
});
