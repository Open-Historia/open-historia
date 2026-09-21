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

// Bisected against the live API (2026-09-17) when every chat action batch came
// back 400: Gemini refuses array-length bounds on an array of OBJECTS inside an
// anyOf branch. The same keywords are fine on an array of strings and fine
// outside a union, which is why the scene's choices in the jump's answer always worked.
test("array-length bounds are stripped inside a union, kept outside one", () => {
  const converted = toGeminiSchema({
    type: "object",
    properties: {
      plain: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", properties: { a: { type: "string" } } } },
      union: {
        anyOf: [
          { type: "object", properties: { rows: { type: "array", minItems: 2, maxItems: 10, items: { type: "object", properties: { b: { type: "string" } } } } } },
          { type: "object", properties: { words: { type: "array", minItems: 2, items: { type: "string" } } } },
        ],
      },
    },
  });
  assert.equal(converted.properties.plain.minItems, 2, "outside a union the bound is a useful hint and stays");
  assert.equal(converted.properties.plain.maxItems, 5);
  const [objects, strings] = converted.properties.union.anyOf;
  assert.equal(objects.properties.rows.minItems, undefined, "inside a union, an array of objects loses its bounds");
  assert.equal(objects.properties.rows.maxItems, undefined);
  assert.equal(strings.properties.words.minItems, 2, "an array of strings keeps them: Gemini accepts those");
});
