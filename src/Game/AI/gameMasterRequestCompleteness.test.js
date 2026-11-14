/*! Open Historia — GM request completeness tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  gameMasterRequestAsksForPuppet,
  validateGameMasterRequestedPuppetCompleteness,
} from "./gameMasterRequestCompleteness.js";

// Whether the request asks for a puppet is the answer's requestedSubordination,
// which the model reads from the request in any language. The request's own
// words decided when the field was missing (English install phrasings with an
// English negation check); nothing reads them now.

const install = { op: "install", overlord: "Republic of Latvia", puppet: "Republic of Lithuania", kind: "satellite", loyalty: 70, secrecy: "open", eventIndexes: [0], note: "" };

test("relations, agreements and puppet prose cannot satisfy a requested puppet installation", () => {
  const error = validateGameMasterRequestedPuppetCompleteness({
    requestedSubordination: true,
    events: [{ title: "Treaty", description: "Lithuania becomes Latvia's satellite state." }],
    relationUpdates: [{ a: "Republic of Latvia", b: "Republic of Lithuania", score: 90 }],
    agreementUpdates: [{ id: "latvia-lithuania", op: "start", parties: ["Republic of Latvia", "Republic of Lithuania"] }],
    puppetUpdates: [],
  });
  assert.match(error, /no install operation/i);
  assert.match(error, /world\.puppets/i);
});

test("a canonical puppet install satisfies the completeness guard", () => {
  assert.equal(validateGameMasterRequestedPuppetCompleteness({ requestedSubordination: true, puppetUpdates: [install] }), "");
});

test("the answer's requestedSubordination decides, and a request and its translation are held alike", () => {
  // The same answer whatever language the request was in: the request is not
  // an argument any more.
  assert.match(validateGameMasterRequestedPuppetCompleteness({ requestedSubordination: true, puppetUpdates: [] }), /no install operation/i);
  assert.equal(validateGameMasterRequestedPuppetCompleteness({ requestedSubordination: false, puppetUpdates: [] }), "");
  assert.equal(gameMasterRequestAsksForPuppet({ requestedSubordination: true }), true);
  assert.equal(gameMasterRequestAsksForPuppet({ requestedSubordination: false }), false);
});

test("an answer without the field is held to no install", () => {
  assert.equal(gameMasterRequestAsksForPuppet({ puppetUpdates: [] }), false);
  assert.equal(gameMasterRequestAsksForPuppet({}), false);
  assert.equal(gameMasterRequestAsksForPuppet(null), false);
  assert.equal(validateGameMasterRequestedPuppetCompleteness({ puppetUpdates: [] }), "");
});

// gameplay.js does not load under bare node, so its part is read as source:
// the date a GM request names is the answer's requestedDate alone, never the
// request's English month names.
test("gameplay.js reads requestedSubordination and requestedDate, never the request's words", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.doesNotMatch(gameplay, /GAME_MASTER_REQUEST_MONTHS|extractExplicitGameMasterRequestDates|requestExplicitlyInstallsPuppet/);
  assert.match(gameplay, /const requestedDates = gameMasterRequestedDates\(candidate\);/);
  assert.match(gameplay, /validateGameMasterRequestedPuppetCompleteness\(candidate\);/);
});
