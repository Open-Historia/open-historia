/*! Open Historia — what the game's corner button offers: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/gameMenuItems.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { gameMenuItems, playerListRows } from "./gameMenuItems.js";
import { rosterOf } from "../../multiplayer/client/seatRoster.js";

const seats = rosterOf([
  { country: "France", name: "Ana", status: "human", held: true, you: true },
  { country: "German Reich", name: "Ben", status: "away", held: true },
  { country: "Italy", name: "", status: "ai", held: false },
]);

test("single player: no menu, the button opens the game menu as it did", () => {
  assert.deepEqual(gameMenuItems(), []);
  assert.deepEqual(gameMenuItems({ seats: [] }), []);
});

test("a shared game: the game menu, then Players", () => {
  assert.deepEqual(gameMenuItems({ seats }).map((item) => item.id), ["menu", "players"]);
});

test("the player list marks you, the host and who is away, as the Players panel does", () => {
  const rows = playerListRows(seats, { role: "host" });
  assert.deepEqual(rows.map((row) => [row.country, row.name, row.you, row.host, row.state]), [
    ["France", "Ana", true, true, ""],
    ["German Reich", "Ben", false, false, "Away"],
    ["Italy", "", false, false, "AI player"],
  ]);
  // A guest's page knows the host by the seat's own mark only.
  const guest = playerListRows(rosterOf([{ country: "France", name: "Ana", status: "human", held: true, host: true }, { country: "Spain", name: "Me", status: "human", held: true, you: true }]), { role: "guest" });
  assert.deepEqual(guest.map((row) => row.host), [true, false]);
});
