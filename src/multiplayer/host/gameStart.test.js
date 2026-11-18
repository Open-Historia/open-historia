/*! Open Historia — a shared game's start, finished by its host's engine: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/gameStart.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { backstoryPending, finishGameStart } from "./gameStart.js";

const PREHISTORY = { version: 1, events: [{ date: "1913-06-28", title: "A shot in Sarajevo", description: "x" }], facts: [] };
const fresh = () => ({ world: { prehistory: PREHISTORY, simulationHistory: [] }, game: { round: 1 }, events: [] });

test("the backstory is written first, then the fronts, as single player does when its player enters the game", async () => {
  const docs = fresh();
  const calls = [];
  const problems = await finishGameStart({
    backstory: async () => {
      calls.push("backstory");
      // The scenario's own pre-history is applied: its events go on the timeline.
      docs.events = [{ id: "pregame-1" }];
    },
    fronts: async () => {
      calls.push("fronts");
      return true;
    },
    read: async () => docs,
  });
  assert.deepEqual(calls, ["backstory", "fronts"]);
  assert.deepEqual(problems, []);
});

test("the fronts wait while the scenario's pre-history is still to be written, since it writes their wars", async () => {
  assert.equal(backstoryPending(fresh()), true);
  assert.equal(backstoryPending({ ...fresh(), events: [{ id: "pregame-1" }] }), false, "written");
  assert.equal(backstoryPending({ ...fresh(), game: { round: 3 } }), false, "a game under way");
  assert.equal(backstoryPending({ world: { simulationHistory: [] }, game: { round: 1 }, events: [] }), false, "a scenario that keeps none");
  assert.equal(backstoryPending({}), false);

  const calls = [];
  const problems = await finishGameStart({
    backstory: async () => {
      calls.push("backstory");
      throw new Error("The model did not answer.");
    },
    fronts: async () => {
      calls.push("fronts");
    },
    read: async () => fresh(),
  });
  assert.deepEqual(calls, ["backstory"], "no fronts on a backstory not yet written");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /backstory could not be written \(The model did not answer\.\)/, "said to the host, with why");
  assert.match(problems[0], /share it again to try once more/);
});

test("fronts that cannot be built yet are tried again, and only a failure is said", async () => {
  const logged = [];
  const later = await finishGameStart({ fronts: async () => "later", read: async () => ({}), log: (text) => logged.push(text) });
  assert.deepEqual(later, [], "nothing failed: they are built before a round");
  assert.equal(logged.length, 1);
  const failed = await finishGameStart({ fronts: async () => { throw new Error("no map"); }, read: async () => ({}) });
  assert.match(failed[0], /opening fronts could not be built \(no map\)\. They are tried again before each round\./);
  assert.deepEqual(await finishGameStart({}), [], "nothing asked, nothing done");
});

test("the host's engine finishes the start before anyone joins, and the fronts before each round", () => {
  // engineMain.js runs in the engine window only: its wiring is read.
  const source = fs.readFileSync(new URL("./engineMain.js", import.meta.url), "utf8");
  const open = source.slice(source.indexOf("const openGame = async"), source.indexOf("const control = async"));
  const start = open.indexOf("const startProblems = await finishGameStart({");
  assert.ok(start > 0 && start < open.indexOf("gameHost = createGameHost({"), "before the game is hosted");
  assert.ok(open.indexOf("setWorldLanguage(settings.language)") < start, "in the world's language");
  assert.match(open.slice(start, start + 400), /backstory: \(\) => maybeGeneratePregameHistory\(\)/);
  assert.match(open.slice(start, start + 400), /fronts: \(\) => maybeOpenScenarioFronts\(\)/);
  assert.match(open, /failure = startProblems\.join\(" "\);/, "what could not be done is said to the host");
  const round = open.slice(open.indexOf("resolveRound: async"), open.indexOf("await enterSimulation({ signal });"));
  assert.match(round, /await openPendingFronts\(\);/, "before the round's skip takes the game's lock");
});
