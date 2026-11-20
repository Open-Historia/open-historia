import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCharacterOps,
  closePurseLog,
  emptyCharacters,
  normalizeCharacters,
  purseReconciliation,
} from "./characters.js";

const sheet = {
  name: "Svyatoslav Yaroslavich",
  birthdate: "1027-01-01",
  titles: ["Prince of Chernigov"],
  skills: { martial: "Excellent", bogus: "Legendary" },
  purse: { currency: "grivna", amount: 1500 },
};

test("normalizeCharacters fills every field and rejects unknown skill levels", () => {
  const ledger = normalizeCharacters({ byPolity: { Chernigov: sheet } });
  const character = ledger.byPolity.Chernigov;
  assert.equal(character.skills.martial, "Excellent");
  assert.equal(character.skills.bogus, undefined);
  assert.equal(character.skills.diplomacy, "Average");
  assert.equal(character.health.status, "Healthy");
  assert.deepEqual(character.inventory, []);
});

test("create then duplicate create is refused", () => {
  const first = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
  ], { date: "1066-01-01" });
  assert.equal(first.rejected.length, 0);
  assert.equal(first.characters.byPolity.Chernigov.updatedDate, "1066-01-01");
  const again = applyCharacterOps(first.characters, [
    { op: "create", polity: "Chernigov", character: sheet },
  ]);
  assert.equal(again.rejected.length, 1);
});

test("injury sets health to the worst standing injury and heal removes it", () => {
  let { characters } = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
    { op: "injure", polity: "Chernigov", injury: { id: "arm", type: "Severe", location: "left arm" } },
    { op: "injure", polity: "Chernigov", injury: { id: "leg", type: "Minor", location: "shin" } },
  ]);
  assert.equal(characters.byPolity.Chernigov.health.status, "Severe");
  ({ characters } = applyCharacterOps(characters, [{ op: "heal", polity: "Chernigov", injuryId: "arm" }]));
  assert.equal(characters.byPolity.Chernigov.health.status, "Minor");
});

test("spend beyond the purse is refused and changes nothing", () => {
  const start = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
  ]).characters;
  const result = applyCharacterOps(start, [
    { op: "spend", polity: "Chernigov", amount: 2000, note: "fleet" },
  ]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.characters.byPolity.Chernigov.purse.amount, 1500);
});

test("patch cannot rewrite health, purse or inventory", () => {
  const start = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
  ]).characters;
  const result = applyCharacterOps(start, [
    { op: "patch", polity: "Chernigov", fields: { purse: { amount: 99999 } } },
  ]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.characters.byPolity.Chernigov.purse.amount, 1500);
});

test("items: gain adds, lose removes the quantity asked for", () => {
  let { characters } = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
    { op: "gain", polity: "Chernigov", item: { id: "book", name: "treatise", rarity: "Rare" }, qty: 2 },
  ]);
  assert.equal(characters.byPolity.Chernigov.inventory[0].qty, 2);
  ({ characters } = applyCharacterOps(characters, [{ op: "lose", polity: "Chernigov", itemId: "book", qty: 1 }]));
  assert.equal(characters.byPolity.Chernigov.inventory[0].qty, 1);
});

test("unknown verb and unknown person are reported, not thrown", () => {
  const result = applyCharacterOps(emptyCharacters(), [
    { op: "teleport" },
    { op: "heal", polity: "Nobody", injuryId: "x" },
  ]);
  assert.equal(result.rejected.length, 2);
});

test("purse reconciliation is computed from the log and balances", () => {
  let { characters } = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
  ], { date: "1066-01-01" });
  characters = applyCharacterOps(characters, [
    { op: "earn", polity: "Chernigov", amount: 340, note: "tax" },
    { op: "spend", polity: "Chernigov", amount: 650, note: "barns" },
  ], { date: "1066-02-01" }).characters;
  const report = purseReconciliation(characters.byPolity.Chernigov);
  assert.deepEqual(
    { start: report.start, income: report.income, expenses: report.expenses, end: report.end },
    { start: 1500, income: 340, expenses: 650, end: 1190 },
  );
  assert.equal(report.balanced, true);
});

test("after a report closes the log, the next reconciliation starts from the new purse", () => {
  let { characters } = applyCharacterOps(emptyCharacters(), [
    { op: "create", polity: "Chernigov", character: sheet },
  ]);
  const closed = closePurseLog(characters.byPolity.Chernigov);
  const after = applyCharacterOps({ byPolity: { Chernigov: closed } }, [
    { op: "earn", polity: "Chernigov", amount: 100 },
  ]).characters.byPolity.Chernigov;
  const report = purseReconciliation(after);
  assert.equal(report.start, 1500);
  assert.equal(report.balanced, true);
});

import { eventsTouchCharacter } from "./characters.js";

test("no character yet: always asked, so the task can create one", () => {
  assert.equal(eventsTouchCharacter([], null), true);
});

test("events about the person, or with a touch keyword, ask the task; plain trade news does not", () => {
  const character = { name: "Svyatoslav Yaroslavich" };
  assert.equal(eventsTouchCharacter([{ title: "Svyatoslav fell ill", description: "" }], character), true);
  assert.equal(eventsTouchCharacter([{ title: "Grain prices", description: "Rye rose in Kiev" }], character), false);
  assert.equal(eventsTouchCharacter([{ title: "Raid", description: "A wound from the raid", playerRelated: false }], character), true);
  assert.equal(eventsTouchCharacter([{ title: "Council", description: "Yaroslavich was summoned", playerRelated: false }], character), true);
});
