/*! Open Historia — who sits at a diplomatic table: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/tableSeats.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { tableSeats } from "./tableSeats.js";

const FRANCE = "France";
const SPAIN = "Spain";
const ITALY = "Italy";

test("single player: every member is a government the AI answers for", () => {
  assert.deepEqual(tableSeats({ player: FRANCE, members: [SPAIN, ITALY], people: [FRANCE] }), { otherPeople: [], governments: [SPAIN, ITALY] });
});

test("a member writing in a person's thread: the owner is a person, and only the AI's governments answer", () => {
  const seats = tableSeats({ player: ITALY, owner: FRANCE, members: [ITALY, SPAIN], people: [FRANCE, ITALY] });
  assert.deepEqual(seats, { otherPeople: [FRANCE], governments: [SPAIN] });
});

test("a thread whose owner left the game: its country is the AI's, and its government answers there", () => {
  // Spain's player left; Spain's thread with Italy, Italy writing in it.
  const seats = tableSeats({ player: ITALY, owner: SPAIN, members: [ITALY], people: [FRANCE, ITALY] });
  assert.deepEqual(seats, { otherPeople: [], governments: [SPAIN] });
});

test("the owner writing in its own thread is not seated twice", () => {
  assert.deepEqual(tableSeats({ player: FRANCE, owner: FRANCE, members: [SPAIN], people: [FRANCE, ITALY] }), { otherPeople: [], governments: [SPAIN] });
});

test("on a player's own device the host names the governments: everyone else at the table is a person", () => {
  // The view lists the owner among the members; the device adds nobody.
  const seats = tableSeats({ player: ITALY, owner: SPAIN, members: [FRANCE, SPAIN], people: [ITALY], governments: [SPAIN] });
  assert.deepEqual(seats, { otherPeople: [FRANCE], governments: [SPAIN] });
});

test("names are compared by the caller's own key, and a name is seated once", () => {
  const keyOf = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const seats = tableSeats({ player: "côte d'ivoire", owner: "Mali", members: ["Côte d'Ivoire", "mali", "Ghana"], people: ["Côte d'Ivoire"], keyOf });
  assert.deepEqual(seats, { otherPeople: [], governments: ["Mali", "Ghana"] });
});

test("the table's turn seats its people by this rule (gameplay.js)", () => {
  const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  assert.match(source, /const seating = tableSeats\(\{\s*player,\s*owner: threadOwner,/);
  assert.match(source, /const answering = seating\.governments/);
});
