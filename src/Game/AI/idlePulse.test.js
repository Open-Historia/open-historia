/*! Open Historia — the between-rounds pulse moves what the world may move © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/Game/AI/idlePulse.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// The idle pulse (gameplay.js maybeSendIdleDiplomacy) applied its unit ops on
// an event with no title, which the applier's normalizer drops with everything
// it carries, so no pulse ever changed a unit. These drive the pieces the pulse
// now uses against the real applier: what the world may do (idlePulseUnitOps),
// the event the ops ride on (idlePulseEvent), and the unit keeping the event it
// was detected with (keepDetectedEvents).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyEventImpactsToWorld, normalizeWorldState } from "../../runtime/gameState.js";
import { IDLE_PULSE_EVENT_ID, idlePulseEvent, idlePulseUnitOps, keepDetectedEvents } from "./idlePulse.js";

const PLAYER = "United States of America";
const RUSSIA = "Russian Federation";
const DATE = "2014-04-21";
const motion = { originDate: DATE, round: 3, tick: 1 };

const unit = (id, ownerCode, extra = {}) => ({
  id, name: id, ownerCode, type: "armor", strength: 100, lng: 37.62, lat: 55.75,
  regionId: "Moscow", status: "idle", posture: "holding", eventId: `event-origin-${id}`, ...extra,
});
const world = (units) => normalizeWorldState({ units });
const byId = (state) => new Map(state.units.map((entry) => [entry.id, entry]));

// What maybeSendIdleDiplomacy and applyIdlePulseUnitOps do with a model's ops.
const pulse = (before, ops) => {
  const allowed = idlePulseUnitOps(before, ops, PLAYER);
  const { world: impacted } = applyEventImpactsToWorld({ colors: {}, events: [idlePulseEvent(DATE, allowed)], world: before, motion });
  return { allowed, after: keepDetectedEvents(before, impacted) };
};

test("control: the untitled event the pulse used to send is dropped with its ops", () => {
  const before = world([unit("ru-armor", RUSSIA)]);
  const { world: after } = applyEventImpactsToWorld({
    colors: {},
    events: [{ date: DATE, title: "", description: "", impacts: { unitOps: [{ op: "strength", unitId: "ru-armor", strength: 55 }] } }],
    world: before,
    motion,
  });
  assert.equal(byId(after).get("ru-armor").strength, 100);
});

test("a strength change to another power's unit lands; one to the player's unit does not", () => {
  const before = world([unit("ru-armor", RUSSIA), unit("us-air", PLAYER, { type: "air", lng: 23.3, lat: 55.9, regionId: "Siauliai" })]);
  const { allowed, after } = pulse(before, [
    { op: "strength", unitId: "ru-armor", strength: 55, note: "Rotated out for refit." },
    { op: "strength", unitId: "us-air", strength: 10, note: "Shot up." },
  ]);
  assert.deepEqual(allowed.map((op) => op.unitId), ["ru-armor"]);
  assert.equal(byId(after).get("ru-armor").strength, 55);
  assert.equal(byId(after).get("us-air").strength, 100);
});

test("a move of another power's unit becomes its standing order; the same move of the player's unit does nothing", () => {
  const before = world([unit("ru-armor", RUSSIA), unit("us-air", PLAYER, { type: "air", lng: 23.3, lat: 55.9, regionId: "Siauliai" })]);
  const { after } = pulse(before, [
    { op: "move", unitId: "ru-armor", toLng: 36.25, toLat: 50.0, posture: "massing", note: "Toward the border." },
    { op: "move", unitId: "us-air", toLng: 24.1, toLat: 56.9, posture: "patrol", note: "Sent north." },
  ]);
  const orders = after.pendingUnitOrders;
  // No game time passes in a pulse, so the move is a step: an order to go, and
  // the posture it goes in.
  assert.ok(orders.some((order) => order.unitId === "ru-armor" && order.kind === "move" && order.toLat === 50.0), JSON.stringify(orders));
  assert.equal(byId(after).get("ru-armor").posture, "massing");
  assert.equal(orders.some((order) => order.unitId === "us-air"), false);
  assert.deepEqual(byId(after).get("us-air"), byId(before).get("us-air"));
});

test("the world raises nothing for the player, moves no garrison, touches no missing unit, and changes at most two things", () => {
  const before = world([
    unit("ru-armor", RUSSIA),
    unit("ru-garrison", RUSSIA, { type: "garrison" }),
    unit("deployed-by-player", "Somewhere Else", { source: "player" }),
  ]);
  const allowed = idlePulseUnitOps(before, [
    { op: "spawn", unit: { name: "Task Force 1", ownerCode: PLAYER, type: "naval", lng: 1, lat: 1 } },
    { op: "move", unitId: "ru-garrison", toLng: 1, toLat: 1 },
    { op: "strength", unitId: "no-such-unit", strength: 50 },
    { op: "strength", unitId: "deployed-by-player", strength: 50 },
    { op: "strength", unitId: "ru-garrison", strength: 80 },
    { op: "spawn", unit: { name: "Northern Fleet detachment", ownerCode: RUSSIA, type: "naval", lng: 33.4, lat: 69.1 } },
    { op: "strength", unitId: "ru-armor", strength: 70 },
  ], PLAYER);
  assert.deepEqual(
    allowed.map((op) => (op.op === "spawn" ? `spawn:${op.unit.ownerCode}` : `${op.op}:${op.unitId}`)),
    ["strength:ru-garrison", `spawn:${RUSSIA}`],
  );
});

test("a unit the pulse touched keeps the event it was detected with; nothing points at the pulse's own event", () => {
  const before = world([unit("ru-armor", RUSSIA)]);
  const { after } = pulse(before, [
    { op: "strength", unitId: "ru-armor", strength: 55 },
    { op: "spawn", unit: { name: "Northern Fleet detachment", ownerCode: RUSSIA, type: "naval", lng: 33.4, lat: 69.1 } },
  ]);
  assert.equal(byId(after).get("ru-armor").eventId, "event-origin-ru-armor");
  const raised = after.units.find((entry) => entry.name === "Northern Fleet detachment");
  assert.ok(raised, "the spawn landed");
  assert.equal(raised.eventId || "", "");
  assert.equal(JSON.stringify(after).includes(IDLE_PULSE_EVENT_ID), false);
});

test("the pulse is wired to them", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /events: \[idlePulseEvent\(gameDate, unitOps\)\]/);
  assert.match(source, /advanceStandingOrders\(keepDetectedEvents\(freshWorld, impacted\)/);
  assert.match(source, /const unitOps = idlePulseUnitOps\(bundle\.world, normalizeArray\(payload\.unitOps\), bundle\.game\?\.country\)/);
  assert.doesNotMatch(source, /title: "", description: "", impacts: \{ unitOps \}/);
});
