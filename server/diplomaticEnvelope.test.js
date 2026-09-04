import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiplomaticTurnInstruction,
  diplomaticMemoryContextEntry,
  formatDiplomaticTranscriptEntry,
  latestSavedDiplomaticMemory,
  parseDiplomaticEnvelope,
} from "../src/runtime/diplomaticEnvelope.js";

test("the envelope splits the reply, the hidden memory line and the reaction", () => {
  const parsed = parseDiplomaticEnvelope(
    "We will withdraw our garrison by the 20th, provided your ships leave first.\n\n" +
    "DIPLOMATIC_MEMORY: Borduria WILL withdraw the garrison by 1930-05-20 on condition that Ruritania's ships leave first; Ruritania has not yet agreed.\n" +
    "REACTION:🤨",
  );
  assert.equal(parsed.reply, "We will withdraw our garrison by the 20th, provided your ships leave first.");
  assert.equal(parsed.reaction, "🤨");
  assert.match(parsed.memorySummary, /^Borduria WILL withdraw the garrison by 1930-05-20/);
  assert.doesNotMatch(parsed.reply, /DIPLOMATIC_MEMORY|REACTION/);
});

test("a reply without the envelope parts is returned whole, and a multi-line memory is folded", () => {
  assert.deepEqual(parseDiplomaticEnvelope("  Plain words.  "), { reply: "Plain words.", reaction: null, memorySummary: "" });
  const folded = parseDiplomaticEnvelope("Reply.\nDIPLOMATIC_MEMORY: first line\n   second line\nthird");
  assert.equal(folded.reply, "Reply.");
  assert.equal(folded.memorySummary, "first line second line third");
});

test("the newest stored memory wins and is dated by its message", () => {
  const memory = latestSavedDiplomaticMemory([
    { role: "leader", text: "a", time: "1930-01-01", memorySummary: "old" },
    { role: "user", text: "b", time: "1930-02-01" },
    { role: "leader", text: "c", time: "1930-03-01", memorySummary: "new" },
    { role: "leader", text: "d", time: "1930-04-01" },
  ]);
  assert.deepEqual(memory, { summary: "new", time: "1930-03-01" });
  assert.equal(latestSavedDiplomaticMemory([{ role: "user", text: "x" }]), null);
});

test("transcript entries carry the date and the speaker, and the memory context entry is system-side", () => {
  assert.equal(
    formatDiplomaticTranscriptEntry({ speaker: "Ruritania", text: "We object.", time: "1930-05-10" }, (t) => `10 May 1930 (${t})`),
    "[10 May 1930 (1930-05-10)] [Ruritania]: We object.",
  );
  assert.equal(formatDiplomaticTranscriptEntry({ text: "Undated." }), "Undated.");
  const entry = diplomaticMemoryContextEntry("Both sides agreed to talks.", "1930-05-11");
  assert.equal(entry.role, "user");
  assert.match(entry.parts[0].text, /durable diplomatic memory through 1930-05-11/);
  assert.match(entry.parts[0].text, /not a new player instruction/);
  assert.equal(diplomaticMemoryContextEntry(""), null);
});

test("the turn instruction names the voice, carries the prior memory and keeps the reaction contract", () => {
  const instruction = buildDiplomaticTurnInstruction({ speakingAs: "Borduria", priorMemory: "Ruritania demanded the fort." });
  assert.match(instruction, /^\[It is now Borduria's turn/);
  assert.match(instruction, /DIPLOMATIC_MEMORY:<summary>/);
  assert.match(instruction, /Prior durable memory:\nRuritania demanded the fort\./);
  assert.match(instruction, /REACTION:<emoji>/);
  assert.match(buildDiplomaticTurnInstruction({ speakingAs: "X" }), /No durable memory has been established yet/);
});
