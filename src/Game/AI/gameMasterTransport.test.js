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

// A posture is one of the schema's eight, spelled as the schema spells it. Any other word, in English or in French,
// is no posture and is left out (the field is optional), so it neither fails the transaction nor reads as a guess.
test("a unit posture is one of the schema's own; any other word, in any language, is left out", async () => {
  const { validateGameplayPayload } = await import("./gameplaySchemas.js");
  const read = (unitOps) => {
    const { payload, error } = decodeGameMasterTransportPayload({ ...bareTransport, eventsJson: JSON.stringify([eventWith(unitOps)]) });
    assert.equal(error, "");
    assert.equal(validateGameplayPayload("gameMaster", payload).valid, true, JSON.stringify(unitOps));
    return payload.events[0].impacts.unitOps;
  };
  const move = (posture) => ({ op: "move", unitId: "2nd Army", at: "region: Nice, country: France", posture });

  const [own, ownMove] = read([spawn(" Assaulting "), move("HOLDING")]);
  assert.equal(own.unit.posture, "assaulting", "case and spaces aside, the schema's own word");
  assert.equal(ownMove.posture, "holding");

  const english = read([spawn("offensive"), move("Defensive"), spawn("retreating"), move("")]);
  const french = read([spawn("offensive"), move("défensive"), spawn("en retraite"), move("")]);
  for (const ops of [english, french]) {
    assert.equal("posture" in ops[0].unit, false);
    assert.equal("posture" in ops[1], false);
    assert.equal("posture" in ops[2].unit, false);
    assert.equal("posture" in ops[3], false, "an empty posture is none");
  }
  assert.deepEqual(english, french, "the English words and their French twins are read alike: as no posture");
});

test("the events field names the postures a unit may take, since the text carries no enum", () => {
  assert.match(GAME_MASTER_TRANSPORT_SCHEMA.properties.eventsJson.description, /posture \(impacts\.unitOps\) is one of: holding, massing, patrol, transit, exercise, blockade, withdrawing, assaulting\./);
});
