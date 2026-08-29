/*! Open Historia — per-save unit-system setting tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: npm ci && node --test src/runtime/betaUnitsSetting.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// The beta unit system used to live in localStorage, which made it a property of
// a browser profile rather than of a campaign — it did not follow a copied save,
// and the desktop beta and stable builds share their saves but not their profile,
// so it appeared to reset every time a tester swapped builds. It now lives in the
// save's game.json. What these cover is the three promises that move makes:
//
//   * a save that has never chosen still inherits the app-wide default, so no
//     existing campaign silently changes system on upgrade;
//   * an explicit choice on the save wins over that default, in both directions;
//   * the running session stays pinned to one system per save, and re-pins when a
//     different save is opened.

import test from "node:test";
import assert from "node:assert/strict";

// getMapSetting reads localStorage, which node has none of; it is guarded to read
// "everything off" without one. These cases need to drive the app-wide default,
// so stand one up before mapSettings.js is imported.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const {
  MAP_SETTING_KEYS,
  applySaveBetaUnits,
  getBetaUnitsToStamp,
  isBetaUnits,
  resetBetaUnitsPinForTests,
  resolveBetaUnits,
} = await import("./mapSettings.js");
const { normalizeGameData } = await import("./gameState.js");

const setAppDefault = (on) => store.set(MAP_SETTING_KEYS.betaUnits, on ? "1" : "0");

const reset = () => {
  store.clear();
  resetBetaUnitsPinForTests();
};

test("a save that has never chosen inherits the app-wide default", () => {
  reset();
  setAppDefault(true);
  // The migration case: every save written before the setting moved carries no
  // betaUnits field at all, and must keep playing the way it has been.
  applySaveBetaUnits("old-campaign", undefined);
  assert.equal(resolveBetaUnits(), true);
  assert.equal(isBetaUnits(), true);
  // ...and the next ordinary write to that save writes the inherited value down,
  // which is what makes the save independent of the default from then on.
  assert.equal(getBetaUnitsToStamp(), true);
});

test("an explicit choice on the save beats the app-wide default, both ways", () => {
  reset();
  setAppDefault(true);
  applySaveBetaUnits("classic-campaign", false);
  assert.equal(resolveBetaUnits(), false);
  assert.equal(getBetaUnitsToStamp(), false);

  reset();
  setAppDefault(false);
  applySaveBetaUnits("beta-campaign", true);
  assert.equal(resolveBetaUnits(), true);
  assert.equal(getBetaUnitsToStamp(), true);
});

test("nothing is stamped before a save has loaded", () => {
  reset();
  setAppDefault(true);
  // No save open: the toggle still answers (from the default) but there is no
  // save to stamp, so writeGameData must be told to write nothing down. A stray
  // write here would land the flag on whichever save loaded next.
  assert.equal(resolveBetaUnits(), true);
  assert.equal(getBetaUnitsToStamp(), null);
});

test("the value stamped follows the toggle, not the pin", () => {
  reset();
  applySaveBetaUnits("campaign", false);
  assert.equal(isBetaUnits(), false);
  // Flipped while a turn is generating: the turn's own write must persist the
  // NEW choice, not the one it read before the flip — the setting only shows its
  // effect after a reload, so silently reverting it here looks like a lost click.
  applySaveBetaUnits("campaign", true);
  assert.equal(getBetaUnitsToStamp(), true);
  assert.equal(isBetaUnits(), false);
});

test("the running session stays pinned while the same save's toggle is flipped", () => {
  reset();
  applySaveBetaUnits("campaign", false);
  assert.equal(isBetaUnits(), false);

  // The player flips the toggle mid-session. The checkbox moves immediately; the
  // engine does not, until the game is reloaded — that is the whole reason the
  // panel offers a Reload button.
  applySaveBetaUnits("campaign", true);
  assert.equal(resolveBetaUnits(), true);
  assert.equal(isBetaUnits(), false);
});

test("opening a different save re-pins the engine to that save's system", () => {
  reset();
  applySaveBetaUnits("classic-campaign", false);
  assert.equal(isBetaUnits(), false);

  // Not a mid-turn switch: a different campaign is a different world, and
  // App.jsx remounts the map and the UI around the new active game id.
  applySaveBetaUnits("beta-campaign", true);
  assert.equal(isBetaUnits(), true);

  applySaveBetaUnits("classic-campaign", false);
  assert.equal(isBetaUnits(), false);
});

test("normalizeGameData keeps an explicit choice and leaves absence absent", () => {
  // Absent stays absent — the third state is what "never chose" is made of, and
  // defaulting it to false here would convert every pre-existing beta save to
  // classic on its next write.
  assert.equal("betaUnits" in normalizeGameData({ round: 3 }), false);
  assert.equal("betaUnits" in normalizeGameData({ round: 3, betaUnits: null }), false);

  assert.equal(normalizeGameData({ betaUnits: true }).betaUnits, true);
  assert.equal(normalizeGameData({ betaUnits: false }).betaUnits, false);
  // Whatever a hand-edited save says, it comes back a boolean.
  assert.equal(normalizeGameData({ betaUnits: 1 }).betaUnits, true);
  assert.equal(normalizeGameData({ betaUnits: "" }).betaUnits, false);
});

test("normalizeGameData carries the choice through an otherwise unrelated write", () => {
  // The shape a turn writes: a game object read before the turn, with the clock
  // moved on. The flag has to survive that untouched.
  const saved = normalizeGameData({
    country: "France",
    difficulty: "hard",
    gameDate: "2016-02-01",
    round: 4,
    startDate: "2016-01-01",
    betaUnits: true,
  });
  assert.equal(saved.betaUnits, true);
  assert.equal(saved.round, 4);
});
