import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findWorldStorylineAntiStasisIssues,
  normalizeWorldStorylineEventLinks,
} from "../src/Game/AI/nativeWorldDirector.js";

// A storyline record names its events by their numbers, and an event may name
// its storyline: those are the links, and nothing else ties the two. A text
// scorer used to tie them too (scoreStorylineEventLink, with
// bindSelectedStorylineEvents and bindNewStorylineEvents): the words of four
// letters or more that a record's title and state shared with an event, and
// its participants' names in the event's prose. In another language they
// shared few words, so the model's own number was taken for unrelated and
// stripped; in English, generic shared words moved events between storylines.

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

const MALI = {
  English: [
    ["Mass Anti-Government Protests Intensify Political Crisis in Mali", "Large demonstrations in Bamako challenge the Malian government's legitimacy as opposition groups demand institutional reform."],
    ["Ghana Opens New Agricultural Export Terminal", "The terminal begins commercial operations."],
    ["Malian Political Crisis and Institutional Unrest", "Mass opposition mobilization and institutional legitimacy disputes have become an unresolved national political crisis."],
  ],
  Russian: [
    ["Массовые антиправительственные волнения углубляют политический кризис в Мали", "Крупные демонстрации в Бамако оспаривают легитимность правительства."],
    ["Гана открывает новый экспортный терминал", "Терминал начал коммерческую работу."],
    ["Политический кризис и волнения в Мали", "Массовая мобилизация оппозиции и споры о легитимности власти стали неразрешённым политическим кризисом."],
  ],
};

const maliCandidate = ([[protest, protestDetail], [terminal, terminalDetail], [title, state]], eventIndexes) => ({
  events: [
    { date: "2020-06-10", title: protest, description: protestDetail, storylineIds: [] },
    { date: "2020-06-14", title: terminal, description: terminalDetail, storylineIds: [] },
  ],
  storylineUpdates: [{
    id: "storyline-mali-political-crisis",
    status: "active",
    pressure: 58,
    momentum: 64,
    startedDate: "2020-06-10",
    kind: "crisis",
    title,
    participants: ["Republic of Mali"],
    eventIndexes,
    state,
  }],
});

test("a storyline is tied to the events its record names, as written, in any language", () => {
  for (const [language, texts] of Object.entries(MALI)) {
    const given = maliCandidate(texts, [0]);
    normalizeWorldStorylineEventLinks(given);
    assert.deepEqual(given.storylineUpdates[0].eventIndexes, [0], `${language}: the model's own number is kept`);

    const omitted = maliCandidate(texts, []);
    normalizeWorldStorylineEventLinks(omitted);
    assert.deepEqual(omitted.storylineUpdates[0].eventIndexes, [], `${language}: none is guessed when it gave none`);

    // The number is the model's statement of which event moved the storyline.
    const other = maliCandidate(texts, [1]);
    normalizeWorldStorylineEventLinks(other);
    assert.deepEqual(other.storylineUpdates[0].eventIndexes, [1], `${language}: no word corrects it`);
  }
});

test("a record pinned to its events by id is read where they stand after the sort", () => {
  for (const texts of Object.values(MALI)) {
    const candidate = maliCandidate(texts, []);
    candidate.events = candidate.events.map((event, index) => ({ ...event, id: `segment-1-event-${index + 1}` }));
    candidate.storylineUpdates[0].eventIds = ["segment-1-event-1"];
    candidate.events.reverse();
    normalizeWorldStorylineEventLinks(candidate);
    assert.deepEqual(candidate.storylineUpdates[0].eventIndexes, [1]);
    assert.equal("eventIds" in candidate.storylineUpdates[0], false, "it leaves with places alone");
  }
});

test("an event that names its storyline links the record before anti-stasis is judged", () => {
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
        storylineIds: [korea.id],
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

  normalizeWorldStorylineEventLinks(candidate);
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

// The breadth search's new storylines must name the event that opens them; one
// that names none is left out and the events stand. It used to be tied to the
// event its words matched best, and the whole search was thrown away when none
// did.
test("a new breadth storyline that names no event is left out, and the search's events stand", () => {
  const gameplay = readFileSync(new URL("../src/Game/AI/gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!gameplay.includes("bindNewStorylineEvents(") && !gameplay.includes("bindSelectedStorylineEvents("));
  assert.match(gameplay, /const decodedStorylines = decodeWorldStorylineUpdates\(parsed\.storylineUpdates\)\n\s+\.filter\(\(update\) => normalizeArray\(update\?\.eventIndexes\)\.length > 0\);/);
  assert.ok(!gameplay.includes("must link to a returned event"));
});
