// Run: node --test src/Game/AI/advisorMemory.test.js
//
// Past 24 messages the advisor's oldest talk shrinks to snippets and then
// disappears; the ADVISOR_MEMORY line each reply carries is what survives it
// (P10#7).
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADVISOR_MEMORY_DIRECTIVE,
  ADVISOR_MEMORY_MAX_CHARS,
  advisorMemoryContextEntry,
  latestAdvisorMemory,
  splitAdvisorMemory,
  stripAdvisorMemory,
} from "./advisorMemory.js";

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

test("the memory line comes off the reply, fences and all left in place", () => {
  const raw = [
    "Hold the river line through the winter.",
    "",
    fence("actions", '[{"title":"Hold the river"}]'),
    "ADVISOR_MEMORY: Player rejected a spring offensive; prefers defence until the harvest.",
  ].join("\n");
  const { reply, memory } = splitAdvisorMemory(raw);
  assert.equal(memory, "Player rejected a spring offensive; prefers defence until the harvest.");
  assert.ok(!reply.includes("ADVISOR_MEMORY"));
  assert.ok(reply.endsWith("```"), "the actions fence is untouched");
});

test("a reply without the line keeps its text and has no memory", () => {
  assert.deepEqual(splitAdvisorMemory("Just advice."), { reply: "Just advice.", memory: "" });
});

test("the last of two memory lines wins, and neither is shown", () => {
  const { reply, memory } = splitAdvisorMemory("Text.\nADVISOR_MEMORY: old\nMore text.\nadvisor_memory : new");
  assert.equal(memory, "new");
  assert.equal(reply, "Text.\nMore text.");
});

test("a memory longer than the cap is cut", () => {
  const { memory } = splitAdvisorMemory(`Text.\nADVISOR_MEMORY: ${"x".repeat(3000)}`);
  assert.equal(memory.length, ADVISOR_MEMORY_MAX_CHARS);
});

test("a streaming reply never shows the label, even half-written", () => {
  assert.equal(stripAdvisorMemory("Hold the line.\nADVISOR_MEM"), "Hold the line.");
  assert.equal(stripAdvisorMemory("Hold the line.\nADVISOR_MEMORY: Player pref"), "Hold the line.");
  assert.equal(stripAdvisorMemory("Hold the line.\nAdvise the cabinet"), "Hold the line.\nAdvise the cabinet");
});

test("a reload finds the newest memory in the transcript", () => {
  assert.equal(latestAdvisorMemory([
    { role: "advisor", text: "a", memory: "first" },
    { role: "user", text: "q" },
    { role: "advisor", text: "b", memory: "second" },
    { role: "advisor", text: "c" },
    { role: "error", text: "failed", memory: "not an advisor reply" },
  ]), "second");
  assert.equal(latestAdvisorMemory([]), "");
  assert.equal(latestAdvisorMemory(null), "");
});

test("the memory goes to the model as context, not as an instruction", () => {
  assert.equal(advisorMemoryContextEntry(""), null);
  const entry = advisorMemoryContextEntry("Player rejected a spring offensive.");
  assert.equal(entry.role, "user");
  assert.match(entry.parts[0].text, /not a new player instruction/);
  assert.match(entry.parts[0].text, /Player rejected a spring offensive\.$/);
});

test("the directive asks for the exact label the parser reads", () => {
  assert.match(ADVISOR_MEMORY_DIRECTIVE, /^ADVISOR_MEMORY:<memory>$/m);
  const { memory } = splitAdvisorMemory("Reply.\nADVISOR_MEMORY:Player wants brief answers.");
  assert.equal(memory, "Player wants brief answers.");
});
