/*! Open Historia — closed values are read exactly: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/closedValues.test.js
//
// "there should be absolutely no keywording done in this game anywhere" (the
// owner, 2026-11-13). An op, a posture, a tier is one of the game's own words,
// spelled as the schema spells it; another word for one is no value at all, in
// English exactly as in any other language. These pin each closed set, and that
// a French twin of an English synonym is read exactly like it: as nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MARKER_OPS, markerOpKind } from "../../runtime/markerOps.js";
import { JUMP_FORWARD_SCHEMA, GAME_MASTER_SCHEMA, normalizeGameplayPayload } from "./gameplaySchemas.js";
import { applyEventImpactsToWorld, applyMarkerOps } from "../../runtime/gameState.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const markerOpsSchemaOf = (schema, seen = new Set()) => {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return null;
  seen.add(schema);
  if (schema.properties?.markerOps) return schema.properties.markerOps;
  for (const value of Object.values(schema)) {
    const found = value && typeof value === "object" ? markerOpsSchemaOf(value, seen) : null;
    if (found) return found;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Structures: the five operations

test("the schema's structure operations and the engine's are one closed set", () => {
  for (const schema of [JUMP_FORWARD_SCHEMA, GAME_MASTER_SCHEMA]) {
    const ops = [...new Set(markerOpsSchemaOf(schema).items.anyOf.map((branch) => branch.properties.op.enum).flat())];
    assert.deepEqual(ops.sort(), [...MARKER_OPS].sort());
  }
  assert.equal(markerOpKind(" Build "), "build", "case and spaces aside");
  for (const word of ["found", "fonder", "destroy", "détruire", "modify", "modifier", "create", "add", "delete", ""]) {
    assert.equal(markerOpKind(word), "", word);
  }
});

const fort = { name: "Fort Alpha", kind: "fortress", ownerCode: "Spain", lng: 10, lat: 20 };

test("the engine applies the five and nothing else: an English verb and its French twin both change nothing", () => {
  const built = applyMarkerOps([], [{ op: "build", marker: fort }]);
  assert.equal(built.length, 1);
  for (const pair of [["found", "fonder"], ["destroy", "détruire"], ["modify", "modifier"]]) {
    const [english, french] = pair.map((op) => applyMarkerOps(built, [{ op, name: "Fort Alpha", status: "destroyed", marker: { ...fort, name: "Fort Beta" } }]));
    assert.deepEqual(english, built, pair[0]);
    assert.deepEqual(french, built, pair[1]);
  }
  const ruined = applyMarkerOps(built, [{ op: "update", name: "Fort Alpha", status: "destroyed" }]);
  assert.equal(ruined[0].status, "destroyed", "a ruin is an update to its status");
  assert.equal(ruined.length, 1);
  // An event's stored impacts keep only the five, whatever was written.
  const { world } = applyEventImpactsToWorld({
    world: { markers: built },
    events: [{ id: "e1", date: "1900-01-01", impacts: { markerOps: [{ op: "destroy", name: "Fort Alpha" }, { op: "détruire", name: "Fort Alpha" }] } }],
  });
  assert.equal(world.markers[0].status, "active");
});

test("a time skip's shape leaves an op word as written, and builds only by the word build or by its shape", () => {
  const jump = (markerOps) => normalizeGameplayPayload("jumpForward", {
    summary: "", stopDate: "1900-02-01", events: [{ date: "1900-01-10", title: "Works", description: "d", impacts: { markerOps } }],
  }).events[0].impacts.markerOps;
  const [built, byShape, english, french] = jump([
    { op: "Build", name: "Fort Alpha", kind: "fortress", at: "city: Madrid, country: Spain" },
    { marker: { name: "Fort Beta", kind: "fortress" } },
    { op: "found", name: "Fort Gamma" },
    { op: "fonder", name: "Fort Gamma" },
  ]);
  assert.equal(built.op, "build");
  assert.equal(built.marker.name, "Fort Alpha");
  assert.equal(byShape.op, "build", "no op word but a structure under marker: a build by its shape");
  assert.equal(english.op, "found", "an English verb is not read as build");
  assert.equal(french.op, "fonder");
  const [destroyed, detruit] = jump([{ op: "destroy", name: "Fort Alpha" }, { op: "détruire", name: "Fort Alpha" }]);
  assert.equal(destroyed.op, "destroy", "nor destroy as remove");
  assert.equal(detruit.op, "détruire");
});

test("the task runner leaves out a structure op that is none of the five, says so, and asks nothing more for it", () => {
  const block = gameplay.slice(gameplay.indexOf("const markerOpsLeftOut = [];"), gameplay.indexOf("// 8B.2.18: the Stats tool"));
  assert.ok(block.length > 200, "the block is where it was");
  assert.match(block, /markerOpKind\(written\)/);
  assert.match(block, /markerOpsLeftOut\.push\(\{\s*kind: "item"/);
  assert.doesNotMatch(block, /"found"|"destroy"/, "no English verb is read as an op");
  // The left-out ops reach the answer's removals: the skip's receipt, and the Game Master's notes.
  assert.match(gameplay, /let removedThisAttempt = \[\.\.\.markerOpsLeftOut\];/);
  assert.match(gameplay, /removedThisAttempt = \[\.\.\.markerOpsLeftOut, \.\.\.salvaged\.removed\];/);
  assert.match(gameplay, /const \{ generation, payload, removed \} = await runJsonTask\("gameMaster"/);
  assert.match(gameplay, /for \(const removal of normalizeArray\(removed\)\) \{\n\s*const note = schemaRemovalNote\(removal\)\?\.text;/);
});
