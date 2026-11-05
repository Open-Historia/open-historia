import test from "node:test";
import assert from "node:assert/strict";

import {
  bindNewStorylineEvents,
  bindSelectedStorylineEvents,
  findWorldStorylineAntiStasisIssues,
  normalizeWorldStorylineEventLinks,
} from "../src/Game/AI/nativeWorldDirector.js";

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
  pressure: 72,
  momentum: 63,
  startedDate: "2019-08-14",
  accountedThroughDate: "2020-05-22",
  lastUpdatedDate: "2020-05-22",
  lastVisibleEventDate: "2020-01-05",
  nextReviewDate: "2020-06-01",
  state: "North Korean missile testing and allied military readiness sustain a dangerous regional confrontation.",
};

test("R3.8 binds a new Malian crisis storyline to its obvious returned event", () => {
  const candidate = {
    events: [
      {
        date: "2020-06-10",
        title: "Mass Anti-Government Protests Intensify Political Crisis in Mali",
        description:
          "Large demonstrations in Bamako challenge the Malian government's legitimacy as opposition groups demand institutional reform and threaten sustained civil disobedience.",
        storylineIds: [],
      },
      {
        date: "2020-06-14",
        title: "Ghana Opens New Agricultural Export Terminal",
        description: "The terminal begins commercial operations.",
        storylineIds: [],
      },
    ],
    storylineUpdates: [
      {
        id: "storyline-mali-political-crisis",
        status: "active",
        pressure: 58,
        momentum: 64,
        startedDate: "2020-06-10",
        kind: "crisis",
        title: "Malian Political Crisis and Institutional Unrest",
        participants: ["Republic of Mali"],
        eventIndexes: [],
        state:
          "Mass opposition mobilization and institutional legitimacy disputes have become an unresolved national political crisis.",
      },
    ],
  };

  const result = bindNewStorylineEvents(candidate, {
    existingStorylines: [],
    world: {},
  });

  assert.equal(result.bound, 1);
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [0]);
  assert.deepEqual(candidate.events[0].storylineIds, ["storyline-mali-political-crisis"]);
  assert.deepEqual(candidate.events[1].storylineIds, []);
});

test("R3.8 refuses to guess when two new-crisis events are semantically ambiguous", () => {
  const candidate = {
    events: [
      {
        title: "Mali Opposition Protest Expands in Bamako",
        description: "Opposition mobilization widens amid a political legitimacy dispute.",
        storylineIds: [],
      },
      {
        title: "Mali Opposition Protest Expands in Regional Cities",
        description: "Opposition mobilization widens amid the same political legitimacy dispute.",
        storylineIds: [],
      },
    ],
    storylineUpdates: [
      {
        id: "storyline-mali-political-crisis",
        status: "active",
        pressure: 55,
        momentum: 60,
        startedDate: "2020-06-10",
        kind: "crisis",
        title: "Mali Political Crisis",
        participants: ["Republic of Mali"],
        eventIndexes: [],
        state: "Opposition mobilization is challenging national political legitimacy.",
      },
    ],
  };

  const result = bindNewStorylineEvents(candidate, {
    existingStorylines: [],
    world: {},
  });

  assert.equal(result.bound, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, []);
});

// A game played in Russian. The link score read the storyline's and the event's
// words with everything but a-z and 0-9 taken out, so two texts in Cyrillic
// shared nothing: an event number the model had given was taken for unrelated
// and stripped, and none was ever inferred.
test("a storyline and its event are linked by their words in another script", () => {
  const candidate = (eventIndexes) => ({
    events: [
      {
        date: "2020-06-10",
        title: "Массовые антиправительственные волнения углубляют политический кризис в Мали",
        description: "Крупные демонстрации в Бамако оспаривают легитимность правительства; оппозиция грозит гражданским неповиновением.",
        storylineIds: [],
      },
      {
        date: "2020-06-14",
        title: "Гана открывает новый экспортный терминал",
        description: "Терминал начал коммерческую работу.",
        storylineIds: [],
      },
    ],
    storylineUpdates: [
      {
        id: "storyline-mali-political-crisis",
        status: "active",
        pressure: 58,
        momentum: 64,
        startedDate: "2020-06-10",
        kind: "crisis",
        title: "Политический кризис и волнения в Мали",
        participants: ["Republic of Mali"],
        eventIndexes,
        state: "Массовая мобилизация оппозиции и споры о легитимности власти стали неразрешённым политическим кризисом.",
      },
    ],
  });

  const given = candidate([0]);
  normalizeWorldStorylineEventLinks(given, { world: {} });
  assert.deepEqual(given.storylineUpdates[0].eventIndexes, [0], "the model's own event number is kept");

  const omitted = candidate([]);
  normalizeWorldStorylineEventLinks(omitted, { world: {} });
  assert.deepEqual(omitted.storylineUpdates[0].eventIndexes, [0], "and found when it gave none");

  const wrong = candidate([1]);
  normalizeWorldStorylineEventLinks(wrong, { world: {} });
  assert.deepEqual(wrong.storylineUpdates[0].eventIndexes, [0], "a number pointing at the export terminal is corrected");
});

test("R3.8 propagates a native selected-storyline event link before anti-stasis evaluation", () => {
  const candidate = {
    stopDate: "2020-06-21",
    events: [
      {
        date: "2020-06-05",
        importance: "major",
        kind: "military",
        title: "Naval Standoff in the Yellow Sea Heightens Korean Peninsula Tensions",
        description:
          "North Korean patrol vessels cross the Northern Limit Line, prompting an immediate tactical deployment of Republic of Korea naval forces and allied reconnaissance aircraft before the vessels withdraw after tense maneuvering.",
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
      },
    ],
    storylineUpdates: [
      {
        ...korea,
        accountedThroughDate: "2020-06-21",
        lastUpdatedDate: "2020-06-21",
        eventIndexes: [],
        // Deliberately little numeric motion: the visible event itself is the
        // objective evolution that should prevent a bogus anti-stasis repair.
        pressure: 72,
        momentum: 63,
        state: korea.state,
      },
    ],
  };

  const selected = bindSelectedStorylineEvents(candidate, {
    selectedStorylines: [korea],
    world: {},
  });
  assert.equal(selected.bound, 1);
  assert.deepEqual(candidate.events[0].storylineIds, [korea.id]);

  normalizeWorldStorylineEventLinks(candidate, { world: {} });
  assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [0]);

  const issues = findWorldStorylineAntiStasisIssues(candidate, {
    existingStorylines: [korea],
    selectedStorylines: [korea],
    originDate: "2020-05-22",
    stopDate: "2020-06-21",
    world: {},
  });

  assert.deepEqual(issues, []);
});
