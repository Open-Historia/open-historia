import test from "node:test";
import assert from "node:assert/strict";

import {
  POLITICAL_WORLD_GENERATION_TOOL,
  POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL,
  POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE,
  POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE,
  POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL,
  POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE,
  POLITICAL_WORLD_LANDSCAPE_FAST_TOOL,
  buildPoliticalWorldGenerationPrompt,
  buildPoliticalWorldLandscapeFastPrompt,
  buildPoliticalWorldHistoricalVerificationPrompt,
  buildPoliticalWorldTemporalSentinelPrompt,
  generatePoliticalWorldProposalsCore,
  reverifyPoliticalWorldProposalsCore,
} from "./politicalWorldGeneratorCore.js";
import { toGeminiSchema } from "./geminiSchema.js";
import { POLITICAL_GENERATION_NEEDS } from "../../runtime/politicalWorldGeneration.js";

const fixedNow = "2026-09-06T00:00:00Z";

test("Phase006B tool keeps the provider envelope shallow while native code owns date/depth/provenance", () => {
  assert.equal(POLITICAL_WORLD_GENERATION_TOOL.name, "submit_political_world_generation");
  assert.equal(POLITICAL_WORLD_GENERATION_TOOL.schema.properties.proposals.maxItems, 12);
  const proposal = POLITICAL_WORLD_GENERATION_TOOL.schema.properties.proposals.items;
  assert.ok(proposal.properties.polityKey);
  assert.ok(proposal.properties.actorPatchJson);
  assert.equal(proposal.properties.scenarioDate, undefined);
  assert.equal(proposal.properties.depth, undefined);
  assert.equal(proposal.properties.provenance, undefined);
});


test("Phase006D quantitative-landscape fast tool batches forty-eight compact existing actors", () => {
  assert.equal(POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE, 48);
  assert.equal(POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name, "submit_political_world_quantitative_landscapes");
  assert.equal(POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.schema.properties.landscapes.maxItems, 48);
  const row = POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.schema.properties.landscapes.items;
  assert.deepEqual(row.required, ["polityKey", "landscapeJson"]);
  assert.ok(row.properties.landscapeJson);
  assert.equal(row.properties.actorPatchJson, undefined);
});

test("Phase006D quantitative-landscape fast prompt carries only compact existing political context", () => {
  const { systemPrompt, userMessage } = buildPoliticalWorldLandscapeFastPrompt({
    scenarioDate: "2014-03-22",
    items: [{ polityKey: "Federal Republic of Germany", needs: [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE] }],
    politicalActors: { byPolity: {
      "Federal Republic of Germany": {
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Federal parliamentary republic", headOfGovernment: "Angela Merkel", rulingPartyIds: ["cdu-csu"], coalitionPartyIds: ["spd"] },
        parties: [
          { id: "cdu-csu", name: "CDU/CSU", ideology: "Christian democracy" },
          { id: "spd", name: "SPD", ideology: "Social democracy" },
        ],
        goals: ["This must not be serialized in the lightweight backfill."],
      },
    } },
  });
  assert.match(systemPrompt, /lightweight support\/influence backfill/i);
  assert.match(userMessage, /REPRESENTATION: electoral/);
  assert.match(userMessage, /cdu-csu \| CDU\/CSU \| ruling/);
  assert.match(userMessage, /spd \| SPD \| coalition/);
  assert.doesNotMatch(userMessage, /This must not be serialized/);
});

test("Political World tool stays shallow after Gemini schema conversion", () => {
  const converted = toGeminiSchema(POLITICAL_WORLD_GENERATION_TOOL.schema);
  const proposal = converted.properties.proposals.items;
  assert.equal(proposal.properties.actorPatchJson.type, "string");
  assert.equal(proposal.properties.actorPatch, undefined);
  assert.deepEqual(proposal.required, ["polityKey", "confidence", "sourceAsOf", "referenceDates", "actorPatchJson"]);

  const objectDepth = (value, depth = 0) => {
    if (!value || typeof value !== "object") return depth;
    const children = Array.isArray(value) ? value : Object.values(value);
    return children.reduce((max, child) => Math.max(max, objectDepth(child, depth + 1)), depth);
  };
  assert.ok(objectDepth(converted) <= 8, "Gemini political-generation tool must remain deliberately shallow");
});

test("live shallow tool actorPatchJson parses into canonical Political Actor state", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Algeria"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Algeria",
      confidence: "moderate",
      sourceAsOf: "2014-03-20",
      referenceDates: ["2014-03-20"],
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic" },
        parties: [{ id: "fln", name: "National Liberation Front" }],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.equal(result.proposals[0].validation.actor.politicalSystem.representation, "electoral");
  assert.equal(result.proposals[0].validation.actor.parties[0].id, "fln");
});

test("provider wire arrays for response issues and perceptions canonicalize before Phase006A validation", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { globalPower: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", ideology: "Civic republicanism" },
        parties: [{
          id: "civic-union",
          name: "Civic Union",
          politicalResponse: {
            organization: 70,
            issues: [{ issue: "security", position: 25, sensitivity: 60, strainResponse: 10 }],
          },
        }],
        traits: { riskTolerance: 55 },
        goals: ["Preserve constitutional government"],
        perceptions: { entries: [{ target: "Neighbor Y", threat: 65, cohesionEstimate: 40 }] },
        domesticPressures: ["Regional autonomy debate"],
      },
    }] } }),
  });

  assert.equal(result.generatedPolities, 1);
  const actor = result.proposals[0].validation.actor;
  assert.equal(actor.parties[0].politicalResponse.issues.security.position, 25);
  assert.equal(actor.perceptions["Neighbor Y"].threat, 65);
});

test("batch progress reports overall resolution and a live sample validation error", async () => {
  const updates = [];
  await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Algeria"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [{ polityKey: "Algeria", actorPatch: {} }] } }),
    onBatch: (update) => updates.push(update),
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].resolvedPolities, 1);
  assert.equal(updates[0].totalPolities, 1);
  assert.equal(updates[0].totalBatches, 1);
  assert.equal(updates[0].sampleError.polityKey, "Algeria");
  assert.ok(updates[0].sampleError.errors.some((entry) => entry.includes("proposal did not satisfy requested need political_system")));
});

test("bounded prompt excludes derived runtime politics and carries only requested canonical context", () => {
  const prompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2067-04-19",
    items: [{ polityKey: "Kingdom of Poland", depth: "rich", needs: ["structured_leadership_traits"] }],
    politicalActors: {
      byPolity: {
        "Kingdom of Poland": {
          government: { form: "Constitutional monarchy", ideology: "Constitutional royalism" },
          traits: {},
          behavioralDisposition: { assertiveness: 99 },
          politicalPressures: { issues: { security: { salience: 88 } } },
        },
      },
    },
    scenarioContext: "A fictional 2067 European settlement.",
  });
  assert.match(prompt.systemPrompt, /2067-04-19/);
  assert.match(prompt.userMessage, /Constitutional monarchy/);
  assert.doesNotMatch(prompt.userMessage, /assertiveness/);
  assert.doesNotMatch(prompt.userMessage, /security.*salience/);
  assert.match(prompt.userMessage, /structured_leadership_traits/);
  assert.match(prompt.userMessage, /ACTORPATCH SCOPE THIS CALL.*top-level keys: traits/i);
  assert.doesNotMatch(prompt.userMessage, /ACTORPATCH SCOPE THIS CALL[^\n]*party keys:/i);
});

test("actual generation handles historical monarchy and future fictional polity through the same validated seam", async () => {
  const calls = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-04-19",
    polities: ["Kingdom of Poland", "Lunar Free State"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: {
      "Kingdom of Poland": { globalPower: true },
      "Lunar Free State": { sovereign: false },
    },
    maxBatchSize: 2,
    generatedAt: fixedNow,
    callModel: async (system, history, opts) => {
      calls.push({ system, history, opts });
      return {
        toolInput: {
          proposals: [
            {
              polityKey: "Kingdom of Poland",
              confidence: "moderate",
              actorPatch: {
                politicalSystem: { type: "constitutional_monarchy", representation: "electoral" },
                government: { form: "Constitutional monarchy", ideology: "Constitutional royalism" },
                parties: [{ id: "civic-league", name: "Civic League", politicalResponse: { organization: 65, issues: { reform: { position: 30, sensitivity: 55, strainResponse: 15 } } } }],
                traits: { riskTolerance: 48 },
                goals: ["Preserve the constitutional settlement"],
                perceptions: { eastern_neighbor: { threat: 55 } },
                domesticPressures: ["Federal autonomy debate"],
              },
            },
            {
              polityKey: "Lunar Free State",
              confidence: "low",
              actorPatch: {
                politicalSystem: { type: "administrative_republic", representation: "none" },
              },
            },
          ],
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.taskKey, "politicalWorldGeneration");
  assert.equal(calls[0].opts.tool.name, "submit_political_world_generation");
  assert.equal(result.generatedPolities, 2);
  assert.equal(result.failedPolities, 0);
  const poland = result.proposals.find((entry) => entry.item.polityKey === "Kingdom of Poland");
  assert.equal(poland.proposal.scenarioDate, "2067-04-19");
  assert.equal(poland.proposal.depth, "full");
  assert.equal(poland.proposal.provenance.source, "generated");
  assert.equal(poland.proposal.provenance.generatedAt, fixedNow);
  assert.equal(poland.validation.actor.behavioralDisposition, undefined);
});

test("invalid polity retries only the unresolved proposal and preserves the valid result", async () => {
  let call = 0;
  const seenUserMessages = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "1867-01-01",
    polities: ["Russian Empire", "Kingdom of Italy"],
    politicalActors: { byPolity: {} },
    maxBatchSize: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      call += 1;
      seenUserMessages.push(history[0].parts[0].text);
      if (call === 1) {
        return { toolInput: { proposals: [
          {
            polityKey: "Kingdom of Italy",
            actorPatch: {
              politicalSystem: { type: "constitutional_monarchy", representation: "electoral" },
              government: { form: "Constitutional monarchy" },
              parties: [{ id: "historical-right", name: "Historical Right" }],
            },
          },
          {
            polityKey: "Russian Empire",
            sourceAsOf: "1870-01-01",
            actorPatch: {
              politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
              government: { form: "Absolute monarchy" },
              powerBlocs: [{ id: "imperial-court", name: "Imperial Court" }],
            },
          },
        ] } };
      }
      return { toolInput: { proposals: [{
        polityKey: "Russian Empire",
        sourceAsOf: "1866-12-01",
        actorPatch: {
          politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
          government: { form: "Absolute monarchy" },
          powerBlocs: [{ id: "imperial-court", name: "Imperial Court" }],
        },
      }] } };
    },
  });

  assert.equal(call, 2);
  assert.equal(result.generatedPolities, 2);
  assert.equal(result.failedPolities, 0);
  assert.match(seenUserMessages[1], /Russian Empire/);
  assert.doesNotMatch(seenUserMessages[1], /POLITY: Kingdom of Italy/);
  assert.match(seenUserMessages[1], /crosses the scenario-date boundary/);
});

test("unrequested extras are projected away instead of rejecting an otherwise valid requested patch", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: ["Republic X"],
    politicalActors: {
      byPolity: {
        "Republic X": {
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: {
            form: "Parliamentary republic",
            ideology: "Civic liberalism",
            headOfGovernment: { name: "A. Example" },
          },
          parties: [{
            id: "unity",
            name: "Unity",
            politicalResponse: { organization: 60 },
          }],
          goals: ["Maintain stability"],
        },
      },
    },
    relevanceByPolity: { "Republic X": { regionalPower: true } },
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatch: {
        traits: { riskTolerance: 45 },
        government: { type: "parliamentary_republic", leader: "A. Example" },
        tags: ["AI broadened scope"],
      },
    }] } }),
  });
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.deepEqual(result.proposals[0].proposal.actorPatch, {
    traits: { riskTolerance: 45 },
    parties: [{
      id: "unity",
      name: "Unity",
      support: { percent: 100, basis: "native-fallback-estimate" },
    }],
  });
  assert.ok(result.warnings.some((warning) => warning.includes("actorPatch.government")));
  assert.ok(result.warnings.some((warning) => warning.includes("actorPatch.tags")));
});

test("response-profile requests explicitly name every existing entity still missing a profile", async () => {
  const seen = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["United States of America"],
    politicalActors: {
      byPolity: {
        "United States of America": {
          politicalSystem: { type: "presidential_republic", representation: "electoral" },
          government: {
            form: "Presidential republic",
            ideology: "Liberal democratic",
            headOfState: { name: "President Example" },
          },
          parties: [
            { id: "democratic-party", name: "Democratic Party" },
            { id: "republican-party", name: "Republican Party", politicalResponse: { organization: 70 } },
          ],
          traits: { riskTolerance: 45 },
          goals: ["Maintain global alliances"],
        },
      },
    },
    relevanceByPolity: { "United States of America": { regionalPower: true } },
    maxAttempts: 1,
    callModel: async (_system, history) => {
      seen.push(history[0].parts[0].text);
      return { toolInput: { proposals: [{
        polityKey: "United States of America",
        actorPatch: {
          parties: [{
            id: "democratic-party",
            name: "Democratic Party",
            politicalResponse: { organization: 72, credibility: 68 },
          }],
        },
      }] } };
    },
  });
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.match(seen[0], /RESPONSE PROFILE TARGET IDS: parties -> democratic-party/);
  assert.doesNotMatch(seen[0], /republican-party.*Return exact id\/name plus politicalResponse/);
});

test("generation never mutates existing Political Actors while producing review proposals", async () => {
  const politicalActors = {
    byPolity: {
      "Republic X": {
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic" },
      },
    },
  };
  const before = JSON.stringify(politicalActors);
  await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: ["Republic X"],
    politicalActors,
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatch: { parties: [{ id: "unity", name: "Unity" }] },
    }] } }),
  });
  assert.equal(JSON.stringify(politicalActors), before);
});

test("text-json fallback is still validated when a provider cannot land a tool call", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: [{ polityKey: "Station Authority", sovereign: false }],
    maxAttempts: 1,
    callModel: async () => ({ rawText: JSON.stringify({ proposals: [{
      polityKey: "Station Authority",
      confidence: "low",
      actorPatch: { politicalSystem: { type: "appointed_administration", representation: "none" } },
    }] }) }),
  });
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
});

test("a politically complete world causes zero AI calls", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: ["Republic X"],
    politicalActors: { byPolity: { "Republic X": {
      politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
      government: { form: "Parliamentary republic", ideology: "Civic liberalism", headOfGovernment: "A. Example", approval: 60, stability: 70 },
      parties: [{
        id: "unity",
        name: "Unity",
        support: { percent: 55 },
        politicalResponse: { organization: 60, issues: { reform: { position: 20, sensitivity: 50 } } },
      }],
      traits: { riskTolerance: 50 },
      goals: ["Maintain stability"],
      perceptions: { rival: { threat: 40 } },
      domesticPressures: ["Housing costs"],
    } } },
    relevanceByPolity: { "Republic X": { globalPower: true } },
    callModel: async () => { calls += 1; return { toolInput: { proposals: [] } }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.plan.items.length, 0);
});

test("duplicate proposals for one polity are rejected as ambiguous", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: [{ polityKey: "Station Authority", sovereign: false }],
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [
      { polityKey: "Station Authority", actorPatch: { politicalSystem: { type: "appointed_administration", representation: "none" } } },
      { polityKey: "Station Authority", actorPatch: { politicalSystem: { type: "military_regime", representation: "military_factions" } } },
    ] } }),
  });
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.ok(result.failures[0].errors.some((error) => error.includes("duplicate proposals")));
});

test("review-authorized roster expansion can generate into an explicitly authored closed roster without overwriting existing fields", async () => {
  const prompts = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-01-01",
    polities: ["Republic X"],
    politicalActors: { byPolity: { "Republic X": {
      politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
      government: { form: "Parliamentary republic" },
      parties: [],
    } } },
    allowEntityExpansionByPolity: { "Republic X": true },
    maxAttempts: 1,
    callModel: async (_system, history) => {
      prompts.push(history[0].parts[0].text);
      return { toolInput: { proposals: [{
        polityKey: "Republic X",
        actorPatch: {
          parties: [{ id: "reform-league", name: "Reform League" }],
          government: { rulingPartyIds: ["reform-league"] },
        },
      }] } };
    },
  });
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.match(prompts[0], /ROSTER REVIEW AUTHORIZATION/);
  assert.equal(result.proposals[0].validation.actor.parties[0].id, "reform-league");
  assert.equal(result.proposals[0].validation.actor.government.form, "Parliamentary republic");
});

test("live model government aliases and nested political-system extras are normalized/projected instead of rejecting valid governing structure", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Australia"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Australia",
      actorPatchJson: JSON.stringify({
        politicalSystem: {
          type: "parliamentary_constitutional_monarchy",
          representation: "electoral",
          executiveType: "parliamentary",
          legislature: "Parliament of Australia",
        },
        government: {
          type: "Parliamentary constitutional monarchy",
          leader: "Tony Abbott",
        },
        parties: [
          { id: "liberal-party", name: "Liberal Party of Australia", status: "governing" },
          { id: "australian-labor-party", name: "Australian Labor Party", status: "opposition" },
        ],
      }),
    }] } }),
  });
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.government.form, "Parliamentary constitutional monarchy");
  assert.equal(patch.government.headOfGovernment, "Tony Abbott");
  assert.equal(patch.politicalSystem.executiveType, undefined);
  assert.equal(patch.politicalSystem.legislature, undefined);
  assert.equal(patch.parties[0].status, undefined, "party-only unsupported status is discarded instead of reaching Phase006A");
});

test("governing structure can be deterministically mirrored from politicalSystem when model omits duplicate government.form", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Kosovo"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic of Kosovo",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        parties: [{ id: "pdk", name: "Democratic Party of Kosovo" }],
      }),
    }] } }),
  });
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.match(result.proposals[0].proposal.actorPatch.government.form, /Parliamentary republic/i);
});

test("strategic-context retry explains both required halves and accepts the corrected second attempt", async () => {
  const prompts = [];
  let call = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Poland"],
    politicalActors: {
      byPolity: {
        "Republic of Poland": {
          politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
          government: { form: "Parliamentary republic", headOfGovernment: "Donald Tusk" },
          parties: [{ id: "po", name: "Platforma Obywatelska", politicalResponse: { organization: 70 } }],
          traits: { caution: 55 },
        },
      },
    },
    relevanceByPolity: { "Republic of Poland": { regionalPower: true } },
    maxAttempts: 2,
    callModel: async (_system, history) => {
      call += 1;
      prompts.push(history[0].parts[0].text);
      if (call === 1) return { toolInput: { proposals: [{
        polityKey: "Republic of Poland",
        actorPatch: { goals: ["Strengthen eastern security"] },
      }] } };
      return { toolInput: { proposals: [{
        polityKey: "Republic of Poland",
        actorPatch: {
          government: { ideology: "Centrist liberal, pro-European coalition" },
          goals: ["Strengthen eastern security"],
        },
      }] } };
    },
  });
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(call, 2);
  assert.match(prompts[1], /government\.ideology AND at least one goals\/fears\/ambitions/i);
});

test("generation diagnostics retain requested needs, raw proposal, projected patch, dropped paths, and final errors", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["United Kingdom"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "United Kingdom",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "constitutional_monarchy", representation: "electoral", legislatureName: "Parliament" },
        government: { form: "Constitutional monarchy" },
      }),
    }] } }),
  });
  assert.equal(result.diagnostics.length, 1);
  const attempt = result.diagnostics[0];
  assert.equal(attempt.requested[0].polityKey, "United Kingdom");
  const polity = attempt.polities.find((entry) => entry.polityKey === "United Kingdom");
  assert.ok(polity.rawProposal.actorPatchJson);
  assert.ok(polity.droppedPaths.includes("actorPatch.politicalSystem.legislatureName"));
  assert.equal(polity.projectedActorPatch.politicalSystem.legislatureName, undefined);
  assert.ok(Array.isArray(polity.errors));
});

test("live strategicContext alias is flattened before scope projection and avoids a needless retry", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["People's Republic of China"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "People's Republic of China": { regionalPower: true } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      return { toolInput: { proposals: [{
        polityKey: "People's Republic of China",
        actorPatchJson: JSON.stringify({
          politicalSystem: {
            type: "single-party socialist republic",
            representation: "non-competitive vanguard party apparatus",
          },
          government: {
            form: "Single-party socialist republic under the Chinese Communist Party",
            headOfState: "Xi Jinping",
            headOfGovernment: "Li Keqiang",
            ideology: "Socialism with Chinese characteristics",
          },
          powerBlocs: [{
            id: "ccp_apparatus",
            name: "Chinese Communist Party Leadership",
            role: "Ruling vanguard apparatus",
            politicalResponse: {
              organization: 95,
              issues: {
                stability: { position: 90, sensitivity: 90, strainResponse: 50 },
              },
            },
          }],
          traits: { caution: 70, pragmatism: 80 },
          strategicContext: {
            goals: ["Maintain internal stability"],
            fears: ["Large-scale political unrest"],
            ambitions: ["Sustain national modernization"],
          },
        }),
      }] } };
    },
  });

  assert.equal(calls, 1, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.deepEqual(patch.goals, ["Maintain internal stability"]);
  assert.equal(patch.strategicContext, undefined);
  assert.equal(patch.politicalSystem.type, "one_party_state");
  assert.equal(patch.politicalSystem.representation, "party_state");
  assert.equal(patch.powerBlocs[0].kind, "Ruling vanguard apparatus");
});

test("live domesticContext alias satisfies domestic_context before scope projection", async (t) => {
  for (const entry of [
    {
      name: "approval and stability wrapper from the first US attempt",
      domesticContext: { stability: 80, approval: 45 },
      expectedPressures: undefined,
    },
    {
      name: "approval, stability, and pressures wrapper from the corrective US attempt",
      domesticContext: {
        stability: 80,
        approval: 45,
        pressures: [
          "Congressional polarization and gridlock",
          "Public fatigue over foreign military interventions",
        ],
      },
      expectedPressures: [
        "Congressional polarization and gridlock",
        "Public fatigue over foreign military interventions",
      ],
    },
  ]) {
    await t.test(entry.name, async () => {
      let calls = 0;
      const result = await generatePoliticalWorldProposalsCore({
        scenarioDate: "2014-03-22",
        polities: ["United States of America"],
        politicalActors: { byPolity: {} },
        relevanceByPolity: { "United States of America": { player: true, globalPower: true } },
        maxAttempts: 2,
        generatedAt: fixedNow,
        callModel: async () => {
          calls += 1;
          return { toolInput: { proposals: [{
            polityKey: "United States of America",
            confidence: "high",
            sourceAsOf: "2014-03-22",
            referenceDates: ["2014-03-22"],
            actorPatchJson: JSON.stringify({
              politicalSystem: { type: "presidential_republic", representation: "electoral" },
              government: {
                form: "Federal presidential constitutional republic",
                headOfState: "Barack Obama",
                headOfGovernment: "Barack Obama",
                ideology: "Liberal internationalism",
                rulingPartyIds: ["democratic-party"],
              },
              leader: "Barack Obama",
              traits: { caution: 70, pragmatism: 65 },
              goals: ["Strengthen transatlantic alliance cohesion"],
              fears: ["Broad military escalation in Eastern Europe"],
              ambitions: ["Promote global norms against territorial conquest"],
              perceptions: {
                "Russian Federation": { threat: 65, opportunity: 15, weakness: 40, cohesionEstimate: 75 },
              },
              domesticContext: entry.domesticContext,
              parties: [{
                id: "democratic-party",
                name: "Democratic Party",
                politicalResponse: {
                  organization: 80,
                  credibility: 75,
                  inertia: 50,
                  resilience: 75,
                  issues: { foreign_policy: { position: 30, sensitivity: 60, strainResponse: 40 } },
                },
              }],
            }),
          }] } };
        },
      });

      assert.equal(calls, 1, JSON.stringify(result.failures));
      assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
      assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
      const patch = result.proposals[0].proposal.actorPatch;
      assert.equal(patch.domesticContext, undefined);
      assert.equal(patch.government.approval, 45);
      assert.equal(patch.government.stability, 80);
      assert.deepEqual(patch.domesticPressures, entry.expectedPressures);
      assert.equal(result.diagnostics[0].polities[0].droppedPaths.includes("actorPatch.domesticContext"), false);
    });
  }
});

test("domesticContext alias never overwrites canonical domestic fields", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { isPlayer: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: {
          form: "Presidential republic",
          headOfState: "Leader X",
          headOfGovernment: "Leader X",
          ideology: "Civic republicanism",
          approval: 61,
          stability: 73,
        },
        traits: { pragmatism: 70 },
        goals: ["Maintain stability"],
        perceptions: { "Neighbor Y": { threat: 20 } },
        domesticPressures: ["Canonical pressure"],
        domesticContext: {
          approval: 12,
          stability: 19,
          pressures: ["Alias pressure must not win"],
        },
        parties: [{
          id: "civic-party",
          name: "Civic Party",
          politicalResponse: {
            organization: 70,
            issues: { security: { position: 20, sensitivity: 60, strainResponse: 10 } },
          },
        }],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.deepEqual(patch.domesticPressures, ["Canonical pressure"]);
  assert.equal(patch.government.approval, 61);
  assert.equal(patch.government.stability, 73);
  assert.equal(patch.domesticContext, undefined);
});

test("generation prompt explicitly forbids the non-canonical domesticContext wrapper", () => {
  const prompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    items: [{ polityKey: "United States of America", depth: "full", needs: ["domestic_context"] }],
    politicalActors: { byPolity: {} },
  });
  assert.match(prompt.systemPrompt, /domestic_context.*domesticPressures/i);
  assert.match(prompt.systemPrompt, /Never create an actorPatch\.domesticContext wrapper/i);
});

test("generated Round-Zero support is retained only as an explicitly approximate baseline", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Australia"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { Australia: { regionalPower: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Australia",
      actorPatchJson: JSON.stringify({
        politicalSystem: {
          type: "Federal parliamentary constitutional monarchy",
          representation: "competitive_democracy",
        },
        government: {
          form: "Federal parliamentary constitutional monarchy",
          headOfGovernment: "Tony Abbott",
          ideology: "Liberal conservatism",
          rulingParties: ["Liberal Party"],
        },
        parties: [{
          id: "liberal-party",
          name: "Liberal Party",
          support: { percent: 45 },
          ruling: true,
          politicalResponse: {
            organization: 80,
            issues: { economy: { position: 60, sensitivity: 70, strainResponse: 30 } },
          },
        }],
        traits: { caution: 65 },
        goals: ["Maintain regional alliances"],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.politicalSystem.type, "constitutional_monarchy");
  assert.equal(patch.politicalSystem.representation, "electoral");
  assert.deepEqual(patch.parties[0].support, { percent: 45, basis: "generated-estimate" });
  assert.deepEqual(patch.government.rulingPartyIds, ["liberal-party"]);
});

test("numeric politicalResponse issue shorthand is rejected and corrected on retry instead of silently degrading C2", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Belarus"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic of Belarus": { regionalPower: true } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      const issues = calls === 1
        ? { regime_survival: 100 }
        : { regime_survival: { position: 100, sensitivity: 100, strainResponse: 90 } };
      return { toolInput: { proposals: [{
        polityKey: "Republic of Belarus",
        actorPatchJson: JSON.stringify({
          politicalSystem: {
            type: "presidential authoritarian republic",
            representation: "executive-dominated single-person rule with weak pluralism",
          },
          government: {
            form: "Authoritarian presidential republic",
            headOfState: "Alexander Lukashenko",
            ideology: "Statist authoritarianism",
          },
          powerBlocs: [{
            id: "presidential-apparatus",
            name: "Presidential Administration",
            politicalResponse: { organization: 90, issues },
          }],
          traits: { caution: 75 },
          goals: ["Preserve regime stability"],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("numeric shorthand is not accepted")));
  assert.equal(result.proposals[0].proposal.actorPatch.powerBlocs[0].politicalResponse.issues.regime_survival.strainResponse, 90);
});

test("top-level representation entity aliases are routed into canonical power blocs before scope projection", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Arab Republic of Egypt"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Arab Republic of Egypt": { regionalPower: true } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      return { toolInput: { proposals: [{
        polityKey: "Arab Republic of Egypt",
        actorPatchJson: JSON.stringify({
          politicalSystem: { type: "military_transition", representation: "military_factions" },
          government: {
            form: "Interim Presidential Republic under Military Oversight",
            headOfState: "Adly Mansour",
            headOfGovernment: "Ibrahim Mahlab",
            ideology: "Secular nationalism and military guardianship",
          },
          representation: [{
            id: "egyptian_armed_forces",
            name: "Egyptian Armed Forces",
            type: "military_factions",
            politicalResponse: {
              organization: 95,
              issues: { security: { position: 90, sensitivity: 95, strainResponse: 80 } },
            },
          }],
          traits: { militarism: 80, caution: 50 },
          goals: ["Restore internal security"],
        }),
      }] } };
    },
  });

  assert.equal(calls, 1, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.representation, undefined);
  assert.equal(patch.powerBlocs.length, 1);
  assert.equal(patch.powerBlocs[0].id, "egyptian_armed_forces");
  assert.equal(patch.powerBlocs[0].kind, "military_factions");
});

test("representation enum accidentally placed in politicalSystem.type is replaced by a real system type", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Pridnestrovian Moldavian Republic"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Pridnestrovian Moldavian Republic": { regionalPower: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Pridnestrovian Moldavian Republic",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "elite_factions", representation: "elite_factions" },
        government: {
          form: "Semi-presidential republic under de facto independence",
          headOfState: "Yevgeny Shevchuk",
          ideology: "Pridnestrovian regionalism",
        },
        powerBlocs: [{
          id: "sheriff_holding",
          name: "Sheriff Holding",
          politicalResponse: {
            organization: 85,
            issues: { economic_survival: { position: 50, sensitivity: 80, strainResponse: 50 } },
          },
        }],
        traits: { pragmatism: 75 },
        goals: ["Maintain de facto independence"],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const system = result.proposals[0].proposal.actorPatch.politicalSystem;
  assert.equal(system.type, "semi_presidential_republic");
  assert.equal(system.representation, "elite_factions");
});

test("existing response-profile targets can return stable id plus response without repeating display name", async () => {
  let calls = 0;
  const politicalActors = { byPolity: {
    "Republic of Poland": {
      polityKey: "Republic of Poland",
      politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
      government: { form: "Parliamentary republic", ideology: "Liberal-conservative coalition" },
      parties: [
        { id: "civic-platform", name: "Platforma Obywatelska" },
        { id: "law-and-justice", name: "Prawo i Sprawiedliwość" },
      ],
      traits: { caution: 70 },
      goals: ["Strengthen regional security"],
    },
  } };
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Poland"],
    politicalActors,
    relevanceByPolity: { "Republic of Poland": { regionalPower: true } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      const prompt = history?.[0]?.parts?.[0]?.text ?? "";
      assert.match(prompt, /display name does not need to be repeated/i);
      return { toolInput: { proposals: [{
        polityKey: "Republic of Poland",
        actorPatchJson: JSON.stringify({
          parties: [
            { id: "civic-platform", politicalResponse: { organization: 80 } },
            { id: "law-and-justice", politicalResponse: { organization: 85 } },
          ],
        }),
      }] } };
    },
  });

  assert.equal(calls, 1, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.parties[0].name, undefined);
  assert.equal(patch.parties[0].politicalResponse.organization, 80);
});

test("generation prompt reserves party_state for genuine party-state systems", () => {
  const prompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    items: [{ polityKey: "Republic of Cameroon", depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] }],
    politicalActors: { byPolity: {} },
  });
  assert.match(prompt.systemPrompt, /party_state is reserved for genuine one-party\/vanguard-party state structures/i);
  assert.match(prompt.systemPrompt, /dominant-party republic that still has meaningful opposition parties/i);
  assert.match(prompt.systemPrompt, /parties and\/or powerBlocs for true party_state systems/i);
});

test("corrective retry freezes a valid political system instead of morphing dominant-party regimes into party_state", async (t) => {
  const cases = [
    { polityKey: "Algeria", headOfState: "Abdelaziz Bouteflika", rulingName: "National Liberation Front" },
    { polityKey: "Republic of Azerbaijan", headOfState: "Ilham Aliyev", rulingName: "New Azerbaijan Party" },
    { polityKey: "Republic of Cameroon", headOfState: "Paul Biya", rulingName: "Cameroon People's Democratic Movement" },
  ];

  for (const entry of cases) {
    await t.test(entry.polityKey, async () => {
      let calls = 0;
      const result = await generatePoliticalWorldProposalsCore({
        scenarioDate: "2014-03-22",
        polities: [entry.polityKey],
        politicalActors: { byPolity: {} },
        maxAttempts: 2,
        generatedAt: fixedNow,
        callModel: async (_system, history) => {
          calls += 1;
          const prompt = history?.[0]?.parts?.[0]?.text ?? "";
          if (calls === 2) {
            assert.match(prompt, /POLITICAL SYSTEM LOCK/i);
            assert.match(prompt, /representation=elite_factions/i);
            assert.match(prompt, /representation_entities failed.*repair the representation entity collection\/shape/i);
          }
          return { toolInput: { proposals: [{
            polityKey: entry.polityKey,
            actorPatchJson: JSON.stringify(calls === 1 ? {
              politicalSystem: {
                type: "presidential_republic",
                representation: "elite_factions",
              },
              government: {
                form: "Dominant-party presidential republic",
                headOfState: entry.headOfState,
              },
              // Deliberately wrong collection for elite_factions; this should trigger
              // representation_entities without invalidating the regime classification.
              parties: [{ id: "ruling-party", name: entry.rulingName }],
            } : {
              // Deliberately ignore the prompt and try to make the retry easier by
              // changing the regime into party_state. Native code must restore the lock.
              politicalSystem: {
                type: "one_party_state",
                representation: "party_state",
              },
              government: {
                form: "Dominant-party presidential republic",
                headOfState: entry.headOfState,
              },
              powerBlocs: [{ id: "presidential-establishment", name: `${entry.rulingName} / Presidential Establishment` }],
            }),
          }] } };
        },
      });

      assert.equal(calls, 2, JSON.stringify(result.failures));
      assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
      assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
      assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("representation_entities")));
      assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, {
        type: "presidential_republic",
        representation: "elite_factions",
      });
      const system = result.proposals[0].proposal.actorPatch.politicalSystem;
      assert.equal(system.type, "presidential_republic");
      assert.equal(system.representation, "elite_factions");
      assert.equal(result.proposals[0].proposal.actorPatch.powerBlocs.length, 1);
      assert.ok(result.warnings.some((warning) => warning.includes("Ignored corrective retry politicalSystem mutation")));
    });
  }
});

test("a genuinely invalid political system is not frozen and may be repaired on retry", async () => {
  let calls = 0;
  const prompts = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      prompts.push(history?.[0]?.parts?.[0]?.text ?? "");
      return { toolInput: { proposals: [{
        polityKey: "Republic X",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: { type: "unspecified", representation: "none" },
          government: { headOfState: "Leader X" },
        } : {
          politicalSystem: { type: "presidential_republic", representation: "electoral" },
          government: { form: "Presidential republic", headOfState: "Leader X" },
          parties: [{ id: "civic-party", name: "Civic Party" }],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.doesNotMatch(prompts[1], /POLITICAL SYSTEM LOCK/i);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.representation, "electoral");
});

test("genuine party_state classifications remain unchanged across unrelated corrective retries", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["People's Republic of China"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "People's Republic of China": { regionalPower: true } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      return { toolInput: { proposals: [{
        polityKey: "People's Republic of China",
        actorPatchJson: JSON.stringify({
          politicalSystem: { type: "one_party_state", representation: "party_state" },
          government: {
            form: "Single-party socialist republic",
            headOfState: "Xi Jinping",
            headOfGovernment: "Li Keqiang",
            ideology: "Socialism with Chinese characteristics",
          },
          powerBlocs: [{
            id: "ccp",
            name: "Chinese Communist Party",
            politicalResponse: calls === 1
              ? { organization: 95, issues: { sovereignty: 90 } }
              : { organization: 95, issues: { sovereignty: { position: 90, sensitivity: 95, strainResponse: 70 } } },
          }],
          traits: { pragmatism: 60 },
          goals: ["Preserve party rule"],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const system = result.proposals[0].proposal.actorPatch.politicalSystem;
  assert.equal(system.type, "one_party_state");
  assert.equal(system.representation, "party_state");
  assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, {
    type: "one_party_state",
    representation: "party_state",
  });
});


test("Ethiopia retry locks a valid dominant-party type while correcting only representation", async () => {
  let calls = 0;
  const prompts = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Ethiopia"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      prompts.push(history?.[0]?.parts?.[0]?.text ?? "");
      return { toolInput: { proposals: [{
        polityKey: "Ethiopia",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: { type: "dominant_party_republic", representation: "party_state" },
          government: {
            form: "Federal Parliamentary Republic",
            headOfState: "Mulatu Teshome",
            headOfGovernment: "Hailemariam Desalegn",
          },
          parties: [{ id: "eprdf", name: "Ethiopian Peoples' Revolutionary Democratic Front" }],
        } : {
          // The provider still tries to rewrite the valid regime type. Native code
          // must keep the first attempt's type while allowing representation repair.
          politicalSystem: { type: "one_party_state", representation: "electoral" },
          government: {
            form: "Dominant-party federal parliamentary republic",
            headOfState: "Mulatu Teshome",
            headOfGovernment: "Hailemariam Desalegn",
          },
          parties: [
            { id: "eprdf", name: "Ethiopian Peoples' Revolutionary Democratic Front" },
            { id: "medrek", name: "Medrek" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.equal(result.diagnostics[0].polities[0].parsedActorPatch.politicalSystem.type, "dominant_party_republic");
  assert.equal(result.diagnostics[0].polities[0].parsedActorPatch.politicalSystem.representation, "party_state");
  assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("party_state")));
  assert.match(prompts[1], /POLITICAL SYSTEM LOCK \(FIELD LEVEL\): type=dominant_party_republic/i);
  assert.match(prompts[1], /representation is NOT locked and must be corrected/i);
  assert.match(prompts[1], /do NOT rewrite a valid dominant-party regime into one_party_state/i);
  const system = result.proposals[0].proposal.actorPatch.politicalSystem;
  assert.equal(system.type, "dominant_party_republic");
  assert.equal(system.representation, "electoral");
  assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, { type: "dominant_party_republic" });
  assert.ok(result.warnings.some((warning) => warning.includes("kept locked type=dominant_party_republic")));
});



test("one-party dominant provider wording remains negative evidence after core canonicalization", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Dominant Republic X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Dominant Republic X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "one-party dominant semi-presidential republic", representation: "party_state" },
        government: { form: "One-party semi-presidential republic", headOfState: "Leader X", headOfGovernment: "Leader X" },
        parties: [{ id: "ruling-party", name: "Ruling Party" }],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.ok(result.failures[0].errors.some((error) => /party_state requires explicit/i.test(error)), JSON.stringify(result.failures));
  assert.equal(result.diagnostics[0].polities[0].parsedActorPatch.politicalSystem.type, "dominant_party_republic");
});

test("literal Cuba, Eritrea, and Sahrawi one-party government forms satisfy party_state on the first attempt", async () => {
  let calls = 0;
  const payloads = {
    "Republic of Cuba": {
      politicalSystem: { type: "communist_state", representation: "party_state" },
      government: { form: "Single-party communist state", headOfState: "Raúl Castro", headOfGovernment: "Raúl Castro" },
      parties: [{ id: "pcc", name: "Communist Party of Cuba" }],
    },
    "State of Eritrea": {
      politicalSystem: { type: "party_state", representation: "party_state" },
      government: { form: "One-party presidential republic", headOfState: "Isaias Afwerki", headOfGovernment: "Isaias Afwerki" },
      parties: [{ id: "pfdj", name: "People's Front for Democracy and Justice" }],
    },
    "Sahrawi Arab Democratic Republic": {
      politicalSystem: { type: "party_state", representation: "party_state" },
      government: { form: "One-party semi-presidential republic", headOfState: "Mohamed Abdelaziz", headOfGovernment: "Abdelkader Taleb Omar" },
      parties: [{ id: "polisario-front", name: "Polisario Front" }],
    },
  };
  const polities = Object.keys(payloads);
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities,
    politicalActors: { byPolity: {} },
    maxBatchSize: 12,
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      return { toolInput: { proposals: polities.map((polityKey) => ({
        polityKey,
        actorPatchJson: JSON.stringify(payloads[polityKey]),
      })) } };
    },
  });

  assert.equal(calls, 1, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 3, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  for (const entry of result.proposals) {
    assert.equal(entry.proposal.actorPatch.politicalSystem.representation, "party_state", entry.item.polityKey);
  }
});

test("Sahrawi representation repair relocates a sole wrong retry roster into revolutionary powerBlocs", async () => {
  let calls = 0;
  const prompts = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Sahrawi Arab Democratic Republic"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      prompts.push(history?.[0]?.parts?.[0]?.text ?? "");
      return { toolInput: { proposals: [{
        polityKey: "Sahrawi Arab Democratic Republic",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: {
            type: "semi_presidential_republic",
            representation: "party_state",
          },
          government: {
            form: "dominant-party semi-presidential republic",
            headOfState: "Mohamed Abdelaziz",
            headOfGovernment: "Abdelkader Taleb Omar",
          },
          parties: [{ id: "polisario-front", name: "Polisario Front" }],
        } : {
          politicalSystem: {
            type: "semi_presidential_republic",
            representation: "revolutionary_factions",
          },
          government: {
            form: "Semi-presidential republic governed by the Polisario Front",
            headOfState: "Mohamed Abdelaziz",
            headOfGovernment: "Abdelkader Taleb Omar",
          },
          // Exact live regression: representation is repaired correctly but the
          // intended revolutionary roster is still placed under parties.
          parties: [{ id: "polisario_front", name: "Polisario Front", ideology: "National liberation" }],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("party_state")));
  assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, { type: "semi_presidential_republic" });
  assert.match(prompts[1], /REPRESENTATION REPAIR IS ATOMIC/i);
  assert.match(prompts[1], /revolutionary_factions\/colonial -> powerBlocs/i);
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.politicalSystem.type, "semi_presidential_republic");
  assert.equal(patch.politicalSystem.representation, "revolutionary_factions");
  assert.equal(patch.parties, undefined);
  assert.deepEqual(patch.powerBlocs.map((bloc) => bloc.id), ["polisario_front"]);
  assert.ok(result.warnings.some((warning) => warning.includes("moved parties -> powerBlocs") && warning.includes("revolutionary_factions")));
});

test("unlocked representation retry can symmetrically relocate a sole powerBloc roster into parties for electoral", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Dominant Republic X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async () => {
      calls += 1;
      return { toolInput: { proposals: [{
        polityKey: "Dominant Republic X",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: { type: "dominant_party_republic", representation: "party_state" },
          government: { form: "Dominant-party presidential republic", headOfState: "Leader X" },
          parties: [{ id: "ruling-party", name: "Ruling Party" }],
        } : {
          politicalSystem: { type: "dominant_party_republic", representation: "electoral" },
          government: { form: "Dominant-party presidential republic", headOfState: "Leader X" },
          powerBlocs: [{
            id: "ruling-party",
            name: "Ruling Party",
            kind: "party",
            influence: "dominant",
            status: "ruling",
          }],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.politicalSystem.representation, "electoral");
  assert.equal(patch.powerBlocs, undefined);
  assert.deepEqual(patch.parties.map((party) => party.id), ["ruling-party"]);
  assert.equal(patch.parties[0].kind, undefined);
  assert.equal(patch.parties[0].influence, undefined);
  assert.equal(patch.parties[0].status, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("moved powerBlocs -> parties") && warning.includes("electoral")));
});

test("dominant-party first attempts cannot pass as party_state while genuine one-party structures still can", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Equatorial Guinea"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      if (calls === 2) {
        const prompt = history?.[0]?.parts?.[0]?.text ?? "";
        assert.match(prompt, /POLITICAL SYSTEM LOCK \(FIELD LEVEL\): type=presidential_republic/i);
        assert.match(prompt, /representation is NOT locked and must be corrected/i);
      }
      return { toolInput: { proposals: [{
        polityKey: "Republic of Equatorial Guinea",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: { type: "presidential_republic", representation: "party_state" },
          government: { form: "Dominant-party presidential republic", headOfState: "Teodoro Obiang Nguema Mbasogo", headOfGovernment: "Vicente Ehate Tomi" },
          parties: [{ id: "pdge", name: "Democratic Party of Equatorial Guinea" }],
        } : {
          politicalSystem: { type: "authoritarian", representation: "electoral" },
          government: { form: "Dominant-party presidential republic", headOfState: "Teodoro Obiang Nguema Mbasogo", headOfGovernment: "Vicente Ehate Tomi" },
          parties: [
            { id: "pdge", name: "Democratic Party of Equatorial Guinea" },
            { id: "cpds", name: "Convergence for Social Democracy" },
          ],
        }),
      }] } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.type, "presidential_republic");
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.representation, "electoral");
  assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, { type: "presidential_republic" });
});

test("South Sudan dominant-party state wording cannot satisfy party_state and retry keeps the valid type", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of South Sudan"],
    politicalActors: { byPolity: {} },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, history) => {
      calls += 1;
      if (calls === 2) {
        const prompt = history?.[0]?.parts?.[0]?.text ?? "";
        assert.match(prompt, /POLITICAL SYSTEM LOCK \(FIELD LEVEL\): type=dominant_party_republic/i);
        assert.match(prompt, /representation is NOT locked and must be corrected/i);
      }
      return { toolInput: { proposals: [{
        polityKey: "Republic of South Sudan",
        actorPatchJson: JSON.stringify(calls === 1 ? {
          politicalSystem: { type: "dominant_party_republic", representation: "party_state" },
          government: {
            form: "Presidential republic (dominant-party state)",
            headOfState: "Salva Kiir Mayardit",
            headOfGovernment: "Salva Kiir Mayardit",
          },
          parties: [{ id: "splm", name: "Sudan People's Liberation Movement" }],
        } : {
          politicalSystem: { type: "one_party_state", representation: "electoral" },
          government: {
            form: "Presidential republic (dominant-party state)",
            headOfState: "Salva Kiir Mayardit",
            headOfGovernment: "Salva Kiir Mayardit",
          },
          parties: [
            { id: "splm", name: "Sudan People's Liberation Movement" },
            { id: "splm-dc", name: "SPLM for Democratic Change" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2, JSON.stringify(result.failures));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("representation=party_state")));
  assert.deepEqual(result.diagnostics[1].polities[0].politicalSystemLock, { type: "dominant_party_republic" });
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.type, "dominant_party_republic");
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.representation, "electoral");
});

test("corrective retries promote nested leader.traits before requested-scope validation", async (t) => {
  for (const entry of [
    {
      polityKey: "Republic of Equatorial Guinea",
      leader: "Teodoro Obiang Nguema Mbasogo",
      headOfGovernment: "Vicente Ehate Tomi",
      rulingId: "pdge",
      blocId: "mongomo_clan",
      blocName: "Mongomo Clan and Presidential Inner Circle",
      traits: { caution: 70, militarism: 60, paranoia: 80, pragmatism: 60 },
    },
    {
      polityKey: "Republic of South Sudan",
      leader: "Salva Kiir Mayardit",
      headOfGovernment: "Salva Kiir Mayardit",
      rulingId: "splm",
      blocId: "dinka_elite_faction",
      blocName: "SPLM / Dinka Political-Military Elite",
      traits: { caution: 50, militarism: 70, paranoia: 75, pragmatism: 50 },
    },
  ]) {
    await t.test(entry.polityKey, async () => {
      let calls = 0;
      const result = await generatePoliticalWorldProposalsCore({
        scenarioDate: "2014-03-22",
        polities: [entry.polityKey],
        politicalActors: { byPolity: {} },
        relevanceByPolity: { [entry.polityKey]: { regionalPower: true } },
        maxAttempts: 2,
        generatedAt: fixedNow,
        callModel: async () => {
          calls += 1;
          const actorPatch = calls === 1 ? {
            politicalSystem: { type: "authoritarian", representation: "elite_factions" },
            government: {
              form: "Presidential republic (dominant-party authoritarian regime)",
              headOfState: entry.leader,
              headOfGovernment: entry.headOfGovernment,
              ideology: "Regime preservation and centralized presidential rule",
              // Exact live failure shape: a party-only reference points at an
              // entity represented as a power bloc, forcing one corrective retry.
              rulingPartyIds: [entry.rulingId],
            },
            leader: entry.leader,
            traits: { caution: 70, pragmatism: 60 },
            goals: ["Preserve regime stability"],
            powerBlocs: [{
              id: entry.rulingId,
              name: "Ruling establishment",
              politicalResponse: {
                organization: 80,
                issues: { security: { position: 70, sensitivity: 80, strainResponse: 40 } },
              },
            }],
          } : {
            politicalSystem: { type: "authoritarian", representation: "elite_factions" },
            government: {
              form: "Authoritarian presidential republic",
              headOfState: entry.leader,
              headOfGovernment: entry.headOfGovernment,
              ideology: "Regime preservation and centralized presidential rule",
            },
            powerBlocs: [{
              id: entry.blocId,
              name: entry.blocName,
              politicalResponse: {
                organization: 85,
                issues: { security: { position: 80, sensitivity: 90, strainResponse: 60 } },
              },
            }],
            // Exact live retry alias: traits are semantically valid but nested
            // under the officeholder object instead of the actor root.
            leader: { name: entry.leader, title: "President", traits: entry.traits },
            goals: ["Preserve regime stability"],
          };
          return { toolInput: { proposals: [{ polityKey: entry.polityKey, actorPatchJson: JSON.stringify(actorPatch) }] } };
        },
      });

      assert.equal(calls, 2, JSON.stringify(result.failures));
      assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
      assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
      assert.ok(result.diagnostics[0].polities[0].errors.some((error) => error.includes("rulingPartyIds references unknown party id")));
      const patch = result.proposals[0].proposal.actorPatch;
      assert.deepEqual(patch.traits, entry.traits);
      assert.deepEqual(patch.leader, { name: entry.leader, title: "President" });
      assert.equal(result.diagnostics[1].polities[0].parsedActorPatch.leader.traits, undefined);
      assert.deepEqual(result.diagnostics[1].polities[0].parsedActorPatch.traits, entry.traits);
    });
  }
});

test("nested leader.traits never overwrites an explicit canonical top-level traits object", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { regionalPower: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: {
          form: "Presidential republic",
          headOfState: "Leader X",
          headOfGovernment: "Leader X",
          ideology: "Pragmatic republicanism",
        },
        leader: { name: "Leader X", title: "President", traits: { caution: 5, paranoia: 95 } },
        traits: { caution: 80, pragmatism: 70 },
        parties: [{
          id: "civic-party",
          name: "Civic Party",
          politicalResponse: {
            organization: 70,
            issues: { security: { position: 20, sensitivity: 60, strainResponse: 10 } },
          },
        }],
        goals: ["Maintain stability"],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const patch = result.proposals[0].proposal.actorPatch;
  assert.deepEqual(patch.traits, { caution: 80, pragmatism: 70 });
  assert.deepEqual(patch.leader, { name: "Leader X", title: "President" });
});


test("Round-Zero verifier tool stays shallow and separate from generation transport", () => {
  assert.equal(POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name, "submit_political_world_historical_verification");
  assert.equal(POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.schema.properties.verifications.maxItems, 4);
  const item = POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.schema.properties.verifications.items;
  assert.deepEqual(item.properties.verdict.enum, ["confirmed", "corrected"]);
  assert.equal(item.properties.correctedIdentityJson.type, "string");
  assert.equal(item.properties.correctionScopes.type, "array");
  assert.deepEqual(item.properties.correctionScopes.items.enum, ["officeholders", "government_structure", "political_system", "representation_roster", "strategic_semantics", "governing_semantics", "perceptions", "domestic_semantics"]);
  assert.equal(item.properties.replaceRepresentationEntities.type, "boolean");
  const converted = toGeminiSchema(POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.schema);
  const convertedItem = converted.properties.verifications.items;
  assert.deepEqual(convertedItem.properties.correctionScopes.items.enum, ["officeholders", "government_structure", "political_system", "representation_roster", "strategic_semantics", "governing_semantics", "perceptions", "domestic_semantics"]);
  assert.equal(convertedItem.properties.correctedIdentityJson.type, "string");
});

test("Round-Zero temporal sentinel uses a distinct shallow Gemini-safe transport and larger bounded batches", () => {
  assert.equal(POLITICAL_WORLD_TEMPORAL_SENTINEL_BATCH_SIZE, 12);
  assert.equal(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name, "submit_political_world_temporal_sentinel");
  assert.deepEqual(Object.keys(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.schema.properties), ["checksJson"]);
  assert.equal(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.schema.properties.checksJson.type, "string");
  assert.deepEqual(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.schema.required, ["checksJson"]);
  const converted = toGeminiSchema(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.schema);
  assert.deepEqual(Object.keys(converted.properties), ["checksJson"]);
  assert.equal(converted.properties.checksJson.type, "string");

  const prompt = buildPoliticalWorldTemporalSentinelPrompt({
    scenarioDate: "2014-03-22",
    entries: [{
      item: { polityKey: "Republic of Korea", depth: "standard", needs: ["representation_entities"] },
      proposal: { actorPatch: {
        government: { headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
        parties: [{ id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" }],
      } },
    }],
  });
  assert.match(prompt.systemPrompt, /TEMPORAL RED-TEAM SENTINEL/);
  assert.match(prompt.systemPrompt, /TOOL TRANSPORT: checksJson is a JSON STRING/);
  assert.match(prompt.systemPrompt, /later in the same month or year is WRONG/i);
  assert.match(prompt.userMessage, /New Politics Alliance for Democracy/);
  assert.match(prompt.userMessage, /F\d+ \[parties\[0\]\.identity\]/);
});


test("Round-Zero generation and sentinel scope behavioral semantics to the scenario date", () => {
  const generationPrompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    items: [{
      polityKey: "Example Republic",
      depth: "standard",
      needs: [
        POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT,
        POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT,
        POLITICAL_GENERATION_NEEDS.PERCEPTIONS,
        POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT,
      ],
    }],
    politicalActors: { byPolity: {} },
  });
  assert.match(generationPrompt.systemPrompt, /TEMPORAL SEMANTIC AUTHORITY/);
  assert.match(generationPrompt.systemPrompt, /later-coined names/i);
  assert.match(generationPrompt.systemPrompt, /hindsight/i);

  const sentinelPrompt = buildPoliticalWorldTemporalSentinelPrompt({
    scenarioDate: "2014-03-22",
    entries: [{
      item: { polityKey: "Example Republic", depth: "standard", needs: [POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT] },
      proposal: { actorPatch: {
        government: { ideology: "Reformist conservatism" },
        goals: ["Execute the later-named Meridian Comprehensive Framework"],
        fears: ["Regional isolation"],
        ambitions: ["Increase regional influence"],
        domesticPressures: ["Employment pressure"],
        perceptions: { Neighbor: { threat: 55, opportunity: 25 } },
        parties: [{
          id: "governing-party",
          name: "Governing Party",
          ideology: "Conservative reformism",
          goals: ["Implement the later-named Meridian package"],
          publicPriorities: ["Economic reform"],
          publicForeignPolicy: "Deepen regional partnerships",
        }],
      } },
    }],
  });
  assert.match(sentinelPrompt.systemPrompt, /named doctrine\/program coined or adopted later/i);
  assert.match(sentinelPrompt.userMessage, /\[government\.ideology\]/);
  assert.match(sentinelPrompt.userMessage, /\[goals\]/);
  assert.match(sentinelPrompt.userMessage, /\[fears\]/);
  assert.match(sentinelPrompt.userMessage, /\[ambitions\]/);
  assert.match(sentinelPrompt.userMessage, /\[domesticPressures\]/);
  assert.match(sentinelPrompt.userMessage, /\[perceptions\]/);
  assert.match(sentinelPrompt.userMessage, /\[parties\[0\]\.semantics\]/);
});

test("history-only exact-date verification surgically repairs future-informed semantics without regenerating the actor", async () => {
  const polityKey = "Example Republic";
  const originalPatch = {
    government: { ideology: "Reformist conservatism" },
    goals: ["Maintain political stability", "Execute the Meridian Comprehensive Framework"],
    fears: ["Regional isolation"],
    ambitions: ["Increase regional influence"],
    domesticPressures: ["Employment pressure shaped by the later Meridian rollout"],
    perceptions: { Neighbor: { threat: 85, opportunity: 10, cohesionEstimate: 70 } },
    parties: [{
      id: "governing-party",
      name: "Governing Party",
      ideology: "Conservative reformism",
      goals: ["Implement the Meridian Comprehensive Framework"],
      publicPriorities: ["Economic reform"],
      publicForeignPolicy: "Deepen regional partnerships",
    }],
  };
  const entry = {
    item: {
      polityKey,
      depth: "standard",
      needs: [
        POLITICAL_GENERATION_NEEDS.STRATEGIC_CONTEXT,
        POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT,
        POLITICAL_GENERATION_NEEDS.PERCEPTIONS,
        POLITICAL_GENERATION_NEEDS.DOMESTIC_CONTEXT,
      ],
    },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      sourceAsOf: "2014-03-22",
      referenceDates: ["2014-03-22"],
      actorPatch: originalPatch,
    },
    validation: { actor: originalPatch, provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [entry.item] },
    proposals: [entry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  const existingActor = {
    polityKey,
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", headOfState: "President Example", headOfGovernment: "Prime Minister Example", rulingPartyIds: ["governing-party"] },
    parties: [{ id: "governing-party", name: "Governing Party" }],
  };
  let calls = 0;
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: { [polityKey]: existingActor } },
    generatedAt: fixedNow,
    callModel: async (_system, history, opts) => {
      calls += 1;
      const text = history?.[0]?.parts?.[0]?.text ?? "";
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        const facts = [...text.matchAll(/^(F\d+) \[(.+?)\] /gm)].map((match) => ({ id: match[1], path: match[2] }));
        const checkedFactIds = facts.map((fact) => fact.id);
        const challengedFactIds = facts.filter((fact) => ["goals", "domesticPressures", "perceptions", "parties[0].semantics"].includes(fact.path)).map((fact) => fact.id);
        assert.ok(challengedFactIds.length >= 4, text);
        return { toolInput: { checksJson: JSON.stringify([{
          polityKey,
          verdict: "challenge",
          confidence: "high",
          issue: "The named Meridian framework and rollout postdate the scenario date; associated hindsight framing must be replaced with as-of political semantics.",
          checkedFactIds,
          challengedFactIds,
        }]) } };
      }
      assert.equal(opts.tool?.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name);
      assert.match(text, /CHALLENGED GENERATED TEMPORAL PATHS|challengedFacts/i);
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "corrected",
        confidence: "high",
        issue: "The Meridian framework name and rollout were adopted later and are not admissible as of 2014-03-22.",
        correctionScopes: ["strategic_semantics", "governing_semantics", "perceptions", "domestic_semantics"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({
          goals: ["Maintain political stability", "Pursue broad economic restructuring"],
          domesticPressures: ["Employment and growth pressure"],
          perceptions: { Neighbor: { threat: 60, opportunity: 20, cohesionEstimate: 70 } },
          parties: [{ id: "governing-party", goals: ["Advance broad economic reform"] }],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.equal(rechecked.historicalVerification.corrected, 1, JSON.stringify(rechecked.historicalVerification));
  const patch = rechecked.proposals[0].proposal.actorPatch;
  assert.deepEqual(patch.goals, ["Maintain political stability", "Pursue broad economic restructuring"]);
  assert.deepEqual(patch.fears, originalPatch.fears);
  assert.deepEqual(patch.ambitions, originalPatch.ambitions);
  assert.deepEqual(patch.domesticPressures, ["Employment and growth pressure"]);
  assert.equal(patch.perceptions.Neighbor.threat, 60);
  assert.deepEqual(patch.parties[0].goals, ["Advance broad economic reform"]);
  assert.deepEqual(patch.parties[0].publicPriorities, originalPatch.parties[0].publicPriorities);
});

test("semantic historical correction cannot overwrite an authored field that was not generated", async () => {
  const polityKey = "Authored Republic";
  const existingActor = {
    polityKey,
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", headOfGovernment: "A. Premier", rulingPartyIds: ["ruling"] },
    goals: ["AUTHORED: Preserve constitutional neutrality"],
    parties: [{ id: "ruling", name: "Ruling Party" }],
  };
  const entry = {
    item: { polityKey, depth: "standard", needs: [POLITICAL_GENERATION_NEEDS.GOVERNING_ENTITY_CONTEXT] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      sourceAsOf: "2014-03-22",
      referenceDates: [],
      actorPatch: { parties: [{ id: "ruling", goals: ["Adopt Future Program"] }] },
    },
    validation: { actor: existingActor, provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1, scenarioDate: "2014-03-22", generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [entry.item] }, proposals: [entry], failures: [], warnings: [], batches: [], diagnostics: [], generatedPolities: 1, failedPolities: 0,
  };
  let calls = 0;
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: { [polityKey]: existingActor } },
    generatedAt: fixedNow,
    callModel: async (_system, history, opts) => {
      calls += 1;
      const text = history?.[0]?.parts?.[0]?.text ?? "";
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        const ids = [...text.matchAll(/^(F\d+) \[/gm)].map((match) => match[1]);
        const semantic = text.match(/^(F\d+) \[parties\[0\]\.semantics\]/m)?.[1];
        return { toolInput: { checksJson: JSON.stringify([{ polityKey, verdict: "challenge", confidence: "high", issue: "The named Future Program was adopted later.", checkedFactIds: ids, challengedFactIds: [semantic] }]) } };
      }
      return { toolInput: { verifications: [{
        polityKey, verdict: "corrected", confidence: "high", issue: "Future Program postdates the scenario date.",
        correctionScopes: ["governing_semantics", "strategic_semantics"], replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({ goals: ["OVERWRITE AUTHORED GOAL"], parties: [{ id: "ruling", goals: ["Pursue contemporaneous reform"] }] }),
      }] } };
    },
  });
  assert.equal(calls, 2);
  const patch = rechecked.proposals[0].proposal.actorPatch;
  assert.equal(patch.goals, undefined);
  assert.deepEqual(patch.parties[0].goals, ["Pursue contemporaneous reform"]);
  assert.deepEqual(existingActor.goals, ["AUTHORED: Preserve constitutional neutrality"]);
});

test("temporal sentinel accepts checksJson shallow transport and validates its fact attestations natively", async () => {
  const polityKey = "Republic of Korea";
  const proposalEntry = {
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
        parties: [
          { id: "saenuri-party", name: "Saenuri Party" },
          { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
        ],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [proposalEntry.item] },
    proposals: [proposalEntry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  let calls = 0;
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, _history, opts) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(opts.tool?.schema.properties.checksJson.type, "string");
        return { toolInput: { checksJson: JSON.stringify([{
          polityKey,
          verdict: "challenge",
          confidence: "high",
          issue: "NPAD was formed after the scenario date.",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
          challengedFactIds: ["F7"],
        }]) } };
      }
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "corrected",
        confidence: "high",
        issue: "NPAD did not yet exist.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify({ parties: [{ id: "saenuri-party", name: "Saenuri Party" }, { id: "democratic-party-korea", name: "Democratic Party" }] }),
      }] } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(rechecked.historicalVerification.corrected, 1);
  assert.equal(rechecked.proposals[0].proposal.actorPatch.parties.some((party) => /new politics alliance/i.test(party.name)), false);
});

test("Round-Zero verification prompt protects exact-date history and authored alternate canon", () => {
  const prompt = buildPoliticalWorldHistoricalVerificationPrompt({
    scenarioDate: "2014-03-22",
    scenarioContext: "Scenario canon: the monarchy survived the 2013 crisis.",
    entries: [{
      item: { polityKey: "Example Kingdom", needs: ["governing_structure"], depth: "standard" },
      proposal: { actorPatch: { government: { form: "Constitutional monarchy", headOfGovernment: "A. Example" } } },
      validation: { actor: { government: { form: "Constitutional monarchy", headOfGovernment: { name: "A. Example" } } } },
    }],
  });
  assert.match(prompt.systemPrompt, /exact scenario date/i);
  assert.match(prompt.systemPrompt, /AFTER the scenario date have zero authority/);
  assert.match(prompt.systemPrompt, /Scenario-authored canon\/backstory is stronger authority/);
  assert.match(prompt.systemPrompt, /demonym.*NOT temporal contradictions/i);
  assert.match(prompt.systemPrompt, /EVERY named officeholder embedded/i);
  assert.match(prompt.systemPrompt, /correctionScopes/);
  assert.match(prompt.userMessage, /2014-03-22/);
  assert.match(prompt.userMessage, /the monarchy survived the 2013 crisis/);
  assert.match(prompt.userMessage, /government\.headOfGovernment/);
});

test("Round-Zero verifier corrects a post-date officeholder before proposal review", async () => {
  const calls = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Malawi"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      calls.push(opts.taskKey);
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Malawi",
          confidence: "high",
          sourceAsOf: "2014-03-22",
          referenceDates: ["2014-03-22"],
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: {
              form: "Presidential republic",
              headOfState: "Peter Mutharika",
              headOfGovernment: "Peter Mutharika",
            },
            parties: [
              { id: "pp", name: "People's Party" },
              { id: "dpp", name: "Democratic Progressive Party" },
            ],
          }),
        }] } };
      }
      assert.equal(opts.taskKey, "politicalWorldVerification");
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Malawi", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic of Malawi",
        verdict: "corrected",
        confidence: "high",
        issue: "Peter Mutharika was not the incumbent on the scenario date; Joyce Banda was the current president.",
        correctionScopes: ["officeholders"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({
          government: { headOfState: "Joyce Banda", headOfGovernment: "Joyce Banda" },
        }),
      }] } };
    },
  });

  assert.deepEqual(calls, ["politicalWorldGeneration", "politicalWorldVerification", "politicalWorldVerification"]);
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  assert.equal(result.historicalVerification.enabled, true);
  assert.equal(result.historicalVerification.corrected, 1);
  assert.equal(result.proposals[0].proposal.actorPatch.government.headOfState, "Joyce Banda");
  assert.equal(result.proposals[0].proposal.actorPatch.government.headOfGovernment, "Joyce Banda");
  assert.ok(result.warnings.some((warning) => warning.includes("Temporal authority verification corrected Republic of Malawi")));
});

test("Round-Zero verifier accepts one-layer escaped correctedIdentityJson transport", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Malawi"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Malawi",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Peter Mutharika", headOfGovernment: "Peter Mutharika" },
            parties: [{ id: "pp", name: "People's Party" }],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Malawi", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic of Malawi",
        verdict: "corrected",
        confidence: "high",
        issue: "On 22 March 2014 Joyce Banda was still President; Peter Mutharika took office later.",
        correctionScopes: ["officeholders"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: '{\\n  \\"government\\": {\\n    \\"form\\": \\"Presidential Republic\\",\\n    \\"headOfState\\": \\"Joyce Banda\\",\\n    \\"headOfGovernment\\": \\"Joyce Banda\\"\\n  }\\n}',
      }] } };
    },
  });

  assert.equal(verificationCalls, 2, JSON.stringify(result.historicalVerification));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  assert.equal(result.historicalVerification.corrected, 1);
  assert.equal(result.proposals[0].proposal.actorPatch.government.headOfState, "Joyce Banda");
  assert.equal(result.proposals[0].proposal.actorPatch.government.headOfGovernment, "Joyce Banda");
});

test("Round-Zero verifier can replace a temporally wrong representation and generated roster", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Kingdom of Thailand"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Kingdom of Thailand",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "constitutional_monarchy", representation: "military_factions" },
            government: {
              form: "Constitutional monarchy under military caretaker government",
              headOfState: "King Bhumibol Adulyadej",
              headOfGovernment: "Yingluck Shinawatra",
            },
            powerBlocs: [{ id: "thai-military", name: "Royal Thai Armed Forces" }],
          }),
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Kingdom of Thailand",
        verdict: "corrected",
        confidence: "high",
        issue: "The military had not taken government on the scenario date; the caretaker elected government was still in office.",
        correctionScopes: ["political_system", "government_structure", "representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify({
          politicalSystem: { representation: "electoral" },
          government: { form: "Parliamentary constitutional monarchy with caretaker government" },
          parties: [
            { id: "pheu-thai", name: "Pheu Thai Party" },
            { id: "democrat-party", name: "Democrat Party" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
  const patch = result.proposals[0].proposal.actorPatch;
  assert.equal(patch.politicalSystem.type, "constitutional_monarchy");
  assert.equal(patch.politicalSystem.representation, "electoral");
  assert.equal(patch.parties.length, 2);
  assert.equal(patch.powerBlocs, undefined);
});

test("Round-Zero verification fails closed when representation correction omits roster replacement authorization", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Kingdom of Thailand"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Kingdom of Thailand",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "constitutional_monarchy", representation: "military_factions" },
            government: { form: "Military caretaker monarchy" },
            powerBlocs: [{ id: "military", name: "Military" }],
          }),
        }] } };
      }
      verificationCalls += 1;
      return { toolInput: { verifications: [{
        polityKey: "Kingdom of Thailand",
        verdict: "corrected",
        confidence: "high",
        issue: "Representation is temporally wrong.",
        correctionScopes: ["political_system", "representation_roster"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({ politicalSystem: { representation: "electoral" } }),
      }] } };
    },
  });

  assert.equal(verificationCalls, 5);
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.equal(result.historicalVerification.failed, 1);
});

test("Round-Zero verifier cannot rescind a previously identified correction by confirming unchanged state on retry", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Madagascar"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Madagascar",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Hery Rajaonarimampianina", headOfGovernment: "Roger Kolo" },
            parties: [{ id: "hvm", name: "Hery Vaovao ho an'i Madagasikara" }],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Madagascar",
          verdict: "corrected",
          confidence: "high",
          issue: "Roger Kolo took office after the scenario date.",
          correctionScopes: ["political_system", "representation_roster"],
          replaceRepresentationEntities: false,
          correctedIdentityJson: JSON.stringify({ politicalSystem: { representation: "elite_factions" } }),
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic of Madagascar",
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.equal(verificationCalls, 5);
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.equal(result.historicalVerification.failed, 1);
  assert.ok(result.failures[0].errors.some((error) => /previous verification attempt identified a temporal correction/i.test(error)), JSON.stringify(result.failures));
});


test("Round-Zero verifier ignores a clearly non-temporal terminology correction instead of poisoning retry state", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Niger"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Niger",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "semi_presidential_republic", representation: "electoral" },
            government: { form: "Semi-presidential republic", headOfState: "Mahamadou Issoufou", headOfGovernment: "Brigi Rafini" },
            parties: [{ id: "pnds", name: "Nigerian Party for Democracy and Socialism" }],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Niger", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic of Niger",
        verdict: "corrected",
        confidence: "high",
        issue: "Corrected demonym from Nigerian to Nigerien for PNDS-Tarayya party name.",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "{",
      }] } };
    },
  });

  assert.equal(verificationCalls, 2, JSON.stringify(result.historicalVerification));
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.equal(result.historicalVerification.confirmed, 1);
  assert.equal(result.historicalVerification.corrected, 0);
  assert.equal(result.proposals[0].proposal.actorPatch.parties[0].name, "Nigerian Party for Democracy and Socialism");
  assert.ok(result.warnings.some((warning) => /non-temporal temporal-verifier correction/i.test(warning)));
});

test("Round-Zero verifier keeps a malformed real temporal correction sticky and fails closed if retry rescinds it", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic X",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Future President", headOfGovernment: "Future President" },
            parties: [{ id: "unity", name: "Unity Party" }],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic X",
          verdict: "corrected",
          confidence: "high",
          issue: "Future President did not take office until after the scenario date.",
          correctionScopes: ["officeholders"],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "{",
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic X",
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.equal(verificationCalls, 5);
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.ok(result.failures[0].errors.some((error) => /previous verification attempt identified a temporal correction/i.test(error)));
});

test("Round-Zero verifier makes a clear temporal finding sticky before correctionScopes validation", async () => {
  let verificationCalls = 0;
  let sawStickyRetryInstruction = false;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Korea"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (system, history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Korea",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
            parties: [
              { id: "saenuri-party", name: "Saenuri Party" },
              { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
            ],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea",
          verdict: "corrected",
          confidence: "high",
          issue: "The New Politics Alliance for Democracy was founded on 26 March 2014, four days after the 22 March 2014 scenario date; the Democratic Party was the opposition party on the scenario date.",
          correctionScopes: [],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "{",
        }] } };
      }
      sawStickyRetryInstruction = /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED[\s\S]*verdict=confirmed is forbidden/i.test(system)
        || /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED[\s\S]*verdict=confirmed is forbidden/i.test(history?.[0]?.parts?.[0]?.text ?? "");
      return { toolInput: { verifications: [{
        polityKey: "Republic of Korea",
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.equal(verificationCalls, 5);
  assert.equal(sawStickyRetryInstruction, true);
  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.ok(result.failures[0].errors.some((error) => /previous verification attempt identified a temporal correction/i.test(error)), JSON.stringify(result.failures));
});

test("Round-Zero verifier can recover a missing-scope Korea correction on retry without regenerating", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Korea"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Korea",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
            parties: [
              { id: "saenuri-party", name: "Saenuri Party" },
              { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
            ],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea",
          verdict: "corrected",
          confidence: "high",
          issue: "The New Politics Alliance for Democracy was founded on 26 March 2014, after the 22 March 2014 scenario date; the Democratic Party existed on the scenario date.",
          correctionScopes: [],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "{",
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic of Korea",
        verdict: "corrected",
        confidence: "high",
        issue: "The New Politics Alliance for Democracy did not exist until 26 March 2014; replace the future roster entry with the Democratic Party for 22 March 2014.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify({
          parties: [
            { id: "saenuri-party", name: "Saenuri Party" },
            { id: "democratic-party-korea", name: "Democratic Party" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(verificationCalls, 3);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.equal(result.historicalVerification.corrected, 1);
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties.map((party) => party.name), ["Saenuri Party", "Democratic Party"]);
  assert.equal(result.proposals[0].proposal.actorPatch.parties.some((party) => /new politics alliance/i.test(party.name)), false);
});


test("Round-Zero consensus adjudicates Korea when one independent pass catches a future roster and the other confirms", async () => {
  let verificationCalls = 0;
  let sawAdjudicationContext = false;
  let sawStickyAdjudication = false;
  const correctedRoster = {
    parties: [
      { id: "saenuri-party", name: "Saenuri Party" },
      { id: "democratic-party-korea", name: "Democratic Party" },
      { id: "unified-progressive-party", name: "Unified Progressive Party" },
    ],
  };
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Korea"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (system, history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Korea",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
            parties: [
              { id: "saenuri-party", name: "Saenuri Party" },
              { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
              { id: "unified-progressive-party", name: "Unified Progressive Party" },
            ],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea",
          verdict: "confirmed",
          confidence: "high",
          issue: "",
          correctionScopes: [],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "",
        }] } };
      }
      if (verificationCalls === 2) {
        assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
        assert.match(history?.[0]?.parts?.[0]?.text ?? "", /INDEPENDENT CONSENSUS PASS B/);
        return { toolInput: { checks: [{
          polityKey: "Republic of Korea",
          verdict: "challenge",
          confidence: "high",
          issue: "The New Politics Alliance for Democracy was formed on 26 March 2014, after the 22 March 2014 scenario date; it did not exist on the scenario date.",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"],
          challengedFactIds: ["F7"],
        }] } };
      }
      const userMessage = history?.[0]?.parts?.[0]?.text ?? "";
      sawAdjudicationContext = /CONSENSUS ADJUDICATION REQUIRED[\s\S]*PASS A:[\s\S]*TEMPORAL SENTINEL:/i.test(userMessage);
      sawStickyAdjudication = /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED[\s\S]*verdict=confirmed is forbidden/i.test(system)
        || /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED[\s\S]*verdict=confirmed is forbidden/i.test(userMessage);
      return { toolInput: { verifications: [{
        polityKey: "Republic of Korea",
        verdict: "corrected",
        confidence: "high",
        issue: "NPAD did not exist on 22 March 2014; it was formed on 26 March 2014. Use the Democratic Party roster that existed on the scenario date.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify(correctedRoster),
      }] } };
    },
  });

  assert.equal(verificationCalls, 3);
  assert.equal(sawAdjudicationContext, true);
  assert.equal(sawStickyAdjudication, true);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.equal(result.historicalVerification.corrected, 1);
  assert.deepEqual(result.historicalVerification.consensus.disputedPolities, ["Republic of Korea"]);
  assert.deepEqual(result.historicalVerification.consensus.stickyAdjudicationPolities, ["Republic of Korea"]);
  assert.deepEqual(result.historicalVerification.consensus.adjudicatedPolities, ["Republic of Korea"]);
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties.map((party) => party.name), ["Saenuri Party", "Democratic Party", "Unified Progressive Party"]);
});

test("Round-Zero consensus carries a malformed temporal finding from a failed independent pass into sticky adjudication", async () => {
  let verificationCalls = 0;
  let sawStickyAdjudication = false;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Korea"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (system, history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic of Korea",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
            parties: [
              { id: "saenuri-party", name: "Saenuri Party" },
              { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
            ],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (verificationCalls === 1) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea",
          verdict: "corrected",
          confidence: "high",
          issue: "The New Politics Alliance for Democracy was founded on 26 March 2014, after the 22 March 2014 scenario date.",
          correctionScopes: [],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "{",
        }] } };
      }
      if (verificationCalls === 2 || verificationCalls === 3) {
        return { toolInput: { verifications: [{
          polityKey: "Republic of Korea",
          verdict: "confirmed",
          confidence: "high",
          issue: "",
          correctionScopes: [],
          replaceRepresentationEntities: false,
          correctedIdentityJson: "",
        }] } };
      }
      const userMessage = history?.[0]?.parts?.[0]?.text ?? "";
      sawStickyAdjudication = /CONSENSUS ADJUDICATION REQUIRED/i.test(userMessage)
        && (/TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED/i.test(system)
          || /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED/i.test(userMessage));
      return { toolInput: { verifications: [{
        polityKey: "Republic of Korea",
        verdict: "corrected",
        confidence: "high",
        issue: "NPAD was founded on 26 March 2014, so the 22 March 2014 roster must use the Democratic Party.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify({
          parties: [
            { id: "saenuri-party", name: "Saenuri Party" },
            { id: "democratic-party-korea", name: "Democratic Party" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(verificationCalls, 4);
  assert.equal(sawStickyAdjudication, true);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  assert.equal(result.historicalVerification.consensus.passA.failed, 1);
  assert.equal(result.historicalVerification.consensus.passB.confirmed, 1);
  assert.deepEqual(result.historicalVerification.consensus.stickyAdjudicationPolities, ["Republic of Korea"]);
  assert.equal(result.proposals[0].proposal.actorPatch.parties.some((party) => /new politics alliance/i.test(party.name)), false);
});

test("Round-Zero verifier explicitly spotlights compound officeholders and accepts a focused exact-date correction", async () => {
  let sawCompoundInstruction = false;
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Australia"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (system, history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Australia",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "parliamentary_democracy", representation: "electoral" },
            government: {
              form: "Federal parliamentary constitutional monarchy",
              headOfState: "Queen Elizabeth II (Governor-General Peter Cosgrove)",
              headOfGovernment: "Prime Minister Tony Abbott",
            },
            parties: [
              { id: "liberal-party", name: "Liberal Party of Australia" },
              { id: "labor-party", name: "Australian Labor Party" },
            ],
          }),
        }] } };
      }
      verificationCalls += 1;
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Australia", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      const userMessage = history?.[0]?.parts?.[0]?.text ?? "";
      sawCompoundInstruction = /COMPOUND OFFICEHOLDER CHECKS[\s\S]*Governor-General Peter Cosgrove[\s\S]*verify every named person\/role independently/i.test(userMessage)
        && /EVERY named officeholder embedded/i.test(system);
      return { toolInput: { verifications: [{
        polityKey: "Australia",
        verdict: "corrected",
        confidence: "high",
        issue: "Peter Cosgrove was not yet Governor-General on 22 March 2014; Quentin Bryce was still serving.",
        correctionScopes: ["officeholders"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({
          government: { headOfState: "Queen Elizabeth II (Governor-General Quentin Bryce)" },
        }),
      }] } };
    },
  });

  assert.equal(verificationCalls, 2);
  assert.equal(sawCompoundInstruction, true);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  assert.equal(result.historicalVerification.corrected, 1);
  assert.equal(result.proposals[0].proposal.actorPatch.government.headOfState, "Queen Elizabeth II (Governor-General Quentin Bryce)");
});

test("future scenarios skip real-history verification even when production verification is enabled", async () => {
  const calls = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2067-04-19",
    polities: ["Lunar Free State"],
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      calls.push(opts.taskKey);
      return { toolInput: { proposals: [{
        polityKey: "Lunar Free State",
        actorPatchJson: JSON.stringify({
          politicalSystem: { type: "administrative_republic", representation: "none" },
          government: { form: "Administrative republic", headOfGovernment: "Director Aster" },
        }),
      }] } };
    },
  });
  assert.deepEqual(calls, ["politicalWorldGeneration"]);
  assert.equal(result.generatedPolities, 1);
  assert.match(result.historicalVerification.skippedReason, /future scenario date/);
});


test("historical roster corrections preserve existing response profiles for retained entity ids", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { regionalPower: true } },
    generatedAt: fixedNow,
    maxAttempts: 1,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [{
          polityKey: "Republic X",
          actorPatchJson: JSON.stringify({
            politicalSystem: { type: "presidential_republic", representation: "electoral" },
            government: { form: "Presidential republic", ideology: "Civic nationalism", headOfState: "Leader A", headOfGovernment: "Leader A" },
            parties: [{
              id: "unity",
              name: "Unity Party",
              leader: "Leader Old",
              politicalResponse: { organization: 75, credibility: 70, issues: [{ issue: "security", position: 20, sensitivity: 60, strainResponse: 10 }] },
            }],
            traits: { caution: 55 },
            goals: ["Preserve state stability"],
          }),
        }] } };
      }
      return { toolInput: { verifications: [{
        polityKey: "Republic X",
        verdict: "corrected",
        confidence: "high",
        issue: "The party leadership had changed before the scenario date.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({ parties: [{ id: "unity", leader: "Leader New" }] }),
      }] } };
    },
  });
  assert.equal(result.generatedPolities, 1);
  const party = result.proposals[0].proposal.actorPatch.parties[0];
  assert.equal(party.name, "Unity Party");
  assert.equal(party.leader, "Leader New");
  assert.equal(party.politicalResponse.organization, 75);
  assert.equal(party.politicalResponse.issues.security.position, 20);
});

test("exact US keyed parties object transport canonicalizes to the canonical array before validation", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["United States of America"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "United States of America": { player: true, globalPower: true } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "United States of America",
      confidence: "high",
      sourceAsOf: "2014-03-22",
      referenceDates: ["2014-03-22"],
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: {
          form: "Federal Presidential Constitutional Republic",
          headOfState: "Barack Obama",
          headOfGovernment: "Barack Obama",
          ideology: "Liberal internationalism and centrist progressivism",
          approval: 45,
          stability: 80,
        },
        parties: {
          "democratic-party": {
            name: "Democratic Party",
            ideology: "Liberalism, social liberalism, progressivism",
            politicalResponse: {
              issues: { "foreign-policy": { position: 20, sensitivity: 70, strainResponse: 10 } },
            },
          },
          "republican-party": {
            name: "Republican Party",
            ideology: "Conservatism, economic liberalism, American conservatism",
            politicalResponse: {
              issues: { "foreign-policy": { position: -30, sensitivity: 80, strainResponse: -20 } },
            },
          },
        },
        traits: { riskTolerance: 50, pragmatism: 70, caution: 60, consensusDriven: 40 },
        goals: ["Maintain transatlantic unity"],
        fears: ["Uncontrolled escalation"],
        ambitions: ["Strengthen alliances"],
        domesticPressures: ["Congressional gridlock"],
        perceptions: { russia: { threat: 70, opportunity: 10, weakness: 40, cohesionEstimate: 60 } },
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0, JSON.stringify(result.failures));
  const parties = result.proposals[0].proposal.actorPatch.parties;
  assert.ok(Array.isArray(parties));
  assert.deepEqual(parties.map((party) => party.id), ["democratic-party", "republican-party"]);
  assert.equal(parties[0].politicalResponse.issues["foreign-policy"].sensitivity, 70);
});

test("keyed powerBlocs object transport canonicalizes to the canonical array", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Court State X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Court State X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "absolute_monarchy", representation: "court_factions" },
        government: { form: "Absolute monarchy", headOfState: "Sovereign X", headOfGovernment: "Sovereign X" },
        powerBlocs: {
          "royal-court": { name: "Royal Court" },
          "security-establishment": { id: "security-establishment", name: "Security Establishment" },
        },
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.deepEqual(result.proposals[0].proposal.actorPatch.powerBlocs.map((bloc) => bloc.id), ["royal-court", "security-establishment"]);
});

test("canonical entity arrays pass through collection-shape normalization unchanged", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic", headOfGovernment: "Leader X" },
        parties: [{ id: "party-x", name: "Party X", ideology: "Centrist" }],
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties, [{
    id: "party-x",
    name: "Party X",
    ideology: "Centrist",
    support: { percent: 100, basis: "native-fallback-estimate" },
  }]);
});

test("keyed collection transport with conflicting explicit id fails closed", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async () => ({ toolInput: { proposals: [{
      polityKey: "Republic X",
      actorPatchJson: JSON.stringify({
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic", headOfGovernment: "Leader X" },
        parties: {
          "party-x": { id: "different-party", name: "Ambiguous Party" },
        },
      }),
    }] } }),
  });

  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 1);
  assert.ok(result.failures[0].errors.some((error) => error.includes("actorPatch.parties must be an array when generated")));
});

test("generation and corrective retry prompts forbid keyed party or power-bloc maps", () => {
  const prompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    items: [{ polityKey: "United States of America", depth: "full", needs: ["representation_entities"] }],
    politicalActors: { byPolity: {} },
    previousErrors: { "United States of America": ["actorPatch.parties must be an array when generated"] },
  });

  assert.match(prompt.systemPrompt, /parties and actorPatch\.powerBlocs MUST ALWAYS be JSON arrays/i);
  assert.match(prompt.systemPrompt, /NEVER return a keyed object\/map\/dictionary/i);
  assert.match(prompt.userMessage, /STRICT RETRY COLLECTION SHAPE/i);
  assert.match(prompt.userMessage, /Do NOT use an id-keyed object\/map\/dictionary/i);
});

test("Round-Zero historical verification is uniformly bounded to four polities per batch", () => {
  assert.equal(POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE, 4);
});

test("generation and verification define government officeholders as formal incumbents rather than supreme leaders", () => {
  const generationPrompt = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    items: [{ polityKey: "Example State", depth: "standard", needs: ["governing_structure"] }],
    politicalActors: { byPolity: {} },
  });
  assert.match(generationPrompt.systemPrompt, /FORMAL current officeholders/);
  assert.match(generationPrompt.systemPrompt, /supreme\/de facto political leader/);

  const verificationPrompt = buildPoliticalWorldHistoricalVerificationPrompt({
    scenarioDate: "2014-03-22",
    entries: [{
      item: { polityKey: "Example State", depth: "standard", needs: ["governing_structure"] },
      proposal: { actorPatch: { government: { form: "Republic", headOfState: "Leader X" } } },
    }],
  });
  assert.match(verificationPrompt.systemPrompt, /FORMAL current officeholders/);
  assert.match(verificationPrompt.systemPrompt, /supreme leader/);
});

test("cross-polity head-of-government collision forces focused re-verification and repairs the Madagascar/Mali case", async () => {
  let verificationCall = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic of Madagascar", "Republic of Mali"],
    politicalActors: { byPolity: {} },
    maxBatchSize: 2,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: true,
    callModel: async (_system, history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [
          {
            polityKey: "Republic of Madagascar",
            actorPatch: {
              politicalSystem: { type: "semi_presidential_republic", representation: "electoral" },
              government: { form: "Semi-Presidential Republic", headOfState: "Hery Rajaonarimampianina", headOfGovernment: "Oumar Tatam Ly" },
              parties: [{ id: "hvm", name: "Hery Vaovao ho an'i Madagasikara" }],
            },
          },
          {
            polityKey: "Republic of Mali",
            actorPatch: {
              politicalSystem: { type: "semi_presidential_republic", representation: "electoral" },
              government: { form: "Semi-Presidential Republic", headOfState: "Ibrahim Boubacar Keïta", headOfGovernment: "Oumar Tatam Ly" },
              parties: [{ id: "rpm", name: "Rally for Mali" }],
            },
          },
        ] } };
      }
      verificationCall += 1;
      if (verificationCall <= 2) {
        if (verificationCall === 2) assert.match(history[0].parts[0].text, /INDEPENDENT CONSENSUS PASS B/);
        return { toolInput: { verifications: [
          { polityKey: "Republic of Madagascar", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
          { polityKey: "Republic of Mali", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
        ] } };
      }
      assert.match(history[0].parts[0].text, /MANDATORY SAME-DATE OFFICEHOLDER COLLISION/);
      assert.match(history[0].parts[0].text, /Oumar Tatam Ly/);
      return { toolInput: { verifications: [
        {
          polityKey: "Republic of Madagascar",
          verdict: "corrected",
          confidence: "high",
          issue: "Oumar Tatam Ly was Mali's prime minister; Madagascar's prime minister was Jean Omer Beriziky on the scenario date.",
          correctionScopes: ["officeholders"],
          replaceRepresentationEntities: false,
          correctedIdentityJson: JSON.stringify({ government: { headOfGovernment: "Jean Omer Beriziky" } }),
        },
        { polityKey: "Republic of Mali", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
      ] } };
    },
  });

  assert.equal(verificationCall, 3);
  assert.equal(result.generatedPolities, 2);
  assert.equal(result.failedPolities, 0);
  assert.equal(result.historicalVerification.collisionRechecks.groups, 1);
  assert.deepEqual(result.historicalVerification.collisionRechecks.failedPolities, []);
  const madagascar = result.proposals.find((entry) => entry.item.polityKey === "Republic of Madagascar");
  assert.equal(madagascar.proposal.actorPatch.government.headOfGovernment, "Jean Omer Beriziky");
  assert.equal(madagascar.historicalVerification.verdict, "corrected");
});

test("cross-polity head-of-government collision fails closed if the focused verifier confirms the contradiction unchanged", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic A", "Republic B"],
    politicalActors: { byPolity: {} },
    maxBatchSize: 2,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [
          {
            polityKey: "Republic A",
            actorPatch: {
              politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
              government: { form: "Parliamentary republic", headOfState: "President A", headOfGovernment: "Prime Minister Shared Person" },
              parties: [{ id: "party-a", name: "Party A" }],
            },
          },
          {
            polityKey: "Republic B",
            actorPatch: {
              politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
              government: { form: "Parliamentary republic", headOfState: "President B", headOfGovernment: "Shared Person" },
              parties: [{ id: "party-b", name: "Party B" }],
            },
          },
        ] } };
      }
      return { toolInput: { verifications: [
        { polityKey: "Republic A", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
        { polityKey: "Republic B", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
      ] } };
    },
  });

  assert.equal(result.generatedPolities, 0);
  assert.equal(result.failedPolities, 2);
  assert.deepEqual(new Set(result.historicalVerification.collisionRechecks.failedPolities), new Set(["Republic A", "Republic B"]));
  assert.ok(result.failures.every((failure) => failure.errors.some((error) => error.includes("collision remained"))));
});

test("shared heads of state do not trigger the collision sentinel when heads of government differ", async () => {
  let verificationCalls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Canada", "Australia"],
    politicalActors: { byPolity: {} },
    maxBatchSize: 2,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: true,
    callModel: async (_system, _history, opts) => {
      if (opts.taskKey === "politicalWorldGeneration") {
        return { toolInput: { proposals: [
          {
            polityKey: "Canada",
            actorPatch: {
              politicalSystem: { type: "parliamentary_democracy", representation: "electoral" },
              government: { form: "Constitutional monarchy", headOfState: "Queen Elizabeth II", headOfGovernment: "Stephen Harper" },
              parties: [{ id: "conservative-party", name: "Conservative Party" }],
            },
          },
          {
            polityKey: "Australia",
            actorPatch: {
              politicalSystem: { type: "parliamentary_democracy", representation: "electoral" },
              government: { form: "Constitutional monarchy", headOfState: "Queen Elizabeth II", headOfGovernment: "Tony Abbott" },
              parties: [{ id: "liberal-party", name: "Liberal Party" }],
            },
          },
        ] } };
      }
      verificationCalls += 1;
      return { toolInput: { verifications: [
        { polityKey: "Canada", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
        { polityKey: "Australia", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "" },
      ] } };
    },
  });

  assert.equal(verificationCalls, 2);
  assert.equal(result.generatedPolities, 2);
  assert.equal(result.historicalVerification.consensus.agreedConfirmed, 2);
  assert.equal(result.historicalVerification.collisionRechecks.groups, 0);
});

test("history-only re-check reuses successful proposals without re-running generation and can correct formal DPRK officeholders", async () => {
  const generated = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Democratic People's Republic of Korea"],
    politicalActors: { byPolity: {} },
    maxBatchSize: 1,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: false,
    callModel: async (_system, _history, opts) => {
      assert.equal(opts.taskKey, "politicalWorldGeneration");
      return { toolInput: { proposals: [{
        polityKey: "Democratic People's Republic of Korea",
        actorPatch: {
          politicalSystem: { type: "one_party_state", representation: "party_state" },
          government: { form: "Single-party socialist republic", headOfState: "Kim Jong Un", headOfGovernment: "Pak Pong-ju" },
          leader: { name: "Kim Jong Un", title: "Supreme Leader" },
          parties: [{ id: "workers-party-of-korea", name: "Workers' Party of Korea" }],
        },
      }] } };
    },
  });

  const taskKeys = [];
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result: generated,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (system, _history, opts) => {
      taskKeys.push(opts.taskKey);
      if (opts.tool?.name === POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) {
        return { toolInput: { verifications: [{
          polityKey: "Democratic People's Republic of Korea", verdict: "confirmed", confidence: "high", issue: "", correctionScopes: [], replaceRepresentationEntities: false, correctedIdentityJson: "",
        }] } };
      }
      assert.match(system, /FORMAL current officeholders|FORMAL officeholder/i);
      return { toolInput: { verifications: [{
        polityKey: "Democratic People's Republic of Korea",
        verdict: "corrected",
        confidence: "high",
        issue: "Kim Yong-nam was the formal head of state on the scenario date; Kim Jong Un remained the supreme political leader.",
        correctionScopes: ["officeholders"],
        replaceRepresentationEntities: false,
        correctedIdentityJson: JSON.stringify({ government: { headOfState: "Kim Yong-nam" } }),
      }] } };
    },
  });

  assert.deepEqual(taskKeys, ["politicalWorldVerification", "politicalWorldVerification"]);
  assert.equal(rechecked.historicalVerification.recheckOnly, true);
  assert.equal(rechecked.generatedPolities, 1);
  assert.equal(rechecked.proposals[0].proposal.actorPatch.government.headOfState, "Kim Yong-nam");
  assert.equal(rechecked.proposals[0].proposal.actorPatch.leader.name, "Kim Jong Un");
});

test("history-only re-check reuses prior verifier decisions and scales the temporal sentinel at twelve polities per call", async () => {
  const proposals = Array.from({ length: 25 }, (_, index) => {
    const polityKey = `Republic ${index + 1}`;
    return {
      item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
      proposal: {
        schemaVersion: 1,
        polityKey,
        scenarioDate: "2014-03-22",
        depth: "standard",
        provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
        actorPatch: {
          politicalSystem: { type: "presidential_republic", representation: "electoral" },
          government: { form: "Presidential republic", headOfState: `President ${index + 1}`, headOfGovernment: `President ${index + 1}` },
          parties: [{ id: `party-${index + 1}`, name: `Party ${index + 1}` }],
        },
      },
      validation: { provenance: { confidence: "high" } },
      historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
    };
  });
  const calls = [];
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: proposals.map((entry) => entry.item) },
    proposals,
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: proposals.length,
    failedPolities: 0,
  };

  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, history, opts) => {
      calls.push(opts.tool?.name);
      assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
      const text = history?.[0]?.parts?.[0]?.text ?? "";
      const polityKeys = [...text.matchAll(/^POLITY: (.+)$/gm)].map((match) => match[1].trim());
      return { toolInput: { verifications: polityKeys.map((polityKey) => ({
        polityKey,
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      })) } };
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls, Array(3).fill(POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name));
  assert.equal(rechecked.historicalVerification.recheckOnly, true);
  assert.equal(rechecked.historicalVerification.consensus.temporalSentinel.batchSize, 12);
  assert.equal(rechecked.historicalVerification.consensus.temporalSentinel.batches, 3);
  assert.equal(rechecked.historicalVerification.confirmed, 25);
  assert.equal(rechecked.historicalVerification.failed, 0);
});

test("temporal sentinel accepts unique slugged polity keys and benign clear notes without fake adjudication", async () => {
  const polityKeys = [
    "Republic of Austria",
    "Republic of Azerbaijan",
    "Republic of Belarus",
    "Republic of Benin",
    "Republic of Botswana",
    "Republic of Bulgaria",
    "Republic of Burundi",
    "Republic of Cabo Verde",
    "Republic of Cameroon",
    "Republic of Chad",
    "Republic of Chile",
    "Republic of China",
  ];
  const proposals = polityKeys.map((polityKey, index) => ({
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: `President ${index + 1}`, headOfGovernment: `President ${index + 1}` },
        parties: [{ id: `party-${index + 1}`, name: `Party ${index + 1}` }],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  }));
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: proposals.map((entry) => entry.item) },
    proposals,
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: proposals.length,
    failedPolities: 0,
  };
  let calls = 0;
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, history, opts) => {
      calls += 1;
      assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
      const text = history?.[0]?.parts?.[0]?.text ?? "";
      const benignIssues = [
        "None",
        "All political structures, executive officeholders, and party identities are temporally valid for 2014-03-22.",
        "Interim administration, executive leadership, and party figures are temporally valid for 2014-03-22.",
        "Executive leadership and major party figures are temporally valid for 2014-03-22.",
        "Head of state, prime minister, and parliamentary parties are temporally valid for 2014-03-22.",
        "Parliamentary monarchy and party leadership are temporally valid for 2014-03-22.",
        "Executive officeholders and major parties are temporally valid for 2014-03-22.",
        "Monarch and absolute governance structures are temporally valid for 2014-03-22.",
        "Laura Chinchilla remains president until May 2014; facts are valid for 2014-03-22.",
        "Mauricio Funes remains president until June 2014; facts are valid for 2014-03-22.",
        "Andrus Ansip is Prime Minister on 2014-03-22 (Taavi Rõivas takes office on 2014-03-26).",
        "Every supplied FACT matches the exact-date identity on 2014-03-22.",
      ];
      const entries = [...text.matchAll(/^POLITY: (.+)$/gm)].map((match, index) => ({
        polityKey: match[1].trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        verdict: "clear",
        confidence: "high",
        issue: benignIssues[index],
        checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
        challengedFactIds: [],
      }));
      return { toolInput: { checksJson: JSON.stringify(entries) } };
    },
  });

  assert.equal(calls, 1);
  assert.equal(rechecked.historicalVerification.confirmed, polityKeys.length);
  assert.equal(rechecked.historicalVerification.corrected, 0);
  assert.equal(rechecked.historicalVerification.failed, 0);
  assert.deepEqual(rechecked.historicalVerification.consensus.disputedPolities, []);
  assert.equal(rechecked.warnings.some((warning) => /Ignored unrequested temporal sentinel result/.test(warning)), false);
});

test("temporal sentinel salvages valid polity checks when one flat checksJson member is malformed", async () => {
  const polityKeys = Array.from({ length: 12 }, (_, index) => `Republic Test ${index + 1}`);
  const proposals = polityKeys.map((polityKey, index) => ({
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: `President ${index + 1}`, headOfGovernment: `President ${index + 1}` },
        parties: [{ id: `party-${index + 1}`, name: `Party ${index + 1}` }],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  }));
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: proposals.map((entry) => entry.item) },
    proposals,
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: proposals.length,
    failedPolities: 0,
  };
  const calls = [];
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, history, opts) => {
      calls.push(opts.tool?.name);
      if (calls.length === 1) {
        assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
        const text = history?.[0]?.parts?.[0]?.text ?? "";
        const requested = [...text.matchAll(/^POLITY: (.+)$/gm)].map((match) => match[1].trim());
        const validMembers = requested.slice(0, 11).map((polityKey) => JSON.stringify({
          polityKey,
          verdict: "clear",
          confidence: 1,
          issue: "",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
          challengedFactIds: [],
        }));
        const malformedLast = `{
          "polityKey": ${JSON.stringify(requested[11])},
          "verdict": "clear",
          _comment": "provider invented an invalid comment field",
          "confidence": 1,
          "issue": "",
          "checkedFactIds": ["F1", "F2", "F3", "F4", "F5", "F6"],
          "challengedFactIds": []
        }`;
        return { toolInput: { checksJson: `[${[...validMembers, malformedLast].join(",")}]` } };
      }
      assert.equal(opts.tool?.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name);
      return { toolInput: { verifications: [{
        polityKey: polityKeys[11],
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.deepEqual(calls, [POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name]);
  assert.equal(rechecked.historicalVerification.confirmed, 12);
  assert.equal(rechecked.historicalVerification.failed, 0);
  assert.deepEqual(rechecked.historicalVerification.consensus.disputedPolities, [polityKeys[11]]);
});

test("history-only recheck does not turn an already-applied prior correction into a fresh sticky obligation", async () => {
  const polityKey = "Bosnia and Herzegovina";
  const proposalEntry = {
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Federal parliamentary consociational republic", headOfState: "Bakir Izetbegović", headOfGovernment: "Vjekoslav Bevanda" },
        parties: [{ id: "sda", name: "Party of Democratic Action" }],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: {
      verdict: "corrected",
      confidence: "high",
      issue: "Bakir Izetbegović assumed the chairmanship on March 10, 2014.",
    },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [proposalEntry.item] },
    proposals: [proposalEntry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  const calls = [];
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, _history, opts) => {
      calls.push(opts.tool?.name);
      if (calls.length === 1) {
        return { toolInput: { checksJson: "not valid json" } };
      }
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "confirmed",
        confidence: "high",
        issue: "Current corrected identity is valid on 2014-03-22.",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.deepEqual(calls, [POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name]);
  assert.equal(rechecked.historicalVerification.failed, 0);
  assert.equal(rechecked.proposals.length, 1);
  assert.equal(rechecked.proposals[0].proposal.actorPatch.government.headOfState, "Bakir Izetbegović");
  assert.equal(rechecked.proposals[0].historicalVerification.verdict, "corrected");
  assert.match(rechecked.proposals[0].historicalVerification.issue, /assumed the chairmanship/i);
  assert.deepEqual(rechecked.historicalVerification.consensus.stickyAdjudicationPolities, []);
});

test("temporal sentinel still fails closed when a clear verdict carries a substantive temporal contradiction", async () => {
  const polityKey = "Republic of Korea";
  const proposalEntry = {
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
        parties: [
          { id: "saenuri-party", name: "Saenuri Party" },
          { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
        ],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [proposalEntry.item] },
    proposals: [proposalEntry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  const calls = [];
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, _history, opts) => {
      calls.push(opts.tool?.name);
      if (calls.length === 1) {
        return { toolInput: { checksJson: JSON.stringify([{
          polityKey,
          verdict: "clear",
          confidence: "high",
          issue: "New Politics Alliance for Democracy was founded after the scenario date on March 26, 2014.",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
          challengedFactIds: [],
        }]) } };
      }
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "confirmed",
        confidence: "high",
        issue: "",
        correctionScopes: [],
        replaceRepresentationEntities: false,
        correctedIdentityJson: "",
      }] } };
    },
  });

  assert.deepEqual(calls, [POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name]);
  assert.deepEqual(rechecked.historicalVerification.consensus.disputedPolities, [polityKey]);
  assert.equal(rechecked.historicalVerification.failed, 0);
});

test("history-only re-check repairs a previously confirmed Korea NPAD leak with sentinel plus adjudication only", async () => {
  const polityKey = "Republic of Korea";
  const proposalEntry = {
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
        parties: [
          { id: "saenuri-party", name: "Saenuri Party" },
          { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
          { id: "unified-progressive-party", name: "Unified Progressive Party" },
        ],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [proposalEntry.item] },
    proposals: [proposalEntry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  const calls = [];
  const updates = [];
  const correctedRoster = {
    parties: [
      { id: "saenuri-party", name: "Saenuri Party" },
      { id: "democratic-party-korea", name: "Democratic Party" },
      { id: "unified-progressive-party", name: "Unified Progressive Party" },
    ],
  };

  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    onBatch: (update) => updates.push(update),
    callModel: async (system, history, opts) => {
      calls.push(opts.tool?.name);
      if (calls.length === 1) {
        assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
        assert.match(history?.[0]?.parts?.[0]?.text ?? "", /F7 \[parties\[1\]\.identity\].*New Politics Alliance for Democracy/);
        return { toolInput: { checksJson: JSON.stringify([{
          polityKey,
          verdict: "challenge",
          confidence: "high",
          issue: "New Politics Alliance for Democracy was formed on 26 March 2014 and did not exist on 22 March 2014.",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"],
          challengedFactIds: ["F7"],
        }]) } };
      }
      assert.equal(opts.tool?.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name);
      const userMessage = history?.[0]?.parts?.[0]?.text ?? "";
      assert.match(userMessage, /CONSENSUS ADJUDICATION REQUIRED/);
      assert.match(userMessage, /TEMPORAL SENTINEL: verdict=challenge/);
      assert.match(system + userMessage, /TEMPORAL CORRECTION OBLIGATION:[\s\S]*ESTABLISHED/);
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "corrected",
        confidence: "high",
        issue: "NPAD did not yet exist on 22 March 2014; the Democratic Party was the opposition identity on the scenario date.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify(correctedRoster),
      }] } };
    },
  });

  assert.deepEqual(calls, [POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name]);
  assert.equal(updates[0].sampleError.polityKey, polityKey);
  assert.match(updates[0].sampleError.errors[0], /formed on 26 March 2014/i);
  assert.equal(rechecked.historicalVerification.recheckOnly, true);
  assert.deepEqual(rechecked.historicalVerification.consensus.disputedPolities, [polityKey]);
  assert.deepEqual(rechecked.historicalVerification.consensus.stickyAdjudicationPolities, [polityKey]);
  assert.equal(rechecked.historicalVerification.corrected, 1);
  assert.equal(rechecked.proposals[0].proposal.actorPatch.parties.some((party) => /new politics alliance/i.test(party.name)), false);
  assert.deepEqual(rechecked.proposals[0].proposal.actorPatch.parties.map((party) => party.name), ["Saenuri Party", "Democratic Party", "Unified Progressive Party"]);
});

test("temporal sentinel cannot clear Korea by omitting the future roster FACT from checkedFactIds", async () => {
  const polityKey = "Republic of Korea";
  const proposalEntry = {
    item: { polityKey, depth: "standard", needs: ["political_system", "governing_structure", "representation_entities"] },
    proposal: {
      schemaVersion: 1,
      polityKey,
      scenarioDate: "2014-03-22",
      depth: "standard",
      provenance: { source: "generated", confidence: "high", generatedAt: fixedNow },
      actorPatch: {
        politicalSystem: { type: "presidential_republic", representation: "electoral" },
        government: { form: "Presidential republic", headOfState: "Park Geun-hye", headOfGovernment: "Jung Hong-won" },
        parties: [
          { id: "saenuri-party", name: "Saenuri Party" },
          { id: "new-politics-alliance-for-democracy", name: "New Politics Alliance for Democracy" },
        ],
      },
    },
    validation: { provenance: { confidence: "high" } },
    historicalVerification: { verdict: "confirmed", confidence: "high", issue: "" },
  };
  const result = {
    schemaVersion: 1,
    scenarioDate: "2014-03-22",
    generatedAt: fixedNow,
    plan: { scenarioDate: "2014-03-22", items: [proposalEntry.item] },
    proposals: [proposalEntry],
    failures: [],
    warnings: [],
    batches: [],
    diagnostics: [],
    generatedPolities: 1,
    failedPolities: 0,
  };
  let calls = 0;
  const rechecked = await reverifyPoliticalWorldProposalsCore({
    result,
    scenarioDate: "2014-03-22",
    politicalActors: { byPolity: {} },
    generatedAt: fixedNow,
    callModel: async (_system, _history, opts) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(opts.tool?.name, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name);
        return { toolInput: { checks: [{
          polityKey,
          verdict: "clear",
          confidence: "high",
          issue: "",
          checkedFactIds: ["F1", "F2", "F3", "F4", "F5", "F6"],
          challengedFactIds: [],
        }] } };
      }
      assert.equal(opts.tool?.name, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name);
      return { toolInput: { verifications: [{
        polityKey,
        verdict: "corrected",
        confidence: "high",
        issue: "NPAD did not yet exist on the scenario date.",
        correctionScopes: ["representation_roster"],
        replaceRepresentationEntities: true,
        correctedIdentityJson: JSON.stringify({
          parties: [
            { id: "saenuri-party", name: "Saenuri Party" },
            { id: "democratic-party-korea", name: "Democratic Party" },
          ],
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(rechecked.historicalVerification.consensus.disputedPolities, [polityKey]);
  assert.equal(rechecked.historicalVerification.corrected, 1);
  assert.equal(rechecked.proposals[0].proposal.actorPatch.parties.some((party) => /new politics alliance/i.test(party.name)), false);
});


test("quantitative-only backfill uses one existing generation call and does not rewrite identity", async () => {
  let calls = 0;
  let promptText = "";
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Federal Republic of Germany"],
    politicalActors: { byPolity: {
      "Federal Republic of Germany": {
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Federal parliamentary republic", headOfState: "Joachim Gauck", headOfGovernment: "Angela Merkel", rulingPartyIds: ["cdu-csu"] },
        parties: [
          { id: "cdu-csu", name: "CDU/CSU" },
          { id: "spd", name: "SPD" },
          { id: "greens", name: "Alliance 90/The Greens" },
          { id: "left", name: "The Left" },
        ],
      },
    } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: true,
    callModel: async (_system, messages, opts) => {
      calls += 1;
      assert.equal(opts.tool?.name, POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name);
      promptText = messages?.[0]?.parts?.[0]?.text || "";
      return { toolInput: { landscapes: [{
        polityKey: "Federal Republic of Germany",
        landscapeJson: JSON.stringify({
          "cdu-csu": 36,
          spd: 26,
          greens: 10,
          left: 9,
        }),
      }] } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.historicalVerification.requested, 0);
  assert.match(result.historicalVerification.skippedReason, /no generated date-sensitive identity fields/);
  assert.deepEqual(result.plan.items[0].needs, [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE]);
  assert.match(promptText, /QUANTITATIVE LANDSCAPES TO ESTIMATE/);
  assert.equal(result.quantitativeLandscapeFastPath.modelCalls, 1);
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties.map((party) => [party.id, party.support.percent, party.support.basis]), [
    ["cdu-csu", 36, "generated-estimate"],
    ["spd", 26, "generated-estimate"],
    ["greens", 10, "generated-estimate"],
    ["left", 9, "generated-estimate"],
  ]);
  assert.equal(result.proposals[0].proposal.government, undefined);
});

test("missing support estimate is repaired natively without burning the retry budget", async () => {
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {
      "Republic X": {
        politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
        government: { form: "Parliamentary republic", headOfGovernment: "Leader", rulingPartyIds: ["a"] },
        parties: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      },
    } },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, _messages, opts) => {
      calls += 1;
      assert.equal(opts.tool?.name, POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name);
      return { toolInput: { landscapes: [{
        polityKey: "Republic X",
        landscapeJson: JSON.stringify({ a: 55 }),
      }] } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  const parties = result.proposals[0].proposal.actorPatch.parties;
  assert.equal(parties.find((party) => party.id === "a").support.basis, "generated-estimate");
  assert.equal(parties.find((party) => party.id === "b").support.basis, "native-fallback-estimate");
});

test("party-state quantitative baseline uses influenceEstimate instead of supportEstimate", async () => {
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["People's Republic X"],
    politicalActors: { byPolity: {
      "People's Republic X": {
        politicalSystem: { type: "one_party_state", representation: "party_state" },
        government: { form: "One-party socialist republic", headOfState: "Leader", headOfGovernment: "Premier", rulingPartyIds: ["workers"] },
        parties: [{ id: "workers", name: "Workers Party" }],
      },
    } },
    maxAttempts: 1,
    generatedAt: fixedNow,
    callModel: async (_system, _messages, opts) => {
      assert.equal(opts.tool?.name, POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name);
      return { toolInput: { landscapes: [{
        polityKey: "People's Republic X",
        landscapeJson: JSON.stringify({ workers: 100 }),
      }] } };
    },
  });
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties[0].influence, { percent: 100, basis: "generated-estimate" });
  assert.equal(result.proposals[0].proposal.actorPatch.parties[0].support, undefined);
});

test("202 existing RICH actors prioritize quantitative backfill into five lightweight model calls", async () => {
  const polities = Array.from({ length: 202 }, (_, index) => `Polity ${String(index + 1).padStart(3, "0")}`);
  const byPolity = Object.fromEntries(polities.map((polityKey) => [polityKey, {
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", headOfGovernment: "Incumbent", rulingPartyIds: ["a"] },
    parties: [{ id: "a", name: "Party A" }, { id: "b", name: "Party B" }],
    // Deliberately omit RICH-only traits/response profiles/strategic context.
    // Balanced mode promotes existing actors to RICH, but Round-Zero landscape
    // bootstrap must still run first through the cheap fast path.
  }]));
  const relevanceByPolity = Object.fromEntries(polities.map((polityKey) => [polityKey, { depth: "rich" }]));
  const calls = [];
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities,
    politicalActors: { byPolity },
    relevanceByPolity,
    prioritizeQuantitativeLandscapeBackfill: true,
    maxAttempts: 2,
    generatedAt: fixedNow,
    verifyHistoricalIdentity: true,
    callModel: async (_system, messages, opts) => {
      calls.push(opts.tool?.name);
      assert.equal(opts.tool?.name, POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name);
      const text = messages?.[0]?.parts?.[0]?.text || "";
      const requested = [...text.matchAll(/^POLITY: (.+)$/gm)].map((match) => match[1].trim());
      assert.ok(requested.length > 0 && requested.length <= POLITICAL_WORLD_LANDSCAPE_FAST_BATCH_SIZE);
      return { toolInput: { landscapes: requested.map((polityKey) => ({
        polityKey,
        landscapeJson: JSON.stringify({ a: 55, b: 35 }),
      })) } };
    },
  });

  assert.ok(result.plan.items[0].needs.includes(POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE));
  assert.ok(result.plan.items[0].needs.includes(POLITICAL_GENERATION_NEEDS.LEADERSHIP_TRAITS));
  assert.ok(result.plan.items[0].needs.includes(POLITICAL_GENERATION_NEEDS.RESPONSE_PROFILES));
  assert.equal(calls.length, 5);
  assert.deepEqual(calls, Array(5).fill(POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name));
  assert.equal(result.generatedPolities, 202, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  assert.equal(result.historicalVerification.requested, 0);
  assert.equal(result.quantitativeLandscapeFastPath.requested, 202);
  assert.equal(result.quantitativeLandscapeFastPath.batchSize, 48);
  assert.equal(result.quantitativeLandscapeFastPath.batches, 5);
  assert.equal(result.quantitativeLandscapeFastPath.modelCalls, 5);
  assert.deepEqual(result.quantitativeLandscapeFastPath.nativeFallbackPolities, []);
  assert.equal(result.batches.filter((batch) => batch.phase === "quantitative-landscape-fast").length, 5);
  assert.deepEqual(result.proposals[0].item.needs, [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE]);
  assert.ok(Object.keys(result.quantitativeLandscapeFastPath.deferredEnrichmentNeedsByPolity).length === 202);
});

test("malformed or omitted individual fast-path landscapes are salvaged natively without retrying the batch", async () => {
  const polities = ["Republic A", "Republic B", "Republic C"];
  const byPolity = Object.fromEntries(polities.map((polityKey) => [polityKey, {
    politicalSystem: { type: "parliamentary_republic", representation: "electoral" },
    government: { form: "Parliamentary republic", headOfGovernment: "Incumbent", rulingPartyIds: ["a"] },
    parties: [{ id: "a", name: "Party A" }, { id: "b", name: "Party B" }],
  }]));
  let calls = 0;
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities,
    politicalActors: { byPolity },
    maxAttempts: 2,
    generatedAt: fixedNow,
    callModel: async (_system, _messages, opts) => {
      calls += 1;
      assert.equal(opts.tool?.name, POLITICAL_WORLD_LANDSCAPE_FAST_TOOL.name);
      return { toolInput: { landscapes: [
        { polityKey: "Republic A", landscapeJson: JSON.stringify({ a: 52, b: 38 }) },
        { polityKey: "Republic B", landscapeJson: "{malformed" },
        // Republic C deliberately omitted. Both B and C must fall back natively
        // without a second provider request for the batch.
      ] } };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.generatedPolities, 3, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  assert.equal(result.quantitativeLandscapeFastPath.modelCalls, 1);
  assert.deepEqual(new Set(result.quantitativeLandscapeFastPath.nativeFallbackPolities), new Set(["Republic B", "Republic C"]));
  const byKey = new Map(result.proposals.map((entry) => [entry.item.polityKey, entry.proposal.actorPatch]));
  assert.equal(byKey.get("Republic A").parties[0].support.basis, "generated-estimate");
  assert.ok(byKey.get("Republic B").parties.every((party) => party.support.basis === "native-fallback-estimate"));
  assert.ok(byKey.get("Republic C").parties.every((party) => party.support.basis === "native-fallback-estimate"));
});

test("PWV2 generated electoral roster coverage retries a shallow Other-heavy landscape instead of accepting it", async () => {
  let calls = 0;
  let retryPrompt = "";
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { depth: "minimal" } },
    maxBatchSize: 1,
    maxAttempts: 2,
    requireRepresentationCoverage: true,
    generatedAt: fixedNow,
    callModel: async (_systemPrompt, history) => {
      calls += 1;
      if (calls === 2) retryPrompt = String(history?.at(-1)?.parts?.[0]?.text ?? "");
      const parties = calls === 1
        ? [
            { id: "government", name: "Government Party", supportEstimate: 50 },
            { id: "opposition", name: "Opposition Party", supportEstimate: 15 },
          ]
        : [
            { id: "government", name: "Government Party", supportEstimate: 40 },
            { id: "coalition", name: "Coalition Partner", supportEstimate: 25 },
            { id: "opposition", name: "Opposition Party", supportEstimate: 10 },
            { id: "reform", name: "Reform Party", supportEstimate: 8 },
          ];
      return { toolInput: { proposals: [{
        polityKey: "Republic X",
        confidence: "high",
        sourceAsOf: "2014-03-22",
        referenceDates: ["2014-03-22"],
        actorPatchJson: JSON.stringify({
          politicalSystem: { type: "parliamentary_republic", representation: "electoral", regimeCharacter: "democratic" },
          government: {
            form: "Parliamentary republic",
            headOfGovernment: "Prime Minister X",
            rulingPartyIds: ["government"],
            coalitionPartyIds: calls === 1 ? [] : ["coalition"],
          },
          parties,
        }),
      }] } };
    },
  });

  assert.equal(calls, 2);
  assert.match(retryPrompt, /at least 75% of estimated support/i);
  assert.equal(result.generatedPolities, 1, JSON.stringify(result.failures));
  assert.equal(result.failedPolities, 0);
  assert.deepEqual(result.proposals[0].proposal.actorPatch.parties.map((party) => party.id), [
    "government", "coalition", "opposition", "reform",
  ]);
  assert.deepEqual(result.proposals[0].proposal.actorPatch.government.coalitionPartyIds, ["coalition"]);
  assert.equal(result.proposals[0].proposal.actorPatch.politicalSystem.regimeCharacter, "democratic");
  assert.equal(
    result.diagnostics[0].polities[0].droppedPaths.includes("actorPatch.politicalSystem.regimeCharacter"),
    false,
    "a required canonical regimeCharacter must survive requested-scope projection",
  );
});

test("external one-call Political World v2 retries preserve prior native validation feedback", async () => {
  let promptText = "";
  const result = await generatePoliticalWorldProposalsCore({
    scenarioDate: "2014-03-22",
    polities: ["Republic X"],
    politicalActors: { byPolity: {} },
    relevanceByPolity: { "Republic X": { depth: "standard" } },
    maxBatchSize: 1,
    maxAttempts: 1,
    verifyHistoricalIdentity: false,
    retryErrorsByPolity: {
      "Republic X": ["Generated non-electoral political systems may not invent party polling/support percentages"],
    },
    generatedAt: fixedNow,
    callModel: async (_systemPrompt, history) => {
      promptText = String(history?.at(-1)?.parts?.[0]?.text ?? "");
      return { toolInput: { proposals: [{
        polityKey: "Republic X",
        confidence: "high",
        sourceAsOf: "2014-03-22",
        referenceDates: ["2014-03-22"],
        actorPatchJson: JSON.stringify({
          politicalSystem: { type: "presidential_republic", representation: "electoral" },
          government: { form: "Presidential republic", headOfState: "Leader X", headOfGovernment: "Leader X" },
          parties: [
            { id: "party-a", name: "Party A", ideology: "Liberalism", supportEstimate: 55 },
            { id: "party-b", name: "Party B", ideology: "Conservatism", supportEstimate: 45 },
          ],
        }),
      }] } };
    },
  });

  assert.match(promptText, /PREVIOUS ATTEMPT VALIDATION ERRORS/i);
  assert.match(promptText, /non-electoral political systems may not invent party polling\/support percentages/i);
  assert.equal(result.generatedPolities, 1);
  assert.equal(result.failedPolities, 0);
});

test("alternate authority keeps a later target world separate from an exclusive reference-canon cutoff", () => {
  const historyAuthority = {
    referenceAllowed: true,
    referenceAuthority: "pre-divergence-only",
    cutoffDate: "1963-11-22",
    cutoffInclusive: false,
    referenceHorizonDate: "1963-11-21",
    scenarioStartDate: "2014-03-22",
  };
  const item = { polityKey: "Example Polity", depth: "standard", needs: ["governing_structure", "strategic_context"] };

  const generation = buildPoliticalWorldGenerationPrompt({
    scenarioDate: "2014-03-22",
    historyAuthority,
    items: [item],
    politicalActors: { byPolity: {} },
    scenarioContext: "AUTHOR CANON: the reference timeline diverged in 1963 and the designed 2014 world is authoritative.",
  });
  assert.match(generation.systemPrompt, /TARGET START-WORLD DATE: 2014-03-22/);
  assert.match(generation.systemPrompt, /only BEFORE 1963-11-22/);
  assert.match(generation.systemPrompt, /1963-11-22 itself and everything after it belong to scenario\/derived canon/i);
  assert.match(generation.systemPrompt, /Never snap them back toward a remembered external timeline/i);
  assert.match(generation.systemPrompt, /sourceAsOf\/referenceDates refer ONLY to external\/reference evidence/i);

  const entry = {
    item,
    proposal: { polityKey: "Example Polity", actorPatch: { government: { form: "Republic", headOfState: "Scenario Leader" }, goals: ["Preserve the authored order"] } },
    validation: { actor: { government: { form: "Republic", headOfState: "Scenario Leader" }, goals: ["Preserve the authored order"] } },
  };
  const verification = buildPoliticalWorldHistoricalVerificationPrompt({
    scenarioDate: "2014-03-22",
    historyAuthority,
    entries: [entry],
    scenarioContext: "AUTHOR CANON: Scenario Leader is the 2014 head of state.",
  });
  assert.match(verification.systemPrompt, /TEMPORAL AUTHORITY verifier/);
  assert.match(verification.systemPrompt, /disagreement with remembered external\/reference history on the target date is NOT evidence of an error/i);
  assert.match(verification.systemPrompt, /only BEFORE 1963-11-22/);

  const sentinel = buildPoliticalWorldTemporalSentinelPrompt({
    scenarioDate: "2014-03-22",
    historyAuthority,
    entries: [entry],
    scenarioContext: "AUTHOR CANON: Scenario Leader is the 2014 head of state.",
  });
  assert.match(sentinel.systemPrompt, /Do NOT challenge a target-date identity merely because remembered external\/reference canon had a different officeholder/i);
});

test("quantitative landscape backfill obeys the same divergent reference boundary as full Political Actor generation", () => {
  const { systemPrompt } = buildPoliticalWorldLandscapeFastPrompt({
    scenarioDate: "2400-01-01",
    historyAuthority: {
      referenceAllowed: true,
      referenceAuthority: "pre-divergence-only",
      cutoffDate: "2300-05-01",
      cutoffInclusive: false,
    },
    items: [{ polityKey: "Crown of Aster", needs: [POLITICAL_GENERATION_NEEDS.QUANTITATIVE_LANDSCAPE] }],
    politicalActors: { byPolity: {
      "Crown of Aster": {
        politicalSystem: { representation: "electoral" },
        government: { rulingPartyIds: ["a"] },
        parties: [{ id: "a", name: "Solar League" }, { id: "b", name: "Outer Compact" }],
      },
    } },
  });
  assert.match(systemPrompt, /TARGET START-WORLD DATE: 2400-01-01/);
  assert.match(systemPrompt, /only BEFORE 2300-05-01/);
  assert.match(systemPrompt, /Never import post-boundary facts from an external\/reference canon/i);
});
