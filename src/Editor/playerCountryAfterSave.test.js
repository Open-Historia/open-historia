/*! Open Historia — the player country a Workshop save keeps: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/playerCountryAfterSave.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { playerCountryAfterSave } from "./playerCountryAfterSave.js";

// A seed as buildGameSeed makes it: the first owner is its only pick.
const seed = {
  game: { country: "United States of America" },
  world: {
    regionOwnershipOverrides: { r1: "United States of America", r2: "Japan", r3: "Korea" },
    polityOverrides: {
      "Righteous Armies": { name: "Righteous Armies", landless: true },
      "joseon-key": { name: "Joseon" },
    },
  },
};

test("a Workshop save keeps the scenario's player country while the map has it", () => {
  assert.equal(playerCountryAfterSave("Japan", seed), "Japan");
  assert.equal(playerCountryAfterSave("Righteous Armies", seed), "Righteous Armies", "a landless country in the registry is on the map");
  assert.equal(playerCountryAfterSave("Joseon", seed), "Joseon", "by its display name too");
});

test("the seed's pick is the start country only when there is none, or it left the map", () => {
  assert.equal(playerCountryAfterSave("", seed), "United States of America");
  assert.equal(playerCountryAfterSave("Ming China", seed), "United States of America", "a country no longer on the map");
  assert.equal(playerCountryAfterSave("japan", seed), "United States of America", "names are exact");
  assert.equal(playerCountryAfterSave("Japan", { game: { country: "" }, world: {} }), "Japan", "nothing to replace it with");
});
