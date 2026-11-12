import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redactHistoricalAdvisorActionBlocks, renderHistoricalAdvisorReply, sanitizeAdvisorModelHistory } from "./advisorActionHistory.js";

const resolvedBorisId = "action-advisor-reply-02476f58-879a-4aec-b70c-ecf0c0fd473d-0";
const fabricatedBorisId = "action-advisor-reply-f3p9q2k-x4k1p0w-z9s3t5y-k2j6h4g";
const fabricatedIrinaId = "action-advisor-reply-xxxx-moreau-accountability";

const priorReply = (id, title) =>
  "I will coordinate this with the responsible institutions.\n\n"
  + "```actions\n"
  + JSON.stringify([{ id, title, text: "Complete the next review under the current mandate." }])
  + "\n```\n\nI will report the verified result.";

test("Boris's resolved and fictional Action IDs never re-enter one-to-one model history", () => {
  const saved = [
    { role: "user", parts: [{ text: "Boris, update the existing Libya settlement Action." }] },
    { role: "model", parts: [{ text: priorReply(fabricatedBorisId, "Greek-Russian Maritime Security Initiative") }] },
    { role: "model", parts: [{ text: priorReply(resolvedBorisId, "Sirte Basin Settlement - Staged Sanctions Relief Roadmap") }] },
  ];
  const replay = sanitizeAdvisorModelHistory(saved);
  assert.strictEqual(replay[0], saved[0], "the player's own instructions are preserved");
  for (const row of replay.slice(1)) {
    const text = row.parts[0].text;
    assert.match(text, /I will coordinate this|I will report the verified result/);
    assert.match(text, /Historical Action proposal omitted/);
    assert.doesNotMatch(text, /```actions|action-advisor-reply-/i);
  }
  assert.match(saved[1].parts[0].text, /action-advisor-reply-/, "saved and diagnostic text is never rewritten");
});

test("Irina's fabricated placeholder is removed, not promoted to a new Action", () => {
  const reply = "Preserve evidence, maintain due process.\n```actions\n"
    + JSON.stringify([{ id: fabricatedIrinaId, title: "Moreau Detention - Emergency Judicial Remedy", text: "Investigate audit overrides." },
      { title: "Moreau Case - Independent Merit Review", text: "Review prosecution evidence." }])
    + "\n```";
  const scrubbed = redactHistoricalAdvisorActionBlocks(reply);
  assert.match(scrubbed, /Preserve evidence, maintain due process/);
  assert.match(scrubbed, /Historical Action proposal omitted/);
  assert.doesNotMatch(scrubbed, /xxxx-moreau-accountability|Moreau Case - Independent Merit Review/);
  assert.equal(scrubbed, redactHistoricalAdvisorActionBlocks(scrubbed), "rendering is idempotent");
});

test("saved Action review cards retain bounded history without reviving old IDs or claiming a live queue", () => {
  const message = {
    role: "advisor",
    text: priorReply(resolvedBorisId, "Sirte Basin Settlement - Staged Sanctions Relief Roadmap"),
    actionProposals: [
      { id: "proposal-0", actionId: resolvedBorisId, title: "Sirte Basin Settlement - Staged Sanctions Relief Roadmap" },
      { id: "proposal-1", title: "Priority Green - Personnel & Data Protection" },
    ],
    actionReceipts: { "proposal-0": { status: "queued" } },
  };
  const rendered = renderHistoricalAdvisorReply(message);
  assert.match(rendered, /Sirte Basin Settlement - Staged Sanctions Relief Roadmap/);
  assert.match(rendered, /Priority Green - Personnel & Data Protection/);
  assert.match(rendered, /historical receipt: queued; current status unknown/);
  assert.match(rendered, /no recorded approval receipt/);
  assert.doesNotMatch(rendered, /action-advisor-reply-|\\`\\`\\`actions/);
  assert.match(message.text, /action-advisor-reply-/, "historical content remains available in persisted messages");
  assert.equal(renderHistoricalAdvisorReply({ text: "Ordinary reply without Action proposals" }),
    "Ordinary reply without Action proposals");
});

test("only model Action fences are redacted; player inputs and unrelated structured blocks survive unchanged", () => {
  const userText = "Can you interpret this?\n```actions\n[{\"id\":\"example-from-user\"}]\n```";
  const otherText = "Evidence:\n```json\n{\"id\":\"a\"}\n```\n```projects\n[{\"op\":\"update\"}]\n```";
  const source = [
    { role: "user", parts: [{ text: userText }] },
    { role: "model", parts: [{ text: otherText }, { text: "unrelated provider part" }], retained: true },
    { role: "model", parts: [{ text: priorReply(resolvedBorisId, "Old order") }], retained: true },
  ];
  const result = sanitizeAdvisorModelHistory(source);
  assert.strictEqual(result[0], source[0]);
  assert.strictEqual(result[1], source[1]);
  assert.equal(result[1].parts[1].text, "unrelated provider part");
  assert.equal(result[2].retained, true, "unrelated message metadata is retained");
  assert.equal(result[2].role, "model");
  assert.equal(source[2].parts[0].text.includes(resolvedBorisId), true);
  assert.equal(result[2].parts[0].text.includes(resolvedBorisId), false);
  assert.deepEqual(sanitizeAdvisorModelHistory(result), result);
});

test("an unterminated historical Action fence is not replayed into another AI turn", () => {
  const incomplete = "This work is planned in principle.\n```actions\n"
    + JSON.stringify([{ id: resolvedBorisId, text: "Repeat expired instructions." }]);
  const clean = redactHistoricalAdvisorActionBlocks(incomplete);
  assert.match(clean, /This work is planned in principle/);
  assert.match(clean, /Historical Action proposal omitted/);
  assert.doesNotMatch(clean, /action-advisor-reply-|Repeat expired instructions/);
});

test("production sanitizes both loaded histories and immediate prior replies without mutating raw output", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  assert.match(source, /sanitizeAdvisorModelHistory\(state\.history\)/);
  assert.match(source, /redactHistoricalAdvisorActionBlocks\(shown\)/);
  assert.match(source, /character\s*\?\s*state\.history\s*:\s*sanitizeAdvisorModelHistory\(state\.history\)/);
  assert.match(source, /renderHistoricalAdvisorReply\(msg\)/);
  assert.match(source, /compactConversationHistory\(character \? restoredHistory : sanitizeAdvisorModelHistory\(restoredHistory\)\)/,
    "restored raw fences must be redacted BEFORE the history is compacted");
  assert.match(source, /return reply;/);
  const panel = readFileSync(new URL("../GameUI/advisor.jsx", import.meta.url), "utf8");
  assert.match(panel, /const\s+raw\s*=\s*await\s+sendMessage\(text/);
  assert.match(panel, /loadHistory\(selectedMessages, id, \{ character: advisorContacts\(saved\)\.some/);
  assert.match(panel, /loadHistory\(merged, threadId, \{ character: advisorContacts\(saved\)\.some/);
});
