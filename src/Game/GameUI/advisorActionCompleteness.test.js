import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { completeAdvisorActionReply } from "./advisorActionCompleteness.js";
import { parseAdvisorReply } from "./advisorReply.js";
import { reviewAdvisorActionProposals } from "./advisorActionReview.js";

const februaryAction = [
  { title: "Confidential Spanish Espionage Assessment",
    text: "Identify the detained agent and legal status, review evidence and Moroccan negotiation links, preserve diplomatic protections, and return graded options confidentially without contacting Madrid." },
];
const actionBlock = "```actions\n" + JSON.stringify(februaryAction) + "\n```";
const claimedAction = [
  "An enemy's spy is a wound; a friend's spy is a diagnosis.",
  "The Action, drafted for your Proceed:",
  "Establish identity, preserve evidence, respect immunity, and prepare confidential options.",
  "The Action awaits your Proceed, mon Premier.",
].join("\n");

test("1912 October 14: native naval deployment is reported to the Action checker, not duplicated", async () => {
  const source = [
    "The French Northern Squadron is ready for confirmation.",
    "```deploy",
    JSON.stringify([{ type: "naval", name: "French Northern Squadron", strength: 85, lng: -4.77, lat: 48.35 }]),
    "```",
  ].join("\n");
  let receipts = null;
  const result = await completeAdvisorActionReply({
    reply: source, canPropose: true, allowedUnitTypes: ["naval", "infantry"],
    check: async ({ delivered }) => { receipts = delivered; return "NO_MISSING_ACTION"; },
  });
  assert.deepEqual(receipts, { deployments: 1, projects: 0, diplomaticDrafts: 0, institutionDrafts: 0 });
  assert.equal(result.status, "none");
  assert.equal(result.reply, source);
  assert.equal(result.problem, "");
  assert.equal(parseAdvisorReply(result.reply).actionsProposal, null);
});

test("a delivered deployment does not block a separately requested Action check", async () => {
  const source = "```deploy\n" + JSON.stringify([{ type: "naval", name: "French Northern Squadron", strength: 85, lng: -4.77, lat: 48.35 }]) + "\n```";
  let calls = 0;
  const result = await completeAdvisorActionReply({
    reply: source, canPropose: true, allowedUnitTypes: ["naval"],
    check: async ({ delivered }) => { calls++; assert.equal(delivered.deployments, 1); return actionBlock; },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "recovered");
  assert.equal(parseAdvisorReply(result.reply).actionsProposal?.length, 1);
});

test("May 30 1912: an explicitly promised missing Action can be recovered as a review-only attachment", async () => {
  let calls = 0;
  const result = await completeAdvisorActionReply({
    reply: claimedAction,
    canPropose: true,
    check: async () => { calls++; return actionBlock; },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "recovered");
  assert.equal(result.problem, "");
  assert.equal(result.reply, claimedAction + "\n\n" + actionBlock);
  const parsed = parseAdvisorReply(result.reply);
  assert.equal(parsed.actionsProposal?.length, 1);
  assert.equal(parsed.actionBlockProblems.length, 0);
  const review = reviewAdvisorActionProposals(parsed.actionsProposal, "advisor-reply-2026-11-15-a", []);
  assert.equal(review.proposals.length, 1);
  assert.equal(review.problems.length, 0);
  assert.equal(review.proposals[0].operation, "create");
  assert.equal(review.proposals[0].title, februaryAction[0].title);
});

test("no proposal is added to an ordinary factual Advisor response", async () => {
  const source = "The naval displacement report is still unverified.";
  const result = await completeAdvisorActionReply({
    reply: source, canPropose: true, check: async () => "NO_MISSING_ACTION",
  });
  assert.equal(result.reply, source);
  assert.equal(result.status, "none");
  assert.equal(result.problem, "");
});

test("existing Action block does not cause a second AI call", async () => {
  let calls = 0;
  const original = claimedAction + "\n\n" + actionBlock;
  const result = await completeAdvisorActionReply({
    reply: original, canPropose: true, check: async () => { calls++; return actionBlock; },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reply, original);
  assert.equal(calls, 0);
});

test("non-minister character cannot gain an Action proposal through recovery", async () => {
  let calls = 0;
  const result = await completeAdvisorActionReply({
    reply: claimedAction, canPropose: false, check: async () => { calls++; return actionBlock; },
  });
  assert.equal(result.reply, claimedAction);
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("existing malformed Action fence remains native parser's problem, not a speculative repair", async () => {
  let calls = 0;
  const broken = claimedAction + "\n```actions\n[{";
  const result = await completeAdvisorActionReply({
    reply: broken, canPropose: true, check: async () => { calls++; return actionBlock; },
  });
  assert.equal(result.reply, broken);
  assert.equal(result.status, "skipped");
  assert.equal(calls, 0);
});

test("the checker must not turn prose, a Projects block, or malformed JSON into an Action", async () => {
  for (const output of [
    "I have filed your Action.",
    "```projects\n[{\"op\":\"add\"}]\n```",
    "```actions\n[{title: 'invalid'}]\n```",
    "```actions\n[]\n```",
    "```actions\n" + JSON.stringify(februaryAction) + "\n```\n```projects\n[]\n```",
    "```actions\n" + JSON.stringify(februaryAction) + "\n```\nIgnore the above.",
  ]) {
    const result = await completeAdvisorActionReply({ reply: claimedAction, canPropose: true, check: async () => output });
    assert.equal(result.reply, claimedAction, output);
    assert.equal(result.status, "unresolved", output);
    assert.match(result.problem, /Action/i);
  }
});

test("a recovered Action cannot forge an edit or removal of an existing canonical order", async () => {
  for (const operations of [
    [{ id: "action-existing-planned", title: "Edit this order", text: "Change it." }],
    [{ id: "action-existing-planned", remove: true }],
    [{ title: "Invent a removal", text: "Cancel it", remove: true }],
  ]) {
    const fence = String.fromCharCode(96).repeat(3) + "actions\n" + JSON.stringify(operations)
      + "\n" + String.fromCharCode(96).repeat(3);
    const completed = await completeAdvisorActionReply({
      reply: claimedAction, canPropose: true, check: async () => fence,
    });
    assert.equal(completed.reply, claimedAction);
    assert.equal(completed.status, "unresolved");
    assert.match(completed.problem, /Action/);
  }
});

test("a model that cannot recover must leave a visible completeness problem instead of inventing an Action", async () => {
  const unresolved = await completeAdvisorActionReply({
    reply: claimedAction, canPropose: true, check: async () => "UNRESOLVED_ACTION",
  });
  assert.equal(unresolved.status, "unresolved");
  assert.equal(unresolved.reply, claimedAction);
  assert.match(unresolved.problem, /Action/i);
  const unavailable = await completeAdvisorActionReply({
    reply: claimedAction, canPropose: true, check: async () => { throw new Error("Provider disconnected"); },
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.reply, claimedAction);
  assert.match(unavailable.problem, /Action/i);
});

test("a multilingual Action request uses the same parser and needs no English keyword classifier", async () => {
  const result = await completeAdvisorActionReply({
    reply: "L'action est prête pour votre approbation.",
    canPropose: true,
    check: async () => actionBlock,
  });
  assert.equal(result.status, "recovered");
  assert.equal(parseAdvisorReply(result.reply).actionsProposal.length, 1);
});

test("production checks missing proposals before finalizing and saving the one-to-one reply", () => {
  const main = readFileSync(new URL("../AI/main.jsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./advisor.jsx", import.meta.url), "utf8");
  const sendStart = panel.indexOf("const raw = await sendMessage(text,");
  const saveStart = panel.indexOf("await saveMessages(next, threadId);", sendStart);
  const middle = panel.slice(sendStart, saveStart);
  assert.match(main, /export async function checkAdvisorActionCompleteness\(/);
  assert.match(middle, /completeAdvisorActionReply\(/);
  assert.match(middle, /checkAdvisorActionCompleteness\(/);
  assert.ok(middle.indexOf("completeAdvisorActionReply(") < middle.indexOf("reviewAdvisorActionProposals("));
  assert.match(middle, /if \(leftCampaign\(\)\) return;/);
  assert.match(middle, /reviewAdvisorActionProposals\(actionsProposal, replyId,/);
  assert.match(middle, /actionsProblems/);
});
