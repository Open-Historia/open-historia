/*! Open Historia — native world integrity screen tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorldActorResolver,
  createWorldEventScopeClassifier,
  deriveWorldExplorationAudit,
  screenGeneratedWorldEvents,
} from "./nativeWorldIntegrity.js";

const quietly = (run) => {
  const { info, warn } = console;
  console.info = () => {};
  console.warn = () => {};
  try {
    return run();
  } finally {
    console.info = info;
    console.warn = warn;
  }
};

// A large map: two hundred polities, each with two aliases.
const bigWorld = () => {
  const names = Array.from({ length: 200 }, (_, i) => `Polity Number ${i} Republic`);
  return {
    names,
    world: {
      polityOverrides: Object.fromEntries(names.map((name, i) => [name, {
        code: name,
        name,
        aliases: [`Land${i}`, `Realm ${i}`],
        status: "active",
      }])),
      wars: [{ id: "war-1-2", status: "active", sideA: [names[1]], sideB: [names[2]] }],
      storylines: [],
      projects: [],
    },
  };
};

test("the resolver finds the same polities by alias as by name, whole words only", () => {
  const { world, names } = bigWorld();
  const resolver = createWorldActorResolver(world, names[0]);
  assert.deepEqual(resolver.mentionedPolities("Land3 and Realm 4 meet; Land33x does not."), [names[3], names[4]]);
  assert.equal(resolver.mentions(names[5], "Talks in Land5 continue."), true);
  assert.equal(resolver.mentions(names[5], "Talks in Land55 continue."), false);
  // An alias given as the actor is matched as itself, not widened to its polity.
  assert.equal(resolver.mentions("Land6", "Realm 6 votes."), false);
});

test("the scope classifier reads mentions through its one resolver", () => {
  const { world, names } = bigWorld();
  const classify = createWorldEventScopeClassifier(null, { world, gameCountry: names[0] });
  assert.equal(classify({ title: "Land0 opens a port", description: "" }), "player-sphere");
  assert.equal(classify({ title: "Land9 opens a port", description: "" }), "wider-world");
  assert.equal(classify({ title: "A port opens", description: "" }), "unknown");
});

test("screening a segment on a two-hundred-polity map takes well under a few seconds", () => {
  const { world, names } = bigWorld();
  const events = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    date: "2014-07-01",
    title: `Land${i} Faces Fuel Rationing`,
    description: `Wartime rationing and war economy shortages hit Land${i} and Realm ${i + 1}.`,
    importance: "major",
  }));
  const analysis = {
    explorationSlate: Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      type: i < 5 ? "actor-domain" : "global",
      scope: i < 3 ? "player-sphere" : "wider-world",
      actor: names[i * 7],
      domain: "diplomacy",
    })),
  };

  const started = performance.now();
  const screened = quietly(() => screenGeneratedWorldEvents({
    events,
    world,
    game: { country: names[0] },
    actions: [],
    analysis,
  }));
  deriveWorldExplorationAudit({ events }, analysis, { world, gameCountry: names[0] });
  const elapsed = performance.now() - started;

  // Before the resolver was shared this took over ten seconds.
  assert.ok(elapsed < 3000, `took ${Math.round(elapsed)} ms`);
  // The rationing rule still runs: only the belligerents' own homefront survives.
  const kept = screened.events.map((event) => event.id);
  assert.ok(kept.includes("e1") && kept.includes("e2"), kept.join(","));
  assert.ok(!kept.includes("e5"));
});

// --- The player's sovereign choices belong to the player ---

const latviaWorld = {
  polityOverrides: {
    "Republic of Latvia": { code: "Republic of Latvia", name: "Republic of Latvia", aliases: ["Latvia"], status: "active" },
    "Republic of Estonia": { code: "Republic of Estonia", name: "Republic of Estonia", aliases: ["Estonia"], status: "active" },
    "Russian Federation": { code: "Russian Federation", name: "Russian Federation", aliases: ["Russia"], status: "active" },
  },
  institutions: { byId: {} },
  wars: [],
  storylines: [],
  projects: [],
};
const latviaGame = { country: "Republic of Latvia", gameDate: "2014-06-20" };
const latviaEvent = (title, description, extra = {}) => ({
  id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  date: "2014-07-01",
  title,
  description,
  importance: "major",
  playerRelated: true,
  ...extra,
});
const screenLatvia = (events, extra = {}) => quietly(() => screenGeneratedWorldEvents({
  events,
  world: latviaWorld,
  game: latviaGame,
  actions: [],
  chats: [],
  ...extra,
}));

test("the world cannot declare war for the player's country", () => {
  const screened = screenLatvia([latviaEvent("Latvia Declares War on Russia", "Latvia declares war on Russia.")]);
  assert.equal(screened.events.length, 0);
  assert.equal(screened.dropped[0].route, "PLAYER_AGENCY_AUTHORITY");
  assert.match(screened.dropped[0].reason, /no queued order or player-authored message/);
  assert.deepEqual(screened.hidden, [], "it never happened, so the Board must never read it");
});

test("the player's own order authorizes the same choice", () => {
  const actions = [{ id: "act-war", status: "planned", text: "Declare war on Russia" }];
  const screened = screenLatvia([latviaEvent("Latvia Declares War on Russia", "Latvia declares war on Russia.")], { actions });
  assert.equal(screened.events.length, 1);
  assert.equal(screened.events[0].agency.authority, "player-order");
});

test("an event citing a queued order is kept even when it overreaches the order", () => {
  const actions = [{ id: "act-border", status: "planned", text: "Strengthen the eastern border" }];
  const screened = screenLatvia([latviaEvent(
    "Latvia Mobilizes Reservists",
    "Latvia announces a general mobilization of reservists.",
    { impacts: { actionIds: ["act-border"] } },
  )], { actions });
  assert.equal(screened.events.length, 1);
});

test("the player's own message in a chat authorizes the treaty it agreed", () => {
  const chats = [{
    id: "chat-estonia",
    messages: [{
      id: "msg-latvia",
      role: "user",
      speaker: "Republic of Latvia",
      text: "Latvia will sign the border demarcation treaty with Estonia next month.",
    }],
  }];
  const treaty = latviaEvent(
    "Latvia Signs Border Demarcation Treaty With Estonia",
    "Latvia signs the border demarcation treaty with Estonia in Riga.",
  );
  assert.equal(screenLatvia([treaty]).events.length, 0, "without the chat nothing authorizes it");
  const screened = screenLatvia([treaty], { chats });
  assert.equal(screened.events.length, 1);
  assert.equal(screened.events[0].agency.authority, "player-commitment");
  assert.equal(screened.events[0].agency.authorityRef, "msg-latvia");
});

test("another power's sovereign act that only names the player's country stays", () => {
  const screened = screenLatvia([
    latviaEvent("NATO Deploys Battalion to Latvia", "NATO deploys a multinational battalion to Latvia."),
    latviaEvent("Russia Deploys Troops Near the Latvia Border", "Russia deploys troops near the border."),
  ]);
  assert.equal(screened.events.length, 2);
  assert.deepEqual(screened.dropped, []);
});

// --- The parties of a treaty are who signed it ---

const pactRecord = (eventId, parties) => ({
  id: "baltic-pact",
  op: "start",
  type: "mutual_defense",
  parties,
  eventIds: [eventId],
  eventIndexes: [0],
  title: "Baltic Defence Pact",
});

test("a treaty's agreement record makes the player a signatory even when another state heads the title", () => {
  const pact = latviaEvent("Estonia Signs Defence Pact With Latvia", "Estonia and Latvia sign a mutual defence pact in Tallinn.");
  const withoutRecord = screenLatvia([pact]);
  assert.equal(withoutRecord.events.length, 1, "read from the title alone, Estonia signed it");

  const screened = screenLatvia([pact], {
    agreementUpdates: [pactRecord(pact.id, ["Republic of Estonia", "Republic of Latvia"])],
  });
  assert.equal(screened.events.length, 0);
  assert.equal(screened.dropped[0].route, "PLAYER_AGENCY_AUTHORITY");
  assert.match(screened.dropped[0].reason, /^joint-player-sovereign-choice-without-authority/);
});

test("a treaty between two other states names both as sovereign actors and no one else", () => {
  const pact = latviaEvent(
    "Estonia and Russia Sign Border Treaty",
    "Estonia and Russia sign a border treaty, a move watched closely in Latvia.",
    { playerRelated: false },
  );
  const screened = screenLatvia([pact], {
    agreementUpdates: [pactRecord(pact.id, ["Republic of Estonia", "Russian Federation"])],
  });
  assert.equal(screened.events.length, 1);
  assert.deepEqual(
    screened.events[0].agency.sovereignActors.map((row) => [row.polity, row.authority]),
    [["Republic of Estonia", "autonomous"], ["Russian Federation", "autonomous"]],
  );
  assert.equal(screened.events[0].actors, undefined, "derived actors are never stored on the event");
});
