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

test("Round-Zero publication uses one guarded canonical mutation instead of independent event/world writes", () => {
  const body = functionBody("maybeGeneratePregameHistory");
  assert.match(body, /const campaignId = activeCampaignId\(\)/);
  assert.match(body, /mutateCanonicalTurnState\(\(current\) =>/);
  assert.match(body, /expectedGameId: campaignId/);
  assert.match(body, /Round-Zero canonical .* conservation failed/);
  assert.doesNotMatch(body, /writeEventsState\(bootstrapEvents/);
  assert.doesNotMatch(body, /writeWorldState\(bootstrapWorld/);
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

test("Round-Zero validates conservation before and after native war mirrors", () => {
  assert.match(gameplaySource, /pregameCanonicalReceipt: sourceCounts/);
  assert.match(gameplaySource, /pregameCanonicalConservationError\(candidate\)/);
  assert.match(gameplaySource, /pregameCanonicalConservationError\(candidate, \{ includeNativeMirrors: true \}\)/);
  assert.match(gameplaySource, /silent truncation is forbidden/);
});
