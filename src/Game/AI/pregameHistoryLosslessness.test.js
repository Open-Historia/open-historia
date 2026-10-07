import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applyWorldStorylineUpdates } from "./nativeWorldDirector.js";

const gameplaySource = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

const functionBody = (name) => {
  const start = gameplaySource.indexOf(`export const ${name} = async`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = gameplaySource.indexOf("\nexport const ", start + 1);
  return next === -1 ? gameplaySource.slice(start) : gameplaySource.slice(start, next);
};

test("Round-Zero publication recompiles the semantic candidate inside one guarded canonical mutation", () => {
  const body = functionBody("maybeGeneratePregameHistory");
  assert.match(body, /const campaignId = activeCampaignId\(\)/);
  assert.match(body, /mutateCanonicalTurnState\(\(current\) =>/);
  assert.match(body, /const currentWorld = normalizeWorldState\(current\.world\)/);
  assert.match(body, /compilePregameBootstrapCandidate\(\{/);
  assert.match(body, /candidate: buildPregameSemanticCandidate\(payload\)/);
  assert.match(body, /eventIdsByRef: eventRefs\.map/);
  assert.match(body, /compilation\.projectedWorld/);
  assert.match(body, /expectedGameId: campaignId/);
  assert.doesNotMatch(body, /writeEventsState\(bootstrapEvents/);
  assert.doesNotMatch(body, /writeWorldState\(bootstrapWorld/);
  assert.doesNotMatch(body, /applyWarUpdates\(/);
  assert.doesNotMatch(body, /applyDiplomaticUpdates\(/);
  assert.doesNotMatch(body, /applyWorldStorylineUpdates\(/);
});

test("Round-Zero can preserve an unknown storyline start date without changing normal-turn behavior", () => {
  const update = {
    id: "storyline-war-unknown",
    status: "active",
    pressure: 80,
    momentum: 20,
    startedDate: "",
    kind: "war",
    title: "War with unknown opening date",
    participants: ["A", "B"],
    eventIndexes: [],
    state: "The conflict is already active when play begins.",
  };

  const baseline = applyWorldStorylineUpdates({
    world: { storylines: [] },
    updates: [update],
    events: [],
    stopDate: "2021-07-18",
    round: 1,
    preserveUnknownStartedDate: true,
  });
  assert.equal(baseline.world.storylines[0].startedDate, "");
  assert.equal(baseline.world.storylines[0].accountedThroughDate, "2021-07-18");

  const ordinary = applyWorldStorylineUpdates({
    world: { storylines: [] },
    updates: [update],
    events: [],
    stopDate: "2021-07-18",
    round: 1,
  });
  assert.equal(ordinary.world.storylines[0].startedDate, "2021-07-18");
});

test("Round-Zero semantic compiler owns conservation and native-derived war mirrors", () => {
  const body = functionBody("maybeGeneratePregameHistory");
  assert.match(gameplaySource, /compilePregameBootstrapCandidate/);
  assert.doesNotMatch(gameplaySource, /expandCanonicalUpdateEnvelope/);
  assert.doesNotMatch(gameplaySource, /ensurePregameWarStorylineMirrors/);
  assert.doesNotMatch(gameplaySource, /pregameCanonicalReceipt/);
  assert.match(body, /normalizeArray\(compilation\?\.receipt\?\.facts\)/);
  assert.match(body, /normalizeArray\(compilation\?\.receipt\?\.derived\)/);
  assert.match(body, /normalizeString\(entry\?\.kind\) === "war-storyline"/);
  assert.match(body, /pregameBootstrapContractVersion: PREGAME_BOOTSTRAP_CONTRACT_VERSION/);
});
