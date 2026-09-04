import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeWorldExplorationSlate,
  deriveWorldExplorationAudit,
} from "../src/Game/AI/nativeWorldIntegrity.js";
import {
  deriveWorldConflictRiskPosture,
} from "../src/Game/AI/nativeWorldDirector.js";

const activePolities = (names) => Object.fromEntries(
  names.map((name) => [name, { name, aliases: [name], status: "active" }]),
);

test("R3.5 exploration slate targets 5 player-sphere / 5 wider-world lanes when campaign state can fill both", () => {
  const names = [
    "Actor A", "Actor B", "Actor C", "Actor D", "Actor E", "Actor F",
    "Actor G", "Actor H", "Actor I", "Actor J", "Actor K", "Actor L",
    "Actor M", "Actor N",
  ];

  const bundle = {
    game: { country: "Actor A", gameDate: "2020-01-01", round: 12 },
    world: {
      polityOverrides: activePolities(names),
      relations: ["Actor B", "Actor C", "Actor D", "Actor E", "Actor F"]
        .map((polityB) => ({ polityA: "Actor A", polityB, status: "friendly" })),
      storylines: [],
    },
  };

  const slate = buildNativeWorldExplorationSlate({ bundle });

  assert.equal(slate.length, 10);
  assert.equal(slate.filter((slot) => slot.scope === "player-sphere").length, 5);
  assert.equal(slate.filter((slot) => slot.scope === "wider-world").length, 5);
  assert.equal(slate.filter((slot) => slot.type === "crisis-discovery").length, 1);
  assert.equal(slate.filter((slot) => slot.type === "actor-domain").length, 8);
});

test("R3.5 crisis-discovery lane is satisfied only by a new persistent crisis process", () => {
  const bundle = {
    game: { country: "Actor A", gameDate: "2020-01-01", round: 12 },
    world: {
      polityOverrides: activePolities([
        "Actor A", "Actor B", "Actor C", "Actor D", "Actor E", "Actor F",
        "Actor G", "Actor H", "Actor I", "Actor J", "Actor K", "Actor L",
      ]),
      storylines: [],
    },
  };
  const slate = buildNativeWorldExplorationSlate({ bundle });
  const crisisSlot = slate.find((slot) => slot.type === "crisis-discovery");
  assert.ok(crisisSlot);

  const quietAudit = deriveWorldExplorationAudit({
    events: [{
      date: "2020-01-10",
      title: "Ministry Opens New Digital Services Office",
      description: "A routine administrative service centre opens.",
      storylineIds: [],
      impacts: {},
    }],
    storylineUpdates: [],
    diplomaticOutreach: [],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
  }, { explorationSlate: slate }, {
    world: bundle.world,
    gameCountry: bundle.game.country,
  });

  assert.equal(quietAudit.entries.get(crisisSlot.id), "quiet");

  const crisisAudit = deriveWorldExplorationAudit({
    events: [{
      date: "2020-01-14",
      title: "Regional Government Rejects Federal Authority After Constitutional Ruling",
      description: "The regional executive refuses compliance, rival security commands form, and emergency negotiations begin.",
      storylineIds: ["storyline-federal-constitutional-crisis"],
      impacts: {},
    }],
    storylineUpdates: [{
      id: "storyline-federal-constitutional-crisis",
      kind: "crisis",
      status: "active",
      pressure: 58,
      momentum: 61,
      title: "Federal Constitutional Crisis",
      participants: ["Actor G", "Actor H"],
      eventIndexes: [0],
      state: "Competing claims of constitutional authority now threaten government legitimacy and control of security institutions.",
    }],
    diplomaticOutreach: [],
    warUpdates: [],
    relationUpdates: [],
    agreementUpdates: [],
  }, { explorationSlate: slate }, {
    world: bundle.world,
    gameCountry: bundle.game.country,
  });

  assert.equal(
    crisisAudit.entries.get(crisisSlot.id),
    "storyline:storyline-federal-constitutional-crisis",
  );
});

test("R3.5 era is a conflict prior: 1914 is substantially more war-permissive than a quiet 2020, but neither date forces war", () => {
  const quietWorld = {
    polityOverrides: activePolities(["A", "B", "C", "D"]),
    storylines: [],
    wars: [],
    relations: [],
    agreements: [],
  };

  const posture1914 = deriveWorldConflictRiskPosture({
    bundle: { game: { country: "A", gameDate: "1914-07-01" }, world: quietWorld },
    targetDate: "1914-08-01",
  });
  const posture2020 = deriveWorldConflictRiskPosture({
    bundle: { game: { country: "A", gameDate: "2020-07-01" }, world: quietWorld },
    targetDate: "2020-08-01",
  });

  assert.ok(posture1914.score >= posture2020.score + 20);
  assert.equal(posture1914.id, "guarded");
  assert.equal(posture2020.id, "low");
  assert.ok(posture1914.score < 70, "date alone must not force an acute-war posture");
});

test("R3.5 modern era does not grant plot armor when current campaign state is genuinely dangerous", () => {
  const world = {
    polityOverrides: activePolities(["A", "B", "C", "D", "E", "F"]),
    wars: [
      { id: "war-1", status: "active", sideA: ["A"], sideB: ["B"] },
      { id: "war-2", status: "active", sideA: ["C"], sideB: ["D"] },
    ],
    storylines: [
      { id: "c1", kind: "crisis", status: "active", pressure: 92, momentum: 82 },
      { id: "c2", kind: "security crisis", status: "active", pressure: 86, momentum: 70 },
    ],
    relations: [
      { polityA: "A", polityB: "E", status: "hostile" },
      { polityA: "B", polityB: "F", status: "adversarial" },
      { polityA: "C", polityB: "E", status: "very tense" },
    ],
    agreements: [
      { status: "active", type: "mutual defense alliance", parties: ["A", "E"] },
    ],
    regionClaimants: {
      r1: ["A"], r2: ["B"], r3: ["C"], r4: ["D"],
    },
  };

  const posture = deriveWorldConflictRiskPosture({
    bundle: { game: { country: "A", gameDate: "2020-07-01" }, world },
    targetDate: "2020-08-01",
    causalCandidates: [
      { title: "Reserve mobilization follows ultimatum", detail: "Forward deployment and force concentration continue." },
      { title: "Border clash triggers combat alert", detail: "Talks collapse after an armed incident." },
    ],
  });

  assert.ok(posture.score >= 70);
  assert.equal(posture.id, "acute");
});
