/*! Open Historia — Diplomatic Stance Tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { buildDiplomaticStanceMap, getDiplomaticOwnerColor, DIPLO_COLORS, NEUTRAL_LAND_COLOR } from "./diplomaticStance.js";

const colorOf = (owner, options) => getDiplomaticOwnerColor(owner, buildDiplomaticStanceMap({ playerCountry: "France", ...options }));

test("returns null when player country is not specified", () => {
  assert.equal(buildDiplomaticStanceMap({ playerCountry: "" }), null);
  assert.equal(getDiplomaticOwnerColor("France", null), NEUTRAL_LAND_COLOR);
});

test("identifies the player country correctly and colors it blue", () => {
  assert.equal(colorOf("France"), DIPLO_COLORS.player);
  assert.equal(colorOf("FRA"), DIPLO_COLORS.player);
});

test("identifies war enemies and colors them red, and the player's side as allies", () => {
  const wars = [{ status: "active", sideA: ["France", "United Kingdom"], sideB: ["Germany", "Austria"] }];
  assert.equal(colorOf("Germany", { wars }), DIPLO_COLORS.enemy);
  assert.equal(colorOf("DEU", { wars }), DIPLO_COLORS.enemy);
  assert.equal(colorOf("Austria", { wars }), DIPLO_COLORS.enemy);
  assert.equal(colorOf("United Kingdom", { wars }), DIPLO_COLORS.ally);
});

test("an ended war colours no one", () => {
  const wars = [{ status: "ended", sideA: ["France"], sideB: ["Germany"] }];
  assert.equal(colorOf("Germany", { wars }), DIPLO_COLORS.neutral);
});

test("an enemy at war stays an enemy whatever agreement or relation it has", () => {
  const wars = [{ status: "active", sideA: ["France"], sideB: ["Germany"] }];
  const agreements = [{ status: "active", type: "trade_economic", parties: ["France", "Germany"] }];
  const relations = [{ a: "France", b: "Germany", score: 70, status: "friendly" }];
  assert.equal(colorOf("Germany", { wars, agreements, relations }), DIPLO_COLORS.enemy);
});

test("alliances, mutual defence and military cooperation make allies", () => {
  const agreements = [
    { status: "active", type: "alliance", parties: ["France", "Belgium"] },
    { status: "active", type: "mutual_defense", parties: ["France", "Netherlands"] },
    { status: "active", type: "military_cooperation", parties: ["France", "Italy"] },
  ];
  for (const country of ["Belgium", "Netherlands", "Italy"]) assert.equal(colorOf(country, { agreements }), DIPLO_COLORS.ally);
});

test("an alliance outranks a friendly agreement with the same country", () => {
  const agreements = [
    { status: "active", type: "trade_economic", parties: ["France", "Belgium"] },
    { status: "active", type: "alliance", parties: ["France", "Belgium"] },
  ];
  assert.equal(colorOf("Belgium", { agreements }), DIPLO_COLORS.ally);
});

test("trade and friendship agreements make friends", () => {
  const agreements = [
    { status: "active", type: "trade_economic", parties: ["France", "Spain"] },
    { status: "active", type: "friendship_consultation", parties: ["France", "Portugal"] },
  ];
  assert.equal(colorOf("Spain", { agreements }), DIPLO_COLORS.friendly);
  assert.equal(colorOf("Portugal", { agreements }), DIPLO_COLORS.friendly);
});

test("peace settlements, neutrality, military access and non-aggression leave the colour alone", () => {
  const agreements = ["peace_settlement", "neutrality", "military_access", "non_aggression", "guarantee", "other"]
    .map((type, index) => ({ status: "active", type, parties: ["France", `Country ${index}`] }));
  agreements.forEach((_, index) => assert.equal(colorOf(`Country ${index}`, { agreements }), DIPLO_COLORS.neutral));
});

test("an agreement that is no longer in force colours no one", () => {
  const agreements = [{ status: "ended", type: "alliance", parties: ["France", "Belgium"] }];
  assert.equal(colorOf("Belgium", { agreements }), DIPLO_COLORS.neutral);
});

test("the relation's status decides friendly and hostile", () => {
  const relations = [
    { a: "France", b: "Portugal", score: 25, status: "cordial" },
    { a: "France", b: "Spain", score: 60, status: "friendly" },
    { a: "France", b: "Russia", score: -20, status: "rival" },
    { a: "China", b: "France", score: -80, status: "hostile" },
    { a: "France", b: "Brazil", score: 0, status: "neutral" },
    { a: "France", b: "Japan", score: -40, status: "strained" },
  ];
  assert.equal(colorOf("Portugal", { relations }), DIPLO_COLORS.friendly);
  assert.equal(colorOf("Spain", { relations }), DIPLO_COLORS.friendly);
  assert.equal(colorOf("Russia", { relations }), DIPLO_COLORS.hostile);
  assert.equal(colorOf("China", { relations }), DIPLO_COLORS.hostile);
  assert.equal(colorOf("Brazil", { relations }), DIPLO_COLORS.neutral);
  assert.equal(colorOf("Japan", { relations }), DIPLO_COLORS.neutral);
});

test("relations between two other countries colour neither", () => {
  const relations = [{ a: "Germany", b: "Spain", score: -90, status: "hostile" }];
  assert.equal(colorOf("Germany", { relations }), DIPLO_COLORS.neutral);
});

test("the player's own active puppets, and no one else's", () => {
  const puppets = [
    { status: "active", overlord: "France", puppet: "Monaco" },
    { status: "released", overlord: "France", puppet: "Andorra" },
    { status: "active", overlord: "Germany", puppet: "Luxembourg" },
  ];
  assert.equal(colorOf("Monaco", { puppets }), DIPLO_COLORS.puppet);
  assert.equal(colorOf("Andorra", { puppets }), DIPLO_COLORS.neutral);
  assert.equal(colorOf("Luxembourg", { puppets }), DIPLO_COLORS.neutral);
});

test("every stance has its own colour", () => {
  const colors = Object.values(DIPLO_COLORS);
  assert.equal(new Set(colors).size, colors.length);
});

test("colors unowned land with neutral land tone", () => {
  const stance = buildDiplomaticStanceMap({ playerCountry: "France" });
  assert.equal(getDiplomaticOwnerColor("", stance), NEUTRAL_LAND_COLOR);
  assert.equal(getDiplomaticOwnerColor(null, stance), NEUTRAL_LAND_COLOR);
});
