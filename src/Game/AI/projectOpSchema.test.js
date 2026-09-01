/*! Open Historia — projectOps schema contract tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/projectOpSchema.test.js
//
// The six-variant anyOf that used to describe impacts.projectOps was 41.5 KB
// serialized — 66% of the whole jump tool schema — because three of its variants
// each restated projectSchema in full. It collapsed to one object discriminated
// by `op`.
//
// This file is the safety net for that collapse: EVERY op shape the old schema
// accepted must still validate, because a payload the schema rejects costs the
// player the whole turn, not just the one op. The shapes below are taken from
// what the old variants declared and from the fixtures in
// src/runtime/projectOps.test.js, which exercises the reducer these feed.

import test from "node:test";
import assert from "node:assert/strict";

import { GAMEPLAY_TOOLS, validateGameplayPayload } from "./gameplaySchemas.js";

// The smallest valid jump payload that carries one projectOp, so the op is what
// is actually under test rather than the envelope around it.
const jumpWith = (...projectOps) => ({
  summary: "A quarter passes.",
  stopDate: "1936-04-01",
  events: [{
    date: "1936-03-02",
    title: "The yards are laid down",
    description: "Work begins on the new programme.",
    impacts: { projectOps },
  }],
});

const accepts = (op, what) => {
  const result = validateGameplayPayload("jumpForward", jumpWith(op));
  assert.equal(result.valid, true, `${what} should validate, got: ${result.error}`);
};

test("every op verb the old anyOf declared still validates", () => {
  accepts({ op: "create", name: "Project Leviathan", summary: "A new battleship programme.", kind: "project" }, "create");
  accepts({ op: "update", name: "Project Leviathan", progress: 58, status: "stalled", lastUpdate: "Steel deliveries stopped." }, "update");
  accepts({ op: "milestone", name: "Project Leviathan", milestone: { title: "Keel laid", date: "1936-05-01" } }, "milestone");
  accepts({ op: "complete", name: "Project Leviathan", note: "She commissioned on time." }, "complete");
  accepts({ op: "cancel", name: "Project Leviathan", note: "The budget was cut." }, "cancel");
  accepts({ op: "fail", name: "Project Leviathan", note: "The yard was bombed." }, "fail");
  accepts({ op: "remove", name: "Project Leviathan", note: "Opened in error." }, "remove");
});

// The flat create exists because models routinely put the fields beside `op`
// instead of nesting them, and the schema refusing it threw away the WHOLE turn
// over one op. That must stay true.
test("a create written flat is accepted, with every descriptive field", () => {
  accepts({
    op: "create",
    name: "Operation Kingfisher",
    summary: "Infiltrate the northern shipyards.",
    kind: "operation",
    ownerCode: "Spain",
    status: "active",
    priority: "high",
    progress: 0,
    tags: ["intelligence", "naval"],
    secrecy: "covert",
    startedAt: "1936-03-02",
    ongoing: false,
    targetDate: "1937-01-01",
    milestones: [{ title: "Agents in place", date: "1936-06-01" }],
    lastUpdate: "Approved by the ministry.",
    linkedUnitIds: ["unit-3"],
    linkedMarkerIds: ["marker-7"],
    focus: { lng: -3.7, lat: 40.4 },
    note: "Funded from the reserve.",
  }, "a fully populated flat create");
});

// The nested spelling is no longer taught, but a model that emits it anyway must
// not cost the turn — the reducer reads `operation.project ?? operation`.
test("the legacy nested create is still tolerated", () => {
  accepts(
    { op: "create", name: "Project Leviathan", project: { name: "Project Leviathan", summary: "A new battleship programme." } },
    "a nested create",
  );
});

test("an onComplete payload validates without the schemas being re-embedded", () => {
  accepts({
    op: "create",
    name: "The Northern Marches Campaign",
    summary: "Obtain the disputed provinces.",
    onComplete: {
      regionTransfers: [{ regionId: "Northern Marches", toCode: "Ruritania" }],
      polityChanges: [{ code: "Ruritania", name: "Federal Republic of Ruritania" }],
      regionClaims: [{ regionId: "Northern Marches", claimantCode: "Ruritania", drop: true }],
    },
  }, "a create carrying onComplete");
});

test("a rename carries both the current and the new name", () => {
  accepts({ op: "update", name: "Project Leviathan", newName: "Project Poseidon" }, "a rename");
});

// The collapse must not turn the schema into an anything-goes object: a typo'd
// field is how a silently-dropped op happens, and the strict/salvage validator
// downstream relies on the schema catching it first.
test("the schema still rejects what it should", () => {
  const unknownField = validateGameplayPayload("jumpForward", jumpWith({ op: "update", name: "X", progres: 50 }));
  assert.equal(unknownField.valid, false, "a misspelled field must not pass silently");

  const unknownOp = validateGameplayPayload("jumpForward", jumpWith({ op: "advance", name: "X" }));
  assert.equal(unknownOp.valid, false, "an op verb outside the enum must be rejected");

  const noName = validateGameplayPayload("jumpForward", jumpWith({ op: "update", progress: 50 }));
  assert.equal(noName.valid, false, "an op that names nothing cannot be routed to a project");

  const badProgress = validateGameplayPayload("jumpForward", jumpWith({ op: "update", name: "X", progress: 150 }));
  assert.equal(badProgress.valid, false, "progress outside 0-100 must be rejected");
});

// The reason the collapse was worth doing at all.
test("the collapse actually removed the bulk it was meant to", () => {
  const jumpSchemaChars = JSON.stringify(GAMEPLAY_TOOLS.jumpForward.schema).length;
  const projectOpsChars = JSON.stringify(
    GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties.projectOps,
  ).length;

  // Was 41,538 of 63,161 — two thirds of the whole contract for one impact
  // branch. A regression here means someone re-embedded projectSchema.
  assert.ok(projectOpsChars < 14000, `projectOps grew back to ${projectOpsChars} chars`);
  assert.ok(jumpSchemaChars < 38000, `the jump schema grew back to ${jumpSchemaChars} chars`);
});
