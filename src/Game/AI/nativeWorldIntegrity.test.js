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
