import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { approveAdvisorAction, cancelApprovedAdvisorAction } from "./advisorActionApproval.js";
import {
  actionProposalsFromReply,
  advisorActionCardState,
  mergeAdvisorActionReceiptIntoView,
  planCancelApprovedAdvisorAction,
  planApprovedAdvisorAction,
} from "./advisorActionReview.js";
import { CHIEF_ADVISOR_THREAD } from "../../runtime/advisorThreads.js";

const messageId = "advisor-reply-d983cf49-a623-4990-a18c-302a80a7094a";
const [proposal] = actionProposalsFromReply([
  { title: "Economic stabilization", text: "Implement the approved essential services program." },
], messageId).proposals;
const normalize = (raw) => ({
  ...raw,
  title: raw.title || raw.text,
  text: raw.text || raw.title,
  kind: raw.kind || "action",
  source: raw.source || "advisor",
  status: raw.status || "planned",
});
const setup = () => {
  let actions = [];
  let advisor = [{
    role: "advisor", id: messageId, text: "I propose this.",
    actionProposals: [proposal],
  }];
  let actionWrites = 0;
  let receiptWrites = 0;
  const api = {
    threadId: CHIEF_ADVISOR_THREAD,
    messageId, proposalId: proposal.id,
    normalizeAction: normalize,
    readAdvisorMessages: async () => advisor,
    mutateActionsState: async (change) => {
      const next = change(actions);
      if (next !== null && next !== undefined) {
        actions = next;
        actionWrites += 1;
      }
    },
    mutateAdvisorState: async (change) => {
      advisor = change(advisor);
      receiptWrites += 1;
    },
  };
  return {
    api,
    get actions() { return actions; },
    get advisor() { return advisor; },
    get actionWrites() { return actionWrites; },
    get receiptWrites() { return receiptWrites; },
    setActions(next) { actions = next; },
  };
};

test("a committed queue write takes precedence over a stale/missing local Advisor receipt", async () => {
  const ctx = setup();
  const receipt = await approveAdvisorAction(ctx.api);
  assert.equal(receipt.status, "queued");
  assert.equal(advisorActionCardState(proposal, undefined, ctx.actions[0]), "queued");
  assert.equal(advisorActionCardState(proposal, receipt, ctx.actions[0]), "queued");
  assert.equal(mergeAdvisorActionReceiptIntoView([], CHIEF_ADVISOR_THREAD, messageId, proposal.id, receipt).length, 0);
  const wrongThread = [{ ...ctx.advisor[0], threadId: "advisor-unrelated" }];
  assert.deepEqual(mergeAdvisorActionReceiptIntoView(wrongThread, CHIEF_ADVISOR_THREAD, messageId, proposal.id, receipt), wrongThread);
  const visible = [{ ...ctx.advisor[0], actionReceipts: undefined }];
  const merged = mergeAdvisorActionReceiptIntoView(visible, CHIEF_ADVISOR_THREAD, messageId, proposal.id, receipt);
  assert.equal(merged[0].actionReceipts[proposal.id].status, "queued");
});

test("Cancel removes exactly one planned create proposal, records cancellation, and allows requeue of the same stable ID", async () => {
  const ctx = setup();
  await approveAdvisorAction(ctx.api);
  const before = ctx.actions[0];
  assert.equal(before.status, "planned");
  assert.equal(ctx.actionWrites, 1);
  assert.equal((await cancelApprovedAdvisorAction(ctx.api)).status, "cancelled");
  assert.equal(ctx.actions.length, 0);
  assert.equal(ctx.advisor[0].actionReceipts[proposal.id].status, "cancelled");
  assert.equal(advisorActionCardState(proposal, ctx.advisor[0].actionReceipts[proposal.id], undefined), "cancelled");
  assert.equal((await cancelApprovedAdvisorAction(ctx.api)).status, "cancelled");
  assert.equal(ctx.actionWrites, 2, "idempotent cancel must not write the Actions board twice");
  const again = await approveAdvisorAction(ctx.api);
  assert.equal(again.status, "queued");
  assert.equal(ctx.actions.length, 1);
  assert.equal(ctx.actions[0].id, before.id);
  assert.equal(ctx.advisor[0].actionReceipts[proposal.id].status, "queued");
  assert.equal(ctx.actionWrites, 3);
});

test("Cancel cannot remove an already resolved, edited, missing, unit-backed or substituted action", async () => {
  const ctx = setup();
  await approveAdvisorAction(ctx.api);
  const planned = ctx.actions[0];
  for (const patch of [
    { status: "resolved" },
    { text: "Modified in Actions" },
    { source: "player" },
    { unitRevert: { unitId: "protected" } },
    { kind: "chat" },
  ]) {
    ctx.setActions([{ ...planned, ...patch }]);
    await assert.rejects(cancelApprovedAdvisorAction(ctx.api));
    assert.equal(ctx.actions.length, 1);
    assert.equal(ctx.advisor[0].actionReceipts[proposal.id].status, "queued");
  }
  ctx.setActions([]);
  await assert.rejects(cancelApprovedAdvisorAction(ctx.api), /no longer queued/i);
  assert.equal(ctx.advisor[0].actionReceipts[proposal.id].status, "queued");
});

test("Cancelled creates are not a loophole for forged proposals, shared-game writes or privileged contacts", async () => {
  const ctx = setup();
  await approveAdvisorAction(ctx.api);
  await assert.rejects(cancelApprovedAdvisorAction({ ...ctx.api, sharedGame: true }), /shared games/i);
  await assert.rejects(cancelApprovedAdvisorAction({ ...ctx.api, proposalId: "proposal-3" }), /missing/i);
  const wrongThread = { ...ctx.api, threadId: "advisor-unavailable" };
  await assert.rejects(cancelApprovedAdvisorAction(wrongThread), /active domestic/i);
  const edit = actionProposalsFromReply([{ id: "existing", title: "Edit" }], messageId).proposals[0];
  assert.throws(() => planCancelApprovedAdvisorAction(ctx.actions, edit), /newly queued/i);
  assert.equal(ctx.actions.length, 1);
});

test("A receipt is not enough to pretend an order remains queued when the board has changed", () => {
  const queued = { status: "queued", actionId: proposal.actionId, title: proposal.title };
  const cancelled = { ...queued, status: "cancelled" };
  const planned = normalize({ ...proposal, id: proposal.actionId });
  assert.equal(advisorActionCardState(proposal, queued, undefined), "no-longer-queued");
  assert.equal(advisorActionCardState(proposal, queued, { ...planned, status: "resolved" }), "resolved");
  assert.equal(advisorActionCardState(proposal, queued, { ...planned, text: "Tampered" }), "conflict");
  assert.equal(advisorActionCardState(proposal, cancelled, undefined), "cancelled");
  assert.equal(advisorActionCardState(proposal, undefined, undefined), "proposed");
});

test("a malformed queue and a substituted same-ID order fail closed", () => {
  assert.throws(() => planCancelApprovedAdvisorAction(null, proposal), /could not be read/);
  assert.throws(() => planApprovedAdvisorAction([
    normalize({ id: proposal.actionId, title: proposal.title, text: proposal.text, source: "player" }),
  ], proposal, normalize), /provenance/);
  const initial = normalize({ id: proposal.actionId, title: proposal.title, text: proposal.text });
  assert.throws(() => planCancelApprovedAdvisorAction([initial, initial], proposal), /Duplicate Action IDs/);
});

test("UI wires queued, Cancel and Discuss to the native order, keeping composer handoff explicit", () => {
  const jsx = readFileSync(new URL("./advisor.jsx", import.meta.url), "utf8");
  assert.match(jsx, /advisorActionCardState\(/);
  assert.match(jsx, /onCancelAction=\{handleCancelAction\}/);
  assert.match(jsx, /await cancelApprovedAdvisorAction\(/);
  assert.match(jsx, /\{queued && \(/);
  assert.match(jsx, /Cancelling…" : "Cancel"/);
  assert.match(jsx, /const cancelled = await doAction\(onCancel,/);
  assert.match(jsx, /setInput\(\(current\) => current\.trim\(\)/);
});

test("Edit/Remove cards are actionable only while their exact canonical target remains planned", () => {
  const [edit, remove] = actionProposalsFromReply([
    { id: "action-previous-pending", title: "Update repatriation", text: "Revise next shipment" },
    { id: "action-previous-pending", remove: true },
  ], messageId).proposals;
  const plannedTarget = normalize({ id: "action-previous-pending", title: "Original", text: "Original", status: "planned" });
  for (const proposed of [edit, remove]) {
    assert.equal(advisorActionCardState(proposed, undefined, undefined, plannedTarget), "proposed");
    assert.equal(advisorActionCardState(proposed, undefined, undefined, { ...plannedTarget, status: "resolved" }), "target-resolved");
    assert.equal(advisorActionCardState(proposed, undefined, undefined, undefined), "target-unavailable");
    assert.equal(advisorActionCardState(proposed, undefined, undefined, { ...plannedTarget, id: "wrong-target" }), "target-unavailable");
  }
  assert.equal(advisorActionCardState(edit, { status: "updated" }, undefined, undefined), "updated");
  assert.equal(advisorActionCardState(remove, { status: "removed" }, undefined, undefined), "removed");
  assert.throws(() => planApprovedAdvisorAction([{ ...plannedTarget, status: "resolved" }], edit, normalize), /no longer awaiting/);
});

test("the UI observes Edit/Remove target IDs and never exposes Proceed on unavailable targets", () => {
  const jsx = readFileSync(new URL("./advisor.jsx", import.meta.url), "utf8");
  assert.match(jsx, /targetAction=\{actionStates\?\.\[proposal\.targetId\]\}/);
  assert.match(jsx, /advisorActionCardState\(proposal, receipt, queueAction, targetAction\)/);
  assert.match(jsx, /target-unavailable/);
  assert.match(jsx, /target-resolved/);
  assert.match(jsx, /state === "proposed"/);
  assert.match(jsx, /The referenced Action is no longer queued/);
});
