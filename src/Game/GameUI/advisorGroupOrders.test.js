import test from "node:test";
import assert from "node:assert/strict";
import {
  ADVISOR_RECIPIENT_TYPES, advisorMessagesFor, archiveAdvisorContact,
  archiveAdvisorGroup, createAdvisorContact, createAdvisorGroup, replaceAdvisorThread,
} from "../../runtime/advisorThreads.js";
import { approveAdvisorAction, cancelApprovedAdvisorAction } from "./advisorActionApproval.js";
import { prepareAdvisorGroupMemberReply } from "./advisorGroupOrders.js";

const threadId = "advisor-group-cabinet-001";
const speakerId = "advisor-marina-001";
const replyId = "advisor-reply-2b3b568d-7e14-4386-ab33-82fb9e7420e4";
const contact = {
  id: speakerId, name: "Marina Voronina", title: "Prime Minister", personality: "Candid",
  recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER, archived: false,
};
const prepared = () => createAdvisorGroup(createAdvisorContact([], contact), {
  id: threadId, name: "Russian Ministry Cabinet", memberIds: ["chief", speakerId],
});
const operations = [
  "```actions",
  '[{"title":"Protect heating subsidies","text":"Implement a temporary, funded heating guarantee."}]',
  "```",
].join("\n");
const normalizeAction = (value) => ({
  ...value, title: value.title || value.text, text: value.text || value.title,
  kind: value.kind || "action", source: "advisor", status: "planned",
});
const route = async (text = operations, args = {}) => prepareAdvisorGroupMemberReply({
  speakerId, recipient: contact, replyId, text,
  gameDate: "2029-07-23", round: 300, currentActions: [],
  ...args,
});

test("a minister's cabinet Action is a saved proposal, not an auto-executed order; Proceed uses existing native receipt", async () => {
  const response = await route();
  assert.equal(response.speakerId, speakerId);
  assert.equal(response.actionProposals.length, 1);
  const proposal = response.actionProposals[0];
  assert.equal(proposal.actionId, `action-${replyId}-0`);
  let saved = replaceAdvisorThread(prepared(), threadId, [
    { role: "user", text: "Prepare a subsidy order" }, response,
  ]);
  let orders = [];
  let writes = 0;
  const options = {
    threadId, messageId: replyId, proposalId: proposal.id,
    readAdvisorMessages: async () => saved,
    normalizeAction,
    mutateActionsState: async (mutator) => { const next = mutator(orders); if (next) { orders = next; writes++; } },
    mutateAdvisorState: async (mutator) => { saved = mutator(saved); },
  };
  assert.equal(orders.length, 0, "fenced Actions are never queued automatically");
  const result = await approveAdvisorAction(options);
  assert.equal(result.status, "queued");
  assert.equal(writes, 1);
  assert.equal(orders.length, 1);
  assert.equal(advisorMessagesFor(saved, threadId)[1].actionReceipts[proposal.id].status, "queued");
  assert.deepEqual(await approveAdvisorAction(options), result, "repeated Proceed is idempotent");
  assert.equal(writes, 1);
  saved = replaceAdvisorThread(saved, threadId, advisorMessagesFor(saved, threadId));
  assert.deepEqual(advisorMessagesFor(saved, threadId)[1].actionReceipts[proposal.id], result);
  assert.equal((await cancelApprovedAdvisorAction(options)).status, "cancelled");
  assert.equal(orders.length, 0);
});

test("a cabinet proposal loses approval authority when its specific speaker or group is retired", async () => {
  const response = await route();
  const base = replaceAdvisorThread(prepared(), threadId, [response]);
  const options = {
    threadId, messageId: replyId, proposalId: response.actionProposals[0].id,
    normalizeAction,
    readAdvisorMessages: async () => base,
    mutateActionsState: () => { throw Error("must not mutate"); },
  };
  await assert.rejects(approveAdvisorAction({
    ...options, readAdvisorMessages: async () => archiveAdvisorContact(base, speakerId),
  }), /current invited/);
  await assert.rejects(approveAdvisorAction({
    ...options, readAdvisorMessages: async () => archiveAdvisorGroup(base, threadId),
  }), /current invited/);
  await assert.rejects(approveAdvisorAction({
    ...options, readAdvisorMessages: async () => replaceAdvisorThread(base, threadId,
      [{ ...response, speakerId: "advisor-other-001" }]),
  }), /active, invited|current invited/);
});

test("a minister's authorized group Project uses the same native world mutation service, and failures are visible", async () => {
  const text = "```projects\n[{\"op\":\"create\",\"name\":\"Winter Recovery\"}]\n```";
  let mutations = 0;
  let world = { projects: [] };
  const run = () => route(text, {
    mutateWorldState: async (mutator) => {
      const updated = mutator(world);
      if (updated) { world = updated; mutations++; }
    },
    applyProjectOpsToWorld: ({ world: previous }) => ({
      deferredProjectIds: [],
      world: { ...previous, projects: [{ id: "winter", name: "Winter Recovery", updatedAt: "2029-07-23" }] },
    }),
  });
  const message = await run();
  assert.equal(mutations, 1);
  assert.equal(world.projects.length, 1);
  assert.deepEqual(message.projectsSummary, [{ change: "opened", title: "Winter Recovery" }]);
  assert.equal(advisorMessagesFor(replaceAdvisorThread(prepared(), threadId, [message]), threadId)[0].projectsSummary[0].title, "Winter Recovery");
});

test("a failed cabinet Project mutation is reported and never shown as applied", async () => {
  const message = await route("```projects\n[{\"op\":\"create\",\"name\":\"Emergency Heating\"}]\n```", {
    mutateWorldState: async () => { throw new Error("world is read-only"); },
    applyProjectOpsToWorld: () => { throw new Error("should never run"); },
  });
  assert.equal(message.projectsSummary, undefined);
  assert.equal(message.projectsProblem, "unusable");
  assert.match(message.projectsDetail, /world is read-only/);
});

test("group order parsing rejects civilian, foreign and retired speakers before any Project mutation", async () => {
  let called = false;
  for (const recipient of [
    { ...contact, recipientType: ADVISOR_RECIPIENT_TYPES.CIVILIAN },
    { ...contact, recipientType: ADVISOR_RECIPIENT_TYPES.FOREIGN_OFFICIAL },
    { ...contact, archived: true },
    { ...contact, id: "advisor-other-001" },
  ]) {
    await assert.rejects(route("```projects\n[]\n```", {
      recipient,
      mutateWorldState: async () => { called = true; },
    }), /Only an active government/);
  }
  assert.equal(called, false);
});
