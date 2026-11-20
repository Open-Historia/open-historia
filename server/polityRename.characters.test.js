import { test } from "node:test";
import assert from "node:assert/strict";
import { renamePolityInWorld } from "./polityRename.js";

test("renaming the player's polity moves its character to the new key", () => {
  const world = {
    characters: {
      schemaVersion: 1,
      byPolity: { Chernigov: { name: "Svyatoslav", purse: { amount: 1500, currency: "gold" }, purseLog: [] } },
    },
  };
  const { world: renamed } = renamePolityInWorld(world, "Chernigov", "Principality of Chernigov");
  assert.deepEqual(Object.keys(renamed.characters.byPolity), ["Principality of Chernigov"]);
  assert.equal(renamed.characters.byPolity["Principality of Chernigov"].name, "Svyatoslav");
});
