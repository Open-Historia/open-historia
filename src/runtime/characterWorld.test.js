import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCharacterOpsToWorld, normalizeWorldState } from "./gameState.js";

const sheet = { name: "Svyatoslav", purse: { currency: "grivna", amount: 1500 } };

test("a world without characters gets an empty ledger", () => {
  const world = normalizeWorldState({});
  assert.deepEqual(world.characters, { schemaVersion: 1, byPolity: {} });
});

test("a character written through the door survives a normalise round trip", () => {
  const { world, rejected } = applyCharacterOpsToWorld({
    date: "1066-01-01",
    ops: [{ op: "create", polity: "Chernigov", character: sheet }],
    world: normalizeWorldState({}),
  });
  assert.equal(rejected.length, 0);
  const reloaded = normalizeWorldState(JSON.parse(JSON.stringify(world)));
  assert.equal(reloaded.characters.byPolity.Chernigov.name, "Svyatoslav");
  assert.equal(reloaded.characters.byPolity.Chernigov.purse.amount, 1500);
});

test("the door reports refused operations and leaves the world unchanged", () => {
  const before = normalizeWorldState({});
  const { world, rejected } = applyCharacterOpsToWorld({
    ops: [{ op: "spend", polity: "Chernigov", amount: 10 }],
    world: before,
  });
  assert.equal(rejected.length, 1);
  assert.deepEqual(world.characters, before.characters);
});
