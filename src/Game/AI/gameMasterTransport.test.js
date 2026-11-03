// Run: node --test src/Game/AI/gameMasterTransport.test.js
//
// The game master answers through JSON array TEXT per subsystem. A slip in one
// of those texts used to discard the whole transaction; now it is salvaged the
// way a whole answer is, and only a text with no array in it is an error.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decodeGameMasterTransportPayload } from "./gameplaySchemas.js";

test("GM uses canonical relation score without demanding a second model-authored status", async () => {
  const { validateGameplayPayload } = await import("./gameplaySchemas.js");
  const { decodeRelationUpdates, validateDiplomaticLedgerPayload } =
    await import("./nativeDiplomaticDirector.js");
  const promptSource = readFileSync(new URL("./gameplayPrompts.js", import.meta.url), "utf8");
  const relations = [{ a: "France", b: "Russia", score: 65, eventIndexes: [0],
    summary: "Bilateral cooperation improves" }];
  const { payload, error } = decodeGameMasterTransportPayload({
    mode: "world-intervention", summary: "Bilateral climate update",
    eventsJson: "[]", territorialScopesJson: "[]", countryStatPatchesJson: "[]",
    storylineUpdatesJson: "[]", warUpdatesJson: "[]",
    relationUpdatesJson: JSON.stringify(relations), agreementUpdatesJson: "[]",
    diplomaticOutreachJson: "[]",
  });
  assert.equal(error, "");
  assert.equal(validateGameplayPayload("gameMaster", payload).valid, true,
    "derived status is not a second required model output");
  assert.match(promptSource, /OMIT status/);
  assert.equal(decodeRelationUpdates(relations)[0].status, "friendly");
  assert.equal(decodeRelationUpdates([{ ...relations[0], score: 25 }])[0].status, "cordial");
  const world = { polityOverrides: { France: { status: "active" }, Russia: { status: "active" } } };
  const events = [{ id: "e1", date: "2016-01-01", title: "Agreement",
    description: "Relations improve." }];
  const valid = { events, relationUpdates: relations, agreementUpdates: [] };
  assert.equal(validateDiplomaticLedgerPayload(valid, { world }), "");
  assert.equal(decodeRelationUpdates(valid.relationUpdates)[0].status, "friendly");
  const inconsistent = { events, relationUpdates: [{ ...relations[0], status: "cautious" }],
    agreementUpdates: [] };
  assert.match(validateDiplomaticLedgerPayload(inconsistent, { world }),
    /ABSOLUTE new value/, "explicit contradictory scores still fail closed");
});

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
