import test from "node:test";
import assert from "node:assert/strict";
import { approveAdvisorAction, cancelApprovedAdvisorAction, hostRequestForProposal } from "./advisorActionApproval.js";
import { PLAYER_REQUESTS } from "../../multiplayer/game/messages.js";
import { validate } from "../../multiplayer/protocol/validate.js";
import { actionProposalsFromReply } from "./advisorActionReview.js";
import { CHIEF_ADVISOR_THREAD, ADVISOR_RECIPIENT_TYPES } from "../../runtime/advisorThreads.js";

const messageId = "advisor-reply-a4d975e6-1943-4638-a3c3-3589cb33e9d9";
const [proposal] = actionProposalsFromReply([{ title: "Freeze discretionary expenditure", text: "Pause non-payroll spending for 96 hours." }], messageId).proposals;
const normalize = (raw) => ({
  ...raw, title: raw.title || raw.text, text: raw.text || raw.title,
  kind: raw.kind || "action", source: raw.source || "advisor", status: raw.status || "planned",
});
const setup = (type = "advisor-minister", threadId = "advisor-operator1") => {
  let writes = 0, receipts = 0;
  let actions = [];
  let advisor = [
    ...(threadId === CHIEF_ADVISOR_THREAD ? [] : [{
      id: threadId, role: "advisor-contact", name: "Marina", title: "Prime Minister",
      recipientType: type, archived: false,
    }]),
    { id: messageId, role: "advisor", ...(threadId === CHIEF_ADVISOR_THREAD ? {} : { threadId }), text: "I propose this.",
      actionProposals: [proposal] },
  ];
  const api = {
    threadId, messageId, proposalId: proposal.id, normalizeAction: normalize,
    readAdvisorMessages: async () => advisor,
    mutateActionsState: async (mutator) => {
      const next = mutator(actions);
      if (next) { actions = next; writes++; }
    },
    mutateAdvisorState: async (mutator) => { advisor = mutator(advisor); receipts++; },
  };
  return { api, get actions() { return actions; }, get advisor() { return advisor; },
    get actionWrites() { return writes; }, get receiptWrites() { return receipts; } };
};

test("Chief review: no mutation before Proceed, then one Action and durable receipt", async () => {
  const context = setup("advisor-minister", CHIEF_ADVISOR_THREAD);
  assert.deepEqual(context.actions, []);
  assert.equal(context.advisor[0].actionReceipts, undefined);
  const accepted = await approveAdvisorAction(context.api);
  assert.equal(accepted.status, "queued");
  assert.equal(context.actionWrites, 1);
  assert.equal(context.receiptWrites, 1);
  assert.equal(context.actions[0].id, proposal.actionId);
  assert.equal(context.advisor[0].actionReceipts[proposal.id].actionId, proposal.actionId);
  // Also safe after a simulated full reload of the persisted documents.
  assert.deepEqual(await approveAdvisorAction(context.api), accepted);
  assert.equal(context.actionWrites, 1);
  assert.equal(context.receiptWrites, 1);
});

test("Minister review gets the same human-authorized path but no automatic authority", async () => {
  const ctx = setup();
  assert.deepEqual(ctx.actions, []);
  const result = await approveAdvisorAction(ctx.api);
  assert.equal(result.status, "queued");
  assert.equal(ctx.actions.length, 1);
});

test("foreign, civilian, other-character and archived contacts cannot submit", async () => {
  for (const type of [
    ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL,
    ADVISOR_RECIPIENT_TYPES.CIVILIAN,
    ADVISOR_RECIPIENT_TYPES.OTHER_CHARACTER,
  ]) {
    const ctx = setup(type);
    await assert.rejects(approveAdvisorAction(ctx.api), /Only an active domestic/);
    assert.deepEqual(ctx.actions, []);
  }
  const ctx = setup();
  ctx.advisor[0].archived = true;
  await assert.rejects(approveAdvisorAction(ctx.api), /active domestic/);
});

test("never acknowledges a queue write that failed", async () => {
  const ctx = setup();
  ctx.api.mutateActionsState = async () => { throw Error("disk full"); };
  await assert.rejects(approveAdvisorAction(ctx.api), /disk full/);
  assert.equal(ctx.receiptWrites, 0);
  assert.equal(ctx.advisor[1].actionReceipts, undefined);
});

test("retry after queue succeeded but receipt failed uses stable ID, no duplicate", async () => {
  const ctx = setup();
  const saveReceipt = ctx.api.mutateAdvisorState;
  ctx.api.mutateAdvisorState = async () => { throw Error("advisor storage unavailable"); };
  await assert.rejects(approveAdvisorAction(ctx.api), /advisor storage unavailable/);
  assert.equal(ctx.actionWrites, 1);
  assert.equal(ctx.actions.length, 1);
  ctx.api.mutateAdvisorState = saveReceipt;
  assert.equal((await approveAdvisorAction(ctx.api)).status, "queued");
  assert.equal(ctx.actionWrites, 1);
  assert.equal(ctx.advisor[1].actionReceipts[proposal.id].status, "queued");
});

// In a shared game the queue is the host's. Proceed was refused there ("needs host-backed proposal IDs"): the order
// request carried words only, so a lost answer asked again could queue it twice. It is asked by the proposal's own id.
const sharedHost = ({ loseFirstAnswer = false } = {}) => {
  let queue = [];
  let lose = loseFirstAnswer;
  const asked = [];
  return {
    asked,
    get queue() { return queue; },
    api: {
      sharedGame: true,
      readActions: async () => queue,
      requestFromHost: async (kind, fields) => {
        asked.push([kind, fields]);
        assert.equal(validate(PLAYER_REQUESTS[kind], { t: kind, id: "0123456789abcdef", ...fields }).ok, true, "a request the host takes");
        if (kind === "order" && !queue.some((order) => order.id === fields.ref)) {
          queue = [...queue, { id: fields.ref, title: fields.title, text: fields.text, kind: fields.kind, source: fields.source, status: "planned" }];
        }
        if (kind === "unorder") queue = queue.filter((order) => order.id !== fields.order);
        if (lose) {
          lose = false;
          return { ok: false, error: "The host did not answer in time." };
        }
        return { ok: true };
      },
    },
  };
};

test("in a shared game Proceed asks the host by the proposal's own id, and a lost answer asked again is one order", async () => {
  const ctx = setup();
  const host = sharedHost({ loseFirstAnswer: true });
  await assert.rejects(approveAdvisorAction({ ...ctx.api, ...host.api }), /did not answer in time/);
  assert.equal(ctx.receiptWrites, 0, "no receipt for an answer never had");
  // The host queued it all the same; asked again, the player's view already holds it, and nothing is asked twice.
  const accepted = await approveAdvisorAction({ ...ctx.api, ...host.api });
  assert.equal(accepted.status, "queued");
  assert.equal(accepted.actionId, proposal.actionId);
  assert.deepEqual(host.asked, [["order", { text: proposal.text, title: proposal.title, ref: proposal.actionId, source: "advisor", kind: "action" }]]);
  assert.equal(host.queue.length, 1);
  assert.equal(ctx.actionWrites, 0, "the page writes no queue of its own");
  assert.equal(ctx.advisor[1].actionReceipts[proposal.id].status, "queued", "the receipt is the device's own advisor's");
});

test("in a shared game Cancel withdraws the order by its id, and a page with no way to the host writes nothing", async () => {
  const ctx = setup();
  const host = sharedHost();
  await approveAdvisorAction({ ...ctx.api, ...host.api });
  const cancelled = await cancelApprovedAdvisorAction({ ...ctx.api, ...host.api });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(host.asked.at(-1), ["unorder", { order: proposal.actionId }]);
  assert.deepEqual(host.queue, []);
  const lost = setup();
  await assert.rejects(approveAdvisorAction({ ...lost.api, sharedGame: true }), /shared game's queue could not be reached/);
  assert.equal(lost.actionWrites, 0);
  assert.equal(lost.receiptWrites, 0);
});

test("an advisor's change or withdrawal of a queued order is asked of the host as one", () => {
  const [edit, remove] = actionProposalsFromReply([{ id: "order-x", title: "Hold Riga" }, { id: "order-y", remove: true }], messageId).proposals;
  assert.deepEqual(hostRequestForProposal(edit), ["reword", { order: "order-x", title: "Hold Riga" }]);
  assert.deepEqual(hostRequestForProposal(remove), ["unorder", { order: "order-y" }]);
  for (const [kind, fields] of [hostRequestForProposal(edit), hostRequestForProposal(remove)]) {
    assert.equal(validate(PLAYER_REQUESTS[kind], { t: kind, id: "0123456789abcdef", ...fields }).ok, true);
  }
});

test("a proposal longer than the host's order takes goes whole and is refused in words; a title taken from its words is cut as a label", async () => {
  // Proceed answered "$.text: longer than 1500" for a proposal of up to 12,000
  // characters (the review of 2026-11-18, door 4).
  const { proposals } = actionProposalsFromReply([{ text: "Mobilise the reserves along the eastern border. ".repeat(60) }], messageId);
  const [kind, fields] = hostRequestForProposal(proposals[0]);
  assert.equal(kind, "order");
  assert.equal(fields.text, proposals[0].text, "never cut");
  assert.ok(fields.title.length <= 240);
  const { createGameClient, tooLongWords } = await import("../../multiplayer/client/gameClient.js");
  const client = createGameClient({ send: () => assert.fail("never sent") });
  assert.ok(fields.text.length > 1500);
  assert.equal((await client.request(kind, fields)).error, tooLongWords(1500));
  client.close();
});

test("a valid reviewed Action after a rejected model entry retains its source position", async () => {
  const ctx = setup();
  const { proposals, problems } = actionProposalsFromReply([
    { remove: true },
    { title: "Only the second entry", text: "Authorized after review." },
  ], messageId);
  assert.equal(problems.length, 1);
  assert.equal(proposals[0].id, "proposal-1");
  ctx.advisor[1].actionProposals = proposals;
  const accepted = await approveAdvisorAction({ ...ctx.api, proposalId: "proposal-1" });
  assert.equal(accepted.status, "queued");
  assert.equal(ctx.actions[0].id, `action-${messageId}-1`);
});

test("a proposal ID must match its saved originating message and position", async () => {
  const ctx = setup();
  ctx.advisor[1].actionProposals = [{ ...proposal, actionId: "action-advisor-reply-some-other-message-0" }];
  await assert.rejects(approveAdvisorAction(ctx.api), /original message identity/);
  ctx.advisor[1].actionProposals = [{ ...proposal, id: "proposal-1" }];
  await assert.rejects(approveAdvisorAction({ ...ctx.api, proposalId: "proposal-1" }), /original message identity/);
  assert.equal(ctx.actionWrites, 0);
});

test("turn-in-progress is rechecked under the canonical Action mutation lock", async () => {
  const ctx = setup();
  let calls = 0;
  await assert.rejects(approveAdvisorAction({
    ...ctx.api, assertReady: () => { calls++; throw new Error("turn underway"); },
  }), /turn underway/);
  assert.equal(calls, 1);
  assert.equal(ctx.actionWrites, 0);
  assert.equal(ctx.receiptWrites, 0);
});

test("forged proposals, forged messages and removed contacts fail before Actions write", async () => {
  const ctx = setup();
  await assert.rejects(approveAdvisorAction({ ...ctx.api, messageId: "different" }), /not found/);
  await assert.rejects(approveAdvisorAction({ ...ctx.api, proposalId: "proposal-23" }), /missing/);
  ctx.advisor[1].actionProposals = [{ ...proposal, actionId: "fake" }];
  await assert.rejects(approveAdvisorAction(ctx.api), /original message identity/);
  assert.equal(ctx.actionWrites, 0);
});
