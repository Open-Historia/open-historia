/*! Open Historia — when the map shows every troop: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/troopDetail.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { everyTroopShown, showEveryTroop } from "./troopDetail.js";

test("every troop is shown while anybody wants them, and each asker speaks only for itself", () => {
  assert.equal(everyTroopShown(), false, "nobody has asked");
  showEveryTroop("events", true);
  assert.equal(everyTroopShown(), true);
  // The same asker saying so again is one asker.
  showEveryTroop("events", true);
  showEveryTroop("replay", true);
  showEveryTroop("events", false);
  assert.equal(everyTroopShown(), true, "another still wants them");
  showEveryTroop("replay", false);
  assert.equal(everyTroopShown(), false);
  // Saying it no longer does when it never did changes nothing; nor does an asker with no name.
  showEveryTroop("events", false);
  showEveryTroop("", true);
  showEveryTroop(null, true);
  assert.equal(everyTroopShown(), false);
});
