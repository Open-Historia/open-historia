/*! Open Historia — who plays which country, for the game's screens: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/seatRoster.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { playedCountriesOf, playerSeatFor, rosterOf, sameRoster, seatStateText } from "./seatRoster.js";
import { setSharedGameSeats, sharedGamePeople, sharedGameSeats, subscribeSharedGameRole } from "./sharedGameBridge.js";

// The lobby's seats as host/gameHost.js lobbyFor sends them.
const lobbySeats = [
  { country: "France", name: "Ana", status: "human", held: true, you: true },
  { country: "German Reich", name: "Ben", status: "away", held: true, you: false },
  { country: "Italy", name: "", status: "ai", held: false, you: false },
  { country: "Poland", name: "Cy", status: "watching", held: true, you: false },
  { country: "  ", name: "nobody" },
  null,
];

test("the roster keeps every seat with a country, in the host's order", () => {
  const roster = rosterOf(lobbySeats);
  assert.deepEqual(roster.map((seat) => seat.country), ["France", "German Reich", "Italy", "Poland"]);
  assert.ok(Object.isFrozen(roster) && Object.isFrozen(roster[0]));
  assert.equal(rosterOf(undefined).length, 0);
  assert.ok(sameRoster(rosterOf(lobbySeats), roster));
  assert.ok(!sameRoster(rosterOf(lobbySeats.slice(1)), roster));
});

test("a country is a person's while their device holds it, away or not; not one they only watch", () => {
  const roster = rosterOf(lobbySeats);
  assert.deepEqual(playedCountriesOf(roster), ["France", "German Reich"]);
  assert.equal(playerSeatFor(roster, "german reich")?.name, "Ben");
  assert.equal(playerSeatFor(roster, "", "France ")?.name, "Ana", "any of the country's names");
  assert.equal(playerSeatFor(roster, "Italy"), null, "the AI's");
  assert.equal(playerSeatFor(roster, "Poland"), null, "watched, not played");
  assert.equal(playerSeatFor(roster), null);
});

test("a seat's state reads in the Players panel's words", () => {
  const [france, germany, italy, poland] = rosterOf(lobbySeats);
  assert.equal(seatStateText(france), "");
  assert.equal(seatStateText(germany), "Away");
  assert.equal(seatStateText(italy), "AI player");
  assert.equal(seatStateText(poland), "Watching");
  assert.equal(seatStateText({ status: "ai", held: true }), "Away: the AI plays it");
});

test("the bridge's seats set the countries people play, and tell a change once", () => {
  let told = 0;
  const stop = subscribeSharedGameRole(() => { told += 1; });
  try {
    setSharedGameSeats(lobbySeats);
    assert.deepEqual(sharedGamePeople(), ["France", "German Reich"]);
    assert.equal(sharedGameSeats().length, 4);
    const kept = sharedGameSeats();
    setSharedGameSeats(lobbySeats.map((seat) => (seat ? { ...seat } : seat)));
    assert.equal(sharedGameSeats(), kept, "the same seats, no change told");
    assert.equal(told, 1);
    // A name changes, the countries do not: still told.
    setSharedGameSeats(lobbySeats.map((seat) => (seat?.country === "France" ? { ...seat, name: "Anna" } : seat)));
    assert.equal(told, 2);
    setSharedGameSeats([]);
    assert.deepEqual(sharedGameSeats(), []);
    assert.deepEqual(sharedGamePeople(), []);
  } finally {
    stop();
  }
});
