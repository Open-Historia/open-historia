import test from "node:test";
import assert from "node:assert/strict";

import {
  bindSelectedStorylineEvents,
} from "../src/Game/AI/nativeWorldDirector.js";
import {
  validateGameplayPayload,
} from "../src/Game/AI/gameplaySchemas.js";

const korea = {
  id: "storyline-korean-peninsula-crisis",
  kind: "crisis",
  title: "Korean Peninsula Security Crisis",
  participants: [
    "Republic of Korea",
    "United States of America",
    "Democratic People's Republic of Korea",
    "Japan",
    "People's Republic of China",
    "Russian Federation",
  ],
  status: "active",
  pressure: 60,
  momentum: 55,
  state:
    "Working-level nuclear negotiations between Washington and Pyongyang concluded without agreement.",
};

test("selected-storyline native binding attaches the orphan Nov 18 Korea drill event", () => {
  const candidate = {
    events: [{
      id: "event-ai-r0072-20191118-003",
      date: "2019-11-18",
      importance: "major",
      kind: "military",
      title: "United States, South Korea, and Japan Conduct Joint Missile-Defense Readiness Drills",
      description:
        "Following the breakdown of working-level nuclear negotiations in Stockholm, armed forces of the United States, South Korea, and Japan execute joint ballistic missile-defense tracking and readiness drills in response to ongoing North Korean missile testing.",
      storylineIds: [],
      impacts: {
        actionIds: [],
        createdChats: [],
        markerOps: [],
        polityChanges: [],
        regionControlOps: [],
        regionTransfers: [],
        unitOps: [],
      },
    }],
  };

  const result = bindSelectedStorylineEvents(candidate, {
    selectedStorylines: [korea],
    world: {},
  });

  assert.equal(result.bound, 1);
  assert.deepEqual(candidate.events[0].storylineIds, [
    "storyline-korean-peninsula-crisis",
  ]);
});

test("selected-storyline native binding refuses ambiguous near-ties", () => {
  const shared = {
    status: "active",
    participants: ["Republic of Korea", "Japan"],
    pressure: 60,
    momentum: 50,
    state: "Regional security coordination remains active.",
  };

  const candidate = {
    events: [{
      title: "South Korea and Japan Hold Regional Security Coordination Drills",
      description: "South Korea and Japan conduct regional security coordination drills.",
      storylineIds: [],
    }],
  };

  const result = bindSelectedStorylineEvents(candidate, {
    selectedStorylines: [
      {
        ...shared,
        id: "storyline-a",
        kind: "crisis",
        title: "Regional Security Crisis",
      },
      {
        ...shared,
        id: "storyline-b",
        kind: "crisis",
        title: "Regional Security Coordination",
      },
    ],
    world: {},
  });

  assert.equal(result.bound, 0);
  assert.deepEqual(candidate.events[0].storylineIds, []);
});

test("world motion repair schema physically allows only one storyline semantic update", () => {
  const valid = {
    stopDate: "2019-11-25",
    storyline: {
      id: "storyline-korean-peninsula-crisis",
      status: "active",
      pressure: 68,
      momentum: 62,
      startedDate: "2019-08-14",
      kind: "crisis",
      title: "Korean Peninsula Security Crisis",
      participants: korea.participants,
      state:
        "Joint allied missile-defense drills and failed nuclear talks have hardened the confrontation while diplomacy remains open.",
    },
    summary: "Allied drills increased pressure after the failed talks.",
  };

  assert.equal(validateGameplayPayload("worldMotionRepair", valid).valid, true);

  const invalid = {
    ...valid,
    events: [{
      date: "2019-11-18",
      title: "Extra event",
      description: "Not allowed.",
    }],
  };

  const validation = validateGameplayPayload("worldMotionRepair", invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.error, /not allowed|unexpected property|additional/i);
});
