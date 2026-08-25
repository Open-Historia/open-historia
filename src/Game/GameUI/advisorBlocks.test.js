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
