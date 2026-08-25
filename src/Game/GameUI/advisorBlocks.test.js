/*! Open Historia — portions (advisor fenced-block extraction tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Runs in a BARE CHECKOUT: advisorBlocks.js is import-free on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import { extractFencedJson, looksLikeProjectOps, repairTruncatedJsonArray } from "./advisorBlocks.js";

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

test("extracts a well-formed block and strips it from the prose", () => {
  const reply = `Here is the plan.\n\n${fence("actions", '[{"title":"Do a thing"}]')}\n\nThoughts?`;
  const { rest, json, truncated } = extractFencedJson(reply, "actions");
  assert.deepEqual(json, [{ title: "Do a thing" }]);
  assert.equal(truncated, false);
  assert.ok(!rest.includes("Do a thing"));
  assert.ok(rest.includes("Here is the plan."));
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
