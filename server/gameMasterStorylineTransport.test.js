import test from "node:test";
import assert from "node:assert/strict";

import {
  GAME_MASTER_SCHEMA,
  GAME_MASTER_TRANSPORT_SCHEMA,
  decodeGameMasterTransportPayload,
} from "../src/Game/AI/gameplaySchemas.js";

test("GM transport carries canonical storylineUpdates through the shallow provider seam", () => {
  assert.ok(GAME_MASTER_SCHEMA.required.includes("storylineUpdates"));
  assert.ok(GAME_MASTER_TRANSPORT_SCHEMA.required.includes("storylineUpdatesJson"));

  const decoded = decodeGameMasterTransportPayload({
    mode: "world-intervention",
    summary: "Escalate an unresolved national crisis.",
    eventsJson: "[]",
    countryStatPatchesJson: "[]",
    storylineUpdatesJson: JSON.stringify([{
      id: "storyline-regime-crisis",
      status: "active",
      pressure: 82,
      momentum: 74,
      kind: "crisis",
      title: "Regime Crisis",
      participants: ["Example Republic"],
      eventIndexes: [0],
      state: "Elite conflict and nationwide unrest remain unresolved.",
    }]),
    warUpdatesJson: "[]",
    relationUpdatesJson: "[]",
    agreementUpdatesJson: "[]",
    diplomaticOutreachJson: "[]",
  });

  assert.equal(decoded.error, "");
  assert.equal(decoded.payload.storylineUpdates.length, 1);
  assert.equal(decoded.payload.storylineUpdates[0].id, "storyline-regime-crisis");
  assert.deepEqual(decoded.payload.storylineUpdates[0].eventIndexes, [0]);
});
