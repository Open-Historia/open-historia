import assert from "node:assert/strict";
import test from "node:test";
import { buildIdleConversationBrief, idleThreadChangedSince, orderOpenDiplomaticChats } from "./idleConversationContext.js";

const chat = (id, lastDate, lastText) => ({
  id, status: "open", countries: [{ name: id }],
  messages: [{ speaker: "Russia", time: lastDate, text: "Earlier exchange" }, { speaker: id, time: lastDate, text: lastText }],
});

test("idle diplomacy orders by actual message date instead of thread storage position", () => {
  const belarus = chat("Belarus", "2029-06-06", "The June 1 sovereign equality framework is signed; our commission is implementing it.");
  const old = Array.from({ length: 10 }, (_, i) => chat(`P${i}`, "2026-01-01", "Ancient greeting"));
  const rows = [belarus, ...old];
  assert.equal(orderOpenDiplomaticChats(rows)[0].chat.id, "Belarus");
  const brief = buildIdleConversationBrief(rows);
  assert.match(brief.text, /With Belarus.*recent discussion/);
  assert.match(brief.text, /framework is signed/);
  assert.equal(brief.includedChatIds[0], "Belarus");
});

test("recent full threads and older compact threads both retain speaker and latest obligation", () => {
  const rows = Array.from({ length: 15 }, (_, i) => chat(`Polity${i}`, `2029-07-${String(i + 1).padStart(2, "0")}`, `Our signed framework number ${i} is in implementation.`));
  const brief = buildIdleConversationBrief(rows, { fullLimit: 3, summaryLimit: 12, maxChars: 6000 });
  assert.ok(brief.text.includes("With Polity14"));
  assert.ok(brief.text.includes("With Polity0"));
  assert.match(brief.text, /Polity0: Our signed framework number 0 is in implementation/);
  assert.deepEqual(brief.includedChatIds.length, 15);
  assert.ok(brief.text.length <= 6100);
});

test("large history stays bounded and omitted destinations are not falsely presented as briefed", () => {
  const rows = Array.from({ length: 90 }, (_, i) => chat(`P${i}`, `2029-06-${String((i % 30) + 1).padStart(2, "0")}`, "X".repeat(500)));
  const brief = buildIdleConversationBrief(rows, { fullLimit: 3, summaryLimit: 15, maxChars: 3000 });
  assert.ok(brief.includedChatIds.length < rows.length);
  assert.match(brief.text, /other open thread\(s\) omitted/);
  assert.ok(brief.text.length < 3200);
});

test("a changed conversation tip invalidates a note generated against the previous state", () => {
  const before = chat("Belarus", "2029-06-06", "The treaty has been signed.");
  const after = structuredClone(before);
  assert.equal(idleThreadChangedSince(before, after), false);
  after.messages.push({ speaker: "Russia", time: "2029-07-02", text: "We already created the commission." });
  assert.equal(idleThreadChangedSince(before, after), true);
  assert.equal(idleThreadChangedSince(null, before), true);
  assert.equal(idleThreadChangedSince(before, { ...before, id: "other" }), true);
});
