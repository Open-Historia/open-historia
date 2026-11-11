import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectAdvisorGroupSpeakers, renderAdvisorGroupHistory, unqueuedGroupActionDrafts } from "./advisorGroupMeetings.js";

const fence = String.fromCharCode(96).repeat(3);
const people = [
  { id: "minister-fiscal", name: "Elena Petrov", title: "Finance" },
  { id: "minister-admin", name: "Anna Orlova", title: "Administration" },
  { id: "minister-foreign", name: "Nikolai Sidorov", title: "Foreign Affairs" },
];
const ids = people.map(({ id }) => id);
const groupMessages = [
  { role: "user", text: "Please assess human-rights monitoring with distinct administrative and diplomatic orders." },
  { role: "advisor", speakerId: ids[1], id: "advisor-reply-admin-001",
    text: "I propose the administrative work.\n\n" + fence + "actions\n[{\"title\":\"Independent monitoring\",\"text\":\"Original administrative scope\"}]\n" + fence,
    actionProposals: [{ id: "proposal-0", actionId: "action-advisor-reply-admin-001-0",
      operation: "create", title: "Independent monitoring",
      text: "Establish access procedures, a secure reporting chain, observer safety and independent oversight.", kind: "action" }] },
  { role: "advisor", speakerId: ids[2], id: "advisor-reply-foreign-001",
    text: "I will propose diplomatic consultations.",
    actionProposals: [{ id: "proposal-0", actionId: "action-advisor-reply-foreign-001-0",
      operation: "create", title: "Independent monitoring",
      text: "Consult international organizations concerning recognition-neutral access.", kind: "action" }],
    actionReceipts: { "proposal-0": { status: "queued", actionId: "action-advisor-reply-foreign-001-0", title: "Independent monitoring" } } },
  { role: "user", text: "Can you revise those duplicate titles?" },
  { role: "advisor", speakerId: ids[1], id: "advisor-reply-admin-wrong-edit",
    text: "I will rename my proposed administrative Action.",
    actionProposals: [{ id: "proposal-0", actionId: "action-advisor-reply-admin-wrong-edit-0",
      operation: "edit", targetId: "action-advisor-reply-foreign-001-0",
      title: "Administrative Monitoring", text: "Consult international organizations concerning recognition-neutral access." }],
    actionReceipts: { "proposal-0": { status: "updated", actionId: "action-advisor-reply-foreign-001-0", title: "Administrative Monitoring" } } },
];
const actions = [{ id: "action-advisor-reply-foreign-001-0", status: "planned",
  title: "Administrative Monitoring", text: "Consult international organizations concerning recognition-neutral access." }];
const lastRequest = "The diplomatic Action is queued, but one Action is missing. Reconcile and provide the responsible minister's unqueued proposal for approval.";

test("reconciliation uses the only actual unqueued create proposal's owner, not the rotating first speaker", () => {
  // Three player turns rotate a three-member group to Nikolai first, not Anna.
  const rows = [...groupMessages, { role: "user", text: lastRequest }];
  assert.deepEqual(unqueuedGroupActionDrafts(rows, actions).map((draft) => draft.speakerId), [ids[1]]);
  assert.deepEqual(new Set(selectAdvisorGroupSpeakers(ids, rows, lastRequest, people, "Chief")), new Set(ids));
});

test("group context exposes owner, exact scope and unqueued state from saved proposals without restoring the invalid edit block", () => {
  const rows = [...groupMessages, { role: "user", text: lastRequest }];
  const result = renderAdvisorGroupHistory(rows, people, "Chief", 4300, { currentActions: actions });
  assert.match(result, /Unqueued Action proposals/i);
  assert.match(result, /Anna Orlova/);
  assert.match(result, /Establish access procedures, a secure reporting chain/);
  assert.match(result, /action-advisor-reply-admin-001-0/);
  const pending = result.split("[Unqueued Action proposals").at(-1);
  assert.doesNotMatch(pending, /action-advisor-reply-foreign-001-0/);
  assert.doesNotMatch(pending, /Original administrative scope/);
  assert.ok(result.length <= 4300, "context still obeys its character limit");
});

test("no owner inference for unrelated questions, ambiguous drafts, or unverified queue state", () => {
  const question = "What is the latest fiscal estimate?";
  const rows = [...groupMessages, { role: "user", text: lastRequest }];
  assert.deepEqual(new Set(selectAdvisorGroupSpeakers(ids, rows, question, people, "Chief")), new Set(ids));
  const ambiguous = [...rows.slice(0, -1), { role: "advisor", speakerId: ids[0], id: "advisor-reply-fiscal-001",
    actionProposals: [{ id: "proposal-0", operation: "create", actionId: "action-advisor-reply-fiscal-001-0",
      title: "Fiscal review", text: "Review costs of the planned initiative." }] }, rows.at(-1)];
  assert.equal(new Set(unqueuedGroupActionDrafts(ambiguous, actions).map((draft) => draft.speakerId)).size, 2);
  assert.doesNotMatch(renderAdvisorGroupHistory(rows, people, "Chief", 4300), /Unqueued Action proposals/);
});


test("cancelled drafts and Actions already present by stable ID are not misrepresented as missing", () => {
  const rows = [...groupMessages, { role: "user", text: lastRequest }];
  const cancelled = structuredClone(rows);
  cancelled[1].actionReceipts = { "proposal-0": { status: "cancelled", actionId: "action-advisor-reply-admin-001-0", title: "Independent monitoring" } };
  assert.doesNotMatch(renderAdvisorGroupHistory(cancelled, people, "Chief", 4300, { currentActions: actions }), /Unqueued Action proposals/);
  const nowQueued = [...actions, { id: "action-advisor-reply-admin-001-0", status: "planned", title: "Independent monitoring" }];
  assert.doesNotMatch(renderAdvisorGroupHistory(rows, people, "Chief", 4300, { currentActions: nowQueued }), /Unqueued Action proposals/);
  assert.deepEqual(unqueuedGroupActionDrafts(rows, nowQueued), []);
});

test("shared and individual group requests pass saved group-only proposal state and real canonical Actions to the same native selector", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const from = source.indexOf("export async function sendAdvisorGroupMessage");
  const end = source.indexOf("export async function buildDiplomaticSystemPrompt", from);
  const body = source.slice(from, end);
  assert.match(body, /readJson\(JSON_URLS\.actions, \{ defaultValue: \[\], force: true \}\)/);
  assert.match(body, /advisorMessagesFor\(stored, threadId\)/);
  assert.doesNotMatch(body, /requiredAdvisorGroupSpeakers|mustSpeak/);
  assert.equal((body.match(/renderAdvisorGroupHistory\(conversation, contacts, chiefName, GROUP_MEETING_CONTEXT_MAX_CHARS/g) || []).length, 2);
  assert.match(body, /if \(!Array\.isArray\(currentActions\)\) throw/);
});
