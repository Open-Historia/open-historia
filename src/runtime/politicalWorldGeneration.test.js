import test from "node:test";
import assert from "node:assert/strict";

import {
  POLITICAL_GENERATION_DEPTHS,
  POLITICAL_GENERATION_NEEDS,
  POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN,
  assessPoliticalGenerationNeeds,
  assessPoliticalRepresentationCoverage,
  buildPoliticalGenerationPlan,
  comparePoliticalGenerationAuthority,
  completeGeneratedPoliticalLandscapePatch,
  classifyPoliticalGenerationDepth,
  mergeMissingPoliticalActor,
  validatePoliticalGenerationProposal,
} from "./politicalWorldGeneration.js";


test("generation authority ranks campaign canon above authored/curated/generated input", () => {
  assert.equal(comparePoliticalGenerationAuthority("campaign-created", "authored"), 1);
  assert.equal(comparePoliticalGenerationAuthority("authored", "curated"), 1);
  assert.equal(comparePoliticalGenerationAuthority("curated", "generated"), 1);
  assert.equal(comparePoliticalGenerationAuthority("generated", "authored"), -1);
});

test("relevance changes political generation depth, never whether a polity is politically real", () => {
  assert.equal(classifyPoliticalGenerationDepth({ isPlayer: true }), POLITICAL_GENERATION_DEPTHS.FULL);
  assert.equal(classifyPoliticalGenerationDepth({ regionalPower: true }), POLITICAL_GENERATION_DEPTHS.RICH);
  assert.equal(classifyPoliticalGenerationDepth({ sovereign: true }), POLITICAL_GENERATION_DEPTHS.STANDARD);
  assert.equal(classifyPoliticalGenerationDepth({ sovereign: false }), POLITICAL_GENERATION_DEPTHS.MINIMAL);
});

test("generation plan includes missing polities and batches the most relevant first", () => {
  const plan = buildPoliticalGenerationPlan({
    scenarioDate: "2067-04-19",
    maxBatchSize: 2,
    polities: ["Kingdom of Poland", "European Federation", { polityKey: "Lunar Free State", sovereign: false }],
    politicalActors: { byPolity: {} },
    relevanceByPolity: {
      "European Federation": { globalPower: true },
      "Kingdom of Poland": { regionalPower: true },
    },
  });

  assert.deepEqual(plan.items.map((item) => [item.polityKey, item.depth]), [
    ["European Federation", "full"],
    ["Kingdom of Poland", "rich"],
    ["Lunar Free State", "minimal"],
  ]);
  assert.equal(plan.batches.length, 2);
  assert.ok(plan.items.every((item) => item.needs.includes(POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM)));
});

test("1867 monarchy and 2067 fictional polity use the same scenario-agnostic completeness contract", () => {
  const monarchyNeeds = assessPoliticalGenerationNeeds({
    polityKey: "Russian Empire",
    politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
    government: { form: "Absolute monarchy", headOfState: "Alexander II" },
    powerBlocs: [{ id: "imperial-court", name: "Imperial Court" }],
  }, "rich");
  assert.ok(!monarchyNeeds.includes(POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM));
  assert.ok(!monarchyNeeds.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES));
  assert.ok(monarchyNeeds.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES));

  const futureNeeds = assessPoliticalGenerationNeeds({
    polityKey: "Kingdom of Poland",
    politicalSystem: { type: "constitutional_monarchy", representation: "electoral" },
    government: { form: "Constitutional monarchy" },
  }, "standard");
  assert.deepEqual(futureNeeds, [
    POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES,
    POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE,
  ]);
});

test("missing-only merge preserves authored values and explicit empty lists", () => {
  const existing = {
    polityKey: "Kingdom of Poland",
    government: { form: "Constitutional monarchy", headOfState: "Anna I" },
    parties: [],
  };
  const generated = {
    government: { form: "Federal republic", headOfGovernment: "Jan Nowak" },
    parties: [{ id: "civic-league", name: "Civic League" }],
    traits: { riskTolerance: 62 },
  };

  const merged = mergeMissingPoliticalActor(existing, generated);
  assert.equal(merged.actor.government.form, "Constitutional monarchy");
  assert.equal(merged.actor.government.headOfState, "Anna I");
  assert.equal(merged.actor.government.headOfGovernment, "Jan Nowak");
  assert.deepEqual(merged.actor.parties, [], "explicit authored party membership is not expanded silently");
  assert.deepEqual(merged.actor.traits, { riskTolerance: 62 });
});

test("reviewed entity expansion may add new parties while still preserving authored party fields", () => {
  const existing = {
    polityKey: "Republic X",
    parties: [{ id: "unity", name: "Unity", ideology: "Authored ideology" }],
  };
  const generated = {
    parties: [
      { id: "unity", name: "Different generated name", politicalResponse: { organization: 60 } },
      { id: "reform", name: "Reform League" },
    ],
  };
  const merged = mergeMissingPoliticalActor(existing, generated, { allowEntityExpansion: true });
  assert.equal(merged.actor.parties[0].name, "Unity");
  assert.equal(merged.actor.parties[0].ideology, "Authored ideology");
  assert.equal(merged.actor.parties[0].politicalResponse.organization, 60);
  assert.equal(merged.actor.parties[1].id, "reform");
});

test("valid generation proposal fills missing state and returns generated-field provenance", () => {
  const proposal = {
    schemaVersion: 1,
    polityKey: "Kingdom of Poland",
    scenarioDate: "2067-04-19",
    depth: "rich",
    provenance: { source: "generated", confidence: "moderate", generatedAt: "2067-04-19T00:00:00Z" },
    actorPatch: {
      politicalSystem: { type: "constitutional_monarchy", representation: "electoral", regimeCharacter: "democratic" },
      government: { form: "Constitutional monarchy", rulingPartyIds: ["civic-league"] },
      parties: [{
        id: "civic-league",
        name: "Civic League",
        politicalResponse: { organization: 68, issues: { reform: { position: 45, sensitivity: 70 } } },
      }],
      traits: { riskTolerance: 48, opportunism: 55 },
      goals: ["Preserve the constitutional settlement"],
    },
  };

  const result = validatePoliticalGenerationProposal(proposal, {
    polityKey: "Kingdom of Poland",
    scenarioDate: "2067-04-19",
    depth: "rich",
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.actor.politicalSystem.representation, "electoral");
  assert.equal(result.actor.politicalSystem.regimeCharacter, "democratic");
  assert.equal(result.actor.government.rulingPartyIds[0], "civic-league");
  assert.equal(result.provenance.source, "generated");
  assert.ok(result.provenance.appliedPaths.includes("politicalSystem"));
  assert.equal(result.actor.behavioralDisposition, undefined);
});

test("proposal cannot cross the historical scenario-date boundary", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Russian Empire",
    scenarioDate: "1867-01-01",
    depth: "standard",
    provenance: { source: "generated", confidence: "moderate" },
    referenceDates: ["1866-12-15", "1870-01-01"],
    actorPatch: {
      politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
      government: { form: "Absolute monarchy" },
    },
  }, {
    polityKey: "Russian Empire",
    scenarioDate: "1867-01-01",
    depth: "standard",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("crosses the scenario-date boundary")));
});

test("generator cannot author runtime disposition or pressure state", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Republic X",
    scenarioDate: "2067-01-01",
    depth: "standard",
    provenance: { source: "generated", confidence: "low" },
    actorPatch: {
      politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
      behavioralDisposition: { assertiveness: 100 },
      politicalPressures: { issues: { security: { salience: 100 } } },
    },
  }, {
    polityKey: "Republic X",
    scenarioDate: "2067-01-01",
    depth: "standard",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("behavioralDisposition")));
  assert.ok(result.errors.some((error) => error.includes("politicalPressures")));
});

test("non-electoral generated systems cannot fake party polling", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Emirate X",
    scenarioDate: "2067-01-01",
    depth: "rich",
    provenance: { source: "generated", confidence: "moderate" },
    actorPatch: {
      politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
      government: { form: "Absolute monarchy" },
      parties: [{ id: "kings-party", name: "King's Party", support: { percent: 99 } }],
      powerBlocs: [{ id: "royal-court", name: "Royal Court", influence: { label: "Dominant" } }],
    },
  }, {
    polityKey: "Emirate X",
    scenarioDate: "2067-01-01",
    depth: "rich",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("may not invent party polling")));
});

test("generated government references must resolve to stable party ids", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Republic X",
    scenarioDate: "2067-01-01",
    depth: "standard",
    provenance: { source: "generated", confidence: "moderate" },
    actorPatch: {
      politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
      government: { form: "Parliamentary republic", rulingPartyIds: ["imaginary-party"] },
      parties: [{ id: "real-party", name: "Real Party" }],
    },
  }, {
    polityKey: "Republic X",
    scenarioDate: "2067-01-01",
    depth: "standard",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown party id imaginary-party")));
});


test("scenario-date contract rejects impossible calendar dates", () => {
  assert.throws(() => buildPoliticalGenerationPlan({ scenarioDate: "1867-02-31", polities: ["Russian Empire"] }), /scenarioDate/);
  const leap = buildPoliticalGenerationPlan({ scenarioDate: "2068-02-29", polities: ["Republic X"] });
  assert.equal(leap.scenarioDate, "2068-02-29");
});

test("an unknown political system requests the full depth-appropriate shape instead of pretending representation=none is settled", () => {
  const rich = assessPoliticalGenerationNeeds(null, "rich");
  assert.deepEqual(rich, [
    POLITICAL_GENERATION_NEEDS.POLITICAL_SYSTEM,
    POLITICAL_GENERATION_NEEDS.GOVERNING_STRUCTURE,
    POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES,
    POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE,
    POLITICAL_GENERATION_NEEDS.LEADERSHIP_TRAITS,
    POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES,
    POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT,
  ]);
});

test("rich generation requires response profiles for every represented entity without inventing polling", () => {
  const needs = assessPoliticalGenerationNeeds({
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", ideology: "Pluralist", headOfGovernment: "A" },
    parties: [
      { id: "a", name: "A", support: { percent: 45 }, politicalResponse: { organization: 60 } },
      { id: "b", name: "B" },
    ],
    traits: { riskTolerance: 50 },
    goals: ["Maintain order"],
  }, "rich");
  assert.ok(needs.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES));
});


test("party-state representation may be carried by ruling parties, power blocs, or both", () => {
  const needs = assessPoliticalGenerationNeeds({
    polityKey: "People's Republic of China",
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    government: { form: "One-party socialist republic", ideology: "Socialism with Chinese characteristics", headOfGovernment: "Li Keqiang" },
    parties: [{
      id: "chinese-communist-party",
      name: "Chinese Communist Party",
      politicalResponse: { organization: 95 },
    }],
    traits: { pragmatism: 80 },
    goals: ["Maintain party rule"],
  }, "rich");

  assert.ok(!needs.includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES));
  assert.ok(!needs.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES));
});

test("existing roster enrichment may identify an entity by stable id without repeating its display name", () => {
  const existingActor = {
    polityKey: "Republic of Poland",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", ideology: "Liberal-conservative coalition" },
    parties: [{ id: "civic-platform", name: "Platforma Obywatelska" }],
  };
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Republic of Poland",
    scenarioDate: "2014-03-22",
    depth: "rich",
    provenance: { source: "generated", confidence: "high" },
    actorPatch: {
      parties: [{ id: "civic-platform", politicalResponse: { organization: 80 } }],
    },
  }, {
    polityKey: "Republic of Poland",
    scenarioDate: "2014-03-22",
    depth: "rich",
    existingActor,
  });

  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.actor.parties[0].name, "Platforma Obywatelska");
  assert.equal(result.actor.parties[0].politicalResponse.organization, 80);
});


test("party_state representation requires explicit party-state structural evidence", () => {
  const invalid = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Republic X",
    scenarioDate: "2014-03-22",
    depth: "standard",
    provenance: { source: "generated", confidence: "high" },
    actorPatch: {
      politicalSystem: { type: "presidential_republic", representation: "party_state" },
      government: { form: "Dominant-party presidential republic", headOfState: "Leader X", headOfGovernment: "Leader X" },
      parties: [{ id: "ruling-party", name: "Ruling Party" }],
    },
  }, {
    polityKey: "Republic X",
    scenarioDate: "2014-03-22",
    depth: "standard",
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("representation=party_state requires explicit one-party/vanguard-party")));

  for (const governmentForm of [
    "Presidential republic (dominant-party state)",
    "One-party dominant vanguard state led by the ruling coalition",
  ]) {
    const dominantPartyEvasion = validatePoliticalGenerationProposal({
      schemaVersion: 1,
      polityKey: "Dominant Party X",
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high" },
      actorPatch: {
        politicalSystem: { type: "dominant_party_republic", representation: "party_state" },
        government: { form: governmentForm, headOfState: "Leader X", headOfGovernment: "Leader X" },
        parties: [{ id: "ruling-party", name: "Ruling Party" }],
      },
    }, {
      polityKey: "Dominant Party X",
      scenarioDate: "2014-03-22",
      depth: "standard",
    });
    assert.equal(dominantPartyEvasion.ok, false, governmentForm);
    assert.ok(dominantPartyEvasion.errors.some((error) => error.includes("representation=party_state requires explicit one-party/vanguard-party")));
  }

  for (const [polityKey, governmentForm, type] of [
    ["Republic of Cuba", "Single-party communist state", "communist_state"],
    ["State of Eritrea", "One-party presidential republic", "presidential_republic"],
    ["Sahrawi Arab Democratic Republic", "One-party semi-presidential republic", "semi_presidential_republic"],
  ]) {
    const explicitOneParty = validatePoliticalGenerationProposal({
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high" },
      actorPatch: {
        politicalSystem: { type, representation: "party_state" },
        government: { form: governmentForm, headOfState: "Leader X", headOfGovernment: "Leader X" },
        parties: [{ id: "ruling-party", name: "Ruling Party" }],
      },
    }, {
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
    });
    assert.equal(explicitOneParty.ok, true, `${polityKey}: ${explicitOneParty.errors?.join("\n")}`);
  }

  const valid = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Party State X",
    scenarioDate: "2014-03-22",
    depth: "standard",
    provenance: { source: "generated", confidence: "high" },
    actorPatch: {
      politicalSystem: { type: "one_party_state", representation: "party_state" },
      government: { form: "One-party socialist republic", headOfState: "Leader X", headOfGovernment: "Premier X" },
      parties: [{ id: "vanguard-party", name: "Vanguard Party" }],
    },
  }, {
    polityKey: "Party State X",
    scenarioDate: "2014-03-22",
    depth: "standard",
  });
  assert.equal(valid.ok, true, valid.errors?.join("\n"));
});

test("Political Actor stable ids are unique across parties and powerBlocs", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Ethiopia",
    scenarioDate: "2014-03-22",
    depth: "standard",
    provenance: { source: "generated", confidence: "high" },
    actorPatch: {
      politicalSystem: { type: "republic", representation: "electoral" },
      government: { form: "Federal parliamentary republic", headOfState: "Mulatu Teshome", headOfGovernment: "Hailemariam Desalegn" },
      parties: [{ id: "eprdf", name: "Ethiopian Peoples' Revolutionary Democratic Front" }],
      powerBlocs: [{ id: "eprdf", name: "EPRDF governing coalition" }],
    },
  }, {
    polityKey: "Ethiopia",
    scenarioDate: "2014-03-22",
    depth: "standard",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("entity id eprdf may not exist in both parties and powerBlocs")));
});


test("quantitative landscape is a baseline need even when electoral identity is already complete", () => {
  const needs = assessPoliticalGenerationNeeds({
    polityKey: "Federal Republic of Germany",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Federal parliamentary republic", headOfGovernment: "Angela Merkel" },
    parties: [
      { id: "cdu-csu", name: "CDU/CSU" },
      { id: "spd", name: "SPD" },
    ],
  }, "standard");
  assert.deepEqual(needs, [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE]);
});

test("PWV2 generated electoral coverage reopens a shallow roster while leaving authored support alone", () => {
  const shallowGenerated = {
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", rulingPartyIds: ["a"] },
    parties: [
      { id: "a", name: "Party A", support: { percent: 50, basis: "generated-estimate" } },
      { id: "b", name: "Party B", support: { percent: 15, basis: "generated-estimate" } },
    ],
  };
  const coverage = assessPoliticalRepresentationCoverage(shallowGenerated, { requireGeneratedCoverage: true });
  assert.equal(POLITICAL_GENERATED_ELECTORAL_NAMED_COVERAGE_MIN, 75);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.reliableNamedCoverage, 65);
  assert.equal(coverage.residual, 35);
  assert.ok(assessPoliticalGenerationNeeds(shallowGenerated, "standard", { requireRepresentationCoverage: true })
    .includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES));

  const authored = {
    ...shallowGenerated,
    parties: shallowGenerated.parties.map((party) => ({ ...party, support: { percent: party.support.percent } })),
  };
  assert.equal(assessPoliticalRepresentationCoverage(authored, { requireGeneratedCoverage: true }).complete, true);
  assert.equal(assessPoliticalGenerationNeeds(authored, "standard", { requireRepresentationCoverage: true })
    .includes(POLITICAL_GENERATION_NEEDS.REPRESENTATION_ENTITIES), false);
});

test("native fallback arithmetic cannot fake generated electoral roster coverage", () => {
  const actor = {
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", rulingPartyIds: ["a"] },
    parties: [
      { id: "a", name: "Party A", support: { percent: 45, basis: "native-fallback-estimate" } },
      { id: "b", name: "Party B", support: { percent: 45, basis: "native-fallback-estimate" } },
    ],
  };
  const coverage = assessPoliticalRepresentationCoverage(actor, { requireGeneratedCoverage: true });
  assert.equal(coverage.namedCoverage, 90);
  assert.equal(coverage.reliableNamedCoverage, 0);
  assert.equal(coverage.complete, false);
});

test("party-state and non-electoral influence structures are not forced through electoral support coverage", () => {
  const partyState = {
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    government: { form: "One-party state", rulingPartyIds: ["workers"] },
    parties: [{ id: "workers", name: "Workers Party", influence: { percent: 100, basis: "generated-estimate" } }],
  };
  const court = {
    politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
    government: { form: "Absolute monarchy" },
    powerBlocs: [{ id: "court", name: "Royal Court", influence: { percent: 55, basis: "generated-estimate" } }],
  };
  assert.equal(assessPoliticalRepresentationCoverage(partyState, { requireGeneratedCoverage: true }).complete, true);
  assert.equal(assessPoliticalRepresentationCoverage(court, { requireGeneratedCoverage: true }).complete, true);
});

test("authored quantitative landscape is complete and is never regenerated", () => {
  const needs = assessPoliticalGenerationNeeds({
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", headOfGovernment: "Leader" },
    parties: [
      { id: "a", name: "A", support: { percent: 55 } },
      { id: "b", name: "B", support: { percent: 35 } },
    ],
  }, "standard");
  assert.equal(needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE), false);
});

test("native landscape completion preserves authored shares and scales only generated estimates", () => {
  const existing = {
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", rulingPartyIds: ["a"] },
    parties: [
      { id: "a", name: "A", support: { percent: 60 } },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
  };
  const completed = completeGeneratedPoliticalLandscapePatch(existing, {
    parties: [
      { id: "b", support: { percent: 35, basis: "generated-estimate" } },
      { id: "c", support: { percent: 25, basis: "generated-estimate" } },
    ],
  });
  const b = completed.patch.parties.find((party) => party.id === "b");
  const c = completed.patch.parties.find((party) => party.id === "c");
  assert.equal(existing.parties[0].support.percent, 60);
  assert.equal(Math.round((b.support.percent + c.support.percent) * 10) / 10, 40);
  assert.equal(b.support.basis, "generated-estimate");
  assert.ok(completed.warnings.some((warning) => warning.includes("Normalized generated support estimates")));
});

test("party-state parties receive influence baselines rather than fake voter support", () => {
  const existing = {
    polityKey: "People's Republic X",
    politicalSystem: { type: "one_party_state", representation: "party_state" },
    government: { form: "One-party socialist republic", rulingPartyIds: ["workers-party"] },
    parties: [{ id: "workers-party", name: "Workers Party" }],
  };
  const completed = completeGeneratedPoliticalLandscapePatch(existing, { parties: [{ id: "workers-party" }] });
  assert.deepEqual(completed.patch.parties[0].influence, { percent: 100, basis: "native-fallback-estimate" });
  assert.equal(completed.patch.parties[0].support, undefined);
});

test("representation none still requests quantitative influence when canonical power blocs exist", () => {
  const actor = {
    polityKey: "Brunei-like",
    politicalSystem: { type: "absolute_monarchy", representation: "none" },
    government: { form: "Absolute monarchy", headOfState: "Sultan" },
    powerBlocs: [{ id: "royal-house", name: "Royal House" }],
  };
  const needs = assessPoliticalGenerationNeeds(actor, POLITICAL_GENERATION_DEPTHS.STANDARD);
  assert.deepEqual(needs, [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE]);

  const completed = completeGeneratedPoliticalLandscapePatch(actor, {
    powerBlocs: [{ id: "royal-house", influence: { percent: 100, basis: "generated-estimate" } }],
  });
  assert.equal(completed.patch.powerBlocs[0].influence.percent, 100);
});

test("governing-alignment repair may fill normalized empty government party refs only when explicitly enabled", () => {
  const existing = {
    polityKey: "Federal Republic of Germany",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: {
      form: "Federal parliamentary republic",
      headOfGovernment: "Angela Merkel",
      rulingPartyIds: [],
      coalitionPartyIds: [],
    },
    parties: [
      { id: "cdu-csu", name: "CDU/CSU" },
      { id: "spd", name: "SPD" },
    ],
  };
  const patch = { government: { rulingPartyIds: ["cdu-csu"], coalitionPartyIds: ["spd"] } };

  const ordinary = mergeMissingPoliticalActor(existing, patch);
  assert.deepEqual(ordinary.actor.government.rulingPartyIds, []);
  assert.deepEqual(ordinary.actor.government.coalitionPartyIds, []);
  assert.deepEqual(ordinary.appliedPaths, []);

  const repair = mergeMissingPoliticalActor(existing, patch, { fillEmptyGovernmentPartyRefs: true });
  assert.deepEqual(repair.actor.government.rulingPartyIds, ["cdu-csu"]);
  assert.deepEqual(repair.actor.government.coalitionPartyIds, ["spd"]);
  assert.deepEqual(repair.appliedPaths, ["government.rulingPartyIds", "government.coalitionPartyIds"]);
});

test("governing-alignment repair never overwrites existing non-empty canonical party refs", () => {
  const existing = {
    polityKey: "Republic X",
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: {
      form: "Parliamentary republic",
      rulingPartyIds: ["incumbent"],
      coalitionPartyIds: ["partner"],
    },
    parties: [
      { id: "incumbent", name: "Incumbent" },
      { id: "partner", name: "Partner" },
      { id: "opposition", name: "Opposition" },
    ],
  };
  const repair = mergeMissingPoliticalActor(existing, {
    government: { rulingPartyIds: ["opposition"], coalitionPartyIds: ["opposition"] },
  }, { fillEmptyGovernmentPartyRefs: true });
  assert.deepEqual(repair.actor.government.rulingPartyIds, ["incumbent"]);
  assert.deepEqual(repair.actor.government.coalitionPartyIds, ["partner"]);
  assert.deepEqual(repair.appliedPaths, []);
});

test("external reference dates obey an exclusive divergence authority instead of the later target date", () => {
  const result = validatePoliticalGenerationProposal({
    schemaVersion: 1,
    polityKey: "Polity X",
    scenarioDate: "2014-03-22",
    depth: "standard",
    provenance: {
      source: "generated",
      confidence: "high",
    },
    sourceAsOf: "2008-01-01",
    referenceDates: ["1963-11-21"],
    actorPatch: {
      politicalSystem: { type: "republic", representation: "none" },
      government: { form: "Republic", headOfState: "Leader X" },
    },
  }, {
    polityKey: "Polity X",
    scenarioDate: "2014-03-22",
    historyAuthority: {
      referenceAllowed: true,
      cutoffDate: "1963-11-22",
      cutoffInclusive: false,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("reference date 2008-01-01") && error.includes("before 1963-11-22")));
  assert.equal(result.errors.some((error) => error.includes("1963-11-21")), false);
});
