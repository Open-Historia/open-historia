/*! Open Historia — GM request completeness tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  gameMasterRequestAsksForPuppet,
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

// Each of these once demanded an install, so the Game Master's correct release
// was re-asked until it installed the puppet the administrator wanted removed.
test("requests to end or prevent a subordination never demand an install", () => {
  for (const request of [
    "Make Belarus no longer a puppet state of Russia.",
    "Liberate Belarus, which has become a puppet state of Russia.",
    "Make sure Poland doesn't become a puppet state of Germany.",
    "Make Belarus cease to be a satellite state of Russia.",
    "Release Belarus from being a client state of Russia.",
    "Make Belarus independent of Russia and end its puppet status.",
  ]) {
    assert.equal(requestExplicitlyInstallsPuppet(request), false, request);
    assert.equal(validateGameMasterRequestedPuppetCompleteness({ puppetUpdates: [] }, { request }), "", request);
  }
});

test("a release in another sentence does not cancel an install", () => {
  assert.equal(requestExplicitlyInstallsPuppet("Make Bosnia a puppet state of Serbia. Release all prisoners."), true);
});

// --- The request in any language: the answer says what it asked for ---

test("the answer's requestedSubordination decides, in any language", () => {
  const polish = "Uczyń Litwę państwem satelickim Łotwy.";
  assert.equal(requestExplicitlyInstallsPuppet(polish), false, "the English patterns cannot read it");
  assert.match(validateGameMasterRequestedPuppetCompleteness({ requestedSubordination: true, puppetUpdates: [] }, { request: polish }), /no install operation/i);
  assert.equal(validateGameMasterRequestedPuppetCompleteness({ requestedSubordination: true, puppetUpdates: [install] }, { request: polish }), "");
});

test("the answer's requestedSubordination overrides an English false positive", () => {
  const request = "Make Belarus a satellite state of Russia no more than a week after the treaty.";
  assert.equal(gameMasterRequestAsksForPuppet({ requestedSubordination: false }, request), false);
});

test("without the field the English patterns still decide", () => {
  assert.equal(gameMasterRequestAsksForPuppet({ puppetUpdates: [] }, liveRequest), true);
  assert.equal(gameMasterRequestAsksForPuppet({}, "Do not make Lithuania a puppet state of Latvia."), false);
});
