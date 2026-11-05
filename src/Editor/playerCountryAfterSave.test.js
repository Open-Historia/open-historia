/*! Open Historia — the player country a Workshop save keeps: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/playerCountryAfterSave.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { playerCountryAfterSave, scenarioAfterWorkshopRenames } from "./playerCountryAfterSave.js";

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

// The seed after "Japan" was renamed "Empire of Japan" in the Workshop.
const renamedSeed = {
  game: { country: "Afghanistan" },
  world: {
    regionOwnershipOverrides: { r1: "Afghanistan", r2: "Empire of Japan", r3: "Korea" },
    polityOverrides: { "Empire of Japan": { name: "Empire of Japan" } },
  },
};
const scenarioWorld = {
  polityOverrides: { Japan: { name: "Japan" }, Korea: { name: "Korea" } },
  countryTags: { Japan: ["imperial"], Korea: ["occupied"] },
  playerGoals: { Japan: "Dominate the Pacific" },
  relations: [{ a: "Japan", b: "Korea", value: -40 }],
};

test("a Workshop rename of the player country carries into the scenario", () => {
  const { world, game } = scenarioAfterWorkshopRenames(scenarioWorld, { country: "Japan", gameDate: "1910-08-29" }, [{ from: "Japan", to: "Empire of Japan" }]);
  assert.equal(game.country, "Empire of Japan");
  assert.equal(game.gameDate, "1910-08-29");
  assert.equal(playerCountryAfterSave(game.country, renamedSeed), "Empire of Japan", "not the seed's first owner");
  assert.deepEqual(world.countryTags, { "Empire of Japan": ["imperial"], Korea: ["occupied"] });
  assert.deepEqual(world.playerGoals, { "Empire of Japan": "Dominate the Pacific" });
  assert.deepEqual(world.relations, [{ a: "Empire of Japan", b: "Korea", value: -40 }]);
});

test("renames replay in order, and other countries are left alone", () => {
  const renames = [{ from: "Japan", to: "Nippon" }, { from: "Nippon", to: "Empire of Japan" }];
  const { world, game } = scenarioAfterWorkshopRenames(scenarioWorld, { country: "Japan" }, renames);
  assert.equal(game.country, "Empire of Japan");
  assert.deepEqual(Object.keys(world.countryTags).sort(), ["Empire of Japan", "Korea"]);
  const other = scenarioAfterWorkshopRenames(scenarioWorld, { country: "Korea" }, renames);
  assert.equal(other.game.country, "Korea");
});

test("no renames leaves the scenario untouched, and the player country moves only on its exact key", () => {
  const game = { country: "Japan" };
  const same = scenarioAfterWorkshopRenames(scenarioWorld, game, []);
  assert.equal(same.world, scenarioWorld);
  assert.equal(same.game, game);
  assert.equal(scenarioAfterWorkshopRenames(scenarioWorld, { country: "Russia" }, [{ from: "Russian Federation", to: "Rus" }]).game.country, "Russia");
});

test("a rename onto a name the old registry still holds keeps the world but moves the player country", () => {
  const world = { polityOverrides: { Japan: { name: "Japan" }, Nippon: { name: "Nippon" } }, countryTags: { Japan: ["imperial"] } };
  const out = scenarioAfterWorkshopRenames(world, { country: "Japan" }, [{ from: "Japan", to: "Nippon" }]);
  assert.equal(out.world, world);
  assert.equal(out.game.country, "Nippon");
});

test("after a refused step, a later rename does not move the other polity's records", () => {
  const world = { polityOverrides: { Japan: { name: "Japan" }, Nippon: { name: "Nippon" } }, countryTags: { Japan: ["imperial"], Nippon: ["shogunate"] } };
  const renames = [{ from: "Japan", to: "Nippon" }, { from: "Nippon", to: "Empire of Japan" }];
  const out = scenarioAfterWorkshopRenames(world, { country: "Japan" }, renames);
  assert.deepEqual(out.world.countryTags, { Japan: ["imperial"], Nippon: ["shogunate"] });
  assert.equal(out.game.country, "Empire of Japan");
});
