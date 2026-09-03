import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWorldStorylineUpdates,
} from "../src/Game/AI/nativeWorldDirector.js";
import {
  buildNativeWorldExplorationSlate,
  screenGeneratedWorldEvents,
} from "../src/Game/AI/nativeWorldIntegrity.js";
import {
  eventNeedsNativeUnitDirector,
} from "../src/Game/AI/nativeUnitDirector.js";

const activePolities = (names) => Object.fromEntries(
  names.map((name) => [name, { name, aliases: [name], status: "active" }]),
);

const emptyImpacts = () => ({
  actionIds: [],
  createdChats: [],
  markerOps: [],
  polityChanges: [],
  regionControlOps: [],
  regionTransfers: [],
  unitOps: [],
});

test("R3.7 crisis lane can use high-trajectory evidence that ordinary top-10 initiative ranking omitted", () => {
  const bundle = {
    game: { country: "Republic of Latvia", gameDate: "2020-05-22", round: 77 },
    world: {
      polityOverrides: {
        ...activePolities([
          "Republic of Latvia",
          "Republic of Lithuania",
          "Republic of Estonia",
          "Republic of Poland",
          "Kingdom of Sweden",
          "Republic of Austria",
          "Republic of Turkey",
        ]),
        "Federal Democratic Republic of Ethiopia": {
          name: "Federal Democratic Republic of Ethiopia",
          aliases: ["Ethiopia", "Ethiopian"],
          status: "active",
        },
      },
      relations: [
        { polityA: "Republic of Latvia", polityB: "Republic of Lithuania", status: "friendly" },
        { polityA: "Republic of Latvia", polityB: "Republic of Estonia", status: "friendly" },
        { polityA: "Republic of Latvia", polityB: "Republic of Poland", status: "friendly" },
      ],
      storylines: [],
    },
  };

  const boringTopTen = [{
    id: "event:austria",
    type: "recent-event",
    score: 20,
    title: "Austrian Chamber Publishes Quarterly Industrial Export Outlook",
    detail: "A quarterly assessment reports steady machinery exports.",
    trajectoryValue: 0,
    storylineIds: [],
  }];
  const crisisEvidence = [{
    id: "event:ethiopia",
    type: "recent-event",
    score: 8,
    title: "Tigray Leadership Rejects Ethiopian Prosperity Party Merger and Demands Regional Autonomy",
    detail: "The TPLF rejects the federal party merger, deepening a political schism over autonomy and competing legitimacy in Ethiopia.",
    trajectoryValue: 4,
    storylineIds: [],
  }];

  const slate = buildNativeWorldExplorationSlate({
    bundle,
    causalCandidates: boringTopTen,
    crisisCandidates: crisisEvidence,
  });
  const crisis = slate.find((slot) => slot.type === "crisis-discovery");

  assert.ok(crisis);
  assert.equal(crisis.targetActor, "Federal Democratic Republic of Ethiopia");
  assert.equal(crisis.trajectoryValue, 4);
  assert.match(crisis.basis, /Tigray Leadership Rejects/i);
});

test("R3.7 suppresses clusters of low-trajectory institutional cards but preserves concrete capability outcomes", () => {
  const priorEvents = Array.from({ length: 5 }, (_, index) => ({
    id: `prior-${index}`,
    title: `Technical Dialogue ${index + 1}`,
    description: "Officials hold technical consultations on standards alignment and customs efficiency.",
    importance: "minor",
    impacts: emptyImpacts(),
  }));

  const events = [
    {
      id: "talk-sweden",
      title: "Latvian and Swedish Delegations Convene for Green-Tech Working Sessions",
      description: "Officials hold bilateral working sessions and technical talks on supply-chain cooperation.",
      importance: "minor",
      impacts: emptyImpacts(),
    },
    {
      id: "talk-germany",
      title: "Latvia and Germany Launch Technical Dialogue on Clean-Energy Financing",
      description: "Officials initiate a technical dialogue and coordination framework.",
      importance: "minor",
      impacts: emptyImpacts(),
    },
    {
      id: "talk-russia",
      title: "Latvian and Russian Border Authorities Hold Technical Consultations",
      description: "Working-level consultations review customs efficiency and procedural harmonization.",
      importance: "minor",
      impacts: emptyImpacts(),
    },
    {
      id: "turkey-lab",
      title: "Turkish Aerospace Industries Opens Advanced Avionics Integration Laboratory",
      description: "A new avionics integration facility becomes operational for flight-control and secure communications development.",
      importance: "major",
      impacts: { ...emptyImpacts(), markerOps: [{ op: "build", id: "lab-ankara" }] },
    },
    {
      id: "radar",
      title: "Ukrainian Counter-Battery Radar Batch Enters Frontline Service",
      description: "New mobile radar systems enter service and are deployed to frontline formations.",
      importance: "major",
      impacts: { ...emptyImpacts(), markerOps: [{ op: "build", id: "radar-plant" }] },
    },
  ];

  const screened = screenGeneratedWorldEvents({
    events,
    priorEvents,
    world: {},
    game: { country: "Republic of Latvia" },
    analysis: { explorationSlate: [] },
  });

  assert.equal(screened.events.length, 3);
  assert.equal(screened.events.filter((event) => event.id.startsWith("talk-")).length, 1);
  assert.ok(screened.events.some((event) => event.id === "turkey-lab"));
  assert.ok(screened.events.some((event) => event.id === "radar"));
  assert.equal(
    screened.dropped.filter((row) => row.route === "LOW_TRAJECTORY_FEED_SATURATION").length,
    2,
  );
});

test("R3.7 linked visible events advance storyline visibility bookkeeping even without semantic update", () => {
  const prior = {
    id: "storyline-korean-peninsula-crisis",
    kind: "crisis",
    title: "Korean Peninsula Security Crisis",
    participants: ["Republic of Korea", "United States of America", "Democratic People's Republic of Korea"],
    status: "active",
    pressure: 70,
    momentum: 60,
    startedDate: "2019-08-14",
    accountedThroughDate: "2020-02-22",
    lastUpdatedDate: "2020-02-22",
    lastVisibleEventDate: "2020-02-05",
    sourceEventIds: ["old-event"],
    state: "Testing has resumed and regional deterrence is elevated.",
  };

  const result = applyWorldStorylineUpdates({
    world: { storylines: [prior] },
    updates: [],
    events: [{
      id: "event-ai-r0075-20200305-001",
      date: "2020-03-05",
      title: "United States and South Korea Reinforce Joint Surveillance",
      description: "The allies enhance tracking after North Korean missile tests.",
      storylineIds: ["storyline-korean-peninsula-crisis"],
    }],
    stopDate: "2020-03-23",
    round: 75,
  });

  const korea = result.world.storylines.find((entry) => entry.id === prior.id);
  assert.ok(korea);
  assert.equal(result.appliedIds.length, 0, "bookkeeping salvage must not pretend a semantic update was applied");
  assert.equal(korea.lastVisibleEventDate, "2020-03-05");
  assert.ok(korea.sourceEventIds.includes("event-ai-r0075-20200305-001"));
  assert.equal(korea.state, prior.state);
  assert.equal(korea.pressure, prior.pressure);
});

test("R3.7 Unit Director skips military-tech/readiness cards and runs only for operational unit motion", () => {
  assert.equal(eventNeedsNativeUnitDirector({
    title: "Turkish Aerospace Industries Opens Avionics Integration Laboratory",
    description: "The facility supports military flight-control software and secure communications testing.",
  }), false);

  assert.equal(eventNeedsNativeUnitDirector({
    title: "Allied Commands Reinforce Missile-Defense Readiness",
    description: "Commands improve surveillance and radar data-sharing while maintaining heightened readiness.",
  }), false);

  assert.equal(eventNeedsNativeUnitDirector({
    title: "Army Redeploys Two Brigades to the Border",
    description: "Two brigades redeploy toward the frontier and establish forward positions.",
  }), true);

  assert.equal(eventNeedsNativeUnitDirector({
    title: "Reserve Forces Mobilized After Border Clash",
    description: "The government calls up reserves after a clash and deploys troops toward the frontier.",
  }), true);
});
