// Run: node --test src/Game/AI/gameMasterTransport.test.js
//
// The game master answers through JSON array TEXT per subsystem. A slip in one
// of those texts used to discard the whole transaction; now it is salvaged the
// way a whole answer is, and only a text with no array in it is an error.
import test from "node:test";
import assert from "node:assert/strict";

import { decodeGameMasterTransportPayload } from "./gameplaySchemas.js";

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
