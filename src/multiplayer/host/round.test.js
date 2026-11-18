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

test("a new round length moves this round's deadline and holds for the next", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a", "b", "c"]);
  round.start();
  await clock.advance(4 * 60 * 1000);
  assert.equal(round.setRoundMinutes(30), 30);
  await clock.advance(20 * 60 * 1000);
  assert.deepEqual(resolved, [], "10 minutes was the old length; 30 counts from the start");
  await clock.advance(6 * 60 * 1000);
  assert.deepEqual(resolved, [1]);
  // After the reveal, the next round plans for the new length.
  await clock.advance(60 * 1000);
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 2);
  assert.equal(round.status().remainingMs, 30 * 60 * 1000);
});

test("a shorter round length never ends the round sooner than a minute from now", async () => {
  const { clock, round, resolved } = machine({ roundMinutes: 60 });
  round.setPlayers(["a", "b"]);
  round.start();
  await clock.advance(30 * 60 * 1000);
  round.setRoundMinutes(5);
  await clock.advance(59 * 1000);
  assert.deepEqual(resolved, []);
  await clock.advance(1000);
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

test("a round ended while paused lands in a reveal that ends: Pause, then End round now, no longer sticks", async () => {
  const { clock, round } = machine();
  round.setPlayers(["a", "b"]);
  round.start();
  round.pause();
  assert.equal(round.status().paused, true);
  round.resolveNow();
  await clock.flush();
  assert.equal(round.status().phase, "revealing");
  assert.equal(round.status().paused, false, "ending the round ends the pause");
  await clock.advance(60_000);
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 2);
});

test("reading a round through counts for the round it names, never for the next one being resolved", async () => {
  let release;
  const world = machine({}, { during: () => new Promise((resolve) => { release = resolve; }) });
  world.round.setPlayers(["a", "b"]);
  world.round.start();
  world.round.setReady("a", true);
  world.round.setReady("b", true);
  await world.clock.flush();
  release();
  await world.clock.flush();
  assert.equal(world.round.status().phase, "revealing");
  world.round.revealedBy("a", 1);
  world.round.revealedBy("b", 1);
  assert.equal(world.round.status().round, 2);
  // Round 2 is resolved; both have finished reading round 1 late.
  world.round.setReady("a", true);
  world.round.setReady("b", true);
  await world.clock.flush();
  assert.equal(world.round.status().phase, "resolving");
  world.round.revealedBy("a", 1);
  world.round.revealedBy("b", 1);
  release();
  await world.clock.flush();
  assert.equal(world.round.status().phase, "revealing", "round 2's reveal is not ended by round 1's reading");
  world.round.revealedBy("a", 2);
  world.round.revealedBy("b", 2);
  assert.equal(world.round.status().phase, "planning");
});

test("with nobody here, no round is resolved: the clock waits for someone", async () => {
  const { clock, round, resolved } = machine();
  round.setPlayers(["a"]);
  round.start();
  round.setPlayers([]);
  await clock.advance(11 * 60_000);
  assert.deepEqual(resolved, []);
  assert.equal(round.status().phase, "planning");
  round.setPlayers(["a"]);
  await clock.flush();
  assert.deepEqual(resolved, [1], "resolved once someone is here and the round's time is up");
});

test("a round that fails says why until one lands", async () => {
  let fail = true;
  const clock = createClock();
  const round = createRoundMachine({
    settings: { roundMinutes: 10, countdownSeconds: 30, revealSeconds: 60 },
    now: clock.now,
    timers: clock.timers,
    onResolve: async () => { if (fail) throw new Error("The model's quota is used up."); },
  });
  round.setPlayers(["a"]);
  round.start();
  round.setReady("a", true);
  await clock.flush();
  assert.deepEqual(round.status().failure, { round: 1, reason: "The model's quota is used up." });
  fail = false;
  round.resolveNow();
  await clock.flush();
  assert.equal(round.status().phase, "revealing");
  assert.equal(round.status().failure, null);
});

// One round number, the campaign's (the gap audit of 2026-11-18). The machine counted from 1 in each sitting while
// every turn record and the Events panel count the campaign's rounds: the round bar and the panel named two numbers,
// and a player's "I have read the round", sent with the turn record's number, never matched, so every reveal ran its
// full time.
test("a game started at the campaign's round names that round, and a player's reading of the round the skip wrote counts", async () => {
  const clock = createClock();
  let campaign = 7;
  const round = createRoundMachine({
    settings: { roundMinutes: 10, countdownSeconds: 0, revealSeconds: 60 },
    now: clock.now,
    timers: clock.timers,
    // The skip writes the campaign's next round, and says which.
    onResolve: async () => {
      campaign += 1;
      return { round: campaign };
    },
  });
  round.setPlayers(["a", "b"]);
  round.start(7);
  assert.equal(round.status().round, 7, "the campaign's round, not 1");
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  assert.equal(round.status().phase, "revealing");
  assert.equal(round.status().round, 8, "the round the skip wrote, as its turn record names it");
  round.revealedBy("a", 8);
  round.revealedBy("b", 8);
  assert.equal(round.status().phase, "planning", "every player read it: planning begins without waiting out the reveal");
  assert.equal(round.status().round, 8, "and no second count is added");
  // A reading of another round still counts for nothing.
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  round.revealedBy("a", 3);
  assert.equal(round.status().phase, "revealing");
});

// A page holds the landed turn before the round's entry ends (a view pushed after the skip's commit), and says it has
// read it, naming the round the skip wrote: that read came while the machine still named the round being resolved,
// and was dropped, so the reveal ran its full time (the review of 2026-11-18, core 8).
test("a reading said while the round is still being resolved counts once it lands, for the round it names", async () => {
  const clock = createClock();
  let campaign = 7;
  let release;
  const round = createRoundMachine({
    settings: { roundMinutes: 10, countdownSeconds: 0, revealSeconds: 60 },
    now: clock.now,
    timers: clock.timers,
    onResolve: async () => {
      await new Promise((resolve) => { release = resolve; });
      campaign += 1;
      return { round: campaign };
    },
  });
  round.setPlayers(["a", "b"]);
  round.start(7);
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  assert.equal(round.status().phase, "resolving");
  round.revealedBy("a", 8);
  round.revealedBy("b", 7);
  release();
  await clock.flush();
  assert.equal(round.status().phase, "revealing", "b named another round: the reveal waits for b");
  round.revealedBy("b", 8);
  assert.equal(round.status().phase, "planning", "a's early reading counted");
  // Both early, and the reveal is over as soon as the round lands.
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  round.revealedBy("a", 9);
  round.revealedBy("b", 9);
  release();
  await clock.flush();
  assert.equal(round.status().phase, "planning");
  assert.equal(round.status().round, 9);
});

test("what the round holds for a player follows their seat to a new name: a reading said early counts under it", async () => {
  const clock = createClock();
  let release;
  const round = createRoundMachine({
    settings: { roundMinutes: 10, countdownSeconds: 0, revealSeconds: 60 },
    now: clock.now,
    timers: clock.timers,
    onResolve: async () => {
      await new Promise((resolve) => { release = resolve; });
      // The round renamed b's country; the host moves the seat before the round lands (host/gameHost.js followSeats).
      round.rename("b", "b2");
      round.setPlayers(["a", "b2"]);
      return { round: 8 };
    },
  });
  round.setPlayers(["a", "b"]);
  round.start(7);
  round.setReady("a", true);
  round.setReady("b", true);
  await clock.flush();
  round.revealedBy("a", 8);
  round.revealedBy("b", 8);
  release();
  await clock.flush();
  assert.equal(round.status().phase, "planning", "both had read it, b under its old name");
});

test("a game taken up again goes on at the campaign's round", () => {
  const clock = createClock();
  const round = createRoundMachine({ now: clock.now, timers: clock.timers });
  round.resumeAt(12, { campaign: true });
  assert.equal(round.status().round, 12);
});
