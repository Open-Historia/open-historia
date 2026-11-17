import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectAdvisorGroupSpeakers, completedSilentGroupTurnIndices, renderAdvisorGroupHistory, GROUP_MEETING_CONTEXT_MAX_CHARS } from "./advisorGroupMeetings.js";
import { advisorBatchOutputContract, buildAdvisorSharedBatchPrompt, parseAdvisorGroupBatch } from "./advisorGroupBatching.js";

const contacts = [
  { id: "fiscal", name: "Viktor Gusev", title: "Finance Minister" },
  { id: "prime", name: "Marina Voronina", title: "Prime Minister" },
  { id: "tech", name: "Sergei Yevtushenko", title: "Technology Minister" },
];
const ids = contacts.map(({ id }) => id);
const rows = (question) => [{ role: "user", text: question }];

test("a named technical instruction and a direct question invite all ministers, including potential dissenters", () => {
  const names = [
    "Sergei, proceed with the technical evaluation exactly as outlined. I appreciate your caution.",
    "Sergei, what would prevent a safe technical evaluation?",
  ];
  for (const question of names) {
    // Every minister is asked, in the turn's rotation; naming Sergei moves nobody.
    assert.deepEqual(selectAdvisorGroupSpeakers(ids, rows(question)), ids);
  }
});

test("individual and shared generation do not require an answer based on address, turn rotation, or lexical action cues", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("export async function sendAdvisorGroupMessage"),
    source.indexOf("export async function buildDiplomaticSystemPrompt"));
  assert.doesNotMatch(block, /requiredAdvisorGroupSpeakers|mustSpeak|Required group member|lead respondent/);
  assert.match(block, /OPTIONAL_GROUP_SPEECH_STANDARD/);
  assert.match(block, /If no material contribution remains/);
  assert.match(block, /renderAdvisorGroupHistory/);
  assert.match(block, /onSpeakerComplete/);
  assert.match(block, /onBatchComplete/);
  assert.doesNotMatch(source, /asksToReconcileActionDraft/);
  const prompt = buildAdvisorSharedBatchPrompt({
    groupName: "Cabinet", memberIds: ids, contacts, question: namespacedOrder,
    transcript: "[Viktor]: Cut spending by 30%.",
  });
  assert.match(prompt, /well-founded objection/i);
  assert.doesNotMatch(prompt, /Required speakers cannot pass/);
  assert.deepEqual(advisorBatchOutputContract(ids).replies.map((row) => row.pass), [true, true, true]);
  const response = { replies: [
    { speakerId: ids[0], pass: true, text: "" },
    { speakerId: ids[1], pass: false, text: "I object: the reduction would endanger winter heating." },
    { speakerId: ids[2], pass: true, text: "" },
  ] };
  assert.equal(parseAdvisorGroupBatch(JSON.stringify(response), ids).filter((row) => !row.silent).length, 1);
});
const namespacedOrder = "Sergei, proceed with your technical evaluation.";

test("all-silent turns are recognized only when every invited stable ID explicitly passed; partial turns and errors are not success", () => {
  const complete = [
    { role: "user", text: "Thank you for your work." },
    { role: "advisor", speakerId: ids[2], silent: true, text: "" },
    { role: "advisor", speakerId: ids[0], silent: true, text: "" },
    { role: "advisor", speakerId: ids[1], silent: true, text: "" },
  ];
  assert.deepEqual(completedSilentGroupTurnIndices(complete, ids), [3]);
  assert.deepEqual(completedSilentGroupTurnIndices(complete.slice(0, -1), ids), []);
  assert.deepEqual(completedSilentGroupTurnIndices([...complete.slice(0, -1),
    { role: "advisor", speakerId: ids[1], text: "The proposal has an unresolved cost." }], ids), []);
  assert.deepEqual(completedSilentGroupTurnIndices([...complete.slice(0, -1),
    { role: "error", text: "Provider failure" }], ids), []);
  assert.deepEqual(completedSilentGroupTurnIndices([...complete.slice(0, -1),
    { role: "advisor", speakerId: ids[0], silent: true, text: "" }], ids), []);
  assert.deepEqual(completedSilentGroupTurnIndices([...complete, { role: "user", text: "Next topic" }], ids), [3]);
});

test("a completed all-pass turn is visibly acknowledged without claiming execution or saving a synthetic minister message", () => {
  const panel = readFileSync(new URL("../GameUI/advisor.jsx", import.meta.url), "utf8");
  assert.match(panel, /completedSilentGroupTurnIndices/);
  assert.match(panel, /role === "group-pass"/);
  assert.match(panel, /groupMemberIds=/);
  assert.doesNotMatch(panel, /saveMessages\([^;]*group-pass/);
});

test("a malformed pass still fails closed rather than being interpreted as intentional silence", () => {
  const malformed = { replies: [
    { speakerId: ids[0], pass: true, text: "I approved an Action" },
    { speakerId: ids[1], pass: true, text: "" },
    { speakerId: ids[2], pass: true, text: "" },
  ] };
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify(malformed), ids), /invalid silent response/);
});

test("long group instructions preserve their closing authorization and caveats in individual and shared prompts", () => {
  const end = "You are explicitly authorized to prepare the Eastern Region Diagnostic Action. Do not deploy military forces or approve capital spending.";
  const question = "Cabinet, review the investigation.\n" + "Detailed background and evidence. ".repeat(330) + "\n" + end;
  assert.ok(question.indexOf(end) > 6500, "the regression places authorization beyond both old truncation boundaries");
  const previous = [{ role: "user", text: "Earlier discussion." },
    { role: "advisor", speakerId: ids[0], text: "We will review the finances." },
    { role: "user", text: question },
    { role: "advisor", speakerId: ids[2], text: "I question the risk assessment." }];
  const transcript = renderAdvisorGroupHistory(previous, contacts, "Chief");
  assert.ok(transcript.includes(question), "latest group message is transmitted verbatim");
  assert.ok(transcript.includes(end), "final authorization and safeguards survive");
  assert.ok(transcript.includes("I question the risk assessment."), "in-turn dissent survives");
  assert.ok(transcript.length <= GROUP_MEETING_CONTEXT_MAX_CHARS);
  const batch = buildAdvisorSharedBatchPrompt({
    groupName: "Cabinet", memberIds: ids, contacts, question, transcript,
  });
  assert.match(batch, /Included verbatim in the chronological transcript/);
  assert.equal(batch.split(end).length - 1, 1, "batch does not duplicate a long latest instruction");
  const standalone = buildAdvisorSharedBatchPrompt({
    groupName: "Cabinet", memberIds: ids, contacts, question, transcript: "Previous notes only.",
  });
  assert.ok(standalone.includes(end), "standalone batch never clips the end of the player's instruction");
});

test("oversized latest group instruction fails explicitly rather than silently dropping its ending", () => {
  const question = "Long case context. ".repeat(1100) + "AUTHORIZE AT END";
  assert.throws(() => renderAdvisorGroupHistory([{ role: "user", text: question }], contacts, "Chief"),
    /too long for the Advisor transcript/);
});
