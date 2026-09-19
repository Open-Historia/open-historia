/*! Open Historia — lenient payload shape tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/lenientPayloads.test.js
//
// One rejected field fails the WHOLE payload, and for a jump that means the
// player's month goes to canned events. These pin the slips a real model made
// (a DeepSeek V4 Flash field report) that normalizeGameplayPayload now absorbs,
// and that the schema is still strict about everything else.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";

const spawnedCarrier = (unitFields = {}) => ({
  op: "spawn",
  unit: {
    id: "unit-1-ru-admiral-kuznetsov",
    name: "Адмирал Кузнецов",
    type: "naval",
    ownerCode: "Russian Federation",
    strength: 85,
    composition: "1 aircraft carrier, 2 destroyers, 3 frigates",
    lng: 37.6176,
    lat: 55.7558,
    regionId: "",
    ...unitFields,
  },
});

const jumpWith = (unitOps) => ({
  summary: "February 2016.",
  stopDate: "2016-03-01",
  clearActions: true,
  events: [{
    date: "2016-02-03",
    title: "UN Security Council adopts new sanctions against North Korea.",
    description: "Resolution 2270 bans coal exports.",
    importance: "major",
    kind: "world",
    playerRelated: true,
    notable: true,
    tags: ["Politics", "Military"],
    warId: "",
    combatants: [],
    impacts: {
      actionIds: [],
      regionTransfers: [],
      polityChanges: [],
      createdChats: [],
      unitOps,
      markerOps: [],
      spyOps: [],
      regionClaims: [],
    },
  }],
  storylineUpdates: "",
  warUpdates: "",
  relationUpdates: "",
  agreementUpdates: "",
});

const unitOf = (payload) => payload.events[0].impacts.unitOps[0].unit;

test("the field-report jump: a posture written as a status no longer fails the month", () => {
  // Exactly what the model sent: status "holding" beside posture "holding".
  const raw = jumpWith([spawnedCarrier({ status: "holding", posture: "holding" })]);
  assert.equal(validateGameplayPayload("jumpForward", raw).valid, false, "the raw payload is the one that failed");

  const normalized = normalizeGameplayPayload("jumpForward", raw);
  const result = validateGameplayPayload("jumpForward", normalized);
  assert.equal(result.valid, true, result.error);
  assert.equal("status" in unitOf(normalized), false);
  assert.equal(unitOf(normalized).posture, "holding");
});

test("a skip answer that still offers a scene has it dropped, not refused", () => {
  // A scene is played only from an interactive event a skip offers; the jump
  // schema has no `catalyst`, the field skips used to fill.
  const raw = { ...jumpWith([spawnedCarrier()]), catalyst: { title: "A summit", premise: "p", opening: "o", choices: ["a", "b"] } };
  assert.equal(validateGameplayPayload("jumpForward", raw).valid, false, "the schema has no catalyst");
  const normalized = normalizeGameplayPayload("jumpForward", raw);
  assert.equal("catalyst" in normalized, false);
  assert.equal(validateGameplayPayload("jumpForward", normalized).valid, true);
  assert.equal(validateGameplayPayload("autoJumpForward", normalizeGameplayPayload("autoJumpForward", { ...raw, catalyst: null })).valid, true);
});

test("a posture word in status becomes the posture when none was given", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jumpWith([spawnedCarrier({ status: "Patrol" })]));
  assert.equal(validateGameplayPayload("jumpForward", normalized).valid, true);
  assert.equal(unitOf(normalized).posture, "patrol");
});

test("a posture the model did give is never overwritten by the status", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jumpWith([spawnedCarrier({ status: "transit", posture: "massing" })]));
  assert.equal(unitOf(normalized).posture, "massing");
  assert.equal("status" in unitOf(normalized), false);
});

test("an unknown status that is not a posture either is dropped, not guessed at", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jumpWith([spawnedCarrier({ status: "deployed" })]));
  assert.equal(validateGameplayPayload("jumpForward", normalized).valid, true);
  assert.equal("status" in unitOf(normalized), false);
  assert.equal("posture" in unitOf(normalized), false);
});

test("a real status survives, only its case is tidied", () => {
  const normalized = normalizeGameplayPayload("jumpForward", jumpWith([spawnedCarrier({ status: "Engaged" })]));
  assert.equal(unitOf(normalized).status, "engaged");
});

test("the rest of the unit schema is as strict as before", () => {
  const typo = normalizeGameplayPayload("jumpForward", jumpWith([spawnedCarrier({ strenght: 50 })]));
  assert.equal(validateGameplayPayload("jumpForward", typo).valid, false, "a misspelled unit field must still be caught");
});

test("projects: the id the prompt shows as [id …] is accepted as projectId", () => {
  // Verbatim shape from the field report, which held the turn.
  const raw = { projectOps: [{ op: "update", id: "project-0-mtuaa589-l1rt3ud", name: "Саммит", eventIndex: 0, progress: 20, status: "active" }] };
  assert.equal(validateGameplayPayload("projects", raw).valid, false, "the raw payload is the one that failed");

  const normalized = normalizeGameplayPayload("projects", raw);
  assert.equal(validateGameplayPayload("projects", normalized).valid, true);
  assert.equal(normalized.projectOps[0].projectId, "project-0-mtuaa589-l1rt3ud");
  assert.equal("id" in normalized.projectOps[0], false);
});

test("projects: an explicit projectId wins over a stray id", () => {
  const normalized = normalizeGameplayPayload("projects", { projectOps: [{ op: "update", id: "wrong", projectId: "right", name: "X" }] });
  assert.equal(normalized.projectOps[0].projectId, "right");
  assert.equal(validateGameplayPayload("projects", normalized).valid, true);
});

const pulse = (fields) => ({ chat: null, unitOps: [], sighting: null, ...fields });

test("idle diplomacy: silence written as a sentence reads as silence", () => {
  const raw = pulse({ chat: "Quiet pulse — submitting no contact." });
  assert.equal(validateGameplayPayload("idleDiplomacy", raw).valid, false, "the raw payload is the one that failed");

  const normalized = normalizeGameplayPayload("idleDiplomacy", raw);
  assert.equal(validateGameplayPayload("idleDiplomacy", normalized).valid, true);
  assert.equal(normalized.chat, null);
});

test("idle diplomacy: a real note is untouched, and its unit ops get the same leniency", () => {
  const note = { speaker: "Japan", title: "A word", openingMessage: "Hello.", countries: ["Japan"] };
  const normalized = normalizeGameplayPayload("idleDiplomacy", pulse({ chat: note, unitOps: [spawnedCarrier({ status: "exercise" })] }));
  assert.deepEqual(normalized.chat, note);
  assert.equal(validateGameplayPayload("idleDiplomacy", normalized).valid, true);
  assert.equal(normalized.unitOps[0].unit.posture, "exercise");
});

// A chat's participants are names, as the actions reference has always shown
// them. The schema once demanded {code, name} objects — so a model that followed
// the prose failed the schema — and a campaign whose frozen prompt still shows
// that shape must go on working: an object reads as its name.
test("a chat's countries are names; {name} and {code} objects from older prompts read as names", () => {
  const chat = (countries) => ({ title: "Mediation", speaker: "France", openingMessage: "We propose talks.", countries });
  const named = jumpWith([]);
  named.events[0].impacts.createdChats = [chat(["France", "Germany"])];
  named.diplomaticOutreach = [chat(["Italy"])];
  assert.equal(validateGameplayPayload("jumpForward", normalizeGameplayPayload("jumpForward", named)).valid, true);

  const objects = jumpWith([]);
  objects.events[0].impacts.createdChats = [chat([{ name: "France" }, { code: "Germany" }, { name: "" }])];
  objects.diplomaticOutreach = [chat([{ code: "ITA", name: "Italy" }])];
  assert.equal(validateGameplayPayload("jumpForward", objects).valid, false, "the raw shape is the one the schema refuses");
  const normalized = normalizeGameplayPayload("jumpForward", objects);
  assert.deepEqual(normalized.events[0].impacts.createdChats[0].countries, ["France", "Germany"]);
  assert.deepEqual(normalized.diplomaticOutreach[0].countries, ["Italy"]);
  assert.equal(validateGameplayPayload("jumpForward", normalized).valid, true);

  const pulseNote = normalizeGameplayPayload("idleDiplomacy", pulse({ chat: chat([{ name: "Japan" }]) }));
  assert.deepEqual(pulseNote.chat.countries, ["Japan"]);
  assert.equal(validateGameplayPayload("idleDiplomacy", pulseNote).valid, true);
});

test("countryStatSheet: a missing, null or zero statsSchemaVersion is filled before validation", () => {
  assert.equal(normalizeGameplayPayload("countryStatSheet", { capital: "Kyiv" }).statsSchemaVersion, 1);
  assert.equal(normalizeGameplayPayload("countryStatSheet", { statsSchemaVersion: 0 }).statsSchemaVersion, 1);
  assert.equal(normalizeGameplayPayload("countryStatSheet", { statsSchemaVersion: null }).statsSchemaVersion, 1);
  assert.equal(normalizeGameplayPayload("countryStatSheet", { statsSchemaVersion: 2 }).statsSchemaVersion, 2);
  assert.equal(normalizeGameplayPayload("countryStatSheet", "not an object"), "not an object");
});
