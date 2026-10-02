/*! Open Historia — what the detailed-map offer says © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/tiledBasemapWording.test.js
// Every offer of a detailed map tells the player its size and what they see
// without it: the basic map the scenario carries, or empty sea when the
// detailed map is the scenario's only one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tiledBasemapWording } from "./tiledBasemapWording.js";

const MAP = { id: "got-world", name: "Game of Thrones world map", version: 9, bytes: 463 * 1024 * 1024 };

test("at install, the player chooses: download now, or play on the basic map", () => {
  const words = tiledBasemapWording(MAP, { atInstall: true });
  assert.equal(words.title, "This scenario has a detailed map");
  assert.match(words.body, /463 MB download/);
  assert.match(words.body, /basic map that comes with the scenario/);
  assert.match(words.body, /every scenario on this map shares it/);
  assert.equal(words.accept, "Download 463 MB");
  assert.equal(words.decline, "Use basic map");
});

test("over the map, a missing map is offered with its size", () => {
  const words = tiledBasemapWording(MAP);
  assert.equal(words.title, "You're seeing the basic map");
  assert.match(words.body, /"Game of Thrones world map" \(463 MB\)/);
  assert.equal(words.accept, "Download 463 MB");
});

test("an update says what the player has, that it replaces it, and whether the scenario was made on it", () => {
  const optional = tiledBasemapWording({ ...MAP, version: 10, have: 9, needed: false });
  assert.equal(optional.title, 'A newer version of "Game of Thrones world map" is available');
  assert.match(optional.body, /Version 10 \(463 MB\) replaces your version 9/);
  assert.equal(optional.accept, "Update 463 MB");
  const needed = tiledBasemapWording({ ...MAP, version: 10, have: 9, needed: true });
  assert.match(needed.body, /made with version 10\. You have version 9, which it still works with/);
});

test("a map that cannot be downloaded offers no download", () => {
  for (const offer of [{ name: "Mine", unofficial: true }, { name: "Gone", unavailable: true }]) {
    const words = tiledBasemapWording(offer);
    assert.equal(words.accept, null);
    assert.equal(words.decline, "OK");
    assert.match(words.body, /basic map/);
  }
});
