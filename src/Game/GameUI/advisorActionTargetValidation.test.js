import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reviewAdvisorActionProposals, planApprovedAdvisorAction } from "./advisorActionReview.js";
import { prepareAdvisorGroupMemberReply, stageAdvisorGroupBatch } from "./advisorGroupOrders.js";

const replyId = "advisor-reply-c38840a1-8d3d-42bf-a4f7-cd67ee13a920";
const planned = {
  id: "action-queued-123", status: "planned", title: "Already queued",
  text: "Original work.", kind: "action", source: "advisor",
};
const resolved = {
  id: "action-advisor-reply-e03441d6-bea2-4755-ac28-4482687d6ae3-1",
  status: "resolved", title: "Al-Sadiq: July 11 Consular Visit Operationalization",
  text: "Already executed.", resolvedRound: 280,
};
const normalize = (entry) => ({
  ...entry, title: entry.title || entry.text, text: entry.text || entry.title,
  kind: entry.kind || "action", source: "advisor", status: "planned",
});

test("valid queued edits and removals remain reviewable; fresh creations keep their stable index", () => {
  const reviewed = reviewAdvisorActionProposals([
    { title: "New diplomatic follow-up", text: "Request updated reporting." },
    { id: planned.id, title: "Already queued", text: "Revised work." },
    { id: planned.id, remove: true },
  ], replyId, [planned, resolved]);
  assert.deepEqual(reviewed.problems, []);
  assert.deepEqual(reviewed.proposals.map((p) => [p.id, p.operation]), [
    ["proposal-0", "create"], ["proposal-1", "edit"], ["proposal-2", "remove"],
  ]);
  assert.equal(planApprovedAdvisorAction([planned], reviewed.proposals[1], normalize).receipt.status, "updated");
  assert.equal(planApprovedAdvisorAction([planned], reviewed.proposals[2], normalize).receipt.status, "removed");
  assert.equal(planApprovedAdvisorAction([], reviewed.proposals[0], normalize).receipt.status, "queued");
});

test("resolved and fictional IDs never become actionable proposal cards, including the Al-Sadiq regression", () => {
  const reviewed = reviewAdvisorActionProposals([
    { id: resolved.id, title: "Al-Sadiq: Evidentiary Reconciliation", text: "Check disputed coordinates." },
    { id: "action-advisor-reply-v7n2m8q-x4k1p0w-z9s3t5y-k2j6h4g", title: "Another Al-Sadiq task" },
    { id: "missing-removal", remove: true },
    { title: "Genuinely new task", text: "Prepare a distinct request." },
  ], replyId, [resolved, planned]);
  assert.deepEqual(reviewed.proposals.map((p) => [p.id, p.operation]), [["proposal-3", "create"]]);
  assert.equal(reviewed.problems.length, 3);
  assert.ok(reviewed.problems.every((p) => /only an existing queued Action/i.test(p)));
  assert.equal(planApprovedAdvisorAction([], reviewed.proposals[0], normalize).next.length, 1);
});

test("duplicate targets or unreadable Action state fail closed, not guessed or silently converted", () => {
  assert.throws(() => reviewAdvisorActionProposals([{ id: planned.id, text: "Amend" }], replyId, null), /could not be verified/);
  const duplicates = reviewAdvisorActionProposals([{ id: planned.id, text: "Amend" }], replyId, [planned, { ...planned }]);
  assert.deepEqual(duplicates.proposals, []);
  assert.equal(duplicates.problems.length, 1);
  const deleted = reviewAdvisorActionProposals([{ id: planned.id, remove: true }], replyId, []);
  assert.deepEqual(deleted.proposals, []);
  // A queue may resolve between generation and Proceed: the native writer still denies it.
  const prior = reviewAdvisorActionProposals([{ id: planned.id, text: "New text" }], replyId, [planned]).proposals[0];
  assert.throws(() => planApprovedAdvisorAction([{ ...planned, status: "resolved" }], prior, normalize), /no longer awaiting/);
});

test("individual group speaker persists diagnostic, never a stale Action card", async () => {
  const recipient = {
    id: "advisor-boris-001", name: "Boris", title: "Foreign Minister",
    recipientType: "advisor-minister", archived: false,
  };
  const response = await prepareAdvisorGroupMemberReply({
    speakerId: recipient.id, recipient, replyId, currentActions: [resolved],
    text: "I have reviewed this.\n```actions\n"
      + JSON.stringify([{ id: resolved.id, title: "New Al-Sadiq task", text: "Coordinate more evidence." }])
      + "\n```",
  });
  assert.equal(response.actionProposals, undefined);
  assert.equal(response.actionsProblems.length, 1);
  assert.match(response.actionsProblems[0], /only an existing queued Action/);
});

test("shared AI batch rejects stale target before any speaker Projects are applied", () => {
  const items = [
    { speakerId: "advisor-marina", text: "Prioritize heating.\n```projects\n"
      + JSON.stringify([{ op: "create", name: "Winter Upgrade" }]) + "\n```" },
    { speakerId: "advisor-boris", text: "Amend the maritime order.\n```actions\n"
      + JSON.stringify([{ id: resolved.id, text: "Extend the resolved order." }]) + "\n```" },
  ];
  const options = {
    currentActions: [resolved],
    makeReplyId: (() => { let n = 0; return () => replyId.replace("c388", String(++n).padStart(4,"0")); })(),
  };
  assert.throws(() => stageAdvisorGroupBatch(items, options), /invalid Action proposals from advisor-boris/);
  assert.equal(stageAdvisorGroupBatch(items.slice(0,1), options).length, 1);
  assert.throws(() => stageAdvisorGroupBatch(items, { ...options, currentActions: undefined }), /could not be verified/);
});

test("one shared three-person reply and three one-person replies apply the same Action-target rule", () => {
  const speaking = [
    { speakerId: "advisor-viktor", text: "Update the fiscal Action.\n```actions\n"
      + JSON.stringify([{ id: planned.id, text: "Update the assessment." }]) + "\n```" },
    { speakerId: "advisor-boris", silent: true, text: "" },
    { speakerId: "advisor-marina", text: "Create a separate heating mandate.\n```actions\n"
      + JSON.stringify([{ title: "Heating mandate", text: "Fund resilient heating." }]) + "\n```" },
  ];
  const stagedTogether = stageAdvisorGroupBatch(speaking, {
    currentActions: [planned],
    makeReplyId: (() => { let n = 0; return () => replyId.replace("c388", String(++n).padStart(4,"0")); })(),
  });
  assert.deepEqual(stagedTogether.map((r) => [r.speakerId, !!r.silent, r.actionProposals?.[0]?.operation]), [
    ["advisor-viktor", false, "edit"],
    ["advisor-boris", true, undefined],
    ["advisor-marina", false, "create"],
  ]);
  const stagedSeparately = speaking.map((record, index) => stageAdvisorGroupBatch([record], {
    currentActions: [planned],
    makeReplyId: () => replyId.replace("c388", String(index + 1).padStart(4,"0")),
  })[0]);
  assert.deepEqual(stagedSeparately.map((r) => [r.speakerId, !!r.silent, r.actionProposals?.[0]?.operation]),
    stagedTogether.map((r) => [r.speakerId, !!r.silent, r.actionProposals?.[0]?.operation]));
});

test("production paths use current native Action state and old-card Discuss avoids a fictional failure narrative", () => {
  const panel = readFileSync(new URL("./advisor.jsx", import.meta.url), "utf8");
  const group = readFileSync(new URL("./advisorGroupOrders.js", import.meta.url), "utf8");
  assert.match(panel, /reviewAdvisorActionProposals\(actionsProposal, replyId,/);
  assert.match(panel, /currentActions: await readJson\(JSON_URLS\.actions, \{ force: true \}\)/);
  assert.match(group, /reviewAdvisorActionProposals\(parsed\.actionsProposal, replyId, currentActions\)/);
  assert.match(group, /reviewAdvisorActionProposals\(actionsProposal, replyId, currentActions\)/);
  assert.match(panel, /Do not reuse an old order ID or treat an Action's normal resolution as a system failure/);
  assert.doesNotMatch(panel, /If this is genuinely new work, propose a new Action for my approval instead of editing a missing or resolved order/);
});
