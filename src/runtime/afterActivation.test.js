/*! Open Historia — work that outlives an activation's remount tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/afterActivation.test.js
//
// Workshop Apply & Play created the game and then set up its country picker
// in a component the activation had already unmounted, so the picker never
// showed. What is left for after the remount has to reach the component
// mounted for the new game, and only that one, exactly once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createActivationHandOff } from "./afterActivation.js";

test("the work reaches the UI of the game it names, once", () => {
  const handOff = createActivationHandOff();
  handOff.put({ gameId: "japan-session", countryPicker: { scenario: { id: "japan" } } });
  assert.equal(handOff.take("old-game"), null, "the UI still mounted for the old game leaves it alone");
  assert.deepEqual(handOff.take("japan-session"), { gameId: "japan-session", countryPicker: { scenario: { id: "japan" } } });
  assert.equal(handOff.take("japan-session"), null, "and it is handed over only once");
  assert.equal(handOff.take(null), null);
});

test("the mounted UI hears of work left after it mounted", () => {
  const handOff = createActivationHandOff();
  let heard = 0;
  const stop = handOff.subscribe(() => { heard += 1; });
  handOff.put({ gameId: "g", editor: true, error: "The world could not be read." });
  assert.equal(heard, 1);
  assert.equal(handOff.get().error, "The world could not be read.");
  handOff.take("g");
  assert.equal(heard, 2, "taking it tells the listeners too");
  assert.equal(handOff.get(), null);
  stop();
  handOff.put({ gameId: "h" });
  assert.equal(heard, 2, "an unsubscribed UI hears nothing");
});
