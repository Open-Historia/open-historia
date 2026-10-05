// Run: node --test src/Game/AI/territoryBasisSchema.test.js
//
// Runs without node_modules: gameplaySchemas.js and territoryBasis.js are
// import-free.
//
// The contract side of "why the land moves" (runtime/territoryBasis.js). The
// field has to be OPTIONAL — an older payload, the Game Master console and a
// lenient local backend all answer without it, and rejecting them would bring
// back the bug this game has actually had, borders that fail to move — and it
// has to be a closed vocabulary, so a model cannot invent a ninth reason the
// engine has no rule for. The jump is also told, in words, every value the
// schema offers; a value it is offered but never had explained is a coin toss.
import test from "node:test";
import assert from "node:assert/strict";

import { GAMEPLAY_TOOLS, validateGameplayPayload } from "./gameplaySchemas.js";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import {
  TERRITORY_BASIS_DESCRIPTION,
  TERRITORY_BASIS_ENUM,
} from "../../runtime/territoryBasis.js";

const jumpWith = (impacts) => ({
  clearActions: true,
  events: [{
    date: "1936-05-09",
    title: "Rome proclaims an empire",
    description: "The proclamation is read from the Palazzo Venezia.",
    impacts: { actionIds: [], createdChats: [], markerOps: [], polityChanges: [], regionTransfers: [], unitOps: [], ...impacts },
  }],
  stopDate: "1936-05-10",
  summary: "A proclamation.",
});

const transfer = (extra = {}) => ({ regionId: "ETH.11_1", fromCode: "Ethiopia", toCode: "Italy", ...extra });
const control = (extra = {}) => ({ op: "control", regionId: "ETH.1_1", fromCode: "Ethiopia", toCode: "Italy", ...extra });

test("a transfer and a control operation validate without a basis", () => {
  const verdict = validateGameplayPayload("jumpForward", jumpWith({
    regionTransfers: [transfer()],
    regionControlOps: [control()],
  }));
  assert.deepEqual(verdict, { valid: true, error: "" });
});

test("every word of the vocabulary validates on both families", () => {
  for (const basis of TERRITORY_BASIS_ENUM) {
    const verdict = validateGameplayPayload("jumpForward", jumpWith({
      regionTransfers: [transfer({ basis })],
      regionControlOps: [control({ basis })],
    }));
    assert.equal(verdict.valid, true, `${basis}: ${verdict.error}`);
  }
});

test("a reason outside the vocabulary is rejected, so the retry can name a real one", () => {
  const onTransfer = validateGameplayPayload("jumpForward", jumpWith({ regionTransfers: [transfer({ basis: "manifest destiny" })] }));
  assert.equal(onTransfer.valid, false);
  assert.match(onTransfer.error, /basis/);
  const onControl = validateGameplayPayload("jumpForward", jumpWith({ regionControlOps: [control({ basis: "vibes" })] }));
  assert.equal(onControl.valid, false);
});

test("the schema offers exactly the vocabulary, on the transfer and on the control flip", () => {
  const impacts = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties;
  assert.deepEqual(impacts.regionTransfers.items.properties.basis.enum, [...TERRITORY_BASIS_ENUM]);
  const controlVariant = impacts.regionControlOps.items.anyOf
    .find((variant) => variant.properties.op.enum.includes("control"));
  assert.deepEqual(controlVariant.properties.basis.enum, [...TERRITORY_BASIS_ENUM]);
  // A contest is already the middle state and a cleared contest moves nothing
  // toward anyone, so neither is asked why.
  for (const variant of impacts.regionControlOps.items.anyOf) {
    if (variant === controlVariant) continue;
    assert.equal("basis" in variant.properties, false);
  }
  assert.ok(!impacts.regionTransfers.items.required.includes("basis"), "basis must stay optional");
  assert.ok(!controlVariant.required.includes("basis"), "basis must stay optional");
});

// The jump template's [The Map] states the rule (it was a directive appended at
// call time until 2026-09-26).
test("the jump is told, in words, every value the schema offers it", () => {
  for (const task of ["jumpForward", "autoJumpForward"]) {
    const map = defaultPrompts.tasks[task].slice(defaultPrompts.tasks[task].indexOf("[The Map]"));
    for (const basis of TERRITORY_BASIS_ENUM) {
      assert.ok(map.includes(basis), `${task}: the map rules never mention "${basis}"`);
    }
    // And what the engine DOES with the answer, which is the part that makes a
    // model answer honestly rather than to please.
    assert.match(map, /a claim is recorded as that polity's claim/);
    assert.match(map, /change nothing on the map/);
  }
  for (const basis of TERRITORY_BASIS_ENUM) {
    assert.ok(TERRITORY_BASIS_DESCRIPTION.includes(basis), `the schema description never mentions "${basis}"`);
  }
});
