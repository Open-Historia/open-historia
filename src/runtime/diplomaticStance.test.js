/*! Open Historia — Diplomatic Stance Tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGREEMENT_CATEGORY,
  CLIMATE_BANDS,
  RELATION_PRECEDENCE,
  buildDiplomaticStanceMap,
  relationBandForScore,
  relationBandOf,
  relationRank,
  stanceOf,
} from "./diplomaticStance.js";
import { relationStatusForScore } from "../Game/AI/nativeDiplomaticDirector.js";

const stance = (owner, options = {}) => stanceOf(owner, buildDiplomaticStanceMap({ playerCountry: "France", ...options }));
const categoryOf = (owner, options) => stance(owner, options).category;

test("no focus and no player: nothing to draw", () => {
  assert.equal(buildDiplomaticStanceMap({ playerCountry: "" }), null);
  assert.equal(stanceOf("France", null).category, "unknown");
});

test("the focus is the player's country unless another is chosen, by name or code", () => {
  assert.equal(categoryOf("France"), "self");
  assert.equal(categoryOf("FRA"), "self");
  const map = buildDiplomaticStanceMap({ playerCountry: "France", focusCountry: "Germany" });
  assert.equal(stanceOf("Germany", map).category, "self");
  assert.equal(stanceOf("France", map).category, "unknown");
});

test("the climate bands are the game's own, score by score", () => {
  for (let score = -100; score <= 100; score += 1) {
    assert.equal(relationBandForScore(score), relationStatusForScore(score), `score ${score}`);
  }
  // The thresholds, where the old map drew +20 as friendly and -59 as neutral.
  assert.equal(relationBandForScore(20), "cordial");
  assert.equal(relationBandForScore(55), "friendly");
  assert.equal(relationBandForScore(-11), "cautious");
  assert.equal(relationBandForScore(-59), "strained");
  assert.equal(relationBandForScore(-60), "strained");
  assert.equal(relationBandForScore(-61), "hostile");
  assert.equal(relationBandForScore(-90), "rival");
});

test("a score outranks the band a row names; a row without a score keeps its band", () => {
  assert.equal(relationBandOf({ score: -70, status: "friendly" }), "hostile");
  assert.equal(relationBandOf({ status: "Cautious" }), "cautious");
  assert.equal(relationBandOf({ status: "warm" }), "");
});

test("every relation band is drawn, and a pair with no record is unknown, not neutral", () => {
  const relations = [
    { a: "France", b: "Belgium", score: 70 },
    { a: "France", b: "Spain", score: 30 },
    { a: "Italy", b: "France", score: 0 },
    { a: "France", b: "Austria", score: -20 },
    { a: "France", b: "Hungary", score: -45 },
    { a: "France", b: "Serbia", score: -75 },
    { a: "France", b: "Russia", score: -95 },
  ];
  assert.deepEqual(
    ["Belgium", "Spain", "Italy", "Austria", "Hungary", "Serbia", "Russia"].map((owner) => categoryOf(owner, { relations })),
    ["friendly", "cordial", "neutral", "cautious", "strained", "hostile", "rival"],
  );
  assert.equal(categoryOf("Portugal", { relations }), "unknown");
  assert.notEqual(categoryOf("Italy", { relations }), categoryOf("Portugal", { relations }));
});

test("every agreement type is drawn, a group's deals among them", () => {
  const types = Object.keys(AGREEMENT_CATEGORY);
  // The eleven between states, and the nine that fit a group (groupParties.js).
  assert.equal(types.length, 20);
  for (const type of types) {
    const agreements = [{ status: "active", type, parties: ["France", "Belgium"] }];
    assert.equal(categoryOf("Belgium", { agreements }), AGREEMENT_CATEGORY[type], type);
  }
  assert.deepEqual(
    [...new Set(Object.values(AGREEMENT_CATEGORY))].sort(),
    ["access", "agreement", "alliance", "crackdown", "friendly", "guarantee", "nonAggression", "peace", "trade"],
  );
});

test("an agreement no longer in force draws nothing", () => {
  for (const status of ["suspended", "ended", "expired"]) {
    assert.equal(categoryOf("Belgium", { agreements: [{ status, type: "alliance", parties: ["France", "Belgium"] }] }), "unknown");
  }
});

test("a ceasefire is not a war, and an ended war is nothing", () => {
  const war = (status) => [{ id: "w", title: "The War", status, sideA: ["France"], sideB: ["Germany"] }];
  assert.equal(categoryOf("Germany", { wars: war("active") }), "war");
  assert.equal(categoryOf("Germany", { wars: war("ceasefire") }), "ceasefire");
  assert.equal(categoryOf("Germany", { wars: war("ended") }), "unknown");
  assert.deepEqual(stance("Germany", { wars: war("active") }).why, { kind: "active", war: { id: "w", title: "The War" } });
});

test("whoever fights beside the focus is an ally, every member of a side", () => {
  const wars = [{ status: "active", sideA: ["France", "United Kingdom", "Belgium"], sideB: ["Germany", "Austria"] }];
  assert.equal(categoryOf("United Kingdom", { wars }), "alliance");
  assert.equal(categoryOf("Belgium", { wars }), "alliance");
  assert.equal(categoryOf("Austria", { wars }), "war");
});

test("precedence: the strongest tie wins, war over an old trade deal, any treaty over the climate", () => {
  const wars = [{ status: "active", sideA: ["France"], sideB: ["Germany"] }];
  const agreements = [
    { status: "active", type: "trade_economic", parties: ["France", "Germany"] },
    { status: "active", type: "trade_economic", parties: ["France", "Spain"] },
    { status: "active", type: "guarantee", parties: ["France", "Poland"] },
    { status: "active", type: "alliance", parties: ["France", "Poland"] },
  ];
  const relations = [
    { a: "France", b: "Germany", score: 70 },
    { a: "France", b: "Spain", score: 80 },
  ];
  assert.equal(categoryOf("Germany", { wars, agreements, relations }), "war");
  assert.equal(categoryOf("Spain", { agreements, relations }), "trade", "a trade deal outranks a friendly score");
  assert.equal(categoryOf("Poland", { agreements }), "alliance", "an alliance outranks a guarantee, whichever is listed first");
  // The order itself: subordination, war (and a crackdown on a group), the treaties, then the climate.
  assert.deepEqual(RELATION_PRECEDENCE.slice(0, 7), ["self", "overlord", "puppet", "war", "crackdown", "ceasefire", "alliance"]);
  for (const band of CLIMATE_BANDS) {
    assert.ok(relationRank(band, { kind: "relation" }) > relationRank("agreement"), band);
  }
});

test("puppets and overlords, as the player may see them", () => {
  const puppets = [
    { overlord: "France", puppet: "Monaco", status: "active", kind: "protectorate", secrecy: "open" },
    { overlord: "Germany", puppet: "Luxembourg", status: "active", kind: "client", secrecy: "covert" },
    { overlord: "Spain", puppet: "Andorra", status: "released", kind: "client", secrecy: "open" },
  ];
  assert.equal(categoryOf("Monaco", { puppets }), "puppet");
  // Focused on Luxembourg, the player (France) has not learned whose it is.
  const lux = buildDiplomaticStanceMap({ playerCountry: "France", focusCountry: "Luxembourg", puppets });
  assert.equal(stanceOf("Germany", lux).category, "unknown");
  // Once learned, it shows.
  const learned = puppets.map((row) => (row.puppet === "Luxembourg" ? { ...row, knownTo: [{ polity: "France", learnedDate: "2026-01-01" }] } : row));
  assert.equal(stanceOf("Germany", buildDiplomaticStanceMap({ playerCountry: "France", focusCountry: "Luxembourg", puppets: learned })).category, "overlord");
  // The focus's own overlord, from the puppet's side.
  const monaco = buildDiplomaticStanceMap({ playerCountry: "France", focusCountry: "Monaco", puppets });
  assert.equal(stanceOf("France", monaco).category, "overlord");
  assert.equal(categoryOf("Andorra", { puppets, focusCountry: "Spain" }), "unknown");
});

test("institutions bind their full members: a security alliance as an alliance, a union by its kind", () => {
  const institutions = [
    { id: "nato", shortName: "NATO", kind: "security_alliance", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Italy", status: "member" }, { polity: "Sweden", status: "candidate" }] },
    { id: "eu", shortName: "EU", kind: "political_union", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Austria", status: "member" }] },
    { id: "un", shortName: "UN", kind: "international_organization", status: "active", members: [{ polity: "France", status: "member" }, { polity: "Brazil", status: "member" }] },
    { id: "old", shortName: "Old Pact", kind: "defense_pact", status: "dissolved", members: [{ polity: "France", status: "member" }, { polity: "Chile", status: "member" }] },
  ];
  assert.deepEqual(stance("Italy", { institutions }).why, { kind: "institution", institution: "NATO", institutionKind: "security_alliance" });
  assert.equal(categoryOf("Italy", { institutions }), "alliance");
  assert.equal(categoryOf("Sweden", { institutions }), "unknown", "a candidate is not yet bound");
  assert.equal(categoryOf("Austria", { institutions }), "friendly");
  assert.equal(categoryOf("Brazil", { institutions }), "unknown", "the UN binds no one");
  assert.equal(categoryOf("Chile", { institutions }), "unknown", "a dissolved pact binds no one");
});

test("switching the focus redraws every stance from the new focus's side", () => {
  const wars = [{ status: "active", sideA: ["France"], sideB: ["Germany"] }];
  const agreements = [{ status: "active", type: "alliance", parties: ["Germany", "Austria"] }];
  assert.equal(categoryOf("Austria", { wars, agreements }), "unknown");
  assert.equal(categoryOf("France", { wars, agreements, focusCountry: "Germany" }), "war");
  assert.equal(categoryOf("Austria", { wars, agreements, focusCountry: "Germany" }), "alliance");
});
