import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeWorldExplorationSlate,
  deriveWorldExplorationAudit,
  deriveWorldTrajectoryValue,
} from "../src/Game/AI/nativeWorldIntegrity.js";

const activePolities = (names) => Object.fromEntries(
  names.map((name) => [name, { name, aliases: [name], status: "active" }]),
);

test("R3.6 keeps a structural 5/5 attention slate even when local actors are already selected storyline participants", () => {
  const names = [
    "Actor A", "Actor B", "Actor C", "Actor D", "Actor E", "Actor F",
    "Actor G", "Actor H", "Actor I", "Actor J", "Actor K", "Actor L",
  ];

  const selectedStorylines = [
    {
      id: "local-crisis",
      kind: "crisis",
      status: "active",
      participants: ["Actor B", "Actor C", "Actor D", "Actor E"],
    },
  ];

  const bundle = {
    game: { country: "Actor A", gameDate: "2020-01-01", round: 12 },
    world: {
      polityOverrides: activePolities(names),
      relations: ["Actor B", "Actor C", "Actor D", "Actor E", "Actor F"]
        .map((polityB) => ({ polityA: "Actor A", polityB, status: "friendly" })),
      storylines: selectedStorylines,
    },
  };

  const slate = buildNativeWorldExplorationSlate({
    bundle,
    allStorylines: selectedStorylines,
    selectedStorylines,
    diplomaticActors: ["Actor B", "Actor C", "Actor D", "Actor E", "Actor F"],
  });

  assert.equal(slate.length, 10);
  assert.equal(slate.filter((slot) => slot.scope === "player-sphere").length, 5);
  assert.equal(slate.filter((slot) => slot.scope === "wider-world").length, 5);
  assert.equal(slate.filter((slot) => slot.type === "crisis-discovery").length, 1);
  for (const selectedActor of ["Actor B", "Actor C", "Actor D", "Actor E"]) {
    assert.ok(
      !slate.some((slot) => slot.type === "actor-domain" && slot.actor === selectedActor),
      `${selectedActor} should remain in selected-storyline attention rather than an independent actor slot`,
    );
  }
  assert.ok(
    slate.some((slot) => slot.scope === "player-sphere" && slot.type === "regional-system"),
    "same-scope system filler should preserve the 5/5 balance without duplicating selected actors",
  );
});

test("R3.6 trajectory heuristic prefers unstable branching processes over institutional newsletter cards", () => {
  const report = deriveWorldTrajectoryValue({
    title: "Federal Economic Chamber Publishes Quarterly Industrial Export Assessment",
    description: "The chamber publishes its quarterly review and assessment of machinery exports.",
    impacts: {},
  });
  const capability = deriveWorldTrajectoryValue({
    title: "Coastal Defense Battery Enters Service",
    description: "The new anti-ship missile battery becomes operational.",
    impacts: { markerOps: [{ op: "build" }] },
  });
  const instability = deriveWorldTrajectoryValue({
    title: "Tigray Leadership Rejects Federal Party Merger and Demands Regional Autonomy",
    description: "The regional leadership refuses the merger, deepening a federal political schism and autonomy dispute.",
    impacts: {},
  });
  const breakpoint = deriveWorldTrajectoryValue({
    title: "Army Officers Launch Coup Attempt After Government Crisis",
    description: "Mutinous officers seize government buildings and the cabinet declares a state of emergency.",
    impacts: {},
  });

  assert.equal(report, 0);
  assert.ok(capability >= 3);
  assert.ok(instability >= 4);
  assert.equal(breakpoint, 5);
});

test("R3.6 protected crisis lane targets the strongest bounded wider-world latent trigger instead of remaining generic", () => {
  const bundle = {
    game: { country: "Republic of Latvia", gameDate: "2020-03-23", round: 76 },
    world: {
      polityOverrides: {
        ...activePolities([
          "Republic of Latvia",
          "Republic of Estonia",
          "Republic of Lithuania",
          "Republic of Poland",
          "Kingdom of Sweden",
          "Republic of Austria",
          "Republic of North Macedonia",
          "Ukraine",
        ]),
        "Federal Democratic Republic of Ethiopia": {
          name: "Federal Democratic Republic of Ethiopia",
          aliases: ["Federal Democratic Republic of Ethiopia", "Ethiopia", "Ethiopian"],
          status: "active",
        },
      },
      relations: [
        { polityA: "Republic of Latvia", polityB: "Republic of Estonia", status: "friendly" },
        { polityA: "Republic of Latvia", polityB: "Republic of Lithuania", status: "friendly" },
        { polityA: "Republic of Latvia", polityB: "Republic of Poland", status: "friendly" },
      ],
      storylines: [],
    },
  };

  const causalCandidates = [
    {
      id: "event:ethiopia",
      type: "recent-event",
      score: 12,
      title: "Tigray Leadership Rejects Ethiopian Prosperity Party Merger and Demands Regional Autonomy",
      detail: "The TPLF refuses the Ethiopian federal party merger, deepening a political schism over regional autonomy and competing legitimacy.",
      storylineIds: [],
      trajectoryValue: 4,
    },
    {
      id: "event:austria",
      type: "recent-event",
      score: 13,
      title: "Austrian Chamber Publishes Industrial Export Outlook",
      detail: "A quarterly assessment reports steady machinery exports.",
      storylineIds: [],
      trajectoryValue: 0,
    },
  ];

  const slate = buildNativeWorldExplorationSlate({ bundle, causalCandidates });
  const crisis = slate.find((slot) => slot.type === "crisis-discovery");

  assert.ok(crisis);
  assert.equal(crisis.scope, "wider-world");
  assert.equal(crisis.targetActor, "Federal Democratic Republic of Ethiopia");
  assert.equal(crisis.trajectoryValue, 4);
  assert.match(crisis.basis, /PROTECTED CURRENT TRIGGER/i);
  assert.match(crisis.basis, /Tigray Leadership Rejects/i);
  assert.ok(crisis.consequenceChannels.length >= 2);
});

test("R3.6 crisis-discovery audit requires a real new crisis, not a low-pressure label", () => {
  const bundle = {
    game: { country: "A", gameDate: "2020-01-01", round: 1 },
    world: { polityOverrides: activePolities(["A", "B", "C", "D", "E", "F", "G", "H"]), storylines: [] },
  };
  const slate = buildNativeWorldExplorationSlate({ bundle });
  const crisisSlot = slate.find((slot) => slot.type === "crisis-discovery");
  assert.ok(crisisSlot);

  const weakAudit = deriveWorldExplorationAudit({
    events: [{ title: "Government Discusses Political Crisis", description: "Officials hold routine consultations.", storylineIds: ["weak"], impacts: {} }],
    storylineUpdates: [{
      id: "weak",
      kind: "political crisis",
      status: "active",
      pressure: 25,
      momentum: 20,
      title: "Weak Crisis Label",
      participants: ["G"],
      eventIndexes: [0],
      state: "Routine talks continue.",
    }],
  }, { explorationSlate: slate }, { world: bundle.world, gameCountry: "A" });

  assert.equal(weakAudit.entries.get(crisisSlot.id), "quiet");
});
