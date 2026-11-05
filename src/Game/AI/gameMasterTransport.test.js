// Run: node --test src/Game/AI/gameMasterTransport.test.js
//
// The game master answers through JSON array TEXT per subsystem. A slip in one
// of those texts used to discard the whole transaction; now it is salvaged the
// way a whole answer is, and only a text with no array in it is an error.
import test from "node:test";
import assert from "node:assert/strict";

import { GAME_MASTER_TRANSPORT_SCHEMA, decodeGameMasterTransportPayload } from "./gameplaySchemas.js";

test("well-formed transport text decodes as before", () => {
  const { payload, error } = decodeGameMasterTransportPayload({
    mode: "world-intervention", summary: "s", eventsJson: '[{"title":"x"}]', territorialScopesJson: "[]", countryStatPatchesJson: "[]", storylineUpdatesJson: "[]",
    warUpdatesJson: "[]", relationUpdatesJson: "[]", agreementUpdatesJson: "[]", diplomaticOutreachJson: "[]",
  });
  assert.equal(error, "");
  assert.deepEqual(payload.events, [{ title: "x" }]);
});

test("a remark after the array, a trailing comma and smart quotes are salvaged", () => {
  const { payload, error } = decodeGameMasterTransportPayload({
    mode: "direct", summary: "s",
    eventsJson: '[{"title":"x",}]',
    territorialScopesJson: '[{“kind”:“legal-transfer”,“baseCountries”:[“Estonia”,“Latvia”,“Lithuania”],“toCode”:“The Baltic Union”,“eventIndex”:0,“note”:“all Baltic territory”}]',
    countryStatPatchesJson: "[] // none",
    storylineUpdatesJson: "[{“id”:“s1”}]",
    warUpdatesJson: "[]", relationUpdatesJson: "[]", agreementUpdatesJson: "[]", diplomaticOutreachJson: "[]",
  });
  assert.equal(error, "");
  assert.deepEqual(payload.events, [{ title: "x" }]);
  assert.deepEqual(payload.countryStatPatches, []);
  assert.deepEqual(payload.storylineUpdates, [{ id: "s1" }]);
  assert.deepEqual(payload.territorialScopes, [{
    kind: "legal-transfer", baseCountries: ["Estonia", "Latvia", "Lithuania"],
    toCode: "The Baltic Union", eventIndex: 0, note: "all Baltic territory",
  }]);
});

test("a text with no array in it is still an error naming the field", () => {
  const { payload, error } = decodeGameMasterTransportPayload({
    mode: "direct", summary: "s", eventsJson: "not json at all", territorialScopesJson: "[]", countryStatPatchesJson: "[]", storylineUpdatesJson: "[]",
    warUpdatesJson: "[]", relationUpdatesJson: "[]", agreementUpdatesJson: "[]", diplomaticOutreachJson: "[]",
  });
  assert.equal(payload, null);
  assert.match(error, /\$\.eventsJson must contain valid JSON array text/);
});

// What the request asked for, read by the model in the request's own language.
const requestFields = { requestedSubordination: true, requestedDate: " -0044-03-15 ", requestedOngoingProcess: false };
const bareTransport = {
  mode: "exact-event", summary: "s", eventsJson: "[]", territorialScopesJson: "[]", countryStatPatchesJson: "[]", storylineUpdatesJson: "[]",
  warUpdatesJson: "[]", relationUpdatesJson: "[]", agreementUpdatesJson: "[]", diplomaticOutreachJson: "[]",
};

test("the answer's reading of the request is carried into the transaction and validates", async () => {
  const { validateGameplayPayload } = await import("./gameplaySchemas.js");
  const { payload, error } = decodeGameMasterTransportPayload({ ...bareTransport, ...requestFields });
  assert.equal(error, "");
  assert.equal(payload.requestedSubordination, true);
  assert.equal(payload.requestedDate, "-0044-03-15");
  assert.equal(payload.requestedOngoingProcess, false);
  assert.equal(validateGameplayPayload("gameMaster", payload).valid, true);
});

test("an answer without them decodes without them, so the English fallbacks decide", () => {
  const { payload } = decodeGameMasterTransportPayload(bareTransport);
  for (const field of Object.keys(requestFields)) assert.equal(field in payload, false, field);
});

// A real-key test of the GM console (2026-10-28) could not start a war: the
// model gave a unit the posture "offensive", and its retry came back with the
// array escaped once too often.
const spawn = (posture) => ({ op: "spawn", unit: { name: "1st Army", type: "infantry", ownerCode: "France", strength: 100, composition: "3 divisions", posture } });
const eventWith = (unitOps) => ({ date: "2016-05-01", title: "France attacks", description: "d", impacts: { unitOps } });

test("array text escaped once too often decodes, with or without the quotes round it", () => {
  const events = [eventWith([spawn("assaulting")])];
  const once = JSON.stringify(JSON.stringify(events));
  for (const eventsJson of [once, once.slice(1, -1)]) {
    const { payload, error } = decodeGameMasterTransportPayload({ ...bareTransport, eventsJson });
    assert.equal(error, "", eventsJson.slice(0, 20));
    assert.deepEqual(payload.events, events);
  }
  // Once only: text escaped twice over is not read as an array.
  const twice = JSON.stringify(once).slice(1, -1);
  assert.match(decodeGameMasterTransportPayload({ ...bareTransport, eventsJson: twice }).error, /\$\.eventsJson must /);
});

test("a unit posture said in other words reads as the posture it means", async () => {
  const { validateGameplayPayload } = await import("./gameplaySchemas.js");
  const move = { op: "move", unitId: "2nd Army", at: "region: Nice, country: France", posture: "Defensive" };
  const eventsJson = JSON.stringify([eventWith([spawn("offensive"), move, spawn("retreating")])]);
  const { payload, error } = decodeGameMasterTransportPayload({ ...bareTransport, eventsJson });
  assert.equal(error, "");
  const [first, second, third] = payload.events[0].impacts.unitOps;
  assert.equal(first.unit.posture, "assaulting");
  assert.equal(second.posture, "holding");
  assert.equal(third.unit.posture, "withdrawing");
  // A word that means none of them is left for the schema to name.
  const odd = decodeGameMasterTransportPayload({ ...bareTransport, eventsJson: JSON.stringify([eventWith([spawn("pondering")])]) }).payload;
  assert.equal(odd.events[0].impacts.unitOps[0].unit.posture, "pondering");
  const verdict = validateGameplayPayload("gameMaster", odd);
  assert.equal(verdict.valid, false);
  assert.match(verdict.error, /posture/);
});

test("the events field names the postures a unit may take, since the text carries no enum", () => {
  assert.match(GAME_MASTER_TRANSPORT_SCHEMA.properties.eventsJson.description, /posture \(impacts\.unitOps\) is one of: holding, massing, patrol, transit, exercise, blockade, withdrawing, assaulting\./);
});
