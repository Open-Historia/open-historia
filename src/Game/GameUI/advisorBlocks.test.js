/*! Open Historia — portions (advisor fenced-block extraction tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs in a BARE CHECKOUT: advisorBlocks.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import {
  closeObjectsBeforeList,
  extractFencedJson,
  looksLikeProjectOps,
  recoverOpsElementwise,
  repairJsonStringValues,
  repairTruncatedJsonArray,
} from "./advisorBlocks.js";

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

test("extracts a well-formed block and strips it from the prose", () => {
  const reply = `Here is the plan.\n\n${fence("actions", '[{"title":"Do a thing"}]')}\n\nThoughts?`;
  const { rest, json, truncated } = extractFencedJson(reply, "actions");
  assert.deepEqual(json, [{ title: "Do a thing" }]);
  assert.equal(truncated, false);
  assert.ok(!rest.includes("Do a thing"));
  assert.ok(rest.includes("Here is the plan."));
});

test("complete adjacent project arrays are one strict payload, not a partially salvaged batch", () => {
  // A real 2029 campaign report contained "...}] [{\"op\":\"update\"...";
  // Both independent JSON arrays must survive in source order, with no false
  // malformed-entry receipt or demand to recover historical projects.
  const body = '[{"op":"update","id":"energy","name":"Strategic Energy Autonomy","status":"stalled"}] '
    + '[{"op":"update","id":"assets","name":"Asset Recovery project","progress":28}]';
  assert.throws(() => JSON.parse(body), /non-whitespace|Unexpected token/);
  const result = extractFencedJson(fence("projects", body), "projects", { salvageTruncated: true });
  assert.deepEqual(result.json?.map((op) => op.id), ["energy", "assets"]);
  assert.equal(result.reason, "");
  assert.equal(result.dropped, 0);
  assert.equal(result.truncated, false);
});

test("adjacent arrays inside string values do not become false top-level splits", () => {
  const body = '[{"op":"create","name":"Telemetry ] [ reference"}] '
    + '[{"op":"update","id":"energy","name":"Energy","progress":60}]';
  const result = extractFencedJson(fence("projects", body), "projects", { salvageTruncated: true });
  assert.deepEqual(result.json?.map((op) => op.name), ["Telemetry ] [ reference", "Energy"]);
  assert.equal(result.dropped, 0);
});

test("a missing block is not an error", () => {
  const { rest, json } = extractFencedJson("Just prose.", "actions");
  assert.equal(json, null);
  assert.equal(rest, "Just prose.");
});

test("malformed JSON in a closed fence is dropped, and the fence is still stripped", () => {
  const reply = `Before\n${fence("actions", "{not json")}\nAfter`;
  const { rest, json } = extractFencedJson(reply, "actions");
  assert.equal(json, null);
  assert.ok(!rest.includes("not json"));
});

// 2026-11-13: Boris's correction cited a literal ```actions token in prose,
// before the real JSON fence. The old extractor started inside that sentence,
// swallowed the real opening fence, and rejected otherwise valid proposals.
test("inline example of actions syntax cannot steal a later real Action block", () => {
  const body = '[{"title":"GNCCN Emergency Activation","text":"Coordinate the network","kind":"action"}]';
  const reply = [
    "I failed to provide the ` ```actions ` block earlier.",
    "The planned queue no longer shows the old Action.",
    "",
    fence("actions", body),
    "The mandate awaits approval.",
  ].join("\n");
  const result = extractFencedJson(reply, "actions", { streaming: true });
  assert.deepEqual(result.json, [{ title: "GNCCN Emergency Activation", text: "Coordinate the network", kind: "action" }]);
  assert.match(result.rest, /failed to provide/);
  assert.match(result.rest, /mandate awaits approval/);
  assert.equal(result.reason, "");
});

test("inline and blockquoted mentions of actions cannot become execution blocks", () => {
  const reply = "I need a ```actions block.\n> ```actions\nUse an actual standalone code fence.";
  for (const streaming of [false, true]) {
    const result = extractFencedJson(reply, "actions", { streaming });
    assert.equal(result.json, null);
    assert.equal(result.rest, reply);
  }
});

test("streaming malformed blocks report parse failure without warning on every re-render", () => {
  const malformed = fence("actions", '{ "title": "missing array"');
  const warnings = [];
  const prior = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    for (let i = 0; i < 80; i += 1) {
      const partial = extractFencedJson(malformed, "actions", { streaming: true });
      assert.equal(partial.json, null);
      assert.match(partial.reason, /invalid JSON/);
    }
    assert.deepEqual(warnings, [], "the live bubble must not log the same failure on every render");
    const complete = extractFencedJson(malformed, "actions");
    assert.equal(complete.json, null);
    assert.match(complete.reason, /invalid JSON/);
    assert.equal(warnings.length, 2, "final parse logs the failure and one excerpt only");
  } finally {
    console.warn = prior;
  }
});

test("project mentions cannot swallow a later formal projects block", () => {
  const reply = "There is no ```projects submission yet.\n"
    + fence("projects", '[{"op":"create","name":"Technical review","summary":"Safety"}]');
  const result = extractFencedJson(reply, "projects", { salvageTruncated: true });
  assert.deepEqual(result.json, [{ op: "create", name: "Technical review", summary: "Safety" }]);
  assert.match(result.rest, /no ```projects submission yet/);
});

// The bug this module exists for. A long board runs out of tokens partway
// through the array, so there is an opening fence and no closing one: the strict
// regex does not match, the block is neither applied nor stripped, and the raw
// JSON lands in the chat with nothing anywhere saying why.
test("without salvage, an unterminated fence is invisible", () => {
  const reply = 'Opening the board.\n\n```projects\n[{"op":"create","name":"A","summary":"s"},{"op":"create","name":"B","tags';
  const { json, truncated } = extractFencedJson(reply, "projects");
  assert.equal(json, null);
  assert.equal(truncated, false);
});

test("with salvage, an unterminated fence keeps every complete entry", () => {
  const reply = 'Opening the board.\n\n```projects\n[{"op":"create","name":"A","summary":"s"},{"op":"create","name":"B","summary":"t"},{"op":"create","name":"C","tags';
  const { rest, json, truncated } = extractFencedJson(reply, "projects", { salvageTruncated: true });
  assert.equal(truncated, true);
  assert.equal(json.length, 2, "the two complete entries survive, the half-written third does not");
  assert.equal(json[0].name, "A");
  assert.equal(json[1].name, "B");
  assert.ok(!rest.includes('"op"'), "the partial block is stripped from what the player reads");
  assert.ok(rest.includes("Opening the board."));
});

test("salvage also repairs a closed fence whose JSON is truncated inside", () => {
  const reply = "```projects\n" + '[{"op":"create","name":"A","summary":"s"},{"op":"create","nam' + "\n```";
  const { json } = extractFencedJson(reply, "projects", { salvageTruncated: true });
  assert.equal(json.length, 1);
  assert.equal(json[0].name, "A");
});

test("salvage is off by default, so the small blocks are untouched", () => {
  const reply = 'Talking about ```deploy blocks and how [{"op":"x"} works';
  assert.equal(extractFencedJson(reply, "deploy").json, null);
});

test("repairTruncatedJsonArray handles nesting, strings and escapes", () => {
  // A brace inside a string value must not be counted as depth.
  const source = '[{"name":"A {not a brace}","milestones":[{"title":"m1"}]},{"name":"B","milest';
  const repaired = repairTruncatedJsonArray(source);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].name, "A {not a brace}");
  assert.equal(repaired[0].milestones[0].title, "m1");

  // An escaped quote must not flip string state.
  assert.deepEqual(
    repairTruncatedJsonArray('[{"name":"say \\"hi\\""},{"name":"cut'),
    [{ name: 'say "hi"' }],
  );
});

test("repairTruncatedJsonArray returns a complete array untouched", () => {
  assert.deepEqual(repairTruncatedJsonArray('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }]);
});

test("repairTruncatedJsonArray gives up rather than guessing", () => {
  assert.equal(repairTruncatedJsonArray('[{"op":"create","name":"only a fragm'), null, "no complete element");
  assert.equal(repairTruncatedJsonArray('{"not":"an array"}'), null);
  assert.equal(repairTruncatedJsonArray(""), null);
  assert.equal(repairTruncatedJsonArray(null), null);
  assert.equal(repairTruncatedJsonArray("[]"), null, "an empty array is nothing to apply");
});

test("looksLikeProjectOps spots an attempt the parser could not use", () => {
  assert.equal(looksLikeProjectOps('[{"op":"create","name":"Project Leviathan","summary":"s"}]'), true);
  assert.equal(looksLikeProjectOps('[{"op":"update","projectId":"p-1","progress":50}]'), true);
  // Not a projects payload.
  assert.equal(looksLikeProjectOps('[{"op":"build","marker":{"name":"Base"}}]'), false);
  assert.equal(looksLikeProjectOps("Ordinary advice with no JSON at all."), false);
  assert.equal(looksLikeProjectOps('[{"title":"An action","text":"do it"}]'), false);
});

// ---- the failure this file's second revision exists for ---------------------
// A well-fenced, COMPLETE block that will not parse. The board reported "the
// instructions could not be read" while the chat showed only the advisor's
// preamble — the fence matched and was stripped, then JSON.parse threw and the
// repair gave up. Smart quotes are the first suspect every time: a model whose
// prose is full of typographic punctuation writes its JSON the same way.

test("smart quotes in a complete block are repaired, not thrown away", () => {
  const body = '[{\u201Cop\u201D:\u201Ccreate\u201D,\u201Cname\u201D:\u201CProject Leviathan\u201D,\u201Csummary\u201D:\u201CAutonomous ships.\u201D}]';
  const { json } = extractFencedJson(fence("projects", body), "projects", { salvageTruncated: true });
  assert.equal(json?.length, 1);
  assert.equal(json[0].name, "Project Leviathan");
  assert.equal(json[0].op, "create");
});

test("a trailing comma no longer costs the whole board", () => {
  // The old walker hit depth 0, tried one strict parse, and returned null —
  // discarding every complete entry ahead of the stray comma.
  const body = '[{"op":"create","name":"A","summary":"s"},{"op":"create","name":"B","summary":"t"},]';
  const { json } = extractFencedJson(fence("projects", body), "projects", { salvageTruncated: true });
  assert.equal(json?.length, 2);
  assert.deepEqual(json.map((op) => op.name), ["A", "B"]);
});

test("smart quotes AND a trailing comma together", () => {
  const body = '[{\u201Cop\u201D:\u201Ccreate\u201D,\u201Cname\u201D:\u201CA\u201D,\u201Csummary\u201D:\u201Cs\u201D},]';
  assert.equal(repairTruncatedJsonArray(body)?.[0]?.name, "A");
});

test("comments a chatty model adds are stripped", () => {
  const body = '[\n  // the fusion programme\n  {"op":"create","name":"A","summary":"s"}\n]';
  assert.equal(repairTruncatedJsonArray(body)?.[0]?.name, "A");
});

test("a wrapper object around the array is unwrapped", () => {
  for (const key of ["projects", "ops", "projectOps", "operations"]) {
    const body = `{"${key}":[{"op":"create","name":"A","summary":"s"}]}`;
    assert.equal(repairTruncatedJsonArray(body)?.[0]?.name, "A", `wrapper key "${key}" not unwrapped`);
  }
});

test("a single op sent bare rather than in an array", () => {
  assert.deepEqual(
    repairTruncatedJsonArray('{"op":"update","name":"A","progress":50}'),
    [{ op: "update", name: "A", progress: 50 }],
  );
});

test("a truncated array inside a wrapper object still salvages", () => {
  const body = '{"projects":[{"op":"create","name":"A","summary":"s"},{"op":"create","name":"B","summ';
  const json = repairTruncatedJsonArray(body);
  assert.equal(json?.length, 1);
  assert.equal(json[0].name, "A");
});

test("extractFencedJson reports why a block was unusable", () => {
  const { json, reason } = extractFencedJson(fence("projects", "{definitely not json"), "projects", { salvageTruncated: true });
  assert.equal(json, null);
  assert.match(reason, /invalid JSON/);
});

test("a valid block reports no reason and is not touched", () => {
  const { json, reason, truncated } = extractFencedJson(
    fence("projects", '[{"op":"create","name":"A","summary":"s"}]'), "projects", { salvageTruncated: true },
  );
  assert.equal(reason, "");
  assert.equal(truncated, false);
  assert.deepEqual(json, [{ op: "create", name: "A", summary: "s" }]);
});

test("looksLikeProjectOps survives smart quotes too", () => {
  assert.equal(looksLikeProjectOps('[{\u201Cop\u201D:\u201Ccreate\u201D,\u201Cname\u201D:\u201CA\u201D}]'), true);
});

// ---- unescaped inner quotes, and partial recovery ---------------------------
// Field report: "invalid JSON (Expected ',' or '}' after property value in JSON
// at position 4271 (line 10 column 1))" after ten entries had already imported.
// The model wrote  "summary":"A 1 GW reactor (the "Titan-class" megalith)."  —
// the inner quote closes the string early. Before this, one such entry cost the
// entire batch.

const goodEntry = (i) => `  {"op":"create","name":"Project ${i}","summary":"${"padding text ".repeat(20)}"},`;
const badEntry = '  {"op":"create","name":"Project Vanguard","summary":"A 1 GW reactor (the "Titan-class" megalith)."},';

test("an unescaped inner quote no longer costs the whole batch", () => {
  const body = ["[", ...Array.from({ length: 8 }, (_, i) => goodEntry(i)), badEntry,
    '  {"op":"create","name":"Project Nine","summary":"another"}', "]"].join("\n");

  // Confirm the input really is the failure we are fixing.
  assert.throws(() => JSON.parse(body), /Expected ',' or '}' after property value/);

  const ops = repairTruncatedJsonArray(body);
  assert.ok(ops, "nothing recovered at all");
  assert.ok(ops.length >= 9, `expected the 9 clean entries, got ${ops.length}`);
  assert.ok(ops.some((op) => op.name === "Project Nine"), "entries AFTER the bad one must survive too");
  assert.ok(ops.every((op) => typeof op.name === "string" && op.name));
});

test("the bad entry itself is repaired when it can be", () => {
  const repaired = repairJsonStringValues(badEntry.trim().replace(/,$/, ""));
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.name, "Project Vanguard");
  assert.match(parsed.summary, /Titan-class/);
});

test("already-escaped quotes are not double-escaped", () => {
  const source = '{"op":"create","name":"A","summary":"He said \\"hello\\" once."}';
  const parsed = JSON.parse(repairJsonStringValues(source));
  assert.equal(parsed.summary, 'He said "hello" once.');
});

test("a literal newline inside a string value is escaped", () => {
  const source = '{"op":"create","name":"A","summary":"first line\nsecond line"}';
  assert.throws(() => JSON.parse(source));
  assert.equal(JSON.parse(repairJsonStringValues(source)).summary, "first line\nsecond line");
});

test("recoverOpsElementwise reports what it had to drop", () => {
  const body = [goodEntry(1), goodEntry(2), '  {"op":"create","name":"broken", "summary": }', goodEntry(3)].join("\n");
  const { ops, dropped } = recoverOpsElementwise(body);
  assert.equal(ops.length, 3);
  assert.equal(dropped, 1);
});

test("non-string values are left alone by the repair", () => {
  const source = '{"op":"update","name":"A","progress":58,"tags":["x","y"],"focus":{"lng":1.5,"lat":2.5}}';
  assert.deepEqual(JSON.parse(repairJsonStringValues(source)), JSON.parse(source));
});

test("a fully valid batch is untouched by any of this", () => {
  const source = '[{"op":"create","name":"A","summary":"s","milestones":[{"title":"m","date":"2030-01-01"}]}]';
  assert.deepEqual(repairTruncatedJsonArray(source), JSON.parse(source));
});

// Every verb normalizeProjectOp accepts has to be recognised here too. A verb this
// list misses is not a dropped op — it is a SILENT one: the block fails to parse,
// this says "not a projects block", and the player gets no "Board not fully
// updated" warning at all. cancelled/shelve/fail/failed/drop were all missing.
test("looksLikeProjectOps knows every verb the engine accepts", () => {
  const verbs = [
    "create", "start", "launch", "open", "add",
    "update", "progress", "edit",
    "milestone",
    "complete", "finish", "completed",
    "cancel", "cancelled", "abandon", "shelve",
    "fail", "failed",
    "remove", "delete", "drop",
  ];
  for (const verb of verbs) {
    assert.equal(
      looksLikeProjectOps(`[{"op":"${verb}","name":"Project Leviathan"}]`),
      true,
      `verb "${verb}" would have failed silently`,
    );
  }
  // Still not fooled by a verb from a different op family, or by prose.
  assert.equal(looksLikeProjectOps('[{"op":"spawn","name":"1st Fleet"}]'), false);
  assert.equal(looksLikeProjectOps('[{"op":"fail"}]'), false, "an op with nothing to target is not a board change");
});

test("a projects block still streaming is hidden, not salvaged or warned about", () => {
  const partial = 'On it.\n\n```projects\n[\n  {\n    "op": "update",\n    "lastUpdate": "Forced mechanization deployed nationwide; domestic-source fertilizer plants';
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const result = extractFencedJson(partial, "projects", { salvageTruncated: true, streaming: true });
    assert.equal(result.rest, "On it.\n\n");
    assert.equal(result.json, null);
    assert.equal(result.truncated, false);
    assert.equal(result.reason, "");
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

test("an unclosed actions block is kept out of a streaming bubble", () => {
  const result = extractFencedJson('Queued.\n```actions\n[{"title":"Land ref', "actions", { streaming: true });
  assert.equal(result.rest, "Queued.\n");
  assert.equal(result.json, null);
});

test("a closed block parses the same whether or not the reply is streaming", () => {
  const text = 'Done.\n```projects\n[{"op":"create","name":"Dam"}]\n```\nMore.';
  const streaming = extractFencedJson(text, "projects", { salvageTruncated: true, streaming: true });
  const complete = extractFencedJson(text, "projects", { salvageTruncated: true });
  assert.deepEqual(streaming, complete);
  assert.deepEqual(complete.json, [{ op: "create", name: "Dam" }]);
});

// A player's log, 2026-11-06: the suggested actions lost eighteen times to a list closed over an open object.
test("a list closed while its last object is still open gets the brace it lacks, and nothing else", () => {
  const body = '[\n  {"title":"A","kind":"action"},\n  {"title":"B","text":"x ] y {","kind":"action"]';
  assert.deepEqual(extractFencedJson(fence("actions", body), "actions", { streaming: true }).json, [
    { title: "A", kind: "action" },
    { title: "B", text: "x ] y {", kind: "action" },
  ]);
  assert.equal(closeObjectsBeforeList('[{"a":1}]'), null, "valid JSON is left alone");
  assert.equal(closeObjectsBeforeList('{"a":"]"}'), null, "a bracket inside a string is not one");
  // Cut off rather than mis-closed: still nothing, as before (an incomplete fence is never an Action).
  assert.equal(extractFencedJson(fence("actions", '[{"title":"A","kind":"action"},{"title":"B"'), "actions", { streaming: true }).json, null);
});
