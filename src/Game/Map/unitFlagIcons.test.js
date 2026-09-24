/*! Open Historia — unit counter flag resolution tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveUnitFlagUrl } from "./unitFlagIcons.js";

// Seen in a live game (2026-09-21): the United Kingdom was reconstituted as the
// British Empire, the country panel kept showing the Union flag, and every one
// of its counters on the map went back to the unit-type letters.
const britishEmpire = {
  "British Empire": { code: "British Empire", name: "British Empire", aliases: ["United Kingdom"], status: "active" },
};

test("a renamed polity's counters find its flag through its former name", () => {
  assert.equal(resolveUnitFlagUrl("British Empire", {}, britishEmpire), "https://flagcdn.com/w160/gb.png");
});

test("a flag uploaded under the former name reaches the renamed polity's counters", () => {
  const custom = { "United Kingdom": "data:image/png;base64,AAAA" };
  assert.equal(resolveUnitFlagUrl("British Empire", custom, britishEmpire), "data:image/png;base64,AAAA");
});

test("a stock country still gets its raster flag", () => {
  assert.equal(resolveUnitFlagUrl("Argentina", {}, {}), "https://flagcdn.com/w160/ar.png");
});

test("an owner with no flag anywhere falls back to the type glyph", () => {
  assert.equal(resolveUnitFlagUrl("Nowhere In Particular", {}, {}), null);
  assert.equal(resolveUnitFlagUrl("", {}, {}), null);
});
