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

// An event's trajectory was read from breakpoint, instability, capability and
// settlement word lists, in English only: a coup in Spanish was a 1. It is read
// from what the event carries, the storyline pressure it advances and the
// model's own rating of it, so a record and its twin in another language
// always weigh the same.
test("R3.6 trajectory is read from what an event carries and how the model rated it, in any language", () => {
  const value = (record, title, options) => deriveWorldTrajectoryValue({ title, description: title, ...record }, options);
  for (const title of [
    "Army Officers Launch Coup Attempt After Government Crisis",
    "Oficiales del ejército lanzan un intento de golpe tras la crisis del gobierno",
  ]) {
    assert.equal(value({ importance: "minor", impacts: {} }, title), 1, `${title}: a minor card that changes nothing`);
    assert.equal(value({ importance: "moderate", impacts: {} }, title), 2);
    assert.equal(value({ importance: "minor", impacts: {} }, title, { storylinePressure: 30 }), 2, "it advances a storyline");
    assert.equal(value({ importance: "minor", impacts: { markerOps: [{ op: "build" }] } }, title), 3, "one hard consequence");
    assert.equal(value({ importance: "major", impacts: {} }, title), 3);
    assert.equal(value({ importance: "minor", impacts: {} }, title, { storylinePressure: 70 }), 3, "a high-pressure storyline");
    assert.equal(value({ importance: "major", impacts: {} }, title, { storylinePressure: 70 }), 4, "rated major, in a high-pressure storyline");
    assert.equal(value({ importance: "minor", impacts: { unitOps: [{ op: "move" }], regionControlOps: [{ op: "control" }] } }, title), 4, "two hard consequences");
    assert.equal(value({ notable: true, impacts: { unitOps: [{ op: "move" }], politicalActorOps: [{ op: "set-government" }] } }, title), 5);
    assert.equal(value({ importance: "critical", impacts: {} }, title), 5);
  }
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

  // Each candidate carries the polities its source event's fields name and the
  // event's own tags (nativeWorldDirector.js eventCandidate): the lane's actor
  // and its channels are read from those, never from the candidate's words.
  for (const [title, detail] of [
    ["Tigray Leadership Rejects Ethiopian Prosperity Party Merger and Demands Regional Autonomy", "The TPLF refuses the Ethiopian federal party merger, deepening a political schism over regional autonomy and competing legitimacy."],
    ["የትግራይ አመራር የብልጽግና ፓርቲ ውህደትን ውድቅ አደረገ", "ህወሓት የፌዴራል ፓርቲ ውህደትን አልተቀበለም።"],
  ]) {
    const causalCandidates = [
      {
        id: "event:ethiopia",
        type: "recent-event",
        score: 12,
        title,
        detail,
        storylineIds: [],
        parties: ["Federal Democratic Republic of Ethiopia"],
        tags: ["Politics"],
        impactKeys: ["politicalActorOps"],
        trajectoryValue: 4,
      },
      {
        id: "event:austria",
        type: "recent-event",
        score: 13,
        title: "Austrian Chamber Publishes Industrial Export Outlook",
        detail: "A quarterly assessment reports steady machinery exports.",
        storylineIds: [],
        parties: ["Republic of Austria"],
        trajectoryValue: 1,
      },
    ];

    const slate = buildNativeWorldExplorationSlate({ bundle, causalCandidates });
    const crisis = slate.find((slot) => slot.type === "crisis-discovery");

    assert.ok(crisis);
    assert.equal(crisis.scope, "wider-world");
    assert.equal(crisis.targetActor, "Federal Democratic Republic of Ethiopia", title);
    assert.equal(crisis.trajectoryValue, 4);
    assert.match(crisis.basis, /PROTECTED CURRENT TRIGGER/i);
    assert.ok(crisis.basis.includes(title));
    assert.deepEqual(crisis.consequenceChannels, ["persistent storyline", "relations", "polity/government state"]);

    // Its words name Ethiopia, but its record names nobody: no lane is aimed.
    const unnamed = buildNativeWorldExplorationSlate({ bundle, causalCandidates: [{ ...causalCandidates[0], parties: [] }] })
      .find((slot) => slot.type === "crisis-discovery");
    assert.equal(unnamed.targetActor, "", title);
  }
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
