import test from "node:test";
import assert from "node:assert/strict";
import {
  POLITICAL_TRAIT_KEYS,
  POLITICAL_TRAIT_REGISTRY,
  canonicalPoliticalTraitKey,
  politicalTraitCatalogForActor,
  validatePoliticalTraitPatch,
} from "./politicalTraitRegistry.js";
import { applyPoliticalActorOperation } from "./politicalActorOps.js";
import { normalizePoliticalActors } from "./politicalActors.js";

test("canonical trait registry exposes every native disposition trait once", () => {
  assert.deepEqual(POLITICAL_TRAIT_KEYS, [
    "riskTolerance", "recklessness", "caution", "opportunism", "militarism",
    "conciliatory", "pragmatism", "paranoia", "vindictiveness", "consensusDriven",
  ]);
  assert.equal(new Set(POLITICAL_TRAIT_KEYS).size, POLITICAL_TRAIT_REGISTRY.length);
  assert.equal(canonicalPoliticalTraitKey("risk_tolerance"), "riskTolerance");
  assert.equal(canonicalPoliticalTraitKey("consensus"), "consensusDriven");
});

test("trait catalog keeps unset canonical dimensions visible and legacy extensions separate", () => {
  const catalog = politicalTraitCatalogForActor({ traits: { pragmatism: 85, customLegacyTrait: 42 } });
  assert.equal(catalog.traits.find((entry) => entry.key === "pragmatism")?.value, 85);
  assert.equal(catalog.traits.find((entry) => entry.key === "militarism")?.status, "unset");
  assert.equal(catalog.extensionTraits.customLegacyTrait, 42);
});

test("new set-traits operations canonicalize aliases and reject invented trait keys", () => {
  const world = { politicalActors: normalizePoliticalActors({}) };
  const applied = applyPoliticalActorOperation(world, {
    op: "set-traits",
    polityKey: "New Republic",
    traits: { risk_tolerance: 73, pragmatism: 88 },
  });
  assert.equal(applied.applied, true, applied.error);
  assert.equal(applied.actor.traits.riskTolerance, 73);
  assert.equal(applied.actor.traits.pragmatism, 88);

  const invalid = applyPoliticalActorOperation(world, {
    op: "set-traits",
    polityKey: "New Republic",
    traits: { aggressionishness: 99 },
  });
  assert.equal(invalid.applied, false);
  assert.match(invalid.error, /unknown trait key/i);
});

test("trait patch validator enforces bounded numeric values", () => {
  assert.equal(validatePoliticalTraitPatch({ caution: 120 }).traits.caution, 100);
  assert.match(validatePoliticalTraitPatch({ caution: "not-a-number" }).error, /numeric 0-100/);
});
