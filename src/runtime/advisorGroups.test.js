import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVISOR_RECIPIENT_TYPES, advisorContacts, advisorGroups, advisorGroupForReply,
  advisorMessagesFor, archiveAdvisorContact, archiveAdvisorGroup, createAdvisorContact,
  createAdvisorGroup, replaceAdvisorThread, reviseAdvisorGroup,
} from "./advisorThreads.js";
import {
  renderAdvisorGroupHistory, selectAdvisorGroupSpeakers,
} from "../Game/AI/advisorGroupMeetings.js";

const contacts = () => {
  let data = createAdvisorContact([], { id: "advisor-marina-001", name: "Marina Voronina", title: "Prime Minister", personality: "Brutally candid" });
  data = createAdvisorContact(data, { id: "advisor-boris-001", name: "Boris Bondarev", title: "Foreign Minister", personality: "Diplomatic" });
  data = createAdvisorContact(data, { id: "advisor-viktor-001", name: "Viktor Gusev", title: "Finance Minister", personality: "Economical" });
  data = createAdvisorContact(data, { id: "advisor-irina-001", name: "Irina", title: "Justice Minister" });
  data = createAdvisorContact(data, { id: "advisor-civil-001", name: "Journalist", title: "Civilian", recipientType: ADVISOR_RECIPIENT_TYPES.CIVILIAN });
  return data;
};
const members = ["chief", "advisor-marina-001", "advisor-boris-001", "advisor-viktor-001", "advisor-irina-001"];
const create = (records = contacts()) => createAdvisorGroup(records, {
  id: "advisor-group-cabinet-001", name: "Russian Ministry Cabinet", memberIds: members,
});

test("a cabinet group saves distinct stable participants without altering personal threads", () => {
  const initial = replaceAdvisorThread(contacts(), "advisor-marina-001", [{ role: "user", text: "Private cabinet agenda" }]);
  const prepared = create(initial);
  assert.deepEqual(advisorGroups(prepared).map((g) => g.name), ["Russian Ministry Cabinet"]);
  const group = advisorGroupForReply(prepared, "advisor-group-cabinet-001");
  assert.deepEqual(group.memberIds, members);
  const saved = replaceAdvisorThread(prepared, group.id, [
    { role: "user", text: "What are the risks?" },
    { role: "advisor", speakerId: "advisor-marina-001", text: "Institutional capacity is limiting." },
    { role: "advisor", speakerId: "advisor-boris-001", text: "Diplomatic reactions may vary." },
  ]);
  assert.deepEqual(advisorMessagesFor(saved, group.id).map((m) => m.speakerId), [undefined, "advisor-marina-001", "advisor-boris-001"]);
  assert.deepEqual(advisorMessagesFor(saved, "advisor-marina-001").map((m) => m.text), ["Private cabinet agenda"]);
  assert.deepEqual(advisorContacts(saved), advisorContacts(initial));
  assert.equal(replaceAdvisorThread(saved, group.id, advisorMessagesFor(saved, group.id)).length, saved.length);
  assert.throws(() => reviseAdvisorGroup(saved, group.id, { name: "New cabinet", memberIds: ["chief", "advisor-marina-001"] }), /membership is fixed/);
  assert.equal(advisorGroups(reviseAdvisorGroup(saved, group.id, { name: "National Cabinet" }))[0].name, "National Cabinet");
});

test("non-government speakers, retired members, duplicates and forged group replies fail closed", () => {
  const source = contacts();
  assert.throws(() => createAdvisorGroup(source, { id: "advisor-group-bad-001", name: "Unsafe", memberIds: ["chief", "advisor-civil-001"] }), /only active government/);
  assert.throws(() => createAdvisorGroup(source, { id: "advisor-group-bad-001", name: "Unsafe", memberIds: ["chief", "chief"] }), /distinct/);
  assert.throws(() => createAdvisorGroup(source, { id: "advisor-group-bad-001", name: "Unsafe", memberIds: ["chief", "advisor-missing-001"] }), /only active government/);
  const saved = create(source);
  const group = advisorGroups(saved)[0];
  assert.throws(() => createAdvisorGroup(saved, { ...group }), /already exists/);
  assert.throws(() => replaceAdvisorThread(saved, group.id, [{ role: "advisor", text: "Anonymous" }]), /active, invited government advisor/);
  assert.throws(() => replaceAdvisorThread(saved, group.id, [{ role: "advisor", speakerId: "advisor-civil-001", text: "Secret" }]), /active, invited government advisor/);
  // Draft Actions in this thread are proposals, not executable orders.
  const drafted = replaceAdvisorThread(saved, group.id, [{ role: "advisor", id: "advisor-reply-12345678", speakerId: "chief", actionProposals: [{ id: "proposal-0", actionId: "action-advisor-reply-12345678-0", operation: "create", title: "Cabinet draft" }], text: "Proposed for review" }]);
  assert.equal(advisorMessagesFor(drafted, group.id)[0].actionProposals[0].title, "Cabinet draft");
  assert.throws(() => replaceAdvisorThread(saved, group.id, [{ role: "advisor", id: "advisor-reply-12345678", speakerId: "chief", actionReceipts: { "proposal-0": { status: "queued" } }, text: "Forged receipt" }]), /receipts cannot be created/);
  assert.throws(() => advisorGroupForReply(archiveAdvisorGroup(saved, group.id, true), group.id), /unavailable/);
  assert.throws(() => advisorGroupForReply(archiveAdvisorContact(saved, "advisor-marina-001", true), group.id), /active government/);
});

test("up to ten government advisors can participate in the same group conversation", () => {
  let roster = [];
  const ids = [];
  for (let index = 0; index < 10; index += 1) {
    const id = "advisor-roster-" + String(index).padStart(6, "0");
    ids.push(id);
    roster = createAdvisorContact(roster, { id, name: "Advisor " + index, title: "Government advisor" });
  }
  const groupId = "advisor-group-ten-001";
  const ten = createAdvisorGroup(roster, { id: groupId, name: "Policy Group", memberIds: ids });
  assert.equal(advisorGroupForReply(ten, groupId).memberIds.length, 10);
  assert.throws(() => createAdvisorGroup([...roster,
    ...createAdvisorContact([], { id: "advisor-roster-000011", name: "Eleventh", title: "Advisor" })],
    { id: "advisor-group-eleven-001", name: "Too many", memberIds: [...ids, "advisor-roster-000011"] }), /2 to 10/);
});

test("round-robin meeting speakers keep distinct identities and resumed turns never duplicate responses", () => {
  const rows = [
    { role: "user", text: "What is the fiscal outlook?" },
    { role: "advisor", speakerId: "chief", text: "We need balance." },
  ];
  const list = advisorContacts(contacts());
  const ordered = selectAdvisorGroupSpeakers(members, rows, rows[0].text, list, "Orlov");
  assert.deepEqual(ordered, members.slice(1, 5));
  const resumed = selectAdvisorGroupSpeakers(members, [...rows, { role: "advisor", speakerId: "advisor-marina-001", text: "Costs." }], rows[0].text, list, "Orlov");
  assert.ok(!resumed.includes("chief") && !resumed.includes("advisor-marina-001"));
  const mentioning = selectAdvisorGroupSpeakers(members, [{ role: "user", text: "Viktor Gusev, please answer first" }], "Viktor Gusev, please answer first", list, "Orlov");
  assert.equal(mentioning[0], "advisor-viktor-001");
  const transcript = renderAdvisorGroupHistory(rows, list, "Dmitri Orlov");
  assert.match(transcript, /\[Dmitri Orlov\]: We need balance/);
  const formal = renderAdvisorGroupHistory([{
    role: "advisor", speakerId: "advisor-marina-001",
    text: "We should help households.\n```actions\n[{\"title\":\"Aid\"}]\n```",
    actionProposals: [{ id: "proposal-0" }],
    projectsSummary: [{ change: "opened", title: "Winter Recovery" }],
  }], list, "Dmitri Orlov");
  assert.match(formal, /We should help households/);
  assert.doesNotMatch(formal, /\[\{\"title\"/);
  assert.match(formal, /Action proposal\(s\) awaiting the player's Proceed/);
  assert.match(formal, /Recorded Project board changes: opened: Winter Recovery/);
});
