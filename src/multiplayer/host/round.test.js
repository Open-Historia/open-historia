/*! Open Historia — the multiplayer round machine tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/round.test.js
//
// The user's rule: the host sets the round length and the countdown; when 2/3
// of the players are ready the countdown starts. These step a fake clock from
// one timer to the next and check each phase change.

import test from "node:test";
import assert from "node:assert/strict";
import { createRoundMachine, readyNeeded } from "./round.js";

// A clock whose timers fire in order as it is advanced, each at its own time.
const createClock = (start = 1_000_000) => {
  let t = start;
  let nextId = 1;
  const pending = new Map();
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        pending.set(id, { at: t + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
    flush,
  };
};

const machine = (settings = {}, extra = {}) => {
  const clock = createClock();
  const phases = [];
  const resolved = [];
  const round = createRoundMachine({
    settings: { roundMinutes: 10, countdownSeconds: 30, revealSeconds: 60, ...settings },
    now: clock.now,
    timers: clock.timers,
    onChange: (status) => {
      if (phases.at(-1) !== status.phase) phases.push(status.phase);
    },
    onResolve: async ({ round: number }) => {
      resolved.push(number);
      if (extra.fail) throw new Error("the jump failed");
      if (extra.during) await extra.during();
    },
  });
  return { clock, round, phases, resolved };
};

test("the share: 2/3 of 3 is 2, of 4 is 3, of 1 is 1, of 0 is none", () => {
  assert.equal(readyNeeded(3, 2 / 3), 2);
  assert.equal(readyNeeded(4, 2 / 3), 3);
  assert.equal(readyNeeded(6, 2 / 3), 4);
  assert.equal(readyNeeded(1, 2 / 3), 1);
  assert.equal(readyNeeded(0, 2 / 3), 0);
  assert.equal(readyNeeded(5, 1), 5);
});

test("2 of 3 ready starts the countdown; the countdown ending resolves the round", async () => {
  const { clock, round, phases, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 1);
  round.setReady("a", true);
  assert.equal(round.status().phase, "planning");
  round.setReady("b", true);
  assert.equal(round.status().phase, "countdown");
  assert.equal(round.status().remainingMs, 30_000);
  await clock.advance(29_999);
  assert.equal(round.status().phase, "countdown");
  await clock.advance(1);
  assert.deepEqual(resolved, [1]);
  assert.equal(round.status().phase, "revealing");
  assert.deepEqual(phases, ["lobby", "planning", "countdown", "resolving", "revealing"]);
});

test("everyone ready ends the round at once", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  for (const seat of ["a", "b", "c"]) round.setReady(seat, true);
  await clock.flush();
  assert.deepEqual(resolved, [1]);
});

test("readiness dropping below the share stops the countdown; the round length still ends it", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  round.setReady("a", true);
  round.setReady("b", true);
  assert.equal(round.status().phase, "countdown");
  round.setReady("b", false);
  assert.equal(round.status().phase, "planning");
  await clock.advance(10 * 60 * 1000);
  assert.deepEqual(resolved, [1]);
});

test("the countdown never runs past the round's own end", async () => {
  const { clock, round, resolved } = machine({ roundMinutes: 1, countdownSeconds: 600 });
  round.setPlayers(["a", "b", "c"]);
  round.start();
  await clock.advance(50_000);
  round.setReady("a", true);
  round.setReady("b", true);
  assert.equal(round.status().remainingMs, 10_000);
  await clock.advance(10_000);
  assert.deepEqual(resolved, [1]);
});

test("the reveal ends when every player has seen it, or at its limit; then the next round plans", async () => {
  const { clock, round } = machine();
  round.setPlayers(["a", "b"]);
  round.start();
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  assert.equal(round.status().phase, "revealing");
  round.revealedBy("a");
  assert.equal(round.status().phase, "revealing");
  round.revealedBy("b");
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 2);
  assert.deepEqual(round.status().ready, [], "readiness starts over each round");
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  await clock.advance(60_000);
  assert.equal(round.status().round, 3, "a reveal nobody finishes still ends");
});

test("a player who has read the round before the reveal is announced is counted", async () => {
  // The round's events reach the players as the last step of resolving it: one
  // with a single event to read says so while the host is still finishing.
  let said = false;
  const world = machine({}, { during: async () => {
    world.round.revealedBy("a");
    world.round.revealedBy("b");
    said = true;
  } });
  world.round.setPlayers(["a", "b"]);
  world.round.start();
  world.round.setReady("a", true);
  world.round.setReady("b", true);
  await world.clock.flush();
  assert.equal(said, true);
  assert.equal(world.round.status().phase, "planning", "nobody is left reading: the next round plans at once");
  assert.equal(world.round.status().round, 2);
});

test("a leaver stops counting, so the rest are not held up", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  round.setReady("a", true);
  round.setReady("b", true);
  round.setPlayers(["a", "b"]);
  await clock.flush();
  assert.deepEqual(resolved, [1], "the two who are left are all ready");
});

test("an idle player counts as ready after the AFK limit, when the host turns it on", async () => {
  const { clock, round, resolved } = machine({ afkSeconds: 120 });
  round.setPlayers(["a", "b", "c"]);
  round.start();
  round.setReady("a", true);
  await clock.advance(60_000);
  round.touch("b");
  await clock.advance(60_000);
  // c has been idle 120 s: counts ready, so 2 of 3 and the countdown runs.
  assert.equal(round.status().phase, "countdown");
  assert.deepEqual(round.status().ready.sort(), ["a", "c"]);
  await clock.advance(30_000);
  assert.deepEqual(resolved, [1]);
});

test("a minimum planning time holds the countdown off", async () => {
  const { clock, round, resolved } = machine({ minPlanningSeconds: 90 });
  round.setPlayers(["a", "b"]);
  round.start();
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  assert.equal(round.status().phase, "planning");
  await clock.advance(90_000);
  assert.deepEqual(resolved, [1]);
});

test("pause stops every deadline; resume carries on from where it was", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.advance(10_000);
  round.pause();
  assert.equal(round.status().paused, true);
  await clock.advance(10 * 60 * 1000);
  assert.deepEqual(resolved, []);
  round.resume();
  assert.equal(round.status().remainingMs, 20_000);
  await clock.advance(20_000);
  assert.deepEqual(resolved, [1]);
});

test("a round that fails to resolve goes back to planning, the same round", async () => {
  const { clock, round, resolved } = machine({}, { fail: true });
  round.setPlayers(["a"]);
  round.start();
  round.setReady("a", true);
  await clock.flush();
  assert.deepEqual(resolved, [1]);
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 1);
});

test("readiness only counts for players who are here, and only while planning", async () => {
  const { round } = machine();
  round.setPlayers(["a", "b"]);
  assert.equal(round.setReady("a", true), false, "not in the lobby");
  round.start();
  assert.equal(round.setReady("stranger", true), false);
  assert.equal(round.setReady("a", true), true);
});

test("settings are clamped to sane bounds", () => {
  const { round } = machine({ roundMinutes: -5, readyThreshold: 0.1, countdownSeconds: 1e9 });
  const { settings } = round.status();
  assert.equal(settings.roundMinutes, 1);
  assert.equal(settings.readyThreshold, 0.5);
  assert.equal(settings.countdownSeconds, 3600);
});
