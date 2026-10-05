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
  parseLooseJson,
  repairLooseJson,
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

// ---------------------------------------------------------------------------
// An answer written as a JavaScript object rather than as JSON.
//
// The first real time skip asked of Gemini as JSON text wrote its events as
// JSON and its unit ops, three levels down, with no quotes on their keys. The
// whole answer stopped parsing, and the skip cost a second request.

test("the answer a real skip wrote, bare keys three levels down, is read", () => {
  const written = `{
  "events": [
    {
      "date": "2016-01-05",
      "title": "United States Army Initiates Exercise Northern Vanguard",
      "impacts": {
        "actionIds": ["probe-order-1"],
        "unitOps": [
          {
            op: "spawn",
            unit: {
              name: "Northern Vanguard Task Force",
              type: "armor",
              strength: 100,
              at: "Fort Drum, New York"
            }
          }
        ]
      }
    }
  ],
  "stopDate": "2016-01-31"
}`;
  assert.throws(() => JSON.parse(written), "it is not JSON as written");
  const read = extractJsonPayload(written);
  assert.equal(read.events[0].impacts.unitOps[0].op, "spawn");
  assert.deepEqual(read.events[0].impacts.unitOps[0].unit, { name: "Northern Vanguard Task Force", type: "armor", strength: 100, at: "Fort Drum, New York" });
  assert.equal(read.stopDate, "2016-01-31");
  assert.deepEqual(parseLooseJson(written), read);
});

test("bare keys, single quotes, comments, trailing commas and a copied ? are each repaired", () => {
  assert.deepEqual(parseLooseJson('{a: 1, b_2: "x", $c: [true, null]}'), { a: 1, b_2: "x", $c: [true, null] });
  assert.deepEqual(parseLooseJson("{'name': 'O\\'Brien', 'quote': 'he said \"no\"'}"), { name: "O'Brien", quote: 'he said "no"' });
  assert.deepEqual(parseLooseJson('{"a": 1, // the first\n "b": 2 /* and the second */}'), { a: 1, b: 2 });
  assert.deepEqual(parseLooseJson('{"a": [1, 2,], "b": {"c": 3,},}'), { a: [1, 2], b: { c: 3 } });
  assert.deepEqual(parseLooseJson('{"note"?: "kept", regionName?: "Terespol", "ok" ? : true}'), { note: "kept", regionName: "Terespol", ok: true });
  assert.deepEqual(parseLooseJson('[{op: "move", unitId: "u-1"}, {op: "remove", unitId: "u-2"}]'), [{ op: "move", unitId: "u-1" }, { op: "remove", unitId: "u-2" }]);
});

test("nothing inside a string is touched", () => {
  const text = '{note: "op: spawn, unit: {name: x} // not a comment", "path": "C:/a/*b*/c", q: "is it? : yes", \'s\': "it\'s"}';
  assert.deepEqual(parseLooseJson(text), {
    note: "op: spawn, unit: {name: x} // not a comment",
    path: "C:/a/*b*/c",
    q: "is it? : yes",
    s: "it's",
  });
});

test("a bare word that is not a key is left alone, so what was not an object still does not parse", () => {
  assert.equal(repairLooseJson('{"a": tru, "b": 1}'), '{"a": tru, "b": 1}', "a value is never quoted for the model");
  assert.equal(parseLooseJson('{"a": tru, "b": 1}'), null);
  assert.equal(repairLooseJson("[north, south]"), "[north, south]", "words in a list are not keys");
  assert.equal(parseLooseJson("Here is the plan: move the army."), null);
  assert.equal(parseLooseJson(""), null);
});

test("well-formed JSON is never rewritten: the repair is only tried after a strict parse fails", () => {
  const text = '{"a":"x: y","b":[1,2],"c":{"d":"it\'s // fine"}}';
  assert.deepEqual(parseLooseJson(text), JSON.parse(text));
  assert.equal(repairLooseJson(text), text, "and would have come back as it was");
});

test("an answer cut off mid-object is still not an answer", () => {
  assert.equal(parseLooseJson('{events: [{title: "A war", impacts: {unitOps: [{op: "move"'), null, "a shortened turn is never applied as the whole one");
});
