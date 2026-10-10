/*! Open Historia — live skip event reader tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/streamedEvents.test.js
//
// Runs without node_modules: streamedEvents.js imports only jsonSalvage.js,
// which imports nothing.
//
// The reader fills the time panel while a skip is being written. A scanner bug
// shows up there as a duplicated, phantom or missing event, and nothing else in
// the suite would notice, because the turn that lands never reads the preview.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createStreamedEventReader,
  parseJsonPathSteps,
  partialArgValue,
  setAtJsonPath,
} from "./streamedEvents.js";

// A reader that records every call its listener gets.
const recordingReader = (options = {}) => {
  const seen = [];
  const reader = createStreamedEventReader({
    ...options,
    onEvent: (event, { index }) => { seen.push({ index, event }); },
  });
  return { reader, seen };
};

// Feeds every prefix of the text in turn, the way a stream grows one token at a time.
const pushEveryPrefix = (reader, text, step = 1) => {
  for (let end = step; end < text.length; end += step) reader.pushJson(text.slice(0, end));
  reader.pushJson(text);
};

// ---------------------------------------------------------------------------
// pushJson: partial JSON text

test("an event is emitted once, when its closing brace arrives", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events":[{"title":"A war"');
  assert.deepEqual(seen, []);
  reader.pushJson('{"events":[{"title":"A war", "year": 1914');
  assert.deepEqual(seen, []);
  reader.pushJson('{"events":[{"title":"A war", "year": 1914}');
  assert.deepEqual(seen, [{ index: 0, event: { title: "A war", year: 1914 } }]);
  reader.pushJson('{"events":[{"title":"A war", "year": 1914},{"title":"A peace"}]}');
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A war"], [1, "A peace"]]);
  assert.equal(reader.count, 2);
});

test("a stream fed one character at a time emits each event exactly once", () => {
  const text = '{"summary":"x","events":[{"title":"One"},{"title":"Two","impacts":{"a":[1,2]}},{"title":"Three"}],"tail":{}}';
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, text);
  assert.deepEqual(seen.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(seen.map(({ event }) => event.title), ["One", "Two", "Three"]);
  assert.deepEqual(seen[1].event.impacts, { a: [1, 2] });
  reader.finish();
  assert.equal(seen.length, 3, "finish adds nothing to a text stream");
});

test("braces, brackets and escaped quotes inside strings close nothing", () => {
  const title = 'He said "}" and ] then {x} \\ done';
  const text = JSON.stringify({ events: [{ title, note: "[{" }, { title: "next" }] });
  const { reader, seen } = recordingReader();
  // Every prefix, so a push also ends between a backslash and the quote it escapes.
  pushEveryPrefix(reader, text);
  assert.deepEqual(seen, [
    { index: 0, event: { title, note: "[{" } },
    { index: 1, event: { title: "next" } },
  ]);
});

test("an events key that is not at the top level is ignored", () => {
  const text = JSON.stringify({
    impacts: { events: [{ title: "nested, before" }] },
    events: [{ title: "real", impacts: { events: [{ title: "nested, inside" }] } }],
  });
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, text, 7);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].index, 0);
  assert.equal(seen[0].event.title, "real");
  assert.deepEqual(seen[0].event.impacts.events, [{ title: "nested, inside" }]);
});

test("a string value that reads 'events' is not taken for the key", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"kind":"events","list":[{"title":"not an event"}],"events":[{"title":"an event"}]}');
  assert.deepEqual(seen, [{ index: 0, event: { title: "an event" } }]);
});

test("a prose or code-fence prefix before the object is skipped", () => {
  const text = 'Here is the result [as asked], "quoted": \n```json\n{"events":[{"title":"A"}]}\n```';
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, text);
  assert.deepEqual(seen, [{ index: 0, event: { title: "A" } }]);
});

test("a malformed element uses up only its own index", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events":[{"title":"A"},{"title": nope},{"title":"C"}]}');
  assert.deepEqual(seen, [
    { index: 0, event: { title: "A" } },
    { index: 2, event: { title: "C" } },
  ]);
  assert.equal(reader.count, 3);
});

test("only objects are events: other array members still take an index", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events":[{"title":"A"},[{"title":"inner"}],{"title":"B"}]}');
  // The array member is not an element the scan opens, so B keeps index 1.
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [1, "B"]]);
});

test("the events array closing ends the scan: a later events key is not read", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events":[{"title":"A"}],"events":[{"title":"again"}]}');
  assert.deepEqual(seen, [{ index: 0, event: { title: "A" } }]);
});

test("a shorter text is a new call: the scan restarts from index 0", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events":[{"title":"A"},{"title":"B"}');
  reader.pushJson('{"events":[{"title":"X"}');
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [1, "B"], [0, "X"]]);
});

test("a text of the same length that opens differently is a new call", () => {
  const { reader, seen } = recordingReader();
  const first = '{"events":[{"title":"A"}]}';
  const second = '{"events":[{"title":"Z"}]}';
  assert.equal(first.length, second.length);
  reader.pushJson(first);
  reader.pushJson(second);
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [0, "Z"]]);
});

test("a growing text never re-emits an index, however often it is pushed", () => {
  const { reader, seen } = recordingReader();
  const text = '{"events":[{"title":"A"},{"title":"B"}]}';
  reader.pushJson(text);
  reader.pushJson(text);
  reader.pushJson(`${text}\n`);
  assert.deepEqual(seen.map(({ index }) => index), [0, 1]);
});

test("a throwing listener does not stop later events", () => {
  const titles = [];
  const reader = createStreamedEventReader({
    onEvent: (event) => {
      titles.push(event.title);
      if (event.title === "A") throw new Error("listener broke");
    },
  });
  assert.doesNotThrow(() => reader.pushJson('{"events":[{"title":"A"},{"title":"B"}]}'));
  assert.deepEqual(titles, ["A", "B"]);
  assert.equal(reader.count, 2);
});

test("a custom key reads that array instead", () => {
  const { reader, seen } = recordingReader({ key: "items" });
  reader.pushJson('{"events":[{"title":"no"}],"items":[{"title":"yes"}]}');
  assert.deepEqual(seen, [{ index: 0, event: { title: "yes" } }]);
});

// ---------------------------------------------------------------------------
// pushArgs: an object assembled from partialArgs path fragments

test("pushArgs holds an event back until the next index starts, and finish releases the last", () => {
  const { reader, seen } = recordingReader();
  const args = { events: [{ title: "A" }] };
  reader.pushArgs(args, ["$.events[0].title"]);
  assert.deepEqual(seen, []);
  args.events[0].year = 1914;
  args.events[1] = { title: "B" };
  reader.pushArgs(args, ["$.events[1].title"]);
  assert.deepEqual(seen, [{ index: 0, event: { title: "A", year: 1914 } }]);
  reader.pushArgs(args, ["$.summary"]);
  assert.equal(seen.length, 1, "a path outside events releases nothing");
  reader.finish();
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [1, "B"]]);
  assert.equal(reader.count, 2);
});

test("pushArgs hands out a copy, so later fragments do not change an emitted event", () => {
  const { reader, seen } = recordingReader();
  const args = { events: [{ title: "A" }, { title: "B" }] };
  reader.pushArgs(args, ["$['events'][1]['title']"]);
  args.events[0].title = "changed";
  assert.equal(seen[0].event.title, "A");
});

test("a different arguments object is a new call and starts again from index 0", () => {
  const { reader, seen } = recordingReader();
  reader.pushArgs({ events: [{ title: "A" }, { title: "B" }] }, ["$.events[1].title"]);
  assert.deepEqual(seen.map(({ index }) => index), [0]);
  reader.pushArgs({ events: [{ title: "X" }, { title: "Y" }] }, ["$.events[1]"]);
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [0, "X"]]);
  reader.finish();
  assert.deepEqual(seen.map(({ index, event }) => [index, event.title]), [[0, "A"], [0, "X"], [1, "Y"]]);
});

test("pushArgs ignores a missing object and missing paths", () => {
  const { reader, seen } = recordingReader();
  reader.pushArgs(null, ["$.events[3]"]);
  reader.pushArgs({ events: [{ title: "A" }] }, null);
  reader.finish();
  assert.deepEqual(seen, [{ index: 0, event: { title: "A" } }]);
});

// ---------------------------------------------------------------------------
// The path assembler streamAssembly.js uses

test("parseJsonPathSteps reads the dot and bracket forms alike", () => {
  assert.deepEqual(parseJsonPathSteps("$.events[0].title"), ["events", 0, "title"]);
  assert.deepEqual(parseJsonPathSteps("$['events'][0]['title']"), ["events", 0, "title"]);
  assert.deepEqual(parseJsonPathSteps('$["events"][12].impacts[3]'), ["events", 12, "impacts", 3]);
  assert.deepEqual(parseJsonPathSteps("events[0]"), ["events", 0]);
  assert.deepEqual(parseJsonPathSteps("$['a.b']['it\\'s']"), ["a.b", "it's"]);
  assert.deepEqual(parseJsonPathSteps("$[ 2 ][x]"), [2, "x"]);
  assert.deepEqual(parseJsonPathSteps("$"), []);
  assert.deepEqual(parseJsonPathSteps(""), []);
  assert.deepEqual(parseJsonPathSteps(undefined), []);
});

test("partialArgValue reads whichever value field is set, even at its default", () => {
  assert.equal(partialArgValue({ stringValue: "" }), "");
  assert.equal(partialArgValue({ stringValue: "Rome" }), "Rome");
  assert.equal(partialArgValue({ numberValue: 0 }), 0);
  assert.equal(partialArgValue({ boolValue: false }), false);
  assert.equal(partialArgValue({ nullValue: "NULL_VALUE" }), null);
  assert.equal(partialArgValue({ nullValue: 0 }), null);
  assert.equal(partialArgValue({ jsonPath: "$.events[0].title" }), undefined);
  assert.equal(partialArgValue({ nullValue: null }), undefined);
  assert.equal(partialArgValue(undefined), undefined);
});

test("setAtJsonPath builds arrays for numeric steps and objects for names", () => {
  const root = setAtJsonPath({}, ["events", 0, "title"], "A");
  assert.ok(Array.isArray(root.events));
  assert.deepEqual(root, { events: [{ title: "A" }] });
  setAtJsonPath(root, ["events", 1, "tags", 0], "war");
  assert.deepEqual(root.events[1], { tags: ["war"] });
  setAtJsonPath(root, ["events", 0, "gone"], null);
  assert.equal(root.events[0].gone, null);
});

test("setAtJsonPath continues a string only when asked to append", () => {
  const root = {};
  setAtJsonPath(root, ["title"], "The Gre");
  setAtJsonPath(root, ["title"], "at War", { append: true });
  assert.equal(root.title, "The Great War");
  setAtJsonPath(root, ["title"], "Replaced");
  assert.equal(root.title, "Replaced");
  // Appending onto something that is not a string sets the value instead.
  setAtJsonPath(root, ["year"], 1914);
  setAtJsonPath(root, ["year"], "x", { append: true });
  assert.equal(root.year, "x");
});

test("setAtJsonPath leaves a non-object root or an empty path alone", () => {
  assert.equal(setAtJsonPath(null, ["a"], 1), null);
  assert.equal(setAtJsonPath("text", ["a"], 1), "text");
  const root = { a: 1 };
  assert.equal(setAtJsonPath(root, [], 2), root);
  assert.deepEqual(root, { a: 1 });
});

// ---------------------------------------------------------------------------
// Text that is nearly JSON. A real Gemini skip wrote some of its keys without
// quotes; the turn's own parser reads such an answer (jsonSalvage.js), so the
// preview must show it too, or the event the player is waiting for is the one
// that never appears.

test("an event with unquoted keys inside it is still shown when it closes", () => {
  const text = '{"events":[{"title":"Exercise begins","impacts":{"unitOps":[{op: "spawn", unit: {name: "Task Force", strength: 100}}]}},{"title":"A test"}],"stopDate":"2016-01-31"}';
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, text, 7);
  assert.deepEqual(seen.map((entry) => entry.index), [0, 1]);
  assert.deepEqual(seen[0].event.impacts.unitOps, [{ op: "spawn", unit: { name: "Task Force", strength: 100 } }]);
  assert.equal(seen[1].event.title, "A test");
});

test("an unquoted events key at the top is still the events array", () => {
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, '{events: [{title: "A war"}, {title: "A peace"}], stopDate: "1914-08-01"}', 3);
  assert.deepEqual(seen.map((entry) => entry.event.title), ["A war", "A peace"]);
});

test("a word that is not the key before the array does not start it", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{summary: "the events: [" , notevents: [{title: "No"}], events : [{title: "Yes"}]}');
  assert.deepEqual(seen.map((entry) => entry.event.title), ["Yes"]);
});

test("a comment left in the answer is skipped, braces and quotes and all", () => {
  const text = '{\n  // the "events" of the period {in order}\n  "events": [\n    {"title": "A war"}, // the first } of several\n    {"title": "A peace"}\n  ]\n}';
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, text, 5);
  assert.deepEqual(seen.map((entry) => entry.event.title), ["A war", "A peace"]);
});

test("a comment whose end has not arrived yet holds the scan, and nothing is read out of it", () => {
  const { reader, seen } = recordingReader();
  reader.pushJson('{"events": [{"title": "A war"}, // then {"title": "Not an event"}');
  assert.deepEqual(seen.map((entry) => entry.event.title), ["A war"]);
  reader.pushJson('{"events": [{"title": "A war"}, // then {"title": "Not an event"}\n {"title": "A peace"}]}');
  assert.deepEqual(seen.map((entry) => entry.event.title), ["A war", "A peace"]);
});

test("a slash inside a string is text, not the start of a comment", () => {
  const { reader, seen } = recordingReader();
  pushEveryPrefix(reader, '{"events":[{"title":"See https://example.org/a // b","note":"1/2"},{"title":"Next"}]}', 4);
  assert.deepEqual(seen.map((entry) => entry.event.title), ["See https://example.org/a // b", "Next"]);
});
