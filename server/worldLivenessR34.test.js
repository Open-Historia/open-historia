import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeWorldStorylineUpdates,
  stripQuietDeferredStorylineUpdates,
  validateWorldStorylinePayload,
} from "../src/Game/AI/nativeWorldDirector.js";

const deferredNato = {
  id: "storyline-nato-reassurance",
  status: "active",
  pressure: 42,
  momentum: 28,
  startedDate: "2019-01-01",
  kind: "security",
  title: "NATO Eastern Flank Reassurance",
  participants: [
    "Republic of Latvia",
    "Republic of Poland",
    "United States of America",
  ],
  state: "NATO maintains an established reassurance posture on the eastern flank.",
};

test("R3.4 strips linked-but-nonmaterial deferred re-entry without discarding the event", () => {
  const candidate = {
    events: [{
      id: "event1",
      date: "2020-03-10",
      importance: "minor",
      kind: "military",
      title: "NATO Eastern Flank Patrol Rotation Continues",
      description:
        "Routine allied patrol rotations and scheduled artillery training continue under the existing reassurance posture without a change in deployment, readiness, command, or policy.",
      storylineIds: ["storyline-nato-reassurance"],
      impacts: {
        actionIds: [],
        createdChats: [],
        markerOps: [],
        polityChanges: [],
        regionClaims: [],
        regionTransfers: [],
        unitOps: [],
      },
    }],
    storylineUpdates: [{
      ...deferredNato,
      eventIndexes: [0],
      state: "Routine patrols and artillery training continue under the established reassurance posture.",
    }],
  };

  const salvage = stripQuietDeferredStorylineUpdates(candidate, [deferredNato]);

  assert.deepEqual(salvage.strippedIds, ["storyline-nato-reassurance"]);
  assert.deepEqual(salvage.strippedNonMaterialIds, ["storyline-nato-reassurance"]);
  assert.equal(candidate.events.length, 1, "the unrelated/independently worthwhile event survives salvage");
  assert.deepEqual(candidate.events[0].storylineIds, [], "invalid deferred ownership is removed from the event");
  assert.equal(decodeWorldStorylineUpdates(candidate.storylineUpdates).length, 0);

  const validation = validateWorldStorylinePayload(candidate, {
    existingStorylines: [deferredNato],
    selectedStorylines: [],
    deferredStorylines: [deferredNato],
    originDate: "2020-02-22",
    stopDate: "2020-03-23",
    enforceAntiStasis: false,
    enforceSelectedCoverage: false,
    world: { storylines: [deferredNato] },
  });
  assert.equal(validation, "");
});

test("R3.4 preserves a deferred storyline when its linked event is a real material re-entry", () => {
  const candidate = {
    events: [{
      id: "event1",
      date: "2020-03-10",
      importance: "major",
      kind: "military",
      title: "NATO Deploys Additional Air-Defense Battery to Latvia",
      description:
        "Following a new regional threat assessment, NATO deploys an additional air-defense battery to Latvia and raises the readiness of associated command elements.",
      storylineIds: ["storyline-nato-reassurance"],
      impacts: {
        actionIds: [],
        createdChats: [],
        markerOps: [],
        polityChanges: [],
        regionClaims: [],
        regionTransfers: [],
        unitOps: [{ op: "spawn", name: "NATO Air Defense Battery", owner: "United States of America" }],
      },
    }],
    storylineUpdates: [{
      ...deferredNato,
      pressure: 51,
      momentum: 44,
      eventIndexes: [0],
      state: "A new air-defense deployment raises the eastern-flank reassurance posture beyond routine rotation.",
    }],
  };

  const salvage = stripQuietDeferredStorylineUpdates(candidate, [deferredNato]);
  assert.deepEqual(salvage.strippedIds, []);
  assert.equal(decodeWorldStorylineUpdates(candidate.storylineUpdates).length, 1);
  assert.deepEqual(candidate.events[0].storylineIds, ["storyline-nato-reassurance"]);
});
