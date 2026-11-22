/*! Open Historia — the world a player held before a shared round landed: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/roundBase.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { baseForRecord, roundBaseOf } from "./roundBase.js";
import { startRemoteRuntime, stopRemoteRuntime } from "./remoteRuntime.js";
import { VIEW_KEYS } from "../game/messages.js";
import { digestDoc } from "../protocol/digest.js";

// The world before round 3 landed, and the view that lands it.
const before = { regionOwnershipOverrides: { Narva: "Republic of Estonia" }, simulationHistory: [{ round: 2, fromDate: "1914-07-01", toDate: "1914-07-31", eventIds: ["e0"] }] };
const landed = { regionOwnershipOverrides: { Narva: "Russian Federation" }, simulationHistory: [{ round: 3, fromDate: "1914-07-31", toDate: "1914-08-30", eventIds: ["e1", "e2"] }, ...before.simulationHistory] };

test("the world the page held before the round is the base its events are staged on", () => {
  const base = roundBaseOf({ heldWorld: before, heldGame: { gameDate: "1914-07-31", round: 3 }, world: landed });
  assert.deepEqual(base, { world: before, from: "1914-07-31", round: 3 });
  // The Events panel's record of that turn (time.jsx buildTurnRecord) is given it.
  assert.equal(baseForRecord(base, { fromDate: "1914-07-31", round: 3, events: [] }), before);
  assert.equal(baseForRecord(base, { fromDate: "1914-07-01", round: 2 }), null, "never another round's");
  assert.equal(baseForRecord(base, null), null);
  assert.equal(baseForRecord(null, { fromDate: "1914-07-31", round: 3 }), null);
});

test("a page that missed a round holds an older world, and reads the round whole", () => {
  assert.equal(roundBaseOf({ heldWorld: before, heldGame: { gameDate: "1914-07-01" }, world: landed }), null);
  assert.equal(roundBaseOf({ heldWorld: null, heldGame: { gameDate: "1914-07-31" }, world: landed }), null);
  assert.equal(roundBaseOf({ heldWorld: before, heldGame: { gameDate: "1914-07-31" }, world: { simulationHistory: [] } }), null);
  assert.equal(roundBaseOf({}), null);
});

test("the base is the view the page held, exactly, before the landing view replaced it", () => {
  // As client/sharedGame.js reads it: the runtime's held documents, just before the landing view is applied.
  const runtime = startRemoteRuntime({ publish: () => {}, urlFor: (key) => `/api/runtime/json/${key}` });
  try {
    const docsOf = (world, game) => ({ world, game, events: [], chat: [], actions: [] });
    const sums = (docs) => Object.fromEntries(VIEW_KEYS.map((key) => [key, digestDoc(key in docs ? docs[key] : null)]));
    const first = docsOf(before, { gameDate: "1914-07-31", round: 3 });
    assert.equal(runtime.apply({ epoch: "e", rev: 1, base: 0, docs: first, sums: sums(first) }).ok, true);
    const next = { world: landed, game: { gameDate: "1914-08-30", round: 4 } };
    const base = roundBaseOf({ heldWorld: runtime.held("world"), heldGame: runtime.held("game"), world: next.world });
    assert.equal(runtime.apply({ epoch: "e", rev: 2, base: 1, docs: next, sums: sums({ ...first, ...next }) }).ok, true);
    assert.deepEqual(base.world, before);
    assert.deepEqual(runtime.held("world"), landed, "the page shows the landed world; the base is kept beside it");
  } finally {
    stopRemoteRuntime();
  }
});

test("the page keeps the base when a round lands, and the Events panel stages on it", () => {
  // sharedGame.js and time.jsx load the page's runtime: their wiring is read.
  const page = fs.readFileSync(new URL("./sharedGame.js", import.meta.url), "utf8");
  const landing = page.slice(page.indexOf("const applyToRuntime"), page.indexOf("const makeClient"));
  assert.ok(landing.indexOf("roundBaseOf({") > 0 && landing.indexOf("roundBaseOf({") < landing.indexOf("owner.runtime.apply(view)"), "read before the landing view replaces it");
  assert.match(landing, /setSharedRoundBase\(/);
  const time = fs.readFileSync(new URL("../../Game/GameUI/time.jsx", import.meta.url), "utf8");
  const landedBase = time.slice(time.indexOf("const landedBaseFor = (record)"), time.indexOf("// The land war of a turn being written"));
  assert.match(landedBase, /sharedRoundBase\(record\)/);
});
