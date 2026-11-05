import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTrailingEventQuote,
  normalizeEventPresentation,
  normalizeEventQuote,
  repairEscapedEventProse,
} from "./eventQuote.js";

test("double-escaped generated paragraphs and quotes are repaired without touching ordinary backslashes", () => {
  assert.equal(
    repairEscapedEventProse('First paragraph.\\n\\n> \\"A proper quotation,\\" The Speaker'),
    'First paragraph.\n\n> "A proper quotation," The Speaker',
  );
  assert.equal(repairEscapedEventProse(String.raw`The file is C:\new\plan.txt.`), String.raw`The file is C:\new\plan.txt.`);
  assert.equal(
    repairEscapedEventProse(String.raw`Path C:\new\plan.txt.\n\n> \"Quoted\"`),
    String.raw`Path C:\new\plan.txt.` + '\n\n> "Quoted"',
    "repairing a real escaped paragraph must not reinterpret an unrelated \\n inside prose",
  );
});

test("a trailing legacy markdown quotation becomes canonical quote metadata", () => {
  const result = extractTrailingEventQuote('The decision is announced.\n\n> "A proper quotation" — The Speaker, Prime Minister');
  assert.equal(result.description, "The decision is announced.");
  assert.deepEqual(result.quote, {
    text: "A proper quotation",
    speaker: "The Speaker",
    role: "Prime Minister",
  });
});

test("prose attribution is preserved honestly rather than guessed into a role", () => {
  const result = extractTrailingEventQuote('The decision is announced.\n\n> "We proceed," a directorate spokesperson announced.');
  assert.deepEqual(result.quote, {
    text: "We proceed,",
    speaker: "a directorate spokesperson announced.",
  });
});

test("a structured quote wins over a duplicated legacy blockquote while the duplicate is removed from prose", () => {
  const result = normalizeEventPresentation({
    description: 'The decision is announced.\\n\\n> \\"Old generated form\\"',
    quote: { text: '"Canonical words"', speaker: "The Speaker", role: "Minister" },
  });
  assert.equal(result.description, "The decision is announced.");
  assert.deepEqual(result.quote, { text: "Canonical words", speaker: "The Speaker", role: "Minister" });
});

test("quote normalization accepts the canonical shape and drops an empty quote", () => {
  assert.deepEqual(normalizeEventQuote({ text: "Words", speaker: "A" }), { text: "Words", speaker: "A" });
  assert.equal(normalizeEventQuote({ text: "   " }), null);
});
