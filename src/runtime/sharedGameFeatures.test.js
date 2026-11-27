/*! Open Historia — a shared game's features are the host's: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sharedGameFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { getActiveFeatures, isActiveFeatureEnabled, resolveFeatures, setActiveFeatures, setSharedGameFeatures, sharedGameFeaturesOf, subscribeToActiveFeatures } from "./gameFeatures.js";

test("in a shared game the host's features are the game's on a guest's screen, and its own come back when it ends", () => {
  // The guest's own copy of the scenario has social media on; the host's game has it off.
  setActiveFeatures({ socialMedia: { enabled: true } }, null);
  assert.equal(isActiveFeatureEnabled("socialMedia"), true);
  const host = resolveFeatures({ socialMedia: { enabled: false } }, null);
  let told = 0;
  const stop = subscribeToActiveFeatures(() => { told += 1; });
  setSharedGameFeatures(host);
  assert.equal(isActiveFeatureEnabled("socialMedia"), false);
  assert.equal(told, 1);
  // The library landing again (its catalog refreshed) changes nothing while the host's hold.
  setActiveFeatures({ socialMedia: { enabled: true } }, { socialMedia: { enabled: true } });
  assert.equal(isActiveFeatureEnabled("socialMedia"), false);
  setSharedGameFeatures(null);
  assert.equal(isActiveFeatureEnabled("socialMedia"), true, "the guest's own, after");
  stop();
});

test("the host's features, resolved again on a guest's screen, are what the host resolved", () => {
  const host = resolveFeatures({ socialMedia: { enabled: false }, wars: { enabled: true } }, { espionage: { enabled: false } });
  setSharedGameFeatures(host);
  assert.deepEqual(getActiveFeatures(), host);
  setSharedGameFeatures(null);
});

test("what the host states of its features leaves out the narrator's own: world direction's rules and scripted events", () => {
  const host = resolveFeatures({ worldDirection: { enabled: true, priorityRules: "CANARY-RULES", scriptedEvents: [{ title: "CANARY-PLOT" }] } }, null);
  const stated = sharedGameFeaturesOf(host);
  assert.deepEqual(stated.worldDirection, { enabled: true });
  assert.equal(JSON.stringify(stated).includes("CANARY"), false);
  assert.deepEqual(stated.fronts, host.fronts, "what screens draw by is kept");
});
