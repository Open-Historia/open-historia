/*! Open Historia — map world-store owner folding tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/Map/useWorldState.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { foldOwnerTokens } from "./useWorldState.js";

// The renderer keys surfaces, colours and labels by owner token. A save that
// holds a polity's regions under both its token and its display name must reach
// the map as one owner, exactly as gameState.normalizeWorldState reads it.

const RENAMED = { Russia: { code: "Russia", name: "Russian Federation", aliases: [] } };

test("regions stored under a polity's display name fold onto its token for the map", () => {
  const { overrides } = foldOwnerTokens({
    polityOverrides: RENAMED,
    regionOwnershipOverrides: { "RUS.1_1": "Russia", "RUS.2_1": "Russian Federation", "UKR.1_1": "Ukraine" },
  });
  assert.deepEqual(overrides, { "RUS.1_1": "Russia", "RUS.2_1": "Russia", "UKR.1_1": "Ukraine" });
});

test("claimants share the owner namespace and fold with it", () => {
  const { claimants } = foldOwnerTokens({
    polityOverrides: RENAMED,
    regionClaimants: { "UKR.5_1": ["Russian Federation", "Ukraine"] },
  });
  assert.deepEqual(claimants["UKR.5_1"], ["Russia", "Ukraine"]);
});

test("a world with nothing to fold keeps its own objects", () => {
  const state = {
    polityOverrides: RENAMED,
    regionOwnershipOverrides: { "RUS.1_1": "Russia" },
    regionClaimants: { "UKR.5_1": ["Ukraine"] },
  };
  const { overrides, claimants } = foldOwnerTokens(state);
  assert.equal(overrides, state.regionOwnershipOverrides, "same reference, so the store's change detection still holds");
  assert.equal(claimants, state.regionClaimants);
});

test("a genuinely separate polity is not folded into a namesake", () => {
  const { overrides } = foldOwnerTokens({
    polityOverrides: { ...RENAMED, "Free Siberia": { code: "Free Siberia", name: "Free Siberia", aliases: [] } },
    regionOwnershipOverrides: { "RUS.9_1": "Free Siberia" },
  });
  assert.equal(overrides["RUS.9_1"], "Free Siberia");
});
