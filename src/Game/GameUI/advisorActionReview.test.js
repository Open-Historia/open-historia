import test from "node:test";
import assert from "node:assert/strict";
import { actionProposalsFromReply, planApprovedAdvisorAction, recordAdvisorActionReceipt } from "./advisorActionReview.js";

const messageId = "advisor-reply-8cb9315d-af31-4894-b60e-19f7ce0a8442";
const normalize = (action) => ({
  ...action,
  title: action.title || action.text,
  text: action.text || action.title,
  kind: action.kind || "action",
  source: action.source || "advisor",
  status: action.status || "planned",
});
const proposal = (entry, index = 0) => actionProposalsFromReply([entry], messageId).proposals[index];

test("proposing an order creates only a saved reviewable object, never an Action write", () => {
  const { proposals, problems } = actionProposalsFromReply([
    { title: "Freeze spending", text: "Freeze non-essential expenditure for 96 hours.", kind: "action" },
    { id: "old-action-id", title: "Change existing", text: "A revised order" },
    { id: "another-id", remove: true },
  ], messageId);
  assert.deepEqual(problems, []);
  assert.deepEqual(proposals.map((p) => p.operation), ["create", "edit", "remove"]);
  assert.equal(proposals[0].id, "proposal-0");
  assert.equal(proposals[0].actionId, "action-" + messageId + "-0");
  assert.equal(proposals[1].targetId, "old-action-id");
  assert.equal(proposals[2].targetId, "another-id");
  assert.equal(proposals[0].status, undefined);
});

test("malformed or oversized blocks fail closed without hidden Actions", () => {
  assert.throws(() => actionProposalsFromReply([{ title: "X" }], "invalid"), /stable message ID/);
  const rejected = actionProposalsFromReply([{ remove: true }, null, { title: "" }], messageId);
  assert.equal(rejected.proposals.length, 0);
  assert.equal(rejected.problems.length, 3);
  assert.equal(actionProposalsFromReply(Array.from({ length: 25 }, () => ({ title: "X" })), messageId).proposals.length, 0);
  assert.equal(actionProposalsFromReply("wrong", messageId).proposals.length, 0);
});

test("Proceed plans exactly one native Action with stable id and repeat is no-op", () => {
  const pending = proposal({ title: "Emergency freeze", text: "Freeze discretionary expenditure." });
  const first = planApprovedAdvisorAction([], pending, normalize);
  assert.equal(first.changed, true);
  assert.equal(first.next.length, 1);
  assert.equal(first.next[0].id, pending.actionId);
  assert.equal(first.next[0].status, "planned");
  assert.deepEqual(first.receipt, { status: "queued", actionId: pending.actionId, title: "Emergency freeze" });
  const second = planApprovedAdvisorAction(first.next, pending, normalize);
  assert.equal(second.changed, false);
  assert.deepEqual(second.next, first.next);
  assert.deepEqual(second.receipt, first.receipt);
  assert.throws(() => planApprovedAdvisorAction([{ ...first.next[0], text: "Tampered" }], pending, normalize), /different contents/);
});

test("one of several proposals can be queued without changing the others", () => {
  const props = actionProposalsFromReply([{ title: "A" }, { title: "B" }], messageId).proposals;
  const first = planApprovedAdvisorAction([], props[1], normalize);
  assert.deepEqual(first.next.map(x => x.title), ["B"]);
  const second = planApprovedAdvisorAction(first.next, props[0], normalize);
  assert.deepEqual(second.next.map(x => x.title), ["B", "A"]);
});

test("update/remove requires an existing, pending Action; never silently inserts", () => {
  const prior = normalize({ id: "order-existing", title: "Before", text: "Old" });
  const edit = proposal({ id: prior.id, title: "After", text: "New" });
  const edited = planApprovedAdvisorAction([prior], edit, normalize);
  assert.equal(edited.receipt.status, "updated");
  assert.equal(edited.next[0].text, "New");
  assert.equal(edited.next[0].id, prior.id);
  const remove = proposal({ id: prior.id, remove: true });
  const removed = planApprovedAdvisorAction([prior], remove, normalize);
  assert.equal(removed.receipt.status, "removed");
  assert.deepEqual(removed.next, []);
  assert.throws(() => planApprovedAdvisorAction([], remove, normalize), /missing/);
  assert.throws(() => planApprovedAdvisorAction([{ ...prior, status: "resolved" }], edit, normalize), /no longer awaiting/);
  assert.throws(() => planApprovedAdvisorAction([{ ...prior, unitRevert: { id: "unit" } }], remove, normalize), /Actions panel/);
});

test("an already planned duplicate never gives a new Accepted receipt", () => {
  const p = proposal({ title: "Same" });
  assert.throws(() => planApprovedAdvisorAction([normalize({ id: "original", title: "Same" })], p, normalize, {
    repeatOf: (items, title) => items.find(item => item.title === title),
  }), /already queued/);
});

test("receipts update only the exact original message and thread", () => {
  const p = proposal({ title: "Treasury freeze" });
  const saved = [
    { role: "advisor-contact", id: "advisor-minister-1" },
    { role: "advisor", id: messageId, threadId: "advisor-minister-1", text: "Do it", actionProposals: [p] },
    { role: "advisor", id: messageId, threadId: "advisor-minister-2", text: "Same message ID on another thread" },
    { role: "notice", id: "notice-1", text: "Paper" },
  ];
  const receipt = { status: "queued", actionId: p.actionId, title: p.title };
  const changed = recordAdvisorActionReceipt(saved, "advisor-minister-1", messageId, p.id, receipt);
  assert.deepEqual(changed[1].actionReceipts[p.id], receipt);
  assert.equal(changed[2], saved[2]);
  assert.equal(changed[3], saved[3]);
  assert.deepEqual(recordAdvisorActionReceipt(changed, "advisor-minister-1", messageId, p.id, receipt), changed);
  assert.throws(() => recordAdvisorActionReceipt(changed, "advisor-minister-2", messageId, p.id, receipt), /no longer available/);
  assert.throws(() => recordAdvisorActionReceipt(changed, "advisor-minister-1", messageId, p.id, { ...receipt, actionId: "wrong" }), /different/);
});

test("no truncation or silent acceptance of unsupported proposal shapes", () => {
  const invalid = actionProposalsFromReply([
    { title: "x".repeat(241) },
    { title: "Valid", text: "x".repeat(12001) },
    { title: 400 },
    { id: "a".repeat(151), remove: true },
    { title: "A safe proposal" },
  ], messageId);
  assert.equal(invalid.proposals.length, 1);
  assert.equal(invalid.proposals[0].id, "proposal-4");
  assert.equal(invalid.problems.length, 4);
  const objectBlock = actionProposalsFromReply({ title: "Bare object" }, messageId);
  assert.equal(objectBlock.proposals.length, 0);
  assert.equal(objectBlock.problems.length, 1);
});

test("forge-protection denies invalid saved proposal operation", () => {
  assert.throws(() => planApprovedAdvisorAction([], { id: "proposal-0", actionId: "fake", operation: "create", title: "X" }, normalize), /Invalid saved/);
  assert.throws(() => planApprovedAdvisorAction([], { id: "proposal-0", actionId: "action-" + messageId + "-0", operation: "remove" }, normalize), /target order/);
});
