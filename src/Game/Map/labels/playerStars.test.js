/*! Open Historia — the star on a played country's label: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/labels/playerStars.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { PLAYER_STAR, withPlayerStars } from "./playerStars.js";

const records = [
  { id: "a", owner: "France", text: "FRANCE" },
  { id: "b", owner: "German Reich", text: "GERMAN REICH" },
  { id: "c", owner: "Italy", text: "ITALY" },
];

test("single player stars nothing and hands back the same array", () => {
  assert.equal(withPlayerStars(records, []), records);
  assert.equal(withPlayerStars(records, undefined), records);
});

test("a country a person plays reads with the star; the others are the same objects", () => {
  const out = withPlayerStars(records, ["german  reich"]);
  assert.notEqual(out, records);
  assert.equal(out[1].text, `${PLAYER_STAR} GERMAN REICH`);
  assert.equal(out[1].playedByPerson, true);
  assert.equal(out[0], records[0]);
  assert.equal(out[2], records[2]);
  assert.equal(records[1].text, "GERMAN REICH", "the input is not changed");
});

test("no country on the map played: the same array; never two stars", () => {
  assert.equal(withPlayerStars(records, ["Spain"]), records);
  const once = withPlayerStars(records, ["France"]);
  assert.equal(withPlayerStars(once, ["France"]), once);
});
