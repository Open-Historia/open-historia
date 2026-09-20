/*! Open Historia — Game Master puppet tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/gameMasterPuppets.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { decodeGameMasterTransportPayload, validateGameplayPayload } from "./gameplaySchemas.js";

// THE BUG. A player asked the Game Master to make the United States their
// puppet. The GM understood — it wrote "London Secures Covert Leverage Over
// Washington" and "Washington Reverses Course and Aligns With London" — but its
// answer had nowhere to put a subordination: the GM transaction carried wars,
// relations and agreements, and not puppets. So the story said the US was the
// player's puppet, world.puppets stayed empty, and the country panel said
// nothing.
//
// The GM's answer travels as shallow JSON-array text (the transport) and is
// decoded and then validated against GAME_MASTER_SCHEMA before any preview is
// shown. A puppet change has to survive both.

const transport = (extra = {}) => ({
  mode: "world-intervention",
  summary: "The United States becomes a covert client of the United Kingdom.",
  eventsJson: '[{"date":"2016-01-09","title":"London Secures Covert Leverage Over Washington","description":"British intelligence presents the White House with a stark ultimatum.","importance":"high","kind":"diplomacy","notable":true,"playerRelated":true,"impacts":{}}]',
  countryStatPatchesJson: "[]",
  storylineUpdatesJson: "[]",
  warUpdatesJson: "[]",
  relationUpdatesJson: "[]",
  agreementUpdatesJson: "[]",
  diplomaticOutreachJson: "[]",
  ...extra,
});

const makeUsAPuppet = JSON.stringify([{
  op: "install",
  overlord: "United Kingdom",
  puppet: "United States",
  kind: "client",
  loyalty: 35,
  secrecy: "covert",
  eventIndexes: [0],
  note: "Compromising material forces Washington into line.",
}]);

test("a GM answer that makes a country a puppet carries the change through decoding", () => {
  const { payload, error } = decodeGameMasterTransportPayload(transport({ puppetUpdatesJson: makeUsAPuppet }));
  assert.equal(error, "");
  assert.ok(Array.isArray(payload.puppetUpdates), "the decoded transaction has a puppetUpdates list");
  assert.equal(payload.puppetUpdates.length, 1);
  assert.equal(payload.puppetUpdates[0].puppet, "United States");
  assert.equal(payload.puppetUpdates[0].overlord, "United Kingdom");
});

test("and the decoded transaction is a valid GM transaction", () => {
  const { payload } = decodeGameMasterTransportPayload(transport({ puppetUpdatesJson: makeUsAPuppet }));
  // Not vacuously: a change dropped before validation would pass it trivially.
  assert.equal(payload.puppetUpdates?.length, 1, "the puppet change reached validation");
  const { valid, error } = validateGameplayPayload("gameMaster", payload);
  assert.equal(valid, true, error);
});

test("every kind of subordination can be made, not just one", () => {
  for (const kind of ["protectorate", "satellite", "client"]) {
    const { payload } = decodeGameMasterTransportPayload(transport({
      puppetUpdatesJson: JSON.stringify([{ op: "install", overlord: "United Kingdom", puppet: "United States", kind, loyalty: 50, secrecy: "open", eventIndexes: [0], note: "" }]),
    }));
    assert.equal(payload.puppetUpdates?.[0]?.kind, kind, `${kind} reached validation`);
    assert.equal(validateGameplayPayload("gameMaster", payload).valid, true, kind);
  }
});

test("a GM answer that changes no subordination still decodes as before", () => {
  // The transports that predate puppets carry no puppetUpdatesJson at all; they
  // must not start failing because of it.
  const { payload, error } = decodeGameMasterTransportPayload(transport());
  assert.equal(error, "");
  assert.deepEqual(payload.puppetUpdates ?? [], []);
});
