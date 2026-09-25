/*! Open Historia — Gemini schema conversion tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/geminiSchema.test.js
//
// Runs without node_modules: geminiSchema.js is import-free, and gameplaySchemas.js
// is plain data.

import test from "node:test";
import assert from "node:assert/strict";
import { toGeminiSchema } from "./geminiSchema.js";
import { GAMEPLAY_SCHEMAS } from "./gameplaySchemas.js";

// Every {key, value} pair anywhere in a converted schema, so a guard can assert
// over the WHOLE tree rather than the one field a test happened to think of.
const walk = (value, path = "$", visit) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    visit(key, entry, `${path}.${key}`);
    walk(entry, `${path}.${key}`, visit);
  }
};

// The regression guard this file exists for. Gemini answers a schema it dislikes
// with a flat 400 naming no field, so the only cheap way to know a new schema is
// sendable is to check it here. Runs over the LIVE schemas, so the next task that
// reaches for `type: "null"` fails this test instead of a player's timeline jump.
test("no live gameplay schema converts to anything Gemini rejects", () => {
  for (const [name, schema] of Object.entries(GAMEPLAY_SCHEMAS)) {
    const converted = toGeminiSchema(schema);
    walk(converted, "$", (key, value, path) => {
      assert.notEqual(value, "null", `${name}: Gemini has no null type at ${path}`);
      assert.ok(
        !["additionalProperties", "$schema"].includes(key),
        `${name}: Gemini has no ${key} field at ${path}`,
      );
    });
  }
});

// The exact shape that broke every jump: the nullable scene the jump schema carried then.
test("a two-branch null union becomes one nullable schema", () => {
  const converted = toGeminiSchema({
    anyOf: [
      { type: "object", description: "A scene.", properties: { title: { type: "string" } } },
      { type: "null" },
    ],
  });

  assert.equal(converted.type, "object");
  assert.equal(converted.nullable, true);
  assert.equal(converted.description, "A scene.");
  assert.deepEqual(converted.properties, { title: { type: "string" } });
  assert.ok(!("anyOf" in converted), "the one-member union should be lifted, not kept");
});

// idleDiplomacy writes the null branch FIRST and puts the instruction on it. That
// note is the only thing telling the model silence is a valid answer, so losing it
// with the branch would quietly turn "usually null" into "always invent a chat".
test("the null branch's instruction survives onto the nullable schema", () => {
  const converted = toGeminiSchema({
    anyOf: [
      { type: "null", description: "No polity would plausibly reach out right now." },
      { type: "object", description: "A diplomatic note.", properties: {} },
    ],
  });

  assert.equal(converted.type, "object");
  assert.equal(converted.nullable, true);
  assert.match(converted.description, /A diplomatic note\./);
  assert.match(converted.description, /No polity would plausibly reach out right now\./);
});

test("a union of several real branches keeps anyOf and only drops the null", () => {
  const converted = toGeminiSchema({
    anyOf: [
      { type: "object", properties: { op: { type: "string" } } },
      { type: "string" },
      { type: "null" },
    ],
  });

  assert.equal(converted.nullable, true);
  assert.equal(converted.anyOf.length, 2);
  assert.deepEqual(converted.anyOf.map((branch) => branch.type), ["object", "string"]);
});

test("a union with no null branch is left exactly as it was", () => {
  const source = {
    description: "A unit mutation.",
    anyOf: [
      { type: "object", properties: { op: { type: "string", enum: ["spawn"] } } },
      { type: "object", properties: { op: { type: "string", enum: ["move"] } } },
    ],
  };

  assert.deepEqual(toGeminiSchema(source), source);
});

test("the array spelling of a nullable type is accepted too", () => {
  const converted = toGeminiSchema({ type: ["object", "null"], properties: {} });

  assert.equal(converted.type, "object");
  assert.equal(converted.nullable, true);
});

test("additionalProperties and $schema are stripped at every depth", () => {
  const converted = toGeminiSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: { date: { type: "string" } } },
      },
    },
  });

  assert.deepEqual(converted, {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: { type: "object", properties: { date: { type: "string" } } },
      },
    },
  });
});

// Everything Gemini DOES understand has to come through untouched, or the
// conversion trades a 400 for a model that no longer knows the rules.
test("supported keywords are preserved", () => {
  const converted = toGeminiSchema({
    type: "array",
    description: "Two to five choices.",
    minItems: 2,
    maxItems: 5,
    items: { type: "string", minLength: 1 },
  });

  assert.deepEqual(converted, {
    type: "array",
    description: "Two to five choices.",
    minItems: 2,
    maxItems: 5,
    items: { type: "string", minLength: 1 },
  });
});

// The shape that broke every jump on 2026-09-17 (bounds on an object array
// inside a union), and then every new game on 2026-09-21 (the pregame
// declaration's `events` and `canonicalUpdates`, no union anywhere): an array of
// objects loses its length bounds wherever it sits, and says them in words.
test("array-length bounds on an array of objects become words, everywhere; an array of strings keeps them", () => {
  const converted = toGeminiSchema({
    type: "object",
    properties: {
      plain: { type: "array", description: "The rows.", minItems: 2, maxItems: 5, items: { type: "object", properties: { a: { type: "string" } } } },
      bare: { type: "array", maxItems: 32, items: { type: "object", properties: { a: { type: "string" } } } },
      one: { type: "array", minItems: 1, items: { type: "object", properties: { a: { type: "string" } } } },
      tags: { type: "array", description: "Up to three.", maxItems: 3, items: { type: "string" } },
      union: {
        anyOf: [
          { type: "object", properties: { rows: { type: "array", minItems: 2, maxItems: 10, items: { type: "object", properties: { b: { type: "string" } } } } } },
          { type: "object", properties: { words: { type: "array", minItems: 2, items: { type: "string" } } } },
        ],
      },
    },
  });
  const { plain, bare, one, tags } = converted.properties;
  assert.equal(plain.minItems, undefined, "an array of objects loses its bounds outside a union too");
  assert.equal(plain.maxItems, undefined);
  assert.equal(plain.description, "The rows. Between 2 and 5 entries.", "and says them, after its own description");
  assert.equal(bare.maxItems, undefined);
  assert.equal(bare.description, "At most 32 entries.", "a bare array gets the words as its description");
  assert.equal(one.description, "At least 1 entry.");
  assert.equal(tags.maxItems, 3, "an array of strings keeps them: Gemini accepts those");
  assert.equal(tags.description, "Up to three.");
  const [objects, strings] = converted.properties.union.anyOf;
  assert.equal(objects.properties.rows.minItems, undefined, "inside a union, the same");
  assert.equal(objects.properties.rows.maxItems, undefined);
  assert.equal(objects.properties.rows.description, "Between 2 and 10 entries.");
  assert.equal(strings.properties.words.minItems, 2);});

// And the guard on the live schemas, so the next bound on an object array is
// caught here rather than by a player's new game.
test("no live gameplay schema sends Gemini a bound on an array of objects", () => {
  for (const [name, schema] of Object.entries(GAMEPLAY_SCHEMAS)) {
    const check = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((entry, index) => check(entry, `${path}[${index}]`)); return; }
      if (node.type === "array" && node.items && (node.items.type === "object" || node.items.properties)) {
        assert.equal(node.minItems, undefined, `${name}: minItems on an array of objects at ${path}`);
        assert.equal(node.maxItems, undefined, `${name}: maxItems on an array of objects at ${path}`);
      }
      for (const [key, value] of Object.entries(node)) check(value, `${path}.${key}`);
    };
    check(toGeminiSchema(schema), "$");
  }
});

