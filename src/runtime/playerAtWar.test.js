// Whether the player's country is at war, for the music (playerAtWar.js). The
// owner, 2026-10-13: "when in war, it doesnt play the war song".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { playerAtWar } from "./playerAtWar.js";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

// The ledger of the save the report came with.
const WARS = [{
  id: "war-ukraine-russia-2016",
  status: "active",
  sideA: ["Ukraine"],
  sideB: ["Russia"],
}];

test("a country on either side of a war being fought is at war", () => {
  assert.equal(playerAtWar(WARS, "Ukraine"), true);
  assert.equal(playerAtWar(WARS, "Russia"), true);
  assert.equal(playerAtWar(WARS, "Poland"), false);
  // A row with no status is an active one, as the ledger reads it elsewhere.
  assert.equal(playerAtWar([{ sideA: ["France"], sideB: ["Prussia"] }], "Prussia"), true);
});

test("a war that is over, or frozen, is not being fought", () => {
  for (const status of ["ended", "ceasefire", "peace", "frozen"]) {
    assert.equal(playerAtWar([{ ...WARS[0], status }], "Ukraine"), false, status);
  }
  // One of two still on.
  assert.equal(playerAtWar([{ ...WARS[0], status: "ended" }, { status: "active", sideA: ["Ukraine", "Poland"], sideB: ["Belarus"] }], "Poland"), true);
});

test("a name is exact but for its case and spacing: never another spelling of it", () => {
  assert.equal(playerAtWar(WARS, "  ukraine "), true);
  assert.equal(playerAtWar([{ status: "Active", sideA: ["Russian  Federation"], sideB: ["Ukraine"] }], "Russian Federation"), true);
  assert.equal(playerAtWar(WARS, "Russian Federation"), false);
  assert.equal(playerAtWar(WARS, "Ukr"), false);
});

test("nobody playing, or no ledger, is no war", () => {
  assert.equal(playerAtWar(WARS, ""), false);
  assert.equal(playerAtWar(WARS, null), false);
  assert.equal(playerAtWar(undefined, "Ukraine"), false);
  assert.equal(playerAtWar([null, {}, { sideA: "Ukraine" }], "Ukraine"), false);
});

test("the game's screen plays the at-war music for a war in the ledger, battlefield or not", () => {
  const screen = read("../Game/GameUI/main.jsx");
  assert.ok(screen.includes("const inWar = useRuntimeState(\"world\", (world) => playerAtWar(world?.wars, playerCountry), playerCountry);"));
  // The war room shown plays the battle music only when there is a war: forces built up in peace have none.
  assert.ok(screen.includes("atWar: atWar || inWar, war: battlefieldShown && (atWar || inWar) });"));
  // The war room's button is still the battlefields' alone.
  // (Battlefields being on is the Wars feature's Fronts switch.)
  assert.ok(screen.includes("const atWar = hasFronts && fightingIn(warFronts);"));
  assert.ok(screen.includes("{(hasFronts || isWarRoomOpen) && ("));
});
