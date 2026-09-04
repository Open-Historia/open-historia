/*! Open Historia — canonical war ledger tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/warLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWarIdsForPolity,
  applyWarUpdates,
  buildCanonicalWarContext,
  decodeWarUpdates,
  reconcileCombatWarState,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";

// A war exists only because a warUpdates record started it, and a battle can
// only be narrated inside one that is active: the invariant the whole ledger
// enforces, exercised end to end on the compact line transport the model emits.

const world = { polityOverrides: {}, wars: [] };

const declaration = () => [{
  id: "e1",
  date: "1914-08-03",
  title: "Germany declares war on France",
  description: "Berlin declares war on Paris after the ultimatum expires.",
  kind: "diplomacy",
  warId: "war-france-germany-1914",
}];

test("a declaration starts a canonical war bound to its event", () => {
  const events = declaration();
  const candidate = { events, warUpdates: "war-france-germany-1914~start~Germany~France~1~Declaration of war" };
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");

  const merge = applyWarUpdates({
    world,
    updates: decodeWarUpdates(candidate.warUpdates),
    events,
    stopDate: "1914-08-31",
    round: 2,
  });
  assert.deepEqual(merge.appliedIds, ["war-france-germany-1914"]);
  assert.equal(merge.wars.length, 1);
  assert.equal(merge.wars[0].status, "active");
  assert.deepEqual(merge.wars[0].sideA, ["Germany"]);
  assert.deepEqual(merge.wars[0].sideB, ["France"]);
  assert.equal(merge.wars[0].startedDate, "1914-08-03");
  assert.deepEqual(merge.wars[0].sourceEventIds, ["e1"]);
  assert.deepEqual(activeWarIdsForPolity(merge.world, "France"), ["war-france-germany-1914"]);
  assert.match(buildCanonicalWarContext(merge.world), /war-france-germany-1914 \| ACTIVE \| SIDE A: Germany \| SIDE B: France/);
});

test("a declaration with no matching warUpdates record is rejected", () => {
  const error = validateWarLedgerPayload({ events: declaration(), warUpdates: "" }, { world });
  assert.match(error, /narrates a canonical war transition but has no matching warUpdates record/);
});

test("hard combat without a canonical war is rejected", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  assert.match(validateWarLedgerPayload(candidate, { world }), /has no event\.warId/);
});

test("reconciliation binds unlabelled combat to the one matching active war", () => {
  const warWorld = {
    ...world,
    wars: [{ id: "war-france-germany-1914", status: "active", sideA: ["Germany"], sideB: ["France"], startedDate: "1914-08-03" }],
  };
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-08-20",
      title: "Battle of the Frontiers",
      description: "French and German armies clash along the whole border.",
      kind: "military",
      combatants: ["France", "Germany"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world: warWorld });
  assert.equal(repair.bound, 1);
  assert.deepEqual(repair.unresolved, []);
  assert.equal(candidate.events[0].warId, "war-france-germany-1914");
  assert.equal(validateWarLedgerPayload(candidate, { world: warWorld }), "");
});

test("a readiness event naming two allies is not combat and creates no war", () => {
  const candidate = {
    events: [{
      id: "e1",
      date: "1914-07-30",
      title: "Joint staff talks conclude",
      description: "British and French staffs agree combat-readiness measures and a deployment plan.",
      kind: "military",
      combatants: ["France", "United Kingdom"],
    }],
    warUpdates: "",
  };
  const repair = reconcileCombatWarState(candidate, { world });
  assert.equal(repair.started, 0);
  assert.equal(repair.sanitized, 1);
  assert.deepEqual(candidate.events[0].combatants, []);
  assert.equal(validateWarLedgerPayload(candidate, { world }), "");
});

test("ceasefire, resume and end move the status; a second start on a live war is refused", () => {
  const warWorld = { ...world, wars: [{ id: "w", status: "active", sideA: ["A"], sideB: ["B"], startedDate: "1900-01-01" }] };
  const events = [{ id: "e1", date: "1901-01-01", title: "Armistice signed between A and B", description: "The guns fall silent.", warId: "w" }];

  const paused = applyWarUpdates({ world: warWorld, updates: "w~ceasefire~~~1~armistice", events, stopDate: "1901-01-31", round: 3 });
  assert.equal(paused.wars[0].status, "ceasefire");

  const again = applyWarUpdates({ world: paused.world, updates: "w~start~A~B~1~again", events, stopDate: "1901-02-01", round: 4 });
  assert.deepEqual(again.appliedIds, []);
  assert.equal(again.wars[0].status, "ceasefire");

  const resumed = applyWarUpdates({ world: paused.world, updates: "w~resume~~~1~fighting resumes", events, stopDate: "1901-02-01", round: 4 });
  assert.equal(resumed.wars[0].status, "active");

  const ended = applyWarUpdates({ world: resumed.world, updates: "w~end~~~1~peace", events, stopDate: "1901-03-01", round: 5 });
  assert.equal(ended.wars[0].status, "ended");
  assert.equal(ended.wars[0].endedDate, "1901-01-01");
  assert.match(buildCanonicalWarContext(ended.world), /No active or ceasefire canonical wars/);
});
