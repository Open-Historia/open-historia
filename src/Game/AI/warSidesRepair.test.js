/*! Open Historia — war sides repair tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/warSidesRepair.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { WAR_SIDES_REPAIR_VERSION, repairWarSides } from "./warSidesRepair.js";

const war = (sideA, sideB, extra = {}) => ({ id: "war-ukraine", status: "active", sideA, sideB, ...extra });
const agreement = (type, parties, extra = {}) => ({ id: `ag-${parties.join("-")}`, type, status: "active", parties, title: `${type} ${parties.join("–")}`, ...extra });

test("#892: the UK on Russia's side, committed to Ukraine, moves across", () => {
  const { world, moved } = repairWarSides({
    wars: [war(["Russia", "United Kingdom", "Belarus"], ["Ukraine"])],
    agreements: [agreement("military_cooperation", ["United Kingdom", "Ukraine"]), agreement("alliance", ["Russia", "Belarus"])],
  });
  assert.deepEqual([world.wars[0].sideA, world.wars[0].sideB], [["Russia", "Belarus"], ["Ukraine", "United Kingdom"]]);
  assert.equal(moved.length, 1);
  assert.match(moved[0].reason, /committed to Ukraine on the other side/);
  assert.equal(world.warSidesRepairVersion, WAR_SIDES_REPAIR_VERSION);
});

test("hostility toward its own side moves a polity too", () => {
  const { world } = repairWarSides({
    wars: [war(["Russia", "United Kingdom"], ["Ukraine"])],
    relations: [{ a: "United Kingdom", b: "Russia", status: "hostile", score: -70 }],
  });
  assert.deepEqual(world.wars[0].sideB, ["Ukraine", "United Kingdom"]);
});

test("nothing moves on mixed, missing or founding evidence", () => {
  const cases = [
    // No ties recorded at all: an empty ledger is no evidence.
    { wars: [war(["Russia", "United Kingdom"], ["Ukraine"])] },
    // Pulled across but also held: committed to both sides.
    { wars: [war(["Russia", "United Kingdom"], ["Ukraine"])], agreements: [agreement("alliance", ["United Kingdom", "Ukraine"]), agreement("alliance", ["United Kingdom", "Russia"])] },
    // A trade deal is no military commitment.
    { wars: [war(["Russia", "United Kingdom"], ["Ukraine"])], agreements: [agreement("trade_economic", ["United Kingdom", "Ukraine"])] },
    // An ended alliance is no commitment.
    { wars: [war(["Russia", "United Kingdom"], ["Ukraine"])], agreements: [agreement("alliance", ["United Kingdom", "Ukraine"], { status: "ended" })] },
    // The polity a side was opened with is never moved.
    { wars: [war(["Russia"], ["Ukraine"])], relations: [{ a: "Russia", b: "Ukraine", status: "friendly", score: 60 }], agreements: [agreement("alliance", ["Russia", "Ukraine"])] },
    // A war that has ended is history.
    { wars: [war(["Russia", "United Kingdom"], ["Ukraine"], { status: "ended" })], agreements: [agreement("alliance", ["United Kingdom", "Ukraine"])] },
  ];
  for (const input of cases) {
    const { world, moved } = repairWarSides(input);
    assert.deepEqual(moved, [], JSON.stringify(input));
    assert.deepEqual([world.wars[0].sideA, world.wars[0].sideB], [input.wars[0].sideA, input.wars[0].sideB]);
  }
});

test("it runs once per save", () => {
  const input = {
    wars: [war(["Russia", "United Kingdom"], ["Ukraine"])],
    agreements: [agreement("alliance", ["United Kingdom", "Ukraine"])],
    warSidesRepairVersion: WAR_SIDES_REPAIR_VERSION,
  };
  const { world, moved } = repairWarSides(input);
  assert.equal(world, input);
  assert.deepEqual(moved, []);
});

test("a time skip repairs the sides as it reads the save, after the ledgers are seeded", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(gameplay, /const bundle = withWarSidesRepair\(withDiplomaticLedgerMigration\(await readGameStateBundle\(\{ force: true \}\)\)\);\n  const baseColors/);
  assert.match(gameplay, /withWarSidesRepair\(withDiplomaticLedgerMigration\(await readGameStateBundle\(\{ force: true \}\)\), \{ log: false \}\);/, "the forecast repairs without logging");
  const { normalizeWorldState } = await import("../../runtime/gameState.js");
  assert.equal(normalizeWorldState({ warSidesRepairVersion: 1 }).warSidesRepairVersion, 1, "the stamp survives a save");
});
