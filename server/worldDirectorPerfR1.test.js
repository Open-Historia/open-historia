import test from "node:test";
import assert from "node:assert/strict";

import { buildWorldInitiativeContext } from "../src/Game/AI/nativeWorldDirector.js";

test("world initiative stays near-linear on a 5k-region ownership ledger", () => {
  const regionOwnershipOverrides = {};
  const polityOverrides = {};
  const countryStats = {};

  const actors = Array.from({ length: 180 }, (_, index) => `Test Polity ${index + 1}`);
  for (const actor of actors) {
    polityOverrides[actor] = {
      name: actor,
      code: actor,
      aliases: [actor],
      status: "active",
    };
    countryStats[actor] = {};
  }

  for (let index = 0; index < 5000; index += 1) {
    regionOwnershipOverrides[String(index + 1)] = actors[index % actors.length];
  }

  const bundle = {
    game: {
      country: actors[0],
      gameDate: "2019-12-24",
      round: 73,
    },
    events: Array.from({ length: 70 }, (_, index) => ({
      id: `event-${index + 1}`,
      date: `2019-12-${String((index % 24) + 1).padStart(2, "0")}`,
      title: `${actors[index % actors.length]} event ${index + 1}`,
      description: "A concrete current development.",
      importance: index % 5 === 0 ? "major" : "minor",
      impacts: {
        regionTransfers: [],
        regionClaims: [],
        polityChanges: [],
        unitOps: [],
        markerOps: [],
        createdChats: [],
      },
      storylineIds: [],
    })),
    chats: [],
    world: {
      polityOverrides,
      countryStats,
      regionOwnershipOverrides,
      regionClaimants: {},
      storylines: [],
      wars: [],
      relations: [],
      agreements: [],
      units: [],
      consolidatedHistory: [],
    },
  };

  const started = performance.now();
  const result = buildWorldInitiativeContext(bundle, {
    targetDate: "2020-01-24",
  });
  const elapsed = performance.now() - started;

  assert.equal(result.analysis.explorationSlate.length, 10);
  // This is intentionally generous for CI. The pre-fix nested alias rebuild
  // performed a full 5k-region identity scan once per region owner and could take
  // tens of seconds to minutes; the indexed/unique-owner path should be far below.
  assert.ok(
    elapsed < 5000,
    `world initiative took ${elapsed.toFixed(1)}ms on the 5k-region regression fixture`,
  );
});
