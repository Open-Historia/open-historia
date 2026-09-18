import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync(new URL("./politicalWorldGeneratorCore.js", import.meta.url), "utf8");
const provider = fs.readFileSync(new URL("./politicalWorldGenerator.js", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("./providerConfig.js", import.meta.url), "utf8");

test("Phase006B calls AI through the existing provider seam but owns no world persistence", () => {
  assert.match(provider, /import \{ callAI \} from "\.\/main\.jsx"/);
  assert.match(provider, /generatePoliticalWorldProposalsCore/);
  assert.match(provider, /reverifyPoliticalWorldProposalsCore/);
  assert.match(provider, /reverifyPoliticalWorldProposals/);
  assert.doesNotMatch(core + provider, /writeWorldState|writeGameState|writeScenario|simulateTimelineJump|nativeWorldDirector/);
});

test("Phase006B keeps generation bounded, retry-limited, and downstream of the Phase006A validator", () => {
  assert.match(core, /buildPoliticalGenerationPlan/);
  assert.match(core, /POLITICAL_WORLD_GENERATOR_MAX_ATTEMPTS = 2/);
  assert.match(core, /validatePoliticalGenerationProposal/);
  assert.match(core, /maxItems: 12/);
  assert.match(core, /behavioralDisposition and politicalPressures/);
});

test("Political World generation and Round-Zero verification have separate per-task model routing keys", () => {
  assert.match(config, /key: "politicalWorldGeneration"/);
  assert.match(config, /key: "politicalWorldVerification"/);
  assert.match(provider, /verifyHistoricalIdentity: options\.verifyHistoricalIdentity \?\? true/);
  assert.match(core, /POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL/);
  assert.match(core, /POLITICAL_WORLD_HISTORICAL_VERIFICATION_BATCH_SIZE = 4/);
  assert.match(core, /crossPolityOfficeholderCollisions/);
});
