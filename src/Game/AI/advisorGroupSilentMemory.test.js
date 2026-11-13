import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ADVISOR_MEMORY_DIRECTIVE, advisorMemoryDirectiveForMode } from "./advisorMemory.js";
import { parseAdvisorGroupIndividualReply, selectAdvisorGroupSpeakers } from "./advisorGroupMeetings.js";
import { parseAdvisorGroupBatch, buildAdvisorSharedBatchPrompt } from "./advisorGroupBatching.js";

const contacts = [
  { id: "pip-id", name: "Grand Chancellor Pip", title: "Grand Chancellor" },
  { id: "silt-id", name: "Silt-Tooth", title: "Minister" },
];
const ids = contacts.map((p) => p.id);
const crownCouncilReply = [
  "[[PASS]]",
  "ADVISOR_MEMORY:Player asked who they are; King Rufus IV clarified player is the sovereign monarch.",
].join("\n");

test("one-to-one retains full durable-memory instructions while individual group and JSON batch get exclusive pass rules", () => {
  assert.equal(advisorMemoryDirectiveForMode(false), ADVISOR_MEMORY_DIRECTIVE);
  assert.match(ADVISOR_MEMORY_DIRECTIVE, /end EVERY reply/);
  const group = advisorMemoryDirectiveForMode(true);
  const batch = advisorMemoryDirectiveForMode("batch");
  assert.doesNotMatch(group, /end EVERY reply/i);
  assert.doesNotMatch(batch, /end EVERY reply/i);
  assert.match(group, /exactly \[\[PASS\]\]/);
  assert.match(group, /no ADVISOR_MEMORY/i);
  assert.match(group, /ADVISOR_MEMORY:<memory>/);
  assert.match(batch, /JSON memory field/i);
  assert.match(batch, /pass: true/i);
  assert.match(batch, /no ADVISOR_MEMORY/i);
  assert.notEqual(group, batch);
});

test("Pip's captured [[PASS]] plus ADVISOR_MEMORY is rejected before any saved speaker reply", () => {
  assert.throws(() => parseAdvisorGroupIndividualReply(crownCouncilReply, ids[0], contacts[0].name),
    /Silent group member Grand Chancellor Pip cannot write private memory/);
  assert.deepEqual(parseAdvisorGroupIndividualReply("[[PASS]]", ids[1], contacts[1].name),
    { role: "advisor", speakerId: ids[1], silent: true, text: "" });
  assert.throws(() => parseAdvisorGroupIndividualReply("", ids[0], contacts[0].name), /empty reply/);
  assert.throws(() => parseAdvisorGroupIndividualReply("[[PASS]]\nADVISOR_MEMORY:", ids[0], contacts[0].name),
    /invalid partial pass/);
  assert.throws(() => parseAdvisorGroupIndividualReply("[[PASS]] and more text", ids[0], contacts[0].name),
    /invalid partial pass/);
});

test("a substantive individual group reply retains fenced Action proposals and optional private memory", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const text = "I disagree: this plan endangers our roads.";
  const raw = text + "\n\n" + fence + "actions\n" + '[{"title":"Independent inspection","text":"Assess the roads"}]'
    + "\n" + fence + "\nADVISOR_MEMORY:Player prioritizes emergency road repairs.";
  const parsed = parseAdvisorGroupIndividualReply(raw, ids[0], contacts[0].name);
  assert.equal(parsed.speakerId, ids[0]);
  assert.equal(parsed.memory, "Player prioritizes emergency road repairs.");
  assert.ok(parsed.text.includes(fence + "actions"));
  assert.ok(parsed.text.startsWith(text));
  assert.ok(!parsed.text.includes("ADVISOR_MEMORY"));
  assert.deepEqual(parseAdvisorGroupIndividualReply(text, ids[0], contacts[0].name),
    { role: "advisor", speakerId: ids[0], text });
});

test("shared JSON passes reject memory, while substantive objections may carry structured memory", () => {
  const valid = JSON.stringify({ replies: [
    { speakerId: ids[0], pass: true, text: "" },
    { speakerId: ids[1], pass: false, text: "I disagree.", memory: "Raised a safety concern." },
  ] });
  const parsed = parseAdvisorGroupBatch(valid, ids);
  assert.deepEqual(parsed[0], { role: "advisor", speakerId: ids[0], silent: true, text: "" });
  assert.equal(parsed[1].memory, "Raised a safety concern.");
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: [
    { speakerId: ids[0], pass: true, text: "", memory: "Pip remains on standby." },
    { speakerId: ids[1], pass: true, text: "" },
  ] }), ids), /invalid silent/);
  assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies: [
    { speakerId: ids[0], pass: false, text: "I disagree.\nADVISOR_MEMORY:do not show this" },
    { speakerId: ids[1], pass: true, text: "" },
  ] }), ids), /JSON memory field/);
});

test("shared-batch prompt and assembled system both specify JSON memory, never an external suffix", () => {
  const prompt = buildAdvisorSharedBatchPrompt({
    groupName: "Crown Council", memberIds: ids, contacts, question: "Who is the sovereign?",
    transcript: "[Player]: Who is the sovereign?",
  });
  assert.match(prompt, /optional memory string/);
  assert.match(prompt, /pass:true with empty text and no memory/);
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.match(source, /advisorMemoryDirectiveForMode\(meetingMode\)/);
  const start = source.indexOf("export async function sendAdvisorGroupMessage");
  const end = source.indexOf("export async function buildDiplomaticSystemPrompt", start);
  const groupSource = source.slice(start, end);
  assert.match(groupSource, /parseAdvisorGroupIndividualReply\(raw, speakerId, name\)/);
  assert.ok(groupSource.indexOf("parseAdvisorGroupIndividualReply(raw, speakerId, name)") <
    groupSource.indexOf("onSpeakerComplete(record)"), "validate before callback and any state mutation");
  assert.match(groupSource, /parseAdvisorGroupBatch\(raw, batch\)/);
});

test("a failing late speaker does not erase the completed earlier speaker or repeat their work on retry", () => {
  const question = "All members should assess the response.";
  const conversation = [{ role: "user", text: question }];
  const first = parseAdvisorGroupIndividualReply("[[PASS]]", ids[1], contacts[1].name);
  conversation.push(first);
  assert.throws(() => parseAdvisorGroupIndividualReply(crownCouncilReply, ids[0], contacts[0].name),
    /cannot write private memory/);
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, conversation, question, contacts, "Chief"), [ids[0]]);
  const recovered = parseAdvisorGroupIndividualReply(
    "I have a material objection.\nADVISOR_MEMORY:King Rufus IV remains sovereign.",
    ids[0], contacts[0].name,
  );
  conversation.push(recovered);
  assert.deepEqual(selectAdvisorGroupSpeakers(ids, conversation, question, contacts, "Chief"), []);
  assert.equal(conversation.filter((row) => row.speakerId === ids[1]).length, 1);
});
