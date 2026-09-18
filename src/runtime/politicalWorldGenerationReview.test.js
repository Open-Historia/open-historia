import test from "node:test";
import assert from "node:assert/strict";

import { normalizePoliticalActors } from "./politicalActors.js";
import { buildPoliticalKnowledgeView } from "./politicalKnowledge.js";

import {
  POLITICAL_WORLD_GENERATION_MODES,
  applyReviewedPoliticalGeneration,
  buildScenarioPoliticalGenerationInputs,
  buildScenarioPoliticalRelevance,
  collectScenarioPoliticalPolities,
} from "./politicalWorldGenerationReview.js";

const scenarioDetails = {
  scenario: {
    name: "Future Europe",
    description: "A divergent European order.",
    heroSubtitle: "The old alliances have fractured.",
  },
  data: {
    game: { country: "Kingdom of Poland", startDate: "2067-04-19", gameDate: "2067-04-19" },
    world: {
      ownerCodes: ["Kingdom of Poland", "European Federation", "NA"],
      regionOwnershipOverrides: { "r-1": "Kingdom of Poland", "r-2": "European Federation" },
      polityOverrides: {
        "Kingdom of Poland": { name: "Kingdom of Poland", aliases: ["Poland"], note: "Constitutional monarchy." },
        "European Federation": { name: "European Federation", aliases: ["EF"] },
        "Lunar Free State": { name: "Lunar Free State", status: "active" },
        "Former Republic": { name: "Former Republic", status: "dissolved" },
      },
      politicalActors: {
        byPolity: {
          "European Federation": {
            polityKey: "European Federation",
            politicalSystem: { type: "federal_republic", representation: "electoral" },
            government: { form: "Federal republic" },
            parties: [{ id: "union", name: "Union Party" }],
          },
        },
      },
      wars: [{ id: "war-1", status: "active", sideA: ["EF"], sideB: ["Kingdom of Poland"] }],
      startingTimelineText: "The federation formed in 2059.",
      simulationRules: "Do not restore dissolved pre-2050 institutions.",
    },
  },
};

test("scenario polity collection canonicalizes aliases and includes landless political actors/overrides", () => {
  const polities = collectScenarioPoliticalPolities(scenarioDetails.data.world);
  assert.deepEqual(polities.map((entry) => entry.polityKey), [
    "European Federation",
    "Former Republic",
    "Kingdom of Poland",
    "Lunar Free State",
  ]);
  assert.equal(polities.find((entry) => entry.polityKey === "Lunar Free State").hasTerritory, false);
});

test("balanced relevance gives player/belligerents full, existing actors rich, and ordinary polities standard", () => {
  const world = {
    ...scenarioDetails.data.world,
    wars: [],
    ownerCodes: [...scenarioDetails.data.world.ownerCodes, "Republic X"],
  };
  const relevance = buildScenarioPoliticalRelevance({
    world,
    playerPolity: "Poland",
    mode: POLITICAL_WORLD_GENERATION_MODES.BALANCED,
  });
  assert.equal(relevance["Kingdom of Poland"].depth, "full");
  assert.equal(relevance["European Federation"].depth, "rich");
  assert.equal(relevance["Republic X"].depth, "standard");
});

test("simulation-ready mode makes ordinary sovereign polities rich without promoting peripheral landless entries", () => {
  const relevance = buildScenarioPoliticalRelevance({
    world: { ...scenarioDetails.data.world, wars: [] },
    playerPolity: "Kingdom of Poland",
    mode: POLITICAL_WORLD_GENERATION_MODES.SIMULATION_READY,
  });
  assert.equal(relevance["European Federation"].depth, "rich");
  assert.equal(relevance["Lunar Free State"].depth, "rich", "active custom polity remains politically real even when currently landless");
});

test("scenario generation inputs use saved scenario canon and bounded polity-specific authored context", () => {
  const inputs = buildScenarioPoliticalGenerationInputs(scenarioDetails, { mode: "balanced", maxBatchSize: 9 });
  assert.equal(inputs.scenarioDate, "2067-04-19");
  assert.equal(inputs.maxBatchSize, 9);
  assert.equal(inputs.prioritizeQuantitativeLandscapeBackfill, true);
  assert.match(inputs.scenarioContext, /Future Europe/);
  assert.match(inputs.scenarioContext, /federation formed in 2059/);
  assert.equal(inputs.contextByPolity["Kingdom of Poland"].scenarioNote, "Constitutional monarchy.");
  assert.ok(!inputs.polities.some((entry) => entry.polityKey === "NA"));
  assert.ok(!inputs.polities.some((entry) => entry.polityKey === "Former Republic"), "dissolved polities are historical state, not current generation targets");
});

const validProposal = ({ polityKey = "Kingdom of Poland", actorPatch } = {}) => ({
  schemaVersion: 1,
  polityKey,
  scenarioDate: "2067-04-19",
  depth: "rich",
  provenance: {
    source: "generated",
    confidence: "moderate",
    generatedAt: "2026-09-06T00:00:00Z",
  },
  actorPatch: actorPatch ?? {
    politicalSystem: { type: "constitutional_monarchy", representation: "electoral" },
    government: { form: "Constitutional monarchy", ideology: "Civic constitutionalism" },
    parties: [{
      id: "civic-league",
      name: "Civic League",
      politicalResponse: { organization: 65 },
    }],
    traits: { riskTolerance: 48 },
    goals: ["Preserve the constitutional settlement"],
  },
});

test("review apply is atomic and records generated provenance only for paths actually filled", () => {
  const result = applyReviewedPoliticalGeneration({
    scenarioDate: "2067-04-19",
    politicalActors: { byPolity: {} },
    reviews: [{ selected: true, proposal: validProposal() }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const actor = result.politicalActors.byPolity["Kingdom of Poland"];
  assert.equal(actor.government.form, "Constitutional monarchy");
  assert.equal(actor.behavioralDisposition, undefined);
  assert.equal(actor.generationProvenance.schemaVersion, 1);
  assert.equal(actor.generationProvenance.byPath.government.source, "generated");
  assert.equal(result.applied.length, 1);

  const normalizedAgain = normalizePoliticalActors(result.politicalActors);
  assert.equal(normalizedAgain.byPolity["Kingdom of Poland"].generationProvenance.byPath.government.source, "generated");
  const publicView = buildPoliticalKnowledgeView({ politicalActors: normalizedAgain }, "Kingdom of Poland");
  assert.equal(publicView.public.generationProvenance, undefined, "generation provenance remains non-public metadata");
});

test("one invalid reviewed edit blocks the whole reviewed apply instead of partially mutating scenario canon", () => {
  const result = applyReviewedPoliticalGeneration({
    scenarioDate: "2067-04-19",
    politicalActors: { byPolity: {} },
    reviews: [
      { selected: true, proposal: validProposal() },
      {
        selected: true,
        proposal: validProposal({
          polityKey: "Republic X",
          actorPatch: {
            politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
            behavioralDisposition: { assertiveness: 100 },
          },
        }),
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.politicalActors.byPolity["Kingdom of Poland"], undefined);
});

test("reviewed entity expansion is explicit and preserves authored party fields", () => {
  const existing = {
    byPolity: {
      "Republic X": {
        polityKey: "Republic X",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic", ideology: "Pluralist" },
        parties: [{ id: "unity", name: "Unity", ideology: "Authored ideology" }],
      },
    },
  };
  const proposal = validProposal({
    polityKey: "Republic X",
    actorPatch: {
      parties: [
        { id: "unity", name: "Unity", politicalResponse: { organization: 55 } },
        { id: "reform", name: "Reform League", politicalResponse: { organization: 62 } },
      ],
    },
  });
  const blocked = applyReviewedPoliticalGeneration({
    scenarioDate: "2067-04-19",
    politicalActors: existing,
    reviews: [{ selected: true, proposal, allowEntityExpansion: false }],
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.politicalActors.byPolity["Republic X"].parties.length, 1);

  const allowed = applyReviewedPoliticalGeneration({
    scenarioDate: "2067-04-19",
    politicalActors: existing,
    reviews: [{ selected: true, proposal, allowEntityExpansion: true }],
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.politicalActors.byPolity["Republic X"].parties.length, 2);
  assert.equal(allowed.politicalActors.byPolity["Republic X"].parties[0].ideology, "Authored ideology");
});

test("15-polity generation test preset prioritizes a fixed diverse geopolitical stress set at rich depth", async () => {
  const { buildScenarioPoliticalGenerationTestInputs, POLITICAL_WORLD_GENERATION_TEST_TARGETS } = await import("./politicalWorldGenerationReview.js");
  const names = [
    "Republic of Poland", "Russian Federation", "People's Republic of China",
    "Democratic People's Republic of Korea", "Ethiopia", "Republic of Equatorial Guinea",
    "Republic of South Sudan", "Republic of Azerbaijan", "Kingdom of Saudi Arabia",
    "Islamic Republic of Iran", "Kingdom of Thailand", "Republic of Malawi",
    "Republic of Malta", "Kyrgyz Republic", "Republic of Djibouti",
  ];
  const details = {
    scenario: { name: "2014 Stress" },
    data: {
      game: { country: "Republic of Poland", startDate: "2014-03-22", gameDate: "2014-03-22" },
      world: { ownerCodes: names, politicalActors: { byPolity: {} }, polityOverrides: {} },
    },
  };
  const inputs = buildScenarioPoliticalGenerationTestInputs(details);
  assert.equal(POLITICAL_WORLD_GENERATION_TEST_TARGETS.length, 15);
  assert.deepEqual(inputs.polities.map((entry) => entry.polityKey), names);
  assert.equal(inputs.maxBatchSize, 5);
  assert.equal(inputs.testMode, true);
  assert.ok(inputs.polities.every((entry) => inputs.relevanceByPolity[entry.polityKey].depth === "rich"));
});

test("review apply can surgically fill normalized empty governing-party refs without opening other missing-only fields", () => {
  const existing = normalizePoliticalActors({
    byPolity: {
      "Federal Republic of Germany": {
        polityKey: "Federal Republic of Germany",
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Federal parliamentary republic", headOfGovernment: "Angela Merkel" },
        parties: [
          { id: "cdu-csu", name: "CDU/CSU" },
          { id: "spd", name: "SPD" },
        ],
      },
    },
  });
  assert.deepEqual(existing.byPolity["Federal Republic of Germany"].government.rulingPartyIds, []);

  const proposal = {
    schemaVersion: 1,
    polityKey: "Federal Republic of Germany",
    scenarioDate: "2014-03-22",
    depth: "rich",
    provenance: { source: "generated", confidence: "high", generatedAt: "2026-09-07T00:00:00Z" },
    sourceAsOf: "2014-03-22",
    referenceDates: ["2014-03-22"],
    actorPatch: { government: { rulingPartyIds: ["cdu-csu"], coalitionPartyIds: ["spd"] } },
  };

  const blocked = applyReviewedPoliticalGeneration({
    scenarioDate: "2014-03-22",
    politicalActors: existing,
    reviews: [{ selected: true, proposal }],
  });
  assert.equal(blocked.ok, true);
  assert.equal(blocked.applied.length, 0);

  const repaired = applyReviewedPoliticalGeneration({
    scenarioDate: "2014-03-22",
    politicalActors: existing,
    reviews: [{ selected: true, proposal, fillEmptyGovernmentPartyRefs: true }],
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired.errors));
  assert.deepEqual(repaired.politicalActors.byPolity["Federal Republic of Germany"].government.rulingPartyIds, ["cdu-csu"]);
  assert.deepEqual(repaired.politicalActors.byPolity["Federal Republic of Germany"].government.coalitionPartyIds, ["spd"]);
  assert.deepEqual(repaired.applied[0].appliedPaths, ["government.rulingPartyIds", "government.coalitionPartyIds"]);
});

test("derived Stats/power ledgers never expand the canonical active scenario polity roster", () => {
  const world = {
    polityOverrides: {
      Alpha: { name: "Alpha", status: "active" },
      Beta: { name: "Beta", status: "active" },
    },
    ownerCodes: ["Alpha", "Beta"],
    politicalActors: { byPolity: { Alpha: { polityKey: "Alpha" }, Beta: { polityKey: "Beta" } } },
    countryStats: {
      Alpha: { population: { total: 1 } },
      Beta: { population: { total: 1 } },
      "Stock Germany": { population: { total: 80 } },
      "Legacy France": { population: { total: 65 } },
    },
    powerStatus: {
      schemaVersion: 1,
      byPolity: {
        Alpha: { tier: "minor-power", score: 20 },
        "Stock Germany": { tier: "major-power", score: 90 },
      },
    },
  };

  assert.deepEqual(
    collectScenarioPoliticalPolities(world).filter((entry) => entry.active !== false).map((entry) => entry.polityKey),
    ["Alpha", "Beta"],
  );
});
