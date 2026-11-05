/*! Open Historia Continuum — compact generated-event Political Actor schema. */
import test from "node:test";
import assert from "node:assert/strict";
import { GAMEPLAY_TOOLS, normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";

const event = (politicalActorOps) => ({
  date: "2014-09-19",
  title: "Political transition",
  description: "A government transition occurs.",
  importance: "major",
  kind: "politics",
  impacts: { politicalActorOps },
});

const jumpPayload = (politicalActorOps) => ({
  events: [event(politicalActorOps)],
  stopDate: "2014-09-30",
  summary: "A political transition changes the canonical government.",
  storylineUpdates: "",
  warUpdates: "",
  relationUpdates: "",
  agreementUpdates: "",
});

test("jump schema exposes compact politicalActorOps without operation-specific nested schemas", () => {
  const impacts = GAMEPLAY_TOOLS.jumpForward.schema.properties.events.items.properties.impacts.properties;
  assert.ok(impacts.politicalActorOps, "jump events must be able to mutate canonical Political Actors");
  const item = impacts.politicalActorOps.items;
  assert.deepEqual(Object.keys(item.properties).sort(), ["argsJson", "op", "polityKey"]);
  assert.deepEqual(item.required, ["op", "polityKey", "argsJson"]);
  assert.equal(item.additionalProperties, false);
  assert.ok(
    JSON.stringify(impacts.politicalActorOps).length < 800,
    "the additive PWv2 event channel must stay near the ~0.7k handoff budget rather than bloating the jump schema",
  );
});

test("generated political mutations validate through argsJson and reject native-derived pressure/disposition writes", () => {
  const valid = validateGameplayPayload("jumpForward", jumpPayload([{
    op: "replace-leader",
    polityKey: "New Republic",
    argsJson: JSON.stringify({ office: "headOfState", leader: "New President" }),
  }]));
  assert.equal(valid.valid, true, valid.error);

  const pressure = validateGameplayPayload("jumpForward", jumpPayload([{
    op: "set-political-pressures",
    polityKey: "New Republic",
    argsJson: JSON.stringify({ pressures: { security: 90 } }),
  }]));
  assert.equal(pressure.valid, false, "generated events may not write native-derived political pressure directly");

  const directShape = validateGameplayPayload("jumpForward", jumpPayload([{
    op: "replace-leader",
    polityKey: "New Republic",
    argsJson: "{}",
    leader: "This field belongs inside argsJson",
  }]));
  assert.equal(directShape.valid, false, "provider-facing schema stays compact and strict");
});

test("payload wrapper normalization preserves politicalActorOps", () => {
  const raw = jumpPayload([]);
  raw.events[0].impacts = {
    impacts: {
      politicalActorOps: [{
        op: "set-government",
        polityKey: "New Republic",
        argsJson: JSON.stringify({ patch: { form: "parliamentary republic" } }),
      }],
    },
  };
  const normalized = normalizeGameplayPayload("jumpForward", raw);
  assert.equal(normalized.events[0].impacts.politicalActorOps.length, 1);
  assert.equal(normalized.events[0].impacts.politicalActorOps[0].op, "set-government");
});



test("foundational election payload with nested party operations validates through the compact bridge", () => {
  const ops = [
    { op: "set-political-system", polityKey: "The Baltic Union", argsJson: JSON.stringify({ patch: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic", publicLabel: "Parliamentary Republic" } }) },
    { op: "create-party", polityKey: "The Baltic Union", argsJson: JSON.stringify({ party: { id: "liberals", name: "Baltic Liberal Party", ideology: "liberalism" } }) },
    { op: "create-party", polityKey: "The Baltic Union", argsJson: JSON.stringify({ party: { id: "agrarians", name: "Baltic Agrarian Union", ideology: "agrarianism" } }) },
    { op: "set-party-support", polityKey: "The Baltic Union", argsJson: JSON.stringify({ partyId: "liberals", percent: 42 }) },
    { op: "set-party-support", polityKey: "The Baltic Union", argsJson: JSON.stringify({ partyId: "agrarians", percent: 31 }) },
    { op: "form-coalition", polityKey: "The Baltic Union", argsJson: JSON.stringify({ rulingPartyIds: ["liberals"], coalitionPartyIds: ["agrarians"], coalitionName: "Liberal-Agrarian Coalition" }) },
    { op: "replace-leader", polityKey: "The Baltic Union", argsJson: JSON.stringify({ office: "headOfGovernment", leader: { name: "Example Prime Minister" } }) },
    { op: "set-strategy", polityKey: "The Baltic Union", argsJson: JSON.stringify({ patch: { goals: ["Consolidate sovereignty"], fears: ["Russian reconquest"], ambitions: ["Integrate the Baltic state"], domesticPressures: ["Regional integration"] } }) },
    { op: "set-traits", polityKey: "The Baltic Union", argsJson: JSON.stringify({ traits: { pragmatism: 75, consensusDriven: 70 } }) },
  ];
  const payload = jumpPayload(ops);
  payload.events[0].title = "Baltic Union Election Results Return a Liberal-Agrarian Majority";
  payload.events[0].description = "Final results allocate parliamentary seats and establish the first elected government.";
  const verdict = validateGameplayPayload("jumpForward", payload);
  assert.equal(verdict.valid, true, verdict.error);
});
