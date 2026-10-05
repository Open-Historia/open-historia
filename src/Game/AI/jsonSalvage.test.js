/*! Open Historia — model-output JSON salvage tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
"interactive":null,
"diplomaticOutreach":[]
}
}
]`;
  const args = unwrapMimickedToolCall(extractJsonPayload(raw), TOOL);
  assert.equal(args.stopDate, "2032-11-02");
  assert.equal(args.events.length, 1);
  assert.equal(args.clearActions, true);
});

// A player's koboldcpp log (2026-10-05): asked for a tool call, the model wrote
// the call as its text in the shape it has on the OpenAI wire. The turn fell
// back ("answered after 3 lookup rounds without calling the output function"),
// and the Projects board was held on "$ must be object; received array".
// The start of one of those replies, as logged.
const WIRE_CALL_REPLY = `[
{
"id": "call_001",
"type": "function",
"function": {
"name": "submit_jump_result",
"arguments": {
"events": [
{
"date": "2014-03-26",
"title": "Путин начал инспекцию военных баз по линии реформ",
"description": "Президент Владимир Путин начал серию визитов на ключевые армейские гарнизоны.",
"importance": "major",
"kind": "player",
"tags": ["Military", "Politics"],
"notable": true,
"playerRelated": true,
"warId": "",
"combatants": []
}
],
"stopDate": "2014-03-26",
"summary": "Инспекции начались."
}
}
}
]`;

test("a tool call written in the OpenAI wire shape yields its arguments", () => {
  const args = unwrapMimickedToolCall(extractJsonPayload(WIRE_CALL_REPLY), TOOL);
  assert.equal(args.stopDate, "2014-03-26");
  assert.equal(args.events.length, 1);
  assert.equal(args.events[0].title, "Путин начал инспекцию военных баз по линии реформ");
});

test("the wire shape is opened with its arguments as a JSON string, and outside an array", () => {
  const payload = { events: [{ title: "One" }], stopDate: "2032-11-02" };
  // What the wire itself carries: `arguments` is a string of JSON.
  const asString = [{ id: "call_1", type: "function", function: { name: TOOL, arguments: JSON.stringify(payload) } }];
  assert.deepEqual(unwrapMimickedToolCall(asString, TOOL), payload);
  const bare = { id: "call_1", type: "function", index: 0, function: { name: TOOL, arguments: payload } };
  assert.deepEqual(unwrapMimickedToolCall(bare, TOOL), payload);
  // `parameters`, as the flat mimicry spells it, is read here too.
  assert.deepEqual(unwrapMimickedToolCall({ type: "function", function: { name: TOOL, parameters: payload } }, TOOL), payload);
  // A task with no registered tool has no name to check: the envelope alone decides.
  assert.deepEqual(unwrapMimickedToolCall(asString, null), payload);
  assert.deepEqual(unwrapMimickedToolCall({ function: { arguments: payload } }, TOOL), payload);
});

test("a wire-shaped call that is not the answer is left as it was", () => {
  // A lookup the model wrote out instead of making: not the output function.
  const lookup = [{ id: "call_1", type: "function", function: { name: "list_regions", arguments: { owner: "Russian Federation" } } }];
  assert.equal(unwrapMimickedToolCall(lookup, TOOL), lookup);
  // Arguments that are not an object, or not JSON, are not a payload.
  const broken = { type: "function", function: { name: TOOL, arguments: '{"events":[' } };
  assert.equal(unwrapMimickedToolCall(broken, TOOL), broken);
  const scalar = { type: "function", function: { name: TOOL, arguments: 3 } };
  assert.equal(unwrapMimickedToolCall(scalar, TOOL), scalar);
  // Two calls are two answers; neither is chosen.
  const two = [lookup[0], { type: "function", function: { name: TOOL, arguments: {} } }];
  assert.equal(unwrapMimickedToolCall(two, TOOL), two);
});

test("a real payload with a field called function is not mistaken for the wire envelope", () => {
  // Something beside the envelope's own keys: this is content, not a wrapper.
  const payload = { function: { name: TOOL, arguments: { events: [] } }, events: [{ title: "Kept" }], summary: "A real answer." };
  assert.equal(unwrapMimickedToolCall(payload, TOOL), payload);
  // `type` says what the envelope holds, and only "function" is a call.
  const other = { type: "report", function: { name: TOOL, arguments: { events: [] } } };
  assert.equal(unwrapMimickedToolCall(other, TOOL), other);
  // With no tool name to check, the inner object must be an envelope and nothing else.
  const loose = { type: "function", function: { name: "whatever", arguments: { a: 1 }, events: [] } };
  assert.equal(unwrapMimickedToolCall(loose, null), loose);
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

// A DeepSeek V4 Flash field report: copying the board prompt's `Operation "Name"`
// title into its answer left one unescaped pair of quotes, and the whole reply
// stopped being JSON — which held the turn. Verbatim from the log.
test("a quote copied into a string without its backslash no longer sinks the reply", () => {
  const raw = '{"projectOps":[{"op":"update","projectId":"project-0-mtuaa589-l1rt3ud","name":"Operation "Саммит Нормандской четвёрки"","eventIndex":0,"progress":18,"lastUpdate":"Инициатива начала реализацию."}]}';
  const parsed = extractJsonPayload(raw);
  assert.equal(parsed?.projectOps?.[0]?.name, 'Operation "Саммит Нормандской четвёрки"');
  assert.equal(parsed.projectOps[0].projectId, "project-0-mtuaa589-l1rt3ud");
  assert.equal(parsed.projectOps[0].progress, 18);
});

test("a quote mid-string is content; only a quote before a separator closes the string", () => {
  assert.deepEqual(
    extractJsonPayload('{"note":"he called it "the plan" in public","ok":true}'),
    { note: 'he called it "the plan" in public', ok: true },
  );
});

test("quotes that were escaped properly are left exactly as they were", () => {
  assert.deepEqual(extractJsonPayload('{"note":"a \\"b\\" c"}'), { note: 'a "b" c' });
});

test("extractJsonArray: strict first, then the repairs, then the first balanced array in the text", async () => {
  const { extractJsonArray } = await import("./jsonSalvage.js");
  assert.deepEqual(extractJsonArray("[]"), []);
  assert.deepEqual(extractJsonArray('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(extractJsonArray('[{"a":1},]'), [{ a: 1 }], "a trailing comma is repaired");
  assert.deepEqual(extractJsonArray("[{“a”:“b”}]"), [{ a: "b" }], "smart quotes are repaired");
  assert.deepEqual(extractJsonArray('[{"a":1}] // nothing else moved'), [{ a: 1 }], "a remark after the array is ignored");
  assert.deepEqual(extractJsonArray('Here you go: [{"a":1}] and [{"b":2}]'), [{ a: 1 }], "the first array wins");
  assert.deepEqual(extractJsonArray('{"wrapper":true} [{"a":1}]'), [{ a: 1 }], "an object before the array is skipped");
  assert.equal(extractJsonArray('{"a":1}'), null, "an object alone is not an array");
  assert.equal(extractJsonArray("no json here"), null);
  assert.equal(extractJsonArray(""), null);
});
