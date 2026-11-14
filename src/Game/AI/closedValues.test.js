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
import { PROJECT_OPS, applyEventImpactsToWorld, applyMarkerOps, applyProjectOps, projectOpKind } from "../../runtime/gameState.js";

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

// ---------------------------------------------------------------------------
// The projects board: the turn's validation takes exactly the ops the board applies

test("the board's ops are the schema's seven and its own close; a verb in any language is none of them", () => {
  assert.deepEqual([...PROJECT_OPS], ["create", "update", "milestone", "complete", "cancel", "fail", "remove", "close"]);
  assert.equal(projectOpKind({ op: " Create " }), "create");
  assert.equal(projectOpKind({ action: "milestone" }), "milestone", "the field the board has always also read");
  for (const op of ["start", "lancer", "launch", "open", "ouvrir", "add", "finish", "terminer", ""]) {
    assert.equal(projectOpKind({ op }), "", op);
  }
  const board = applyProjectOps([], [{ op: "start", name: "Project Leviathan", summary: "A carrier." }, { op: "lancer", name: "Projet Léviathan", summary: "Un porte-avions." }]);
  assert.deepEqual(board, [], "neither verb opens a project");
  assert.equal(applyProjectOps([], [{ op: "create", name: "Project Leviathan", summary: "A carrier." }]).length, 1);
});

test("the turn's validation leaves out a project op the board would not apply, says so, and never asks again for it", () => {
  const start = gameplay.indexOf("const keptProjectOps = [];");
  const block = gameplay.slice(start, gameplay.indexOf("impacts.projectOps = keptProjectOps;", start));
  assert.ok(block.length > 200, "the block is where it was");
  assert.match(block, /const op = projectOpKind\(operation\);\n\s*if \(!op\) \{\n\s*const written = [^\n]+\n\s*drop\(path, [^\n]+"malformedOne"\);\n\s*continue;\n\s*\}/);
  assert.doesNotMatch(block.replace(/\/\/[^\n]*/g, ""), /"start"|"launch"|"open"|"add"/, "no English verb passes as a create");
  assert.match(block, /if \(op === "create"\) \{/);
});

// ---------------------------------------------------------------------------
// Claims and de-facto control: the schema's own fields and ops

const claimEvent = (impacts) => ({ id: "e1", date: "2025-01-01", title: "t", description: "d", impacts });
const disputed = () => ({ regionClaimants: { "UKR.4_1": ["Russia", "Belarus"] }, regionOwnershipOverrides: { "UKR.4_1": "Ukraine" } });
const after = (impacts, world = disputed()) => applyEventImpactsToWorld({ events: [claimEvent(impacts)], world }).world;

test("a claim is withdrawn by its drop, never by a verb: 'renounce' and 'renoncer' both assert it", () => {
  assert.deepEqual(after({ regionClaims: [{ regionId: "UKR.4_1", claimantCode: "Russia", drop: true }] }).regionClaimants["UKR.4_1"], ["Belarus"]);
  assert.deepEqual(after({ regionClaims: [{ regionId: "UKR.4_1", claimantCode: "Russia", op: "drop" }] }).regionClaimants["UKR.4_1"], ["Belarus"], "the game's own word in the op's place");
  for (const op of ["renounce", "renoncer"]) {
    const next = after({ regionClaims: [{ regionId: "UKR.4_1", claimantCode: "Russia", op }] });
    assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Russia", "Belarus"], op);
  }
});

test("a control op is one of the schema's three, and every contender goes only by clearAll", () => {
  // control_flip and its French twin are no op: the region stays with Ukraine.
  for (const op of ["control_flip", "basculer"]) {
    const next = after({ regionControlOps: [{ op, regionId: "UKR.4_1", fromCode: "Ukraine", toCode: "Russia" }] });
    assert.equal(next.regionOwnershipOverrides["UKR.4_1"], "Ukraine", op);
  }
  const taken = after({ regionControlOps: [{ op: "control", regionId: "UKR.4_1", fromCode: "Ukraine", toCode: "Russia" }] });
  assert.equal(taken.regionOwnershipOverrides["UKR.4_1"], "Russia");

  // "clear" and a claimant named "all" (or "tous") clear nothing; clear_contest with clearAll clears every contender.
  for (const op of [{ op: "clear", claimantCode: "Russia" }, { op: "clear_contest", claimantCode: "all" }, { op: "clear_contest", claimantCode: "tous" }]) {
    const next = after({ regionControlOps: [{ regionId: "UKR.4_1", fromCode: "Ukraine", ...op }] });
    assert.deepEqual(next.regionClaimants["UKR.4_1"], ["Russia", "Belarus"], JSON.stringify(op));
  }
  const one = after({ regionControlOps: [{ op: "clear_contest", regionId: "UKR.4_1", fromCode: "Ukraine", claimantCode: "Russia" }] });
  assert.deepEqual(one.regionClaimants["UKR.4_1"], ["Belarus"], "one contender, named");
  const cleared = after({ regionControlOps: [{ op: "clear_contest", regionId: "UKR.4_1", fromCode: "Ukraine", clearAll: true }] });
  assert.equal("UKR.4_1" in cleared.regionClaimants, false, "clearAll clears every contender");
});

// ---------------------------------------------------------------------------
// A strike's side: the game's own two tags for a country or a group

test("a side tagged country: or group: is that name; any other word before a colon is part of it, in any language", async () => {
  const { placeStrikes } = await import("./frontTurn.js");
  const { decodeEventStrikes } = await import("./nativeFrontLedger.js");
  const ownerOf = async (side) => {
    const struck = decodeEventStrikes([`${side}~bombing run~~city: Brod~6~none`], "e1");
    const [placed] = await placeStrikes(struck, { events: [{ id: "e1", date: "2024-03-04" }], cities: [{ name: "Brod", lng: 51, lat: 45 }], world: { markers: [], units: [] }, toDate: "2024-03-31" });
    return placed?.owner;
  };
  assert.equal(await ownerOf("country: Aland"), "Aland");
  assert.equal(await ownerOf("Group: Black Hand"), "Black Hand");
  assert.equal(await ownerOf("polity: Aland"), "polity: Aland", "not a tag the game writes");
  assert.equal(await ownerOf("pays: Aland"), "pays: Aland", "nor its French twin");
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
