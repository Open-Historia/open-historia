import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectAdvisorGroupSpeakers, renderAdvisorGroupHistory, OPTIONAL_GROUP_SPEECH_STANDARD } from "./advisorGroupMeetings.js";
import { parseAdvisorGroupBatch, groupSpeakerBatches, advisorBatchOutputContract, buildAdvisorSharedBatchPrompt } from "./advisorGroupBatching.js";
import { createAdvisorContact, createAdvisorGroup, advisorMessagesFor, replaceAdvisorThread } from "../../runtime/advisorThreads.js";
import { stageAdvisorGroupBatch } from "../GameUI/advisorGroupOrders.js";

const contacts = [
  { id: "advisor-viktor-001", name: "Viktor Gusev", title: "Finance Minister" },
  { id: "advisor-marina-001", name: "Marina Voronina", title: "Prime Minister" },
  { id: "advisor-boris-001", name: "Boris Bondarev", title: "Foreign Minister" },
];
const ids = contacts.map((row) => row.id);
const question = "Viktor, can we reach 2 trillion tomorrow?";

test("both generation modes default optional members to silence without suppressing material objections", () => {
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /silence is the default/i);
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /correct an important factual error/i);
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /well-founded objection takes priority over silence/i);
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /repeat agreement/i);
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /exchange pleasantries/i);
  assert.match(OPTIONAL_GROUP_SPEECH_STANDARD, /meeting should end/i);

  const invited = [
    ...contacts,
    { id: "advisor-sergei-001", name: "Sergei Petrov", title: "Defence Minister" },
    { id: "advisor-alex-001", name: "Alex Chen", title: "Energy Minister" },
    { id: "advisor-elena-001", name: "Elena Novak", title: "Interior Minister" },
  ];
  const memberIds = invited.map((person) => person.id);
  const closingMessage = "Thank you, colleagues, for your attention. Viktor - IT adjusted your connection. Marco?";
  // Everyone is asked; each decides whether to speak (the order rotates by turn).
  assert.deepEqual(selectAdvisorGroupSpeakers(memberIds, [{ role: "user", text: closingMessage }]), memberIds);

  // The prompt's example must NOT bias every optional member toward speaking.
  const scaffold = advisorBatchOutputContract(memberIds).replies;
  assert.deepEqual(scaffold.map(({ pass }) => pass), [true, true, true, true, true, true]);
  assert.deepEqual(scaffold.slice(1).map(({ text }) => text), ["", "", "", "", ""]);
  const prompt = buildAdvisorSharedBatchPrompt({
    groupName: "Economic Policy Group", memberIds, contacts: invited,
    chiefName: "Chief",
    question: closingMessage, transcript: "[Viktor]: I will check the report.",
  });
  assert.match(prompt, /silence is the default/i);
  assert.match(prompt, /Do not speak merely to acknowledge/i);
  assert.match(prompt, /pass:true/i);
  assert.match(prompt, /A factual correction or well-founded objection is a reason to speak/i);
  assert.doesNotMatch(prompt, /Generate the next contributions from/);

  const reply = scaffold.map((entry, index) => index === 0
    ? { speakerId: entry.speakerId, pass: false, text: "The Treasury connection is functioning." }
    : entry);
  const parsed = parseAdvisorGroupBatch(JSON.stringify({ replies: reply }), memberIds);
  assert.equal(parsed.filter((record) => !record.silent).length, 1);
  assert.equal(parsed.filter((record) => record.silent).length, 5);
  const dissent = reply.map((entry, index) => index === 3
    ? { speakerId: entry.speakerId, pass: false, text: "The communications test did not verify a backup channel; we need a real failover test." }
    : entry);
  assert.equal(parseAdvisorGroupBatch(JSON.stringify({ replies: dissent }), memberIds)
    .filter((record) => !record.silent).length, 2);
});

test("individual group request uses the same optional-speech threshold, not a universal answer command", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const group = source.slice(source.indexOf("export async function sendAdvisorGroupMessage"), source.indexOf("export async function buildDiplomaticSystemPrompt"));
  assert.match(group, /OPTIONAL_GROUP_SPEECH_STANDARD/);
  assert.match(group, /If you speak, address/);
  assert.match(group, /If no material contribution remains/);
  assert.match(group, /Do not produce a courtesy reply/);
  assert.doesNotMatch(group, /mustSpeak|Required group member|lead respondent/);
  assert.doesNotMatch(group, /Give your own response to the latest question in the group chat transcript/);
  assert.doesNotMatch(group, /Respond now as/);
});

// The speaking order used to put a member the player named first, by parsing
// the message for names after English greetings and "and": a Russian greeting
// or a declined name moved nobody. The order is the turn's rotation now, the
// same whatever the message says and in whatever language; each member reads
// the question and decides whether it is theirs.
test("a name in the player's message does not reorder the speakers, in any language", () => {
  for (const text of [question, "Gusev, are you serious?", "The word Viktorious is not a person's name"]) {
    assert.deepEqual(selectAdvisorGroupSpeakers(ids, [{ role: "user", text }]), ids, text);
  }
  const others = [
    { id: "advisor-anna", name: "Anna Ozola", title: "Minister" },
    { id: "advisor-sara", name: "Sara Jensen", title: "Minister" },
    { id: "advisor-irina", name: "Ирина Белова", title: "Minister" },
  ];
  const otherIds = others.map((person) => person.id);
  for (const text of ["Irina, does the transport plan work?", "Ирина, транспортный план работает?", "Привет, Ирина! Как дела с планом?"]) {
    assert.deepEqual(selectAdvisorGroupSpeakers(otherIds, [{ role: "user", text }]), otherIds, text);
  }
});

test("the order rotates by one each turn the player speaks", () => {
  const turns = (count) => Array.from({ length: count }, (_, index) => ({ role: "user", text: `Question ${index}` }));
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, turns(1)), ids);
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, turns(2)), [ids[1], ids[2], ids[0]]);
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, turns(3)), [ids[2], ids[0], ids[1]]);
});

test("third-person name references and possessives never require unrelated group members", () => {
  const input = "Marina - your proposed Action conflicts in name with Boris's proposed Action.";
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, [{ role: "user", text: input }]), ids, "everyone is asked; none is required");
  const payload = { replies: [
    { speakerId: ids[0], pass: true, text: "" },
    { speakerId: ids[1], pass: false, text: "I will rename the administrative Action." },
    { speakerId: ids[2], pass: true, text: "" },
  ] };
  const records = parseAdvisorGroupBatch(JSON.stringify(payload), ids);
  assert.deepEqual(records.map((row) => row.silent === true), [true, false, true]);
});

test("resume allows remaining dissenters and does not retry completed speaker decisions", () => {
  const initial = [{ role: "user", text: question }];
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, initial), ids);
  const answered = [...initial, { role: "advisor", speakerId: ids[0], text: "Sure" }];
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, answered), [ids[1], ids[2]]);
  const declined = [...answered, { role: "advisor", speakerId: ids[1], silent: true, text: "" }];
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, declined), [ids[2]]);
  const general = [{ role: "user", text: "What should we do about the fiscal deficit?" }];
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, general), ids);
});

test("shared batches allow direct addressees to pass without blocking independent dissent", () => {
  const payload = { replies: [
    { speakerId: ids[0], pass: false, text: "Absolutely, Mr. President." },
    { speakerId: ids[1], pass: false, text: "Viktor, are you mad? That GDP cannot materialize overnight." },
    { speakerId: ids[2], pass: true, text: "" },
  ] };
  const records = parseAdvisorGroupBatch(JSON.stringify(payload), ids);
  assert.deepEqual(records.map((r) => [r.speakerId, !!r.silent]), [[ids[0], false], [ids[1], false], [ids[2], true]]);
  assert.match(records[1].text, /Viktor, are you mad/);
  assert.equal(records[2].text, "");
  assert.equal(groupSpeakerBatches(ids, 3).length, 1);
  const namedMemberPasses = parseAdvisorGroupBatch(JSON.stringify({ replies: [
    { speakerId: ids[0], pass: true, text: "" },
    payload.replies[1], payload.replies[2],
  ] }), ids);
  assert.deepEqual(namedMemberPasses.map((row) => !!row.silent), [true, false, true]);
});

test("a missing response, fake silence, or a silent reply containing operations fails closed", () => {
  const records = [
    { speakerId: ids[0], pass: false, text: "We cannot print GDP overnight." },
    { speakerId: ids[1], pass: true, text: "" },
  ];
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: records.slice(0, 1) }), ids.slice(0, 2)), /exactly/);
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: [records[0], { speakerId: ids[1], text: "" }] }), ids.slice(0, 2)), /invalid/);
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: [records[0], { speakerId: ids[1], pass: true, text: "Execute the Action" }] }), ids.slice(0, 2)), /invalid silent/);
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: [records[0], { speakerId: ids[1], pass: true, memory: "secrets" }] }), ids.slice(0, 2)), /invalid silent/);
  assert.throws(() => stageAdvisorGroupBatch([{ role: "advisor", speakerId: ids[1], silent: true, text: "", actionProposals: [{ id: "forged" }] }], { makeReplyId: () => "advisor-reply-silent-123" }), /silent group participant cannot/);
});

test("silence survives save/reload, remains invisible to subsequent model transcript, and prevents duplicate turns on retry", () => {
  let saved = [];
  for (const person of contacts) saved = createAdvisorContact(saved, person);
  const groupId = "advisor-group-policy-001";
  saved = createAdvisorGroup(saved, { id: groupId, name: "Policy Group", memberIds: ids });
  const messages = [
    { role: "user", text: question },
    { role: "advisor", id: "advisor-reply-viktor-123", speakerId: ids[0], text: "Yes, tomorrow!" },
    { role: "advisor", id: "advisor-reply-marina-123", speakerId: ids[1], text: "Viktor, are you mad?" },
    { role: "advisor", id: "advisor-reply-boris-123", speakerId: ids[2], silent: true, text: "" },
  ];
  saved = replaceAdvisorThread(saved, groupId, messages);
  const recalled = advisorMessagesFor(saved, groupId);
  assert.deepEqual(recalled, messages.map((row) => ({ ...row, threadId: groupId })), "canonical storage must attach the group thread ID without changing participation");
  const transcript = renderAdvisorGroupHistory(recalled, contacts, "Orlov");
  assert.match(transcript, /Viktor, are you mad/);
  assert.doesNotMatch(transcript, /Boris Bondarev/);
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, recalled), []);
  assert.throws(() => replaceAdvisorThread(saved, groupId, messages.map((row) =>
    row.silent ? { ...row, actionProposals: [{ id: "forged" }] } : row
  )), /silent group participant cannot/);
});

test("individual-call mode uses explicit PASS, not an empty, interrupted or ambiguous model response", () => {
  const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const helper = readFileSync(new URL("./advisorGroupMeetings.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../GameUI/advisor.jsx", import.meta.url), "utf8");
  assert.match(main, /parseAdvisorGroupIndividualReply\(raw, speakerId, name\)/);
  assert.match(helper, /reply\.trim\(\) === "\[\[PASS\]\]"/);
  assert.doesNotMatch(main, /mustSpeak\.has\(speakerId\)/);
  assert.match(helper, /returned an empty reply/);
  assert.match(panel, /msg\.silent/);
  assert.match(panel, /onSpeakerComplete: speakerComplete/);
});
