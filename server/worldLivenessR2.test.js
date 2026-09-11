import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalWorldActor,
  buildNativeWorldExplorationSlate,
  screenGeneratedWorldEvents,
} from "../src/Game/AI/nativeWorldIntegrity.js";
import {
  applyWorldStorylineUpdates,
} from "../src/Game/AI/nativeWorldDirector.js";

const koreaWorld = () => ({
  polityOverrides: {
    "Democratic People's Republic of Korea": {
      name: "Democratic People's Republic of Korea",
      aliases: ["Democratic People's Republic of Korea"],
      status: "active",
    },
    "Republic of Korea": {
      name: "Republic of Korea",
      aliases: ["Republic of Korea"],
      status: "active",
    },
    Japan: { name: "Japan", aliases: ["Japan"], status: "active" },
    "United States of America": {
      name: "United States of America",
      aliases: ["United States of America"],
      status: "active",
    },
    "People's Republic of China": {
      name: "People's Republic of China",
      aliases: ["People's Republic of China"],
      status: "active",
    },
    "Russian Federation": {
      name: "Russian Federation",
      aliases: ["Russian Federation"],
      status: "active",
    },
  },
  storylines: [{
    id: "storyline-korean-peninsula-crisis",
    kind: "crisis",
    title: "Korean Peninsula Security Crisis",
    participants: [
      "Democratic People's Republic of Korea",
      "Republic of Korea",
      "Japan",
      "United States of America",
      "People's Republic of China",
      "Russian Federation",
    ],
    status: "active",
    pressure: 60,
    momentum: 55,
    startedDate: "2019-08-14",
    accountedThroughDate: "2019-08-14",
    lastUpdatedDate: "2019-08-14",
    lastVisibleEventDate: "2019-08-14",
    nextReviewDate: "2019-09-28",
    state: "A six-party regional security crisis is unresolved.",
    sourceEventIds: ["event-manual-gm-1"],
    createdRound: 69,
    updatedRound: 69,
  }],
});

test("storyline updates preserve prior participants and canonicalize stock short names", () => {
  const world = koreaWorld();

  assert.equal(
    canonicalWorldActor("North Korea", world),
    "Democratic People's Republic of Korea",
  );
  assert.equal(
    canonicalWorldActor("South Korea", world),
    "Republic of Korea",
  );
  assert.equal(
    canonicalWorldActor("United States", world),
    "United States of America",
  );

  const merged = applyWorldStorylineUpdates({
    world,
    updates: [{
      id: "storyline-korean-peninsula-crisis",
      status: "active",
      pressure: 65,
      momentum: 60,
      startedDate: "",
      kind: "crisis",
      title: "Korean Peninsula Security Crisis",
      participants: ["Republic of Korea", "United States", "North Korea"],
      eventIndexes: [0],
      state: "North Korea orders a partial reserve call-up while allied forces disperse aircraft and missile-defense batteries.",
    }],
    events: [{
      id: "event-ai-r0070-20190829-001",
      date: "2019-08-29",
      storylineIds: ["storyline-korean-peninsula-crisis"],
      title: "North Korea Orders Partial Reserve Call-Up",
    }],
    stopDate: "2019-09-25",
    round: 70,
  });

  const storyline = merged.storylines.find((entry) =>
    entry.id === "storyline-korean-peninsula-crisis"
  );

  assert.deepEqual(storyline.participants, [
    "Democratic People's Republic of Korea",
    "Republic of Korea",
    "Japan",
    "United States of America",
    "People's Republic of China",
    "Russian Federation",
  ]);
  assert.ok(!storyline.participants.includes("North Korea"));
  assert.ok(storyline.sourceEventIds.includes("event-ai-r0070-20190829-001"));
});

test("pressure-60 active crisis now receives the tighter 21-day review cadence", () => {
  const world = koreaWorld();
  const merged = applyWorldStorylineUpdates({
    world,
    updates: [{
      id: "storyline-korean-peninsula-crisis",
      status: "active",
      pressure: 60,
      momentum: 55,
      startedDate: "",
      kind: "crisis",
      title: "Korean Peninsula Security Crisis",
      participants: [],
      eventIndexes: [],
      state: "The crisis remains unresolved.",
    }],
    stopDate: "2019-08-14",
    round: 69,
  });
  const storyline = merged.storylines.find((entry) =>
    entry.id === "storyline-korean-peninsula-crisis"
  );

  assert.equal(storyline.nextReviewDate, "2019-09-04");
});

test("status-only military readiness cards are removed before curation", () => {
  const screened = screenGeneratedWorldEvents({
    events: [{
      id: "event-ai-r0070-20190829-001",
      date: "2019-08-29",
      importance: "major",
      title: "Military Readiness Remains Elevated on the Korean Peninsula",
      description: "Forces remain on heightened alert and both sides maintain an elevated military posture while monitoring continues.",
      impacts: {
        actionIds: [],
        createdChats: [],
        markerOps: [],
        polityChanges: [],
        regionTransfers: [],
        regionClaims: [],
        unitOps: [],
      },
    }],
    world: koreaWorld(),
    game: { country: "Republic of Latvia" },
  });

  assert.equal(screened.events.length, 0);
  assert.equal(screened.dropped.length, 1);
  assert.equal(screened.dropped[0].route, "ROUTINE_MILITARY_PRECURATION");
});

test("world exploration reserves two deterministic latent-active actor slots", () => {
  const polityOverrides = {};
  for (const name of [
    "Actor A", "Actor B", "Actor C", "Actor D", "Actor E", "Actor F",
    "Actor G", "Actor H", "Actor I", "Actor J", "Actor K", "Actor L",
  ]) {
    polityOverrides[name] = { name, aliases: [name], status: "active" };
  }

  const bundle = {
    game: { country: "Actor A", gameDate: "2019-08-14", round: 70 },
    world: {
      polityOverrides,
      relations: [
        { polityA: "Actor A", polityB: "Actor B" },
        { polityA: "Actor C", polityB: "Actor D" },
        { polityA: "Actor E", polityB: "Actor F" },
      ],
      storylines: [],
    },
  };

  const slate = buildNativeWorldExplorationSlate({ bundle });
  const actorSlots = slate.filter((slot) => slot.type === "actor-domain");
  const latentSlots = actorSlots.filter((slot) =>
    String(slot.basis || "").includes("rotating latent-world attention")
  );

  // R3.6 preserves the original two latent-active actor lanes but no longer
  // borrows across the 50/50 scope boundary just to hit eight named actors.
  // Sparse player-sphere capacity is filled by same-scope system lanes instead.
  assert.equal(slate.length, 10);
  assert.equal(slate.filter((slot) => slot.scope === "player-sphere").length, 5);
  assert.equal(slate.filter((slot) => slot.scope === "wider-world").length, 5);
  assert.equal(latentSlots.length, 2);
});

test("canonical actor resolution can recover formal identity from territorial provenance", () => {
  const world = {
    regionOwnershipOverrides: {
      "4333": "Democratic People's Republic of Korea",
      "539": "Republic of Korea",
    },
    storylines: [{
      id: "storyline-korean-peninsula-crisis",
      participants: ["North Korea", "Republic of Korea"],
      status: "active",
    }],
  };

  assert.equal(
    canonicalWorldActor("North Korea", world),
    "Democratic People's Republic of Korea",
  );
});

test("selected storyline participants do not consume independent actor sweep slots", () => {
  const names = [
    "Democratic People's Republic of Korea",
    "Republic of Korea",
    "Japan",
    "United States of America",
    "People's Republic of China",
    "Russian Federation",
    "Brazil",
    "India",
    "Nigeria",
    "Turkey",
    "Mexico",
    "Indonesia",
    "Canada",
    "Australia",
  ];
  const polityOverrides = Object.fromEntries(
    names.map((name) => [name, { name, aliases: [name], status: "active" }]),
  );
  const crisis = {
    id: "storyline-korean-peninsula-crisis",
    kind: "crisis",
    title: "Korean Peninsula Security Crisis",
    participants: names.slice(0, 6),
    status: "active",
    pressure: 65,
    momentum: 60,
  };

  const slate = buildNativeWorldExplorationSlate({
    bundle: {
      game: { country: "Canada", gameDate: "2019-10-25", round: 71 },
      world: { polityOverrides, storylines: [crisis] },
    },
    allStorylines: [crisis],
    selectedStorylines: [crisis],
  });

  const actors = slate
    .filter((slot) => slot.type === "actor-domain")
    .map((slot) => slot.actor);

  for (const participant of crisis.participants) {
    assert.ok(
      !actors.includes(participant),
      `${participant} should receive crisis attention through the selected storyline, not consume an independent sweep slot`,
    );
  }
});

test("failed talks cannot lower crisis pressure without an actual de-escalatory fact", async () => {
  const mod = await import("../src/Game/AI/nativeWorldDirector.js");
  const world = koreaWorld();
  world.storylines[0].pressure = 65;
  world.storylines[0].momentum = 60;

  const error = mod.validateWorldStorylinePayload({
    events: [{
      id: "event-ai-r0071-20191005-001",
      date: "2019-10-05",
      title: "U.S.-North Korea Stockholm Working-Level Nuclear Talks Conclude Without Agreement",
      description: "Talks fail to bridge major gaps and Pyongyang issues renewed warnings regarding its strategic deterrent capability.",
      storylineIds: ["storyline-korean-peninsula-crisis"],
    }],
    storylineUpdates: [{
      id: "storyline-korean-peninsula-crisis",
      status: "active",
      pressure: 60,
      momentum: 55,
      startedDate: "",
      kind: "crisis",
      title: "Korean Peninsula Security Crisis",
      participants: ["Republic of Korea", "United States of America", "North Korea"],
      eventIndexes: [0],
      state: "Negotiations failed and regional tension remains elevated.",
    }],
  }, {
    existingStorylines: world.storylines,
    selectedStorylines: world.storylines,
    deferredStorylines: [],
    originDate: "2019-09-25",
    stopDate: "2019-10-25",
    world,
  });

  assert.match(error, /lowers pressure/i);
});

// A player's Iran game fell back to canned events over this: its cyber
// programme sat at pressure 18, eased to 14, and the one event bound to it
// "deploys" hardware — a keyword the escalation cue list counts. The event and
// the record are transcribed from the player's debug report; the prior pressure
// of 18 is what the report's "lowers pressure by 4" implies.
test("a low-pressure programme may ease while its event 'deploys' hardware; a crisis may not", async () => {
  const mod = await import("../src/Game/AI/nativeWorldDirector.js");
  const candidate = () => ({
    events: [{
      id: "segment-1-event-8",
      date: "2026-08-30",
      kind: "world",
      title: "National Cyber Operations Center Deploys Next-Generation Cryptographic Hardening",
      description: "The National Signals Intelligence and Cyber Operations Center deploys next-generation cryptographic hardware security modules and sovereign routing nodes across critical ministry networks, reinforcing national cyber sovereignty and intelligence defenses.",
    }],
    storylineUpdates: "iran-cyber-sovereignty-2024~active~14~80~~~~~National cyber sovereignty infrastructure achieves advanced operational status with upgraded hardware security modules deployed across all critical ministry networks.",
  });
  const storyline = (pressure) => ({
    id: "iran-cyber-sovereignty-2024",
    kind: "security",
    title: "Iranian Cyber Sovereignty Programme",
    participants: ["Iran"],
    status: "active",
    pressure,
    momentum: 80,
    startedDate: "2024-01-09",
    state: "Sovereign network hardening is under way across the ministries.",
  });
  const validate = (pressure) => {
    const payload = candidate();
    // The jump binds events to storylines natively before judging them; the
    // record's own event field is blank, exactly as the model sent it.
    mod.normalizeWorldStorylineEventLinks(payload, { world: {} });
    assert.deepEqual(payload.storylineUpdates[0].eventIndexes, [0], "the deploys event binds to the programme");
    const storylines = [storyline(pressure)];
    return mod.validateWorldStorylinePayload(payload, {
      existingStorylines: storylines,
      selectedStorylines: storylines,
      deferredStorylines: [],
      originDate: "2026-06-27",
      stopDate: "2026-09-25",
      enforceAntiStasis: false,
      enforceSelectedCoverage: false,
      world: {},
    });
  };

  assert.equal(validate(18), "", "a programme at pressure 18 easing to 14 is not crisis pressure being erased");
  assert.match(validate(65), /lowers pressure/i, "the same drop on a crisis-level storyline is still refused");
});

// The same player's round-53 answer wrote every storyline record two empty
// fields short — seven separators where the contract has nine — so each state
// landed in participantsCSV and the jump fell back on "record 1 must describe
// the process state". Two of its lines, verbatim.
test("a storyline record two or three empty fields short keeps its state", async () => {
  const mod = await import("../src/Game/AI/nativeWorldDirector.js");
  const decode = (line) => mod.decodeWorldStorylineUpdates(line)[0];

  const intelligence = decode("iran-intelligence-modernization-2024~active~20~75~2024-01-09~~~Advanced signals intelligence nodes and cryptographic communication links are actively maintained and expanded across regional outposts.");
  assert.equal(intelligence.state, "Advanced signals intelligence nodes and cryptographic communication links are actively maintained and expanded across regional outposts.");
  assert.deepEqual(intelligence.participants, []);
  assert.equal(intelligence.pressure, 20);
  assert.equal(intelligence.momentum, 75);
  assert.equal(intelligence.startedDate, "2024-01-09");

  const georgia = decode("iran-georgia-transit-2022~active~15~55~2022-03-12~~~Digital customs clearance protocols maintain steady commercial throughput across Caucasus corridors.");
  assert.match(georgia.state, /^Digital customs clearance/);

  // Three short: the state sits in the title slot.
  const titleSlot = decode("storyline-x~active~40~30~2020-01-01~~The junta faces spreading armed resistance and a collapsing economy after the coup.");
  assert.match(titleSlot.state, /^The junta faces/);
  assert.equal(titleSlot.title, "");

  // What must NOT move: a short record whose last field really is a list of
  // names, or a title, keeps it where it is (and its state stays empty for the
  // validator to report).
  const names = decode("storyline-y~active~40~30~2020-01-01~crisis~Border Friction~Armenia, Azerbaijan, Russian Federation, United States.");
  assert.deepEqual(names.participants, ["Armenia", "Azerbaijan", "Russian Federation", "United States."]);
  assert.equal(names.state, "");
  const longName = decode("storyline-z~active~40~30~2020-01-01~diplomacy~Channel Talks~United Kingdom of Great Britain and Northern Ireland, France");
  assert.equal(longName.participants.length, 2);
  assert.equal(longName.state, "");
  const title = decode("storyline-t~active~40~30~2020-01-01~crisis~Armenia-Azerbaijan Border Friction After Ceasefire");
  assert.equal(title.title, "Armenia-Azerbaijan Border Friction After Ceasefire");
  assert.equal(title.state, "");

  // The one-short shape and a complete record read exactly as before.
  const oneShort = decode("iran-cyber-sovereignty-2024~active~14~80~~~~~National cyber sovereignty infrastructure achieves advanced operational status.");
  assert.match(oneShort.state, /^National cyber sovereignty/);
  const complete = decode("storyline-c~active~40~30~2020-01-01~crisis~Title~Armenia,Azerbaijan~1,2~A settled state.");
  assert.deepEqual(complete.participants, ["Armenia", "Azerbaijan"]);
  assert.deepEqual(complete.eventIndexes, [0, 1]);
  assert.equal(complete.state, "A settled state.");
});
