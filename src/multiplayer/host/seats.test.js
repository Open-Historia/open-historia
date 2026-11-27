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

test("a country is its player's device's while the AI minds it, until the host releases it; then anyone may take it", () => {
  // The owner, 2026-11-15: seats "bound to each player's device". Taken by
  // someone else while its player was away, a country handed them its
  // player's threads, orders and stolen papers.
  const { seats, advance } = book();
  seats.claim("France", { device: "a" });
  seats.start();
  seats.left("a");
  advance(60_000);
  seats.expire();
  assert.equal(seats.seatOf("a").status, "ai");
  assert.deepEqual(seats.claim("France", { device: "z", name: "Zoe" }), { ok: false, reason: "taken" });
  assert.equal(seats.returned("a").status, "human", "its player takes it up again");
  // Released by the host: anyone may take it, and its old player cannot.
  seats.left("a");
  assert.equal(seats.release("France"), "a", "it says whose it was");
  assert.equal(seats.claim("France", { device: "z", name: "Zoe" }).ok, true);
  assert.equal(seats.returned("a"), null);
  assert.equal(seats.seatOf("z").country, "France");
});

test("once the game is under way a player changes country only with the host's yes, and gives one up only that way", () => {
  const { seats } = book();
  seats.claim("France", { device: "a" });
  seats.start();
  assert.deepEqual(seats.claim("Spain", { device: "a" }), { ok: false, reason: "ask-host" });
  assert.equal(seats.unclaim("a"), false);
  assert.equal(seats.claim("Spain", { device: "a", approved: true }).ok, true);
  assert.equal(seats.seatOf("a").country, "Spain");
  assert.equal(seats.list().find((seat) => seat.country === "France").device, null, "the old country is free for anyone");
});

test("a player whose country is gone watches it, and may take any free country, even where newcomers may not join", () => {
  const { seats } = book({ allowMidGameJoin: false });
  seats.claim("France", { device: "a", name: "Ana" });
  seats.start();
  const gone = seats.vanish("France");
  assert.deepEqual([gone.device, gone.name], ["a", "Ana"]);
  assert.equal(seats.seatOf("a"), null);
  assert.deepEqual(seats.watcherOf("a"), { device: "a", name: "Ana", was: "France" });
  assert.deepEqual(seats.claim("Spain", { device: "z" }), { ok: false, reason: "game-started" }, "a newcomer may not");
  assert.equal(seats.claim("Spain", { device: "a", name: "Ana" }).ok, true);
  assert.equal(seats.watcherOf("a"), null);
});

test("the book a game saved is taken up again: every seat its device's, its players away until they come back", () => {
  const { seats } = book();
  seats.restore([
    { country: "France", device: "a", name: "Ana", status: "human" },
    { country: "Spain", device: "b", name: "Ben", status: "ai" },
    { country: "Italy", device: null, name: "", status: "ai" },
    { country: "Latvia", device: "host", name: "Host", status: "human" },
  ], { hostDevice: "host" });
  assert.deepEqual(seats.list().map((seat) => [seat.country, seat.device, seat.status]), [
    ["France", "a", "away"],
    ["Spain", "b", "ai"],
    ["Italy", null, "ai"],
  ]);
  assert.deepEqual(seats.claim("France", { device: "z" }), { ok: false, reason: "taken" });
  assert.equal(seats.claim("Italy", { device: "z" }).ok, true, "one nobody holds is free");
  assert.equal(seats.returned("a").country, "France");
});

test("the countries that may be taken follow the world, and a seat's own stays its own", () => {
  const { seats } = book();
  seats.claim("France", { device: "a" });
  seats.setCountries(["Spain", "Saltport"]);
  assert.equal(seats.claim("Saltport", { device: "z" }).ok, true, "a country founded mid-game can be taken");
  assert.deepEqual(seats.claim("Italy", { device: "y" }), { ok: false, reason: "not-a-country" });
  assert.equal(seats.seatOf("a").country, "France");
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
  assert.equal(seats.release("France"), "a", "it says whose it was");
  assert.equal(seats.list()[0].status, SEAT_STATUS.AI);
  assert.equal(seats.list()[0].device, null, "released for good: the device cannot reclaim it");
});

// "Release" told the host its player could no longer come back to the country, and the player took it straight
// back (the review of 2026-11-18, core 6 / ui 3).
test("a player the host released does not take that country back, under any name, unless the host gives it", () => {
  const { seats } = book();
  seats.claim("France", { device: "a", name: "Ana" });
  seats.start();
  seats.release("France");
  assert.deepEqual(seats.claim("France", { device: "a", name: "Ana" }), { ok: false, reason: "released" });
  assert.equal(seats.claim("Spain", { device: "a", name: "Ana" }).ok, true, "another country is theirs to take");
  assert.equal(seats.claim("Spain", { device: "a" }).ok, true);
  assert.equal(seats.releasedFrom("France", "a"), true);
  // Renamed, it is the same country.
  assert.equal(seats.move("France", "French Republic"), true);
  assert.deepEqual(seats.released(), [{ device: "a", country: "French Republic" }]);
  assert.deepEqual(seats.claim("French Republic", { device: "z" }).ok, true, "anyone else may take it");
  // Saved with the game, and kept when it is taken up again; the host's yes overrides it.
  const again = book().seats;
  again.restore([], { released: seats.released() });
  again.setCountries(["French Republic", "Spain"]);
  again.start();
  assert.deepEqual(again.claim("French Republic", { device: "a" }), { ok: false, reason: "released" });
  assert.equal(again.claim("French Republic", { device: "a", approved: true }).ok, true);
  // Kept off at once, before the seat itself is let go.
  const { seats: early } = book();
  early.claim("Italy", { device: "b" });
  early.start();
  early.keepOff("Italy", "b");
  assert.equal(early.seatOf("b").country, "Italy", "still theirs until it is let go");
  assert.equal(early.releasedFrom("Italy", "b"), true);
});

test("a seat keeps its id while its player is away, the AI minds it and its country is renamed; a seat taken anew is another", () => {
  const { seats, advance } = book();
  seats.claim("France", { device: "a" });
  seats.start();
  const { id } = seats.seatOf("a");
  assert.ok(id);
  seats.left("a");
  advance(60_000);
  seats.expire();
  seats.move("France", "French Empire");
  seats.returned("a");
  assert.equal(seats.seatOf("a").id, id);
  assert.equal(seats.seatById(id).country, "French Empire");
  seats.claim("Spain", { device: "a", approved: true });
  assert.notEqual(seats.seatOf("a").id, id, "a change of country is a new seat");
  assert.equal(seats.seatById(id), null);
  assert.notEqual(seats.list().find((seat) => seat.country === "French Empire").id, id, "and the one left behind is no longer theirs");
});

test("a seat follows its people to a country they founded, which no one else may then take", () => {
  const { seats } = book();
  seats.claim("France", { device: "a", name: "Ana" });
  seats.claim("Spain", { device: "b", name: "Ben" });
  seats.start();
  assert.equal(seats.move("France", "Spain"), false, "never onto a country someone plays");
  assert.equal(seats.move("France", "Burgundy"), true);
  assert.equal(seats.seatOf("a").country, "Burgundy");
  assert.equal(seats.seatOf("a").status, SEAT_STATUS.HUMAN);
  assert.deepEqual(seats.humanCountries(), ["Spain", "Burgundy"]);
  assert.deepEqual(seats.claim("Burgundy", { device: "b", name: "Ben" }), { ok: false, reason: "taken" });
  // The country left behind is the AI's, and free to take.
  assert.equal(seats.claim("France", { device: "c", name: "Cy" }).ok, true);
});

test("a seat follows its country to a new name whoever minds it, and its player comes back to it there", () => {
  const { seats, advance } = book();
  seats.claim("France", { device: "a", name: "Ana" });
  seats.claim("Spain", { device: "b", name: "Ben" });
  seats.start();
  seats.left("a");
  advance(30_000);
  // Renamed while its player is away: the grace still runs from their leaving.
  assert.equal(seats.move("France", "French Republic"), true);
  advance(30_000);
  assert.deepEqual(seats.expire(), ["French Republic"]);
  // Renamed again while the AI minds it: still its player's.
  assert.equal(seats.move("French Republic", "French Empire"), true);
  assert.deepEqual([seats.seatOf("a").country, seats.seatOf("a").status], ["French Empire", SEAT_STATUS.AI]);
  assert.equal(seats.returned("a").country, "French Empire");
  assert.equal(seats.move("Spain", "French Empire"), false, "never onto a country another device holds");
});

test("whoever holds a seat or watches is in the game, and comes back in however many newcomers came meanwhile", () => {
  const { seats, advance } = book();
  seats.claim("France", { device: "a", name: "Ana" });
  seats.claim("Spain", { device: "b", name: "Ben" });
  seats.claim("Italy", { device: "c", name: "Cy" });
  seats.start();
  seats.left("a");
  advance(60_000);
  seats.expire();
  seats.vanish("Spain");
  // Three seats, all held: Ana away (the AI minds France), Ben watching, Cy here.
  assert.equal(seats.hasRoom("z"), false, "a newcomer is told the game is full");
  assert.equal(seats.hasRoom("a"), true);
  assert.equal(seats.hasRoom("b"), true);
  assert.equal(seats.open(), 0);
  assert.deepEqual(seats.claim("Germany", { device: "z" }), { ok: false, reason: "full" });
  // The host lets the watcher go: there is room for one.
  assert.equal(seats.release("Spain"), "b");
  assert.equal(seats.hasRoom("z"), true);
  assert.equal(seats.hasRoom("z", { waiting: 1 }), false, "someone already in without a seat has it");
  assert.equal(seats.claim("Germany", { device: "z" }).ok, true);
  assert.equal(seats.hasRoom("b"), false, "a player let go is a newcomer again");
});
