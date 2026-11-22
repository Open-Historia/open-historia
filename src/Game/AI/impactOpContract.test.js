/*! Open Historia — the operations a prompt teaches are the schema's: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/impactOpContract.test.js
//
// The Game Master's events reach it as JSON TEXT (gameplaySchemas.js
// GAME_MASTER_TRANSPORT_SCHEMA): it is shown no schema for an event's impacts,
// only the shapes its prompt writes out. When the projects rework changed the
// board's ops, the prompt still taught the old ones (milestone, complete,
// remove; status and progress written directly), and every Game Master answer
// that followed it was refused (2026-11-19, two of four reports). A time skip's
// board rules write their shapes out too (projectsDirective.js).
//
// So these hold every shape a prompt teaches to the schema the answer is checked
// against, both ways: every op a shape names is one of the schema's, every field
// it writes is one the op takes, every field the op requires is written, a list
// of choices (a|b|c) is exactly the schema's; and every op the schema has is
// taught. A prompt and its schema can no longer drift apart unseen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GAME_MASTER_SCHEMA, JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";
import { buildJumpProjectsRules } from "./projectsDirective.js";

const source = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
// gameplayPrompts.js imports JSON that node cannot load bare, so the template is
// read from its source, as groupsSwitchedOff.test.js reads it.
const GM_PROMPT = source.match(/NATIVE_GAME_MASTER_PROMPT = `([\s\S]*?)`;/)?.[1] ?? "";

const gmImpacts = GAME_MASTER_SCHEMA.properties.events.items.properties.impacts;
const skipImpacts = JUMP_FORWARD_SCHEMA.properties.events.items.properties.impacts;

// Every top-level {...} in a line, parsed. A placeholder written bare
// (`"days":<1-180>`, `[<what it does>]`) is read as a number or an empty list,
// and an escaped quote of the template literal as a quote.
const examplesIn = (line) => {
  const found = [];
  const text = line.replace(/\\"/g, "\"");
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" || text[index - 1] === "$") continue;
    let depth = 0;
    let inString = false;
    for (let end = index; end < text.length; end += 1) {
      const char = text[end];
      if (char === "\"" && text[end - 1] !== "\\") inString = !inString;
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        const json = text.slice(index, end + 1)
          .replace(/\[<[^>"]*>\]/g, "[]")
          .replace(/:\s*<[^>"]*>/g, ":0");
        found.push(JSON.parse(json));
        index = end;
        break;
      }
    }
  }
  return found;
};

const choicesOf = (value) => (typeof value === "string" && value.includes("|")
  ? value.split("|").map((entry) => entry.trim())
  : null);

const branchesOf = (schema) => (Array.isArray(schema?.anyOf) ? schema.anyOf : [schema]);

// Why `example` does not fit `schema`, or "".
const misfit = (example, schema, path) => {
  if (Array.isArray(schema?.anyOf)) {
    const reasons = schema.anyOf.map((branch) => misfit(example, branch, path));
    return reasons.some((reason) => !reason) ? "" : reasons.join(" / ");
  }
  if (schema?.type === "object" && example && typeof example === "object" && !Array.isArray(example)) {
    const properties = schema.properties ?? {};
    for (const key of Object.keys(example)) {
      if (!properties[key] && schema.additionalProperties === false) return `${path}.${key} is not a field`;
    }
    for (const key of schema.required ?? []) {
      if (!(key in example)) return `${path}.${key} is required and not written`;
    }
    for (const [key, value] of Object.entries(example)) {
      if (!properties[key]) continue;
      const reason = misfit(value, properties[key], `${path}.${key}`);
      if (reason) return reason;
    }
    return "";
  }
  if (schema?.type === "array" && Array.isArray(example)) {
    for (const [index, item] of example.entries()) {
      const reason = misfit(item, schema.items ?? {}, `${path}[${index}]`);
      if (reason) return reason;
    }
    return "";
  }
  const choices = choicesOf(example);
  if (choices && Array.isArray(schema?.enum)) {
    const missing = schema.enum.filter((entry) => !choices.includes(entry));
    const extra = choices.filter((entry) => !schema.enum.includes(entry));
    return missing.length || extra.length ? `${path} lists ${choices.join("|")}; the schema's are ${schema.enum.join("|")}` : "";
  }
  if (typeof example === "string" && Array.isArray(schema?.enum) && example && !example.startsWith("<")) {
    return schema.enum.includes(example) ? "" : `${path} "${example}" is not one of ${schema.enum.join("|")}`;
  }
  return "";
};

// One op per example: its discriminator (op, or a polity change's operation)
// written as a|b|c stands for each of them.
const DISCRIMINATORS = ["op", "operation"];
const expand = (example) => {
  const key = DISCRIMINATORS.find((name) => typeof example?.[name] === "string");
  const choices = key ? choicesOf(example[key]) : null;
  return choices ? choices.map((choice) => ({ ...example, [key]: choice })) : [example];
};

const opsOf = (itemSchema) => {
  const ops = new Set();
  for (const branch of branchesOf(itemSchema)) {
    for (const key of DISCRIMINATORS) for (const value of branch.properties?.[key]?.enum ?? []) ops.add(value);
  }
  return ops;
};

const checkFamily = (family, examples, itemSchema) => {
  assert.ok(examples.length, `${family}: the prompt writes out its shape`);
  const taught = new Set();
  for (const example of examples.flatMap(expand)) {
    const op = DISCRIMINATORS.map((key) => example[key]).find((value) => typeof value === "string");
    if (op) taught.add(op);
    assert.equal(misfit(example, itemSchema, family), "", `${family}: ${JSON.stringify(example)}`);
  }
  for (const op of opsOf(itemSchema)) assert.ok(taught.has(op), `${family}: the schema's op "${op}" is taught`);
};

// The Game Master's "- <family>: ..." lines under "eventsJson element".
const gmShapeLines = () => {
  const start = GM_PROMPT.indexOf("eventsJson element:");
  const end = GM_PROMPT.indexOf("territorialScopesJson element:");
  assert.ok(start > 0 && end > start, "the prompt has its eventsJson shapes");
  return GM_PROMPT.slice(start, end).split("\n").filter((line) => /^- [A-Za-z/]+: /.test(line));
};

test("every impacts list the Game Master's skeleton names is one its events carry", () => {
  const skeleton = examplesIn(GM_PROMPT.slice(GM_PROMPT.indexOf("eventsJson element:")).split("\n")[1])[0];
  for (const key of Object.keys(skeleton.impacts)) assert.ok(gmImpacts.properties[key], `impacts.${key}`);
  for (const line of gmShapeLines()) {
    const families = line.slice(2, line.indexOf(":")).split("/");
    for (const family of families) {
      if (family === "diplomaticOutreach") continue;
      assert.ok(gmImpacts.properties[family], `"- ${family}:" is an impacts list`);
    }
  }
});

test("each impacts list the Game Master is taught is the schema's: its ops, its fields, its choices", () => {
  const seen = new Set();
  for (const line of gmShapeLines()) {
    const family = line.slice(2, line.indexOf(":")).split("/")[0];
    seen.add(family);
    checkFamily(family, examplesIn(line), gmImpacts.properties[family].items);
  }
  for (const family of ["markerOps", "projectOps", "unitOps", "regionControlOps", "regionTransfers", "regionClaims", "polityChanges", "politicalActorOps", "createdChats", "groupOps"]) {
    assert.ok(seen.has(family), `the Game Master is taught ${family}`);
  }
});

test("no leftover of the old board ops: the engine runs the clock", () => {
  const line = gmShapeLines().find((entry) => entry.startsWith("- projectOps:"));
  for (const word of ["|milestone", "|complete", "\"progress\":", "\"status\":", "projectId"]) {
    assert.equal(line.includes(word), false, `projectOps teaches no ${word}`);
  }
});

test("a structure's families are taught, every one the answer may carry", () => {
  const line = gmShapeLines().find((entry) => entry.startsWith("- markerOps:"));
  const build = examplesIn(line).find((example) => example.op === "build");
  assert.deepEqual(choicesOf(build.marker.family), gmImpacts.properties.markerOps.items.anyOf[0].properties.marker.properties.family.enum);
});

test("a time skip's board rules are the board op's schema, both ways", () => {
  const rules = buildJumpProjectsRules({ folded: true });
  checkFamily("projectOps", examplesIn(rules), skipImpacts.properties.projectOps.items);
});

// The transaction's own ledgers, beside the events: each "<field>Json element:"
// shape is the schema's record, its ops and its choices (a war's op, a
// relation's band, an agreement's type) both ways.
test("each ledger the Game Master is taught is the schema's: its ops, its fields, its choices", () => {
  const ledgers = ["warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates", "storylineUpdates", "territorialScopes"];
  for (const field of ledgers) {
    const marker = `${field}Json element`;
    const start = GM_PROMPT.indexOf(marker);
    assert.ok(start > 0, `the prompt writes out ${marker}`);
    const shape = GM_PROMPT.slice(start).split("\n").slice(1).find((line) => line.trim().startsWith("{"));
    checkFamily(field, examplesIn(shape), GAME_MASTER_SCHEMA.properties[field].items);
  }
});
