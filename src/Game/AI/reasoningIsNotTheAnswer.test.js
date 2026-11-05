import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { REASONING_ONLY_MESSAGE, REASONING_ONLY_NOTE } from "./providerErrors.js";

// A player's log (2026-10-12): a time skip on an OpenAI-compatible endpoint
// fell back after two requests with "$.events is required." The endpoint
// returned the model's reasoning apart from an answer the model never wrote;
// the reasoning was handed to the JSON reader as the answer, and the first
// fragment of the planning that parsed was taken for the turn. main.jsx and
// gameplay.js do not load under bare node, so their part is read as source.
const main = fs.readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const task = gameplay.slice(gameplay.indexOf("const runJsonTask = async"));

test("a structured task is never handed the model's reasoning as its answer", () => {
  // The fallback to reasoning (#540) stays for a reply in words, and only there.
  assert.match(main, /function extractOpenAIMessageText\(data, \{ reasoningFallback = true \} = \{\}\)/);
  assert.match(main, /if \(!text && reasoningFallback\) text = stripThinking\(message\?\.reasoning\);/);
  assert.match(main, /const text = extractOpenAIMessageText\(data, \{ reasoningFallback: !tool \}\);/);
});

test("the reasoning goes back beside an empty answer, under its own name", () => {
  assert.match(main, /const reasoningText = tool && !text \? extractOpenAIReasoning\(data\) : "";/);
  assert.match(main, /const thoughtOnly = reasoningText \? \{ reasoningText \} : \{\};/);
  assert.match(main, /return \{ rawText: text, toolInput: null, \.\.\.thoughtOnly \};/);
  // Both names a provider uses for it, and a think block left in the content.
  const reader = main.slice(main.indexOf("function extractOpenAIReasoning"), main.indexOf("function extractOpenAIToolInput"));
  assert.match(reader, /message\?\.reasoning, message\?\.reasoning_content/);
  assert.match(reader, /<think>/);
});

test("reasoning with no answer still steps the structured mode down as it did", () => {
  // The step down read `text`, which used to hold the reasoning. It reads both now.
  assert.match(main, /looksLikeDeliberation\(text \|\| reasoningText\)/);
});

test("the task reads the object its contract asks for, not the first that parses", () => {
  assert.match(task, /const contractKeys = normalizeArray\(tool\?\.schema\?\.required\);/);
  assert.match(task, /extractJsonPayload\(text, \{ prefer: contractFit, fullFit: WHOLE_ANSWER, \.\.\.options \}\)/);
  assert.match(task, /let parsed = response\?\.toolInput \?\? unwrapMimickedToolCall\(readAnswer\(rawText\), tool\?\.name\);/);
  // Whole means the task's own check passes: the tool may ask for a key the
  // check does not insist on.
  assert.match(task, /whole = validateGameplayPayload\(taskKey, shaped\)\.valid === true;/);
});

test("reasoning is read only for a complete answer, and the log says when one was found there", () => {
  assert.match(task, /const reasoningOnly = !rawText && !response\?\.toolInput && Boolean\(reasoningText\);/);
  assert.match(task, /readAnswer\(reasoningText, \{ minFit: WHOLE_ANSWER \}\)/);
  assert.match(task, /the complete answer found inside the reasoning is used\./);
});

test("with no answer, the player is told the model wrote only its reasoning", () => {
  assert.equal(REASONING_ONLY_MESSAGE, "The model wrote only its reasoning and no answer.");
  assert.match(task, /reasoningOnly \|\| \(contractKeys\.length && rawText\.length > PLANNING_PROSE_CHARS\) \? REASONING_ONLY_MESSAGE/);
  // The report shows the reasoning labelled, and the retry does not send it back.
  assert.match(REASONING_ONLY_NOTE, /no answer/);
  assert.match(task, /reasoningOnly \? `\$\{REASONING_ONLY_NOTE\}\\n\$\{reasoningText\}` : ""/);
  assert.match(task, /reasoningOnly \? "\(No answer was written\.\)"/);
});
