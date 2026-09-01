/*! Open Historia — model-output JSON salvage tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/jsonSalvage.test.js
//
// Runs without node_modules: jsonSalvage.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_SENTINEL,
  ANSWER_SENTINEL_DIRECTIVE,
  extractJsonPayload,
  stripBeforeSentinel,
  unwrapMimickedToolCall,
} from "./jsonSalvage.js";

const TOOL = "submit_jump_result";

test("well-formed output is returned untouched", () => {
  const parsed = extractJsonPayload('{"stopDate":"2032-11-02","events":[]}');
  assert.deepEqual(parsed, { stopDate: "2032-11-02", events: [] });
});

test("an intact block still wins over a later unterminated one", () => {
  const parsed = extractJsonPayload('{"stopDate":"2032-11-02"} and then {"stopDate":"bad"');
  assert.deepEqual(parsed, { stopDate: "2032-11-02" });
});

// The reported nemotron failure: the model mimicked a tool call, opened TWO
// arrays around it and closed only one. Every byte of the turn was there —
// 16 events and their projectOps — and all of it fell back for one bracket.
test("a mimicked tool call missing its outer bracket still yields the arguments", () => {
  const raw = `[
[
{
"name":"submit_jump_result",
"parameters":{
"events":[{"date":"2032-11-01","title":"Hyperion battalion assigned","description":"Deployed."}],
"stopDate":"2032-11-02",
"summary":"A wave of programme initiations.",
"clearActions":true,
"catalyst":null,
"diplomaticOutreach":[]
}
}
]`;
  const args = unwrapMimickedToolCall(extractJsonPayload(raw), TOOL);
  assert.equal(args.stopDate, "2032-11-02");
  assert.equal(args.events.length, 1);
  assert.equal(args.clearActions, true);
});

test("a brace inside a string is not counted as structure", () => {
  const parsed = extractJsonPayload('Here you go: {"summary":"the {plan} is set","events":[{"title":"a [b] c"}]} done.');
  assert.equal(parsed.summary, "the {plan} is set");
  assert.equal(parsed.events[0].title, "a [b] c");
});

test("a comma inside a string does not disqualify the envelope", () => {
  const parsed = extractJsonPayload('[[{"summary":"US, Canada, Australia"}]');
  assert.deepEqual(parsed, [[{ summary: "US, Canada, Australia" }]]);
});

// Everything below is a genuinely truncated response. Closing these off would
// hand the engine a shortened turn dressed up as a complete one, so salvage
// must decline and let the caller fall back.
test("a response cut off mid-string is not salvaged", () => {
  assert.equal(
    extractJsonPayload('{"stopDate":"2032-11-02","events":[{"title":"One"},{"title":"Tw'),
    null,
  );
});

test("a response cut off between values is not salvaged", () => {
  assert.equal(extractJsonPayload('{"events":[{"title":"One"},{"title":"Two"}'), null);
});

test("a response cut off on a dangling comma is not salvaged", () => {
  assert.equal(extractJsonPayload('{"events":[{"title":"One"}],'), null);
});

test("a response cut off mid-number is not salvaged", () => {
  assert.equal(extractJsonPayload('{"events":[{"title":"One","progress":7'), null);
});

test("unsalvageable text still returns null", () => {
  assert.equal(extractJsonPayload("I'm sorry, I can't produce that."), null);
});

test("an unclosed object is not salvaged even when it ends on a closed value", () => {
  assert.equal(extractJsonPayload('{"events":[{"title":"One"}]'), null);
});

test("an unclosed array mid-list is not salvaged", () => {
  assert.equal(extractJsonPayload('[{"title":"One"},{"title":"Two"}'), null);
});

test("a complete inner list inside the unclosed envelope is kept whole", () => {
  const parsed = extractJsonPayload('[[{"a":1},{"b":2}]');
  assert.deepEqual(parsed, [[{ a: 1 }, { b: 2 }]]);
});

test("a bare unclosed bracket is not salvaged", () => {
  assert.equal(extractJsonPayload("[["), null);
});

// ---------------------------------------------------------------------------
// The answer sentinel
//
// <think> tags only help when a model emits them. Several do not — they narrate
// the plan as ordinary content and never switch to answering (a 192-second,
// correct, entirely useless plan ending "Let's craft 11 events"). The sentinel
// gives such a model a defined moment to stop, and gives us a cut point that
// does not depend on guessing where prose ends.

test("everything before the sentinel is discarded", () => {
  const reply = `We need to produce JSON with 11 events. Let's craft them.
${ANSWER_SENTINEL}
{"summary":"A quarter passes.","events":[]}`;
  assert.deepEqual(extractJsonPayload(reply), { summary: "A quarter passes.", events: [] });
});

// A model that restates the instruction while planning would otherwise have its
// own plan read as the answer, so the LAST marker wins, not the first.
test("a sentinel quoted inside the reasoning does not win", () => {
  const reply = `First I will think, then I write ${ANSWER_SENTINEL} followed by the object.
Still planning here: 11 events, dates spread across the span.
${ANSWER_SENTINEL}
{"summary":"real answer","events":[]}`;
  assert.deepEqual(extractJsonPayload(reply), { summary: "real answer", events: [] });
});

test("stripBeforeSentinel leaves text without a sentinel untouched", () => {
  // Every model that already answers correctly must be unaffected.
  assert.equal(stripBeforeSentinel('{"a":1}'), '{"a":1}');
  assert.equal(stripBeforeSentinel(""), "");
  assert.equal(stripBeforeSentinel(null), "");
  assert.deepEqual(extractJsonPayload('{"summary":"no sentinel needed"}'), { summary: "no sentinel needed" });
});

test("the sentinel composes with the existing think-block stripping", () => {
  const reply = `<think>internal</think>
${ANSWER_SENTINEL}
{"summary":"both handled"}`;
  assert.deepEqual(extractJsonPayload(reply), { summary: "both handled" });
});

test("the directive actually names the marker it asks for", () => {
  assert.ok(ANSWER_SENTINEL_DIRECTIVE.includes(ANSWER_SENTINEL));
});
