/*! Open Historia — multiplayer seat book tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/seats.test.js
//
// One person per country and one country per person; a leaver is away for the
// grace, then the AI plays their country until they come back.

import test from "node:test";
import assert from "node:assert/strict";
import { SEAT_STATUS, createSeatBook } from "./seats.js";

const COUNTRIES = ["France", "Germany", "Spain", "Italy"];
const book = (extra = {}) => {
  let t = 0;
  const seats = createSeatBook({ countries: COUNTRIES, maxPlayers: 3, graceMs: 60_000, now: () => t, ...extra });
  return { seats, advance: (ms) => { t += ms; } };
};

test("each person takes one country, and no country is taken twice", () => {
  const { seats } = book();
  assert.equal(seats.claim("France", { device: "a", name: "Ana" }).ok, true);
  assert.deepEqual(seats.claim("France", { device: "b", name: "Ben" }), { ok: false, reason: "taken" });
  assert.deepEqual(seats.claim("Atlantis", { device: "b", name: "Ben" }), { ok: false, reason: "not-a-country" });
  // Choosing again in the lobby moves the person; the old country is free.
  assert.equal(seats.claim("Spain", { device: "a", name: "Ana" }).ok, true);
  assert.equal(seats.claim("France", { device: "b", name: "Ben" }).ok, true);
  assert.deepEqual(seats.humanCountries().sort(), ["France", "Spain"]);
});

test("the player limit holds", () => {
  const { seats } = book();
  seats.claim("France", { device: "a" });
  seats.claim("Germany", { device: "b" });
  seats.claim("Spain", { device: "c" });
  assert.deepEqual(seats.claim("Italy", { device: "d" }), { ok: false, reason: "full" });
});

test("a leaver is away for the grace, then the AI plays their country; they can take it back", () => {
  const { seats, advance } = book();
  seats.claim("France", { device: "a", name: "Ana" });
  seats.start();
  assert.equal(seats.left("a").status, SEAT_STATUS.AWAY);
  assert.deepEqual(seats.humanCountries(), ["France"], "still theirs while away: the world may not decide for it");
  assert.deepEqual(seats.presentDevices(), [], "but the round does not wait for them");
  advance(59_000);
  assert.deepEqual(seats.expire(), []);
  advance(1000);
  assert.deepEqual(seats.expire(), ["France"]);
  assert.equal(seats.seatOf("a").status, SEAT_STATUS.AI);
  assert.deepEqual(seats.humanCountries(), []);
  assert.equal(seats.returned("a").status, SEAT_STATUS.HUMAN);
  assert.deepEqual(seats.humanCountries(), ["France"]);
});

test("once the AI plays a country, someone else may take it mid-game (if allowed), and the leaver cannot take it back", () => {
  const { seats, advance } = book();
  seats.claim("France", { device: "a" });
  seats.start();
  seats.left("a");
  advance(60_000);
  seats.expire();
  assert.equal(seats.claim("France", { device: "z", name: "Zoe" }).ok, true);
  assert.equal(seats.returned("a"), null);
  assert.equal(seats.seatOf("z").country, "France");
});

test("mid-game joining can be switched off", () => {
  const { seats } = book({ allowMidGameJoin: false });
  seats.start();
  assert.deepEqual(seats.claim("France", { device: "a" }), { ok: false, reason: "game-started" });
});

test("before the game starts, a leaver simply frees the country", () => {
  const { seats } = book();
  seats.claim("France", { device: "a" });
  assert.equal(seats.left("a"), null);
  assert.deepEqual(seats.list(), []);
});

test("the host can release a country from a player", () => {
  const { seats } = book();
  seats.claim("France", { device: "a" });
  seats.start();
  assert.equal(seats.release("France"), true);
  assert.equal(seats.list()[0].status, SEAT_STATUS.AI);
  assert.equal(seats.list()[0].device, null, "released for good: the device cannot reclaim it");
});
