/*! Open Historia — GM request completeness tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  requestExplicitlyInstallsPuppet,
  validateGameMasterRequestedPuppetCompleteness,
} from "./gameMasterRequestCompleteness.js";

const install = { op: "install", overlord: "Republic of Latvia", puppet: "Republic of Lithuania", kind: "satellite", loyalty: 70, secrecy: "open", eventIndexes: [0], note: "" };

const liveRequest = "Make Lithuania an open satellite state of Latvia with an initial loyalty of 70, preserving its territory and separate sovereignty, established via a formal diplomatic treaty and event.";

test("the live Lithuania request explicitly requires a canonical puppet install", () => {
  assert.equal(requestExplicitlyInstallsPuppet(liveRequest), true);
});

test("relations, agreements and puppet prose cannot satisfy an explicit puppet installation request", () => {
  const error = validateGameMasterRequestedPuppetCompleteness({
    events: [{ title: "Treaty", description: "Lithuania becomes Latvia's satellite state." }],
    relationUpdates: [{ a: "Republic of Latvia", b: "Republic of Lithuania", score: 90 }],
    agreementUpdates: [{ id: "latvia-lithuania", op: "start", parties: ["Republic of Latvia", "Republic of Lithuania"] }],
    puppetUpdates: [],
  }, { request: liveRequest });
  assert.match(error, /no install operation/i);
  assert.match(error, /world\.puppets/i);
});

test("a canonical puppet install satisfies the request-level completeness guard", () => {
  assert.equal(validateGameMasterRequestedPuppetCompleteness({ puppetUpdates: [install] }, { request: liveRequest }), "");
});

test("other direct installation phrasings are recognized without hardcoding one country", () => {
  for (const request of [
    "Turn Poland into a covert client state of Germany.",
    "Install Estonia as a protectorate under Sweden.",
    "Set Bulgaria as an open puppet state of Russia.",
    "Establish a protectorate over Morocco.",
    "Romania becomes a satellite state of Austria.",
  ]) {
    assert.equal(requestExplicitlyInstallsPuppet(request), true, request);
  }
});

test("negated and descriptive mentions do not manufacture a canonical puppet requirement", () => {
  for (const request of [
    "Do not make Lithuania a puppet state of Latvia.",
    "Never turn Lithuania into a satellite state.",
    "Create an event where the opposition calls Lithuania a puppet state.",
    "Record a speech accusing Latvia of treating Lithuania like a satellite state.",
    "Keep Lithuania independent and prevent it from becoming a client state.",
  ]) {
    assert.equal(requestExplicitlyInstallsPuppet(request), false, request);
    assert.equal(validateGameMasterRequestedPuppetCompleteness({ puppetUpdates: [] }, { request }), "", request);
  }
});
