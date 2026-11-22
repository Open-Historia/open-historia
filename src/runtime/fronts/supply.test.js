/*! Open Historia — battlefields and fronts: supply, patches and pockets: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/supply.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMask } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { findPockets } from "./supply.js";

// The least of a battle that findPockets reads: the field, whose home ground
// each cell is (as three stand-in regions: side A's, side B's, nobody's), and
// how big a cell is.
const battleOf = ({ cols, rows, holders, play, home, rowKm }) => {
  const size = cols * rows;
  const homeOf = decodeMask(home, size);
  return {
    field: { cols, rows, size, holders: decodeMask(holders, size), play: decodeMask(play, size), turns: 1 },
    arena: { region: Uint8Array.from(homeOf, (side) => side + 1) },
    homeSide: Int8Array.from([-1, HOLDER_SIDE_A, HOLDER_SIDE_B, -1]),
    place: { rowKm: Float64Array.from(rowKm) },
    anchors: [],
    sieges: [],
    siegeKey: "",
    pockets: [],
    pocketOf: null,
  };
};

test("a body that alone holds a province of its own side's is fed by it, though it holds a little more of the main body's home ground", () => {
  // Reported from a 1946 scenario: the Communists' southern body (Jiangsu, their own, and Anhui and
  // Shanghai, taken) also held a strip of Henan, their own too but part of the home ground their
  // northern body holds most of. The day that strip outgrew their part of Jiangsu by one cell, the
  // body was read as cut off; ten days later all of it gave up, every troop in it lost and every
  // region of it the Republic's.
  const fixture = JSON.parse(readFileSync(new URL("./testdata/home-province-pocket.json", import.meta.url), "utf8"));
  const battle = battleOf(fixture);
  const [x, y] = fixture.probe;
  const cell = y * fixture.cols + x;
  assert.equal(battle.field.holders[cell], HOLDER_SIDE_B);
  findPockets(battle);
  assert.equal(battle.pocketOf[HOLDER_SIDE_B][cell], -1, "the southern body is no pocket");
  assert.equal(battle.fed[HOLDER_SIDE_B][cell], 1, "and it is supplied");
  assert.deepEqual(battle.pockets.filter((pocket) => pocket.s === HOLDER_SIDE_B && pocket.cells > 100), [], "no great body of theirs is cut off");
});

test("a scrap of home ground inside a ring does not feed the ring", () => {
  // Side B's country is one stretch, with a scrap of its own (a lake's far shore, say) set apart from
  // it; side A has ringed a part of B's country that holds the scrap too.
  const cols = 30;
  const rows = 12;
  const size = cols * rows;
  const holders = new Uint8Array(size).fill(HOLDER_SIDE_B);
  const home = new Uint8Array(size).fill(HOLDER_SIDE_B);
  const play = new Uint8Array(size).fill(1);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      holders[row * cols + col] = HOLDER_SIDE_A;
      home[row * cols + col] = HOLDER_SIDE_A;
    }
  }
  // The ring: a square of A's ground from column 6 to 16.
  for (let row = 2; row <= 9; row += 1) {
    for (let col = 6; col <= 16; col += 1) {
      if (row === 2 || row === 9 || col === 6 || col === 16) holders[row * cols + col] = HOLDER_SIDE_A;
    }
  }
  // The scrap, inside the ring: ground of nobody's round two cells of B's own.
  for (let row = 4; row <= 7; row += 1) for (let col = 8; col <= 11; col += 1) home[row * cols + col] = 2;
  home[5 * cols + 9] = HOLDER_SIDE_B;
  home[5 * cols + 10] = HOLDER_SIDE_B;
  const battle = {
    field: { cols, rows, size, holders, play, turns: 1 },
    arena: { region: Uint8Array.from(home, (side) => side + 1) },
    homeSide: Int8Array.from([-1, HOLDER_SIDE_A, HOLDER_SIDE_B, -1]),
    place: { rowKm: new Float64Array(rows).fill(16) },
    anchors: [],
    sieges: [],
    siegeKey: "",
    pockets: [],
    pocketOf: null,
  };
  findPockets(battle);
  const inside = 5 * cols + 12;
  assert.notEqual(battle.pocketOf[HOLDER_SIDE_B][inside], -1, "the ringed ground is a pocket");
  assert.equal(battle.fed[HOLDER_SIDE_B][20], 1, "and the rest of the country is fed");
});
