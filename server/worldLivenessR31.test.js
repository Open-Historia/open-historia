import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWorldStorylineEventLinks,
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

const drill = (title, description) => ({
  id: "event-ai-r0072-20191118-003",
  date: "2019-11-18",
  importance: "major",
  kind: "military",
  title,
  description,
  storylineIds: [],
  impacts: {
    actionIds: [],
    createdChats: [],
    markerOps: [],
    polityChanges: [],
    regionClaims: [],
    regionTransfers: [],
    unitOps: [],
  },
});

const DRILLS = [
  ["United States, South Korea, and Japan Conduct Joint Missile-Defense Readiness Drills", "Following the breakdown of working-level nuclear negotiations in Stockholm, armed forces of the United States, South Korea, and Japan execute joint ballistic missile-defense tracking and readiness drills in response to ongoing North Korean missile testing."],
  ["미국·한국·일본, 합동 미사일 방어 준비태세 훈련 실시", "스톡홀름 실무 협상이 결렬된 뒤 세 나라 군은 북한의 계속되는 미사일 시험에 대응해 합동 탄도미사일 방어 추적 훈련을 실시했다."],
];

// A selected storyline used to collect any event whose words scored high
// enough against its title, state and participants (bindSelectedStorylineEvents):
// the English drill above was bound to the Korea crisis, its Korean twin to
// nothing, and an event about the player's own programmes landed in a Gulf
// crisis because it said "British". A storyline's events are now the ones its
// record names, by number, and the ones that name it.
test("an event joins a selected storyline when the storyline's record names it, in any language", () => {
  for (const [title, description] of DRILLS) {
    const named = { events: [drill(title, description)], storylineUpdates: [{ ...korea, eventIndexes: [0] }] };
    normalizeWorldStorylineEventLinks(named);
    assert.deepEqual(named.storylineUpdates[0].eventIndexes, [0], title);

    const unnamed = { events: [drill(title, description)], storylineUpdates: [{ ...korea, eventIndexes: [] }] };
    normalizeWorldStorylineEventLinks(unnamed);
    assert.deepEqual(unnamed.storylineUpdates[0].eventIndexes, [], `${title}: its words tie it to nothing`);
    assert.deepEqual(unnamed.events[0].storylineIds, []);
  }
});

test("an event that names its storyline is that storyline's, whatever either says", () => {
  for (const [title, description] of DRILLS) {
    const tagged = { events: [{ ...drill(title, description), storylineIds: [korea.id] }], storylineUpdates: [{ ...korea, eventIndexes: [] }] };
    normalizeWorldStorylineEventLinks(tagged);
    assert.deepEqual(tagged.storylineUpdates[0].eventIndexes, [0], title);
  }
});

test("a number that names no event of the answer is taken off, and nothing replaces it", () => {
  const candidate = { events: [drill(...DRILLS[0])], storylineUpdates: [{ ...korea, eventIndexes: [0, 3] }] };
  const result = normalizeWorldStorylineEventLinks(candidate);
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [0]);
  assert.equal(result.strippedInvalid, 1);
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

  // A storyline's kind is one word of a fixed list (runtime/storylineKinds.js).
  const freeKind = validateGameplayPayload("worldMotionRepair", { ...valid, storyline: { ...valid.storyline, kind: "security crisis" } });
  assert.equal(freeKind.valid, false);
  assert.match(freeKind.error, /kind must be one of "war", "crisis", "unrest", "diplomacy", "politics", "economy", "world"/);
});
