import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  malformedAdvisorGroupSilentPass,
  visibleAdvisorGroupStreamReply,
  parseAdvisorGroupIndividualReply,
  parseAdvisorGroupSilentRepair,
  selectAdvisorGroupSpeakers,
} from "./advisorGroupMeetings.js";

const name = "Étienne de Varenne";
const speakerId = "advisor-varenne";
const badPass = "[[PASS]]\nADVISOR_MEMORY: The prime minister favours an immediate statement.";
const contacts = [{ id: "chief", name: "Chief" }, { id: speakerId, name }];
const question = "What do you recommend for Casablanca?";

test("March 23 Varenne: an invalid silent+memory response qualifies for one format correction but remains invalid canon", () => {
  assert.equal(malformedAdvisorGroupSilentPass(badPass), true);
  assert.throws(() => parseAdvisorGroupIndividualReply(badPass, speakerId, name),
    /Silent group member Étienne de Varenne cannot write private memory/);
  assert.equal(malformedAdvisorGroupSilentPass("[[PASS]]\nADVISOR_MEMORY:"), true);
  assert.equal(malformedAdvisorGroupSilentPass("  [[PASS]] \n ADVISOR_MEMORY: something "), true);
  assert.equal(malformedAdvisorGroupSilentPass("[[PASS]]"), false);
  assert.equal(malformedAdvisorGroupSilentPass("I object.\nADVISOR_MEMORY:keep"), false);
  assert.equal(malformedAdvisorGroupSilentPass("[[PASS]] and I agree"), false);
  assert.equal(malformedAdvisorGroupSilentPass("[[PASS]]\nA substantive note\nADVISOR_MEMORY:bad"), false);
  assert.equal(malformedAdvisorGroupSilentPass(""), false);
});

test("streaming never exposes rejected silent responses or their private memory to the player", () => {
  for (const raw of [
    "[", "[[", "[[PA", "[[PASS]", "[[PASS]]", "[[PASS]]\n",
    "[[PASS]]\nADVISOR_", badPass, "  [[PASS]]\nADVISOR_MEMORY:confidential",
  ]) assert.equal(visibleAdvisorGroupStreamReply(raw), "", JSON.stringify(raw));
  assert.equal(visibleAdvisorGroupStreamReply("I disagree."), "I disagree.");
  assert.equal(visibleAdvisorGroupStreamReply("I disagree.\nADVISOR_MEMORY:private"), "I disagree.");
  assert.equal(visibleAdvisorGroupStreamReply("I disagree.\nADVISOR_MEM"), "I disagree.");
});

test("a short silent-pass correction cannot introduce unsupported speech, memory or operations", () => {
  assert.deepEqual(parseAdvisorGroupSilentRepair("[[PASS]]", speakerId, name),
    { role: "advisor", speakerId, silent: true, text: "" });
  for (const raw of [
    "I now propose a new operation.", "[[PASS]] and more text",
    "[[PASS]]\nADVISOR_MEMORY:secret",
    "[[PASS]]\n" + String.fromCharCode(96).repeat(3) + "actions\n[]",
    "", " ", "{\"pass\":true}",
  ]) {
    assert.throws(() => parseAdvisorGroupSilentRepair(raw, speakerId, name),
      /did not return an exact silent pass/, JSON.stringify(raw));
  }
});

test("one rejected member cannot count as complete until a second response passes the strict validator", () => {
  const first = { role: "user", text: question };
  const alreadyAnswered = parseAdvisorGroupIndividualReply("[[PASS]]", "chief", "Chief");
  const messages = [first, alreadyAnswered];
  assert.deepEqual(selectAdvisorGroupSpeakers(["chief", speakerId], messages, question, contacts, "Chief"), [speakerId]);
  assert.throws(() => parseAdvisorGroupIndividualReply(badPass, speakerId, name));
  assert.deepEqual(selectAdvisorGroupSpeakers(["chief", speakerId], messages, question, contacts, "Chief"), [speakerId]);
  const corrected = parseAdvisorGroupIndividualReply("[[PASS]]", speakerId, name);
  messages.push(corrected);
  assert.deepEqual(selectAdvisorGroupSpeakers(["chief", speakerId], messages, question, contacts, "Chief"), []);
  assert.deepEqual(corrected, { role: "advisor", speakerId, silent: true, text: "" });
  assert.equal(Object.hasOwn(corrected, "memory"), false);
});

test("production retries only malformed silent pass, preserving validation and completed earlier speakers", () => {
  const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const group = main.slice(main.indexOf("export async function sendAdvisorGroupMessage"),
    main.indexOf("export async function buildDiplomaticSystemPrompt"));
  assert.match(group, /malformedAdvisorGroupSilentPass\(raw\)/);
  assert.match(group, /parseAdvisorGroupIndividualReply\(raw, speakerId, name\)/);
  assert.match(group, /parseAdvisorGroupSilentRepair\(correctedRaw, speakerId, name\)/);
  assert.match(group, /maxTokens:\s*64/, "bounded transport-only repair, not another giant campaign prompt");
  assert.match(group, /if \(shouldAbort\?\.\(\)\) throw new Error/);
  assert.ok(group.indexOf("parseAdvisorGroupSilentRepair(correctedRaw, speakerId, name)") <
    group.indexOf("onSpeakerComplete(record)"));
  assert.match(group, /visibleAdvisorGroupStreamReply\(full\)/);
});
