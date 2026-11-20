/*! Open Historia — one malformed op no longer costs the Game Master everything: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/gmOpValidation.test.js
//
// Four player reports (2026-11-19), each "AI task "gameMaster" failed" over ONE
// operation inside one event:
//   1. a build written half nested: its name and family beside op, the rest
//      under marker;
//   2. a board op the projects rework removed (the prompt still taught
//      milestone, complete and remove);
//   3. a board op writing its status directly (the prompt still taught it);
//   4. a build with no family, which the game writes as a landmark before the
//      check, and the check refused the landmark.
// Each is fed here, reconstructed, through the Game Master's answer path as the
// task runner reads it (gameplay.js runJsonTask): the transport decoded, the
// shape normalized, the structures settled, the schema checked, and salvage
// confined to one operation (answerImpactOps.js). The answer is taken, its
// event applies, a bad op is dropped and said, and the valid ops beside it
// still apply.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  decodeGameMasterTransportPayload,
  normalizeGameplayPayload,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import { salvageTaskAnswer, settleMarkerOps } from "./answerImpactOps.js";
import { describeSchemaRemoval } from "./schemaSalvage.js";
import { schemaRemovalNote } from "../../runtime/receiptPlayerNotes.js";
import { applyEventImpactsToWorld } from "../../runtime/gameState.js";

const transport = (impacts, extra = {}) => ({
  mode: "exact-event",
  modeReason: "One finished occurrence.",
  summary: "Spain fortifies its coast.",
  eventsJson: JSON.stringify([{ date: "1950-03-01", title: "Coastal works", description: "Spain fortifies Cadiz.", impacts }]),
  territorialScopesJson: "[]",
  countryStatPatchesJson: "[]",
  storylineUpdatesJson: "[]",
  warUpdatesJson: "[]",
  relationUpdatesJson: "[]",
  agreementUpdatesJson: "[]",
  puppetUpdatesJson: "[]",
  diplomaticOutreachJson: "[]",
  requestedSubordination: false,
  requestedDate: "",
  requestedOngoingProcess: false,
  ...extra,
});

// The Game Master's answer path, as runJsonTask runs it on an answer it may
// salvage (requests are being saved, or this is the last answer).
const readGameMasterAnswer = (raw) => {
  const decoded = decodeGameMasterTransportPayload(raw);
  assert.equal(decoded.error, "");
  const parsed = normalizeGameplayPayload("gameMaster", decoded.payload);
  const leftOut = settleMarkerOps(parsed);
  const check = (candidate) => validateGameplayPayload("gameMaster", candidate);
  const verdict = check(parsed);
  if (verdict.valid) return { ok: true, payload: parsed, removed: leftOut };
  const salvaged = salvageTaskAnswer("gameMaster", parsed, check);
  return { ok: salvaged.valid, error: salvaged.error, payload: salvaged.value, removed: [...leftOut, ...salvaged.removed] };
};

const fortBuild = { op: "build", marker: { name: "Fort Cadiz", kind: "fortress", ownerCode: "Spain", lng: -6.29, lat: 36.53 } };
const board = [{ id: "p1", name: "Atlantic Wall", ownerCode: "Spain", kind: "project", status: "active", progress: 40 }];
const apply = (payload) => applyEventImpactsToWorld({
  world: { markers: [], projects: board.map((entry) => ({ ...entry })) },
  events: payload.events.map((event, index) => ({ ...event, id: `gm-${index}` })),
});

test("report 1: a build written half nested is one structure, read whole", () => {
  const result = readGameMasterAnswer(transport({
    markerOps: [{ op: "build", name: "Fort Cadiz", family: "military", marker: { kind: "fortress", ownerCode: "Spain", lng: -6.29, lat: 36.53 } }],
  }));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.removed, []);
  const [op] = result.payload.events[0].impacts.markerOps;
  assert.equal(op.marker.name, "Fort Cadiz");
  assert.equal(op.marker.family, "military", "the family it said, kept");
  assert.equal("name" in op, false, "nothing is left beside op");
  const { world } = apply(result.payload);
  assert.equal(world.markers.length, 1);
  assert.equal(world.markers[0].name, "Fort Cadiz");
});

test("report 2: a board op the rework removed is dropped and said; the build beside it stands", () => {
  const result = readGameMasterAnswer(transport({
    markerOps: [fortBuild],
    projectOps: [{ op: "complete", projectId: "p1", name: "Atlantic Wall", progress: 100 }],
  }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].path, "$.events[0].impacts.projectOps[0]");
  assert.equal(result.removed[0].kind, "item", "the op whole, never a field of it");
  assert.match(describeSchemaRemoval(result.removed[0]), /Coastal works/);
  assert.ok(schemaRemovalNote(result.removed[0])?.text, "the administrator is told");
  assert.deepEqual(result.payload.events[0].impacts.projectOps, []);
  const { world } = apply(result.payload);
  assert.equal(world.markers[0].name, "Fort Cadiz", "the valid op beside it applies");
  assert.equal(world.projects[0].progress, 40, "the board is the engine's");
});

test("report 3: a board op writing its status is dropped; a valid board op beside it applies", () => {
  const result = readGameMasterAnswer(transport({
    projectOps: [
      { op: "update", name: "Atlantic Wall", status: "completed" },
      { op: "setback", name: "Atlantic Wall", days: 30, lastUpdate: "A storm floods the works." },
    ],
  }));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.removed.map((entry) => entry.path), ["$.events[0].impacts.projectOps[0]"]);
  assert.deepEqual(result.payload.events[0].impacts.projectOps.map((op) => op.op), ["setback"]);
  const { world } = apply(result.payload);
  const project = world.projects.find((entry) => entry.name === "Atlantic Wall");
  assert.equal(project.lastUpdate, "A storm floods the works.", "the setback beside it applies");
  assert.notEqual(project.status, "completed");
});

test("report 4: a build that says no family is a landmark, and is taken", () => {
  const result = readGameMasterAnswer(transport({ markerOps: [fortBuild] }));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.removed, []);
  assert.equal(result.payload.events[0].impacts.markerOps[0].marker.family, "landmark");
  const { world } = apply(result.payload);
  assert.equal(world.markers[0].family, "landmark");
});

test("a structure op the schema refuses is dropped whole and said; the event and its other ops stand", () => {
  const result = readGameMasterAnswer(transport({
    markerOps: [{ op: "update", name: "Old Mole", population: 5 }, fortBuild],
  }));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.removed.map((entry) => entry.path), ["$.events[0].impacts.markerOps[0]"]);
  assert.equal(result.payload.events.length, 1, "the event stands");
  assert.deepEqual(result.payload.events[0].impacts.markerOps.map((op) => op.op), ["build"]);
});

test("an op word that is none of the five is left out and said, never read for its meaning", () => {
  const result = readGameMasterAnswer(transport({ markerOps: [{ op: "construire", name: "Fort Cadiz" }, fortBuild] }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.removed.length, 1);
  assert.match(result.removed[0].error, /"construire" is none of them/);
});

test("a fault outside an event's operations still fails the transaction: half a transaction is not a smaller one", () => {
  const result = readGameMasterAnswer(transport({ markerOps: [fortBuild] }, {
    warUpdatesJson: JSON.stringify([{ id: "war-x", op: "begin", actors: ["Spain"], opponents: ["Portugal"], eventIndexes: [0], note: "" }]),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /warUpdates\[0\]\.op/);
  assert.equal(result.payload.warUpdates.length, 1, "nothing of the ledger was cut");
});

test("an event field the schema refuses is not cut either: only an operation may go", () => {
  const raw = transport({ markerOps: [fortBuild] });
  raw.eventsJson = JSON.stringify([{ date: "1950-03-01", title: "Coastal works", description: "d", notable: "very", impacts: { markerOps: [fortBuild] } }]);
  const result = readGameMasterAnswer(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /notable/);
});

test("the task runner reads every answer through these doors, the Game Master's included", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /const markerOpsLeftOut = settleMarkerOps\(parsed\);/);
  assert.match(gameplay, /if \(!validation\.valid && parsed && lastChance && !transportDecodeError\) \{/);
  assert.match(gameplay, /salvageTaskAnswer\(taskKey, cloneValue\(parsed\), checkAnswer\)/);
  assert.doesNotMatch(gameplay, /lastChance && taskKey !== "gameMaster"/, "no task is kept from salvage");
  // An operation the world cannot carry (a unit or structure it does not name, a
  // project not on the board) is left out of the Game Master's last answer, said.
  assert.match(gameplay, /strictTransfers: true,\n(?:\s*\/\/.*\n)*\s*strictOps: !finalAttempt,/);
});
