/*! Open Historia — a schema written out as the shape of an answer: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/schemaOutline.test.js
//
// Runs without node_modules: schemaOutline.js imports nothing.
//
// The outline is the whole contract a Gemini time skip is given (main.jsx
// callGemini): no schema is compiled on the provider's side, so what the model
// reads here is all that tells it what to write. A field the outline drops, an
// optional one shown as required, or keys shown without their quotes each turn
// into answers the game cannot use.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { buildAnswerFormatBlock, renderSchemaOutline } from "./schemaOutline.js";
import { AGENT_REPORTS_FIELD, foldJumpTool, getGameplayTool } from "./gameplaySchemas.js";
import { parseLooseJson } from "./jsonSalvage.js";

const lines = (schema) => renderSchemaOutline(schema).split("\n");

test("an object is its fields, one to a line, keys quoted as the answer must write them", () => {
  const outline = renderSchemaOutline({
    type: "object",
    description: "A dated event.",
    properties: {
      date: { type: "string", description: "In-game date." },
      title: { type: "string" },
      notable: { type: "boolean", description: "Stops an automatic jump." },
    },
    required: ["date", "title"],
    additionalProperties: false,
  });
  assert.equal(outline, [
    "{  // A dated event.",
    '  "date": string,  // In-game date.',
    '  "title": string,',
    '  "notable"?: boolean,  // Stops an automatic jump.',
    "}",
  ].join("\n"));
});

test("an optional field is marked, a required one is not, and nothing else says so", () => {
  const outline = lines({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["b"] });
  assert.equal(outline[1], '  "a"?: string,');
  assert.equal(outline[2], '  "b": string,');
});

test("the values a field takes are written out: enums, ranges and null", () => {
  const outline = renderSchemaOutline({
    type: "object",
    properties: {
      op: { type: "string", enum: ["spawn", "move"] },
      strength: { type: "integer", minimum: 0, maximum: 100 },
      lat: { type: "number", minimum: -90, maximum: 90, description: "Only with no `at`." },
      population: { type: "integer", minimum: 0 },
      debt: { type: "number", maximum: 0 },
      warId: { type: "string", nullable: true },
      free: { type: "object", description: "Scenario-defined values." },
    },
  });
  assert.ok(outline.includes('"op"?: "spawn" | "move",'));
  assert.ok(outline.includes('"strength"?: integer 0..100,'));
  assert.ok(outline.includes('"lat"?: number -90..90,  // Only with no `at`.'));
  assert.ok(outline.includes('"population"?: integer >= 0,'));
  assert.ok(outline.includes('"debt"?: number <= 0,'));
  assert.ok(outline.includes('"warId"?: string | null,'));
  assert.ok(outline.includes('"free"?: object,  // Scenario-defined values.'), "an object with no fields of its own is still named");
});

test("a list of plain values stays on its line, with how many it may hold", () => {
  const outline = renderSchemaOutline({
    type: "object",
    properties: {
      tags: { type: "array", description: "Filter chips.", maxItems: 3, items: { type: "string", enum: ["Military", "Economy"] } },
      countries: { type: "array", minItems: 1, items: { type: "string" } },
      pair: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
      some: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
    },
  });
  assert.ok(outline.includes('"tags"?: ["Military" | "Economy"],  // Filter chips. (at most 3)'));
  assert.ok(outline.includes('"countries"?: [string],  // (at least 1)'));
  assert.ok(outline.includes('"pair"?: [number],  // (exactly 2)'));
  assert.ok(outline.includes('"some"?: [string],  // (2 to 5)'));
});

test("a list of objects opens a block, its description and count beside it", () => {
  const outline = renderSchemaOutline({
    type: "object",
    properties: {
      events: {
        type: "array",
        description: "Events of the period.",
        minItems: 1,
        items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      },
    },
    required: ["events"],
  });
  assert.equal(outline, [
    "{",
    '  "events": [  // Events of the period. (at least 1)',
    "    {",
    '      "title": string,',
    "    }",
    "  ],",
    "}",
  ].join("\n"));
});

test("a union is each of its shapes, told apart by the field that names them", () => {
  const union = {
    description: "A unit mutation.",
    anyOf: [
      { type: "object", properties: { op: { type: "string", enum: ["move"] }, unitId: { type: "string", description: "Existing unit." }, note: { type: "string", description: "Brief." } }, required: ["op", "unitId"] },
      { type: "object", properties: { op: { type: "string", enum: ["remove"] }, unitId: { type: "string", description: "Existing unit." }, note: { type: "string", description: "Why it ended." } }, required: ["op", "unitId"] },
    ],
  };
  const outline = renderSchemaOutline({ type: "object", properties: { unitOps: { type: "array", description: "Unit operations.", items: union } } });
  assert.equal(outline, [
    "{",
    '  "unitOps"?: [  // Unit operations.',
    '    // one of these shapes, told apart by "op":',
    "    {",
    '      "op": "move",',
    '      "unitId": string,  // Existing unit.',
    '      "note"?: string,  // Brief.',
    "    }",
    "    | {",
    '      "op": "remove",',
    '      "unitId": string,',
    '      "note"?: string,  // Why it ended.',
    "    }",
    "  ],",
    "}",
  ].join("\n"), "a description already given is not repeated; a different one for the same field is");
});

test("two branches for one value are shown as one spelling: the flat one", () => {
  const union = {
    anyOf: [
      { type: "object", properties: { op: { type: "string", enum: ["build"] }, marker: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } }, required: ["op", "marker"] },
      { type: "object", properties: { op: { type: "string", enum: ["build"] }, name: { type: "string" }, at: { type: "string" } }, required: ["op", "name"] },
      { type: "object", properties: { op: { type: "string", enum: ["remove"] }, name: { type: "string" } }, required: ["op"] },
    ],
  };
  const outline = renderSchemaOutline({ type: "object", properties: { markerOps: { type: "array", items: union } } });
  assert.equal(outline.includes('"marker"'), false, "the nested spelling is tolerance, not something to teach");
  assert.equal(outline.match(/"op": "build"/g).length, 1);
  assert.ok(outline.includes('"op": "remove"'));
});

test("a nullable object is still an object, and may be null", () => {
  const outline = renderSchemaOutline({
    type: "object",
    properties: { chat: { anyOf: [{ type: "object", properties: { speaker: { type: "string" } }, required: ["speaker"] }, { type: "null" }] } },
  });
  assert.equal(outline, ["{", '  "chat"?: {', '    "speaker": string,', "  } | null,", "}"].join("\n"));
});

test("descriptions are one line each, whatever they were written as", () => {
  const outline = lines({ type: "object", properties: { note: { type: "string", description: "First line.\n   Second line.\tTabbed." } } });
  assert.equal(outline[1], '  "note"?: string,  // First line. Second line. Tabbed.');
});

test("the same schema gives the same outline, byte for byte", () => {
  const schema = getGameplayTool("jumpForward").schema;
  assert.equal(renderSchemaOutline(schema), renderSchemaOutline(JSON.parse(JSON.stringify(schema))));
});

// ---------------------------------------------------------------------------
// The time skip's own contract

const jumpOutline = (options) => renderSchemaOutline(foldJumpTool(getGameplayTool("jumpForward"), options).schema);

test("a skip's outline opens with its events, and an event ends with its impacts", () => {
  const outline = jumpOutline({ board: true, agentReports: true });
  const at = (text) => {
    const index = outline.indexOf(text);
    assert.ok(index >= 0, `the outline has ${text}`);
    return index;
  };
  assert.ok(at('"events": [') < at('"stopDate": string'), "the events are written first, so they can be shown as they are written");
  assert.ok(at('"title": string') < at('"description": string'));
  assert.ok(at('"combatants"?: [string]') < at('"impacts"?: {'), "an event's consequences come after its text");
  assert.ok(at('"projectOps"?: [') > at('"regionClaims"?: ['), "the board after every other consequence");
  assert.ok(at(`"${AGENT_REPORTS_FIELD}"?: [`) > at('"agreementUpdates"?: string'), "the agents' reports after everything they must agree with");
  assert.ok(outline.trimEnd().endsWith("}"));
});

test("every field of the contract is in the outline, at its own depth", () => {
  const schema = foldJumpTool(getGameplayTool("jumpForward"), { board: true, agentReports: true }).schema;
  const outline = renderSchemaOutline(schema);
  const impacts = schema.properties.events.items.properties.impacts.properties;
  for (const name of Object.keys(schema.properties)) assert.ok(outline.includes(`\n  "${name}"`), `top level: ${name}`);
  for (const name of Object.keys(schema.properties.events.items.properties)) assert.ok(outline.includes(`\n      "${name}"`), `event: ${name}`);
  for (const name of Object.keys(impacts)) assert.ok(outline.includes(`\n        "${name}"?: `), `impacts: ${name}`);
  for (const op of ["contest", "control", "clear_contest", "spawn", "move", "strength", "remove", "build", "update", "rename", "population", "create", "share"]) {
    assert.ok(outline.includes(`"op": "${op}"`), `the ${op} shape is shown`);
  }
  assert.equal(/\bundefined\b|\[object Object\]/.test(outline), false);
});

test("the lean contract's outline has neither the board nor the agents' reports", () => {
  const outline = renderSchemaOutline(getGameplayTool("jumpForward").schema);
  assert.equal(outline.includes('"projectOps"'), false);
  assert.equal(outline.includes(`"${AGENT_REPORTS_FIELD}"`), false);
});

test("an answer that copies the outline's notation is still read", () => {
  // The marks the outline uses that JSON does not have: `?` after a key, and
  // `//` notes. A model that copies them writes an answer the game can read.
  const copied = '{\n  "events": [\n    {\n      "date": "2016-01-05",  // In-game date.\n      "title": "A depot opens",\n      "notable"?: true,\n    }\n  ],\n  "stopDate": "2016-01-31",\n}';
  assert.deepEqual(parseLooseJson(copied), { events: [{ date: "2016-01-05", title: "A depot opens", notable: true }], stopDate: "2016-01-31" });
});

// ---------------------------------------------------------------------------
// What the model is told about it

test("the format block says it is strict JSON, what the marks mean, and to write the events first", () => {
  const block = buildAnswerFormatBlock(getGameplayTool("jumpForward").schema, { first: "events" });
  const [heading, rules, ...outline] = block.split("\n");
  assert.equal(heading, "[Answer Format]");
  assert.match(rules, /ONE JSON object and nothing else/);
  assert.match(rules, /every key in double quotes at every depth/);
  assert.match(rules, /no comments, no trailing commas/);
  assert.match(rules, /A key followed by \? is optional: leave it out entirely/);
  assert.match(rules, /never write the \? itself/);
  assert.match(rules, /The text after \/\/ describes a field and is not part of the answer/);
  assert.match(rules, /Write the fields in the order shown, "events" first, finishing each entry before starting the next\./);
  assert.equal(outline.join("\n"), renderSchemaOutline(getGameplayTool("jumpForward").schema));
  assert.match(buildAnswerFormatBlock({ type: "object", properties: { a: { type: "string" } } }), /Write the fields in the order shown\.\n/);
});

test("a Gemini skip is asked for as JSON text with this block, and no schema is sent", () => {
  const source = readFileSync(new URL("./main.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = source.slice(source.indexOf("async function callGemini("), source.indexOf("async function callAnthropic("));
  assert.ok(body.length > 1000, "callGemini is in main.jsx");
  assert.match(body, /let jsonAnswer = Boolean\(tool && typeof onToolStream === "function" && !lookupDeclarations\.length\)\s*\n\s*&& !geminiJsonAnswerRefusals\.has\(model\);/);
  assert.match(body, /\? buildAnswerFormatBlock\(tool\.schema, \{ first: Object\.keys\(tool\.schema\?\.properties \?\? \{\}\)\[0\] \|\| "" \}\)/);
  assert.match(body, /\.\.\.\(jsonAnswer \? \{ responseMimeType: "application\/json" \} : \{\}\),/);
  assert.equal(/responseSchema/.test(body), false, "the skip's contract does not fit in one (measured), so none is sent");
  assert.match(body, /\.\.\.\(jsonAnswer \? \[\{ text: answerFormat \}\] : \[\]\),/, "its own part, after the prompt");
  assert.match(body, /\.\.\.\(tool && !jsonAnswer \? \{\s*\n\s*tools: \[\{ functionDeclarations: \[/, "and no function is declared with it");
  const refusal = body.slice(body.indexOf("if (jsonAnswer && [400, 422].includes(response.status)"), body.indexOf("if (jsonAnswerRefused) geminiJsonAnswerRefusals.add(model);"));
  assert.match(refusal, /jsonAnswer = false;\s*\n\s*jsonAnswerRefused = true;/);
  assert.match(refusal, /attempt -= 1;\s*\n\s*continue;/, "a refusal of the form is asked again at once, and is not one of the attempts");
});
