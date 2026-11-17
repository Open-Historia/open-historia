import test from "node:test";
import assert from "node:assert/strict";
import {
  POLITICAL_WORLD_GENERATION_MODES,
  buildScenarioPoliticalRelevance,
  buildScenarioPoliticalGenerationInputs,
} from "./politicalWorldGenerationReview.js";

const fixture = {
  scenario: { name: "Divergent Europe" },
  data: {
    game: { country: "Player Republic", startDate: "1911-10-08", gameDate: "1911-10-08" },
    world: {
      ownerCodes: ["Player Republic", "Ordinary Republic", "Non-sovereign Region"],
      polityOverrides: {
        "Player Republic": { name: "Player Republic", status: "active" },
        "Ordinary Republic": { name: "Ordinary Republic", status: "active" },
        "Non-sovereign Region": { name: "Non-sovereign Region", status: "active" },
        "Dissolved Republic": { name: "Dissolved Republic", status: "dissolved" },
      },
      wars: [],
    },
  },
};

test("advanced uniform depth requests the exact standard/rich/full depth for every active polity", () => {
  for (const depth of ["standard", "rich", "full"]) {
    const input = buildScenarioPoliticalGenerationInputs(fixture, {
      mode: POLITICAL_WORLD_GENERATION_MODES.UNIFORM,
      uniformDepth: depth,
    });
    assert.equal(input.generationMode, POLITICAL_WORLD_GENERATION_MODES.UNIFORM);
    assert.equal(input.uniformDepth, depth);
    assert.deepEqual(
      Object.values(input.relevanceByPolity).map((value) => value.depth),
      Array(input.polities.length).fill(depth),
    );
    assert.ok(input.polities.length >= 3);
    assert.ok(!input.polities.some((entry) => entry.polityKey === "Dissolved Republic"));
    assert.equal(input.prioritizeQuantitativeLandscapeBackfill, true, "retain existing native pipeline");
  }
});

test("existing automated mode decisions and the stress test's fixed rich depth remain unchanged", () => {
  const auto = buildScenarioPoliticalRelevance({
    world: fixture.data.world,
    playerPolity: "Player Republic",
    mode: POLITICAL_WORLD_GENERATION_MODES.SIMULATION_READY,
  });
  assert.equal(auto["Player Republic"].depth, "full");
  assert.equal(auto["Ordinary Republic"].depth, "rich");
  const balanced = buildScenarioPoliticalGenerationInputs(fixture);
  assert.equal(balanced.relevanceByPolity["Player Republic"].depth, "full");
  assert.equal(balanced.relevanceByPolity["Ordinary Republic"].depth, "standard");
  assert.equal(balanced.generationMode, POLITICAL_WORLD_GENERATION_MODES.BALANCED);
  assert.equal(balanced.uniformDepth, null);
});

test("an unsupported uniform depth fails closed rather than silently downgrading to standard", () => {
  for (const depth of ["", "maximum", "minimal", null, 0]) {
    assert.throws(() => buildScenarioPoliticalGenerationInputs(fixture, {
      mode: POLITICAL_WORLD_GENERATION_MODES.UNIFORM,
      uniformDepth: depth,
    }), /uniform.*depth|standard.*rich.*full/i);
  }
});
