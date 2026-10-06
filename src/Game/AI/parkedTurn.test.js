/*! Open Historia — a finished skip kept for its campaign, across a restart © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/parkedTurn.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { PARKED_TURN_VERSION, parkedTurnRecord, restoreJumpRequests, restoreParkedTurn } from "./parkedTurn.js";
import { createTurnReplay, replayAnswer } from "./heldTurnReplay.js";
import { createJumpBudget } from "./requestBudget.js";

// The apply's arguments as finishTimelineJump builds them: the board's bundle is
// the very state the base fields hold, and the rest cannot be stored.
const keptSkip = async () => {
  const bundle = {
    actions: [{ id: "order-1", title: "Mobilise", status: "pending" }],
    chats: [{ id: "chat-1", messages: [] }],
    events: [{ id: "event-old", title: "Earlier" }],
    game: { country: "Testland", gameDate: "1914-07-01", round: 4 },
    world: { ownerSchema: 4, projects: [] },
  };
  const budget = createJumpBudget({ cap: 3 });
  budget.reserve("institutionBallots", 1);
  budget.take("jump");
  const replay = createTurnReplay();
  await replayAnswer(replay, "timelineCurator", async () => ({ payload: { judgments: [] }, generation: { source: "ai" } }));
  await replayAnswer(replay, "projectsBoard", async () => ({ ops: [{ op: "progress", id: "p-1" }] }), { rememberFailure: false });
  return {
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors: { Testland: [1, 2, 3] },
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: bundle.world,
    campaignId: "game-a",
    result: { mode: "jump", stopDate: "1914-08-01", events: [{ title: "War declared" }], receipt: { notes: [] } },
    projects: { bundle, signal: new AbortController().signal, review: null, requests: { saving: true, budget, used: 1, refused: 0 } },
    phases: { enter() {}, finish() { return null; } },
    replay,
  };
};

// Through JSON, as both stores keep it.
const stored = (record) => JSON.parse(JSON.stringify(record));

test("a kept skip comes back from its campaign's store ready to be written, asking nothing again", async () => {
  const applyArgs = await keptSkip();
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs, parkedAt: "2026-09-29T10:00:00.000Z" }));
  assert.equal(record.version, PARKED_TURN_VERSION);
  assert.equal(record.round, 4);
  assert.equal(record.fromDate, "1914-07-01");
  assert.equal(record.toDate, "1914-08-01");

  const kept = restoreParkedTurn(record, { campaignId: "game-a" });
  assert.equal(kept.campaignId, "game-a");
  const restored = kept.applyArgs;
  for (const key of ["baseActions", "baseChats", "baseColors", "baseEvents", "baseGame", "baseWorld", "result"]) {
    assert.deepEqual(restored[key], applyArgs[key], key);
  }
  assert.equal(restored.campaignId, "game-a");
  assert.equal(restored.reveal, "staged");
  // The board's bundle is the base state again, one copy of it.
  assert.equal(restored.projects.bundle.world, restored.baseWorld);
  assert.equal(restored.projects.bundle.game, restored.baseGame);
  assert.equal(restored.projects.signal, null, "the Apply button brings its own");
  assert.equal(restored.phases, null, "the skip's phase tracker spoke to a panel long gone");

  // Every answer the apply was given before the write.
  const asked = [];
  restored.replay.rewind();
  const curator = await replayAnswer(restored.replay, "timelineCurator", async () => asked.push("curator"));
  const board = await replayAnswer(restored.replay, "projectsBoard", async () => asked.push("board"), { rememberFailure: false });
  assert.deepEqual(asked, []);
  assert.deepEqual(curator.payload, { judgments: [] });
  assert.deepEqual(board.ops, [{ op: "progress", id: "p-1" }]);

  // And the skip's budget, so the steps after the write spend what is left.
  const { requests } = restored.projects;
  assert.equal(requests.saving, true);
  assert.equal(requests.used, 1);
  assert.equal(requests.budget.cap, 3);
  assert.equal(requests.budget.spent, 1);
  assert.equal(requests.budget.reserved, 1);
  assert.equal(requests.budget.take("stats"), true);
  assert.equal(requests.budget.take("history"), false, "the last slot is the ballots'");
  assert.equal(requests.budget.take("institutionBallots"), true);
});

test("a skip kept by an older build is written under the skip's own list and cap", async () => {
  // Kept with Save AI requests off, when that meant a budget with no cap and
  // every check a request of its own.
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs: await keptSkip() }));
  record.requests.saving = false;
  record.requests.budget = { cap: 3, unlimited: true, spends: [{ spender: "jump", granted: true }], reservations: {} };
  const { requests } = restoreParkedTurn(record, { campaignId: "game-a" }).applyArgs.projects;
  assert.equal(requests.budget.allows("unitDirector"), false, "a check is no longer a request of its own");
  assert.equal(requests.budget.take("unitDirector"), false);
  assert.equal(requests.budget.take("history"), true);
  assert.equal(requests.budget.take("stats"), true);
  assert.equal(requests.budget.take("history"), false, "three is the most a skip spends");
  assert.equal(requests.budget.spent, 3);
});

test("a kept skip is only ever offered to its own campaign", async () => {
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs: await keptSkip() }));
  assert.equal(restoreParkedTurn(record, { campaignId: "game-b" }), null);
  assert.equal(restoreParkedTurn(record, { campaignId: "" }), null);
  assert.equal(restoreParkedTurn(record, {}), null);
});

test("a stored record that is not a kept skip this build can write is not offered", async () => {
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs: await keptSkip() }));
  const broken = [
    null,
    "junk",
    [],
    { ...record, version: PARKED_TURN_VERSION + 1 },
    { ...record, version: undefined },
    { ...record, turn: null },
    { ...record, turn: { ...record.turn, result: null } },
    { ...record, turn: { ...record.turn, baseWorld: "not a world" } },
    { ...record, turn: { ...record.turn, baseGame: undefined } },
  ];
  for (const value of broken) assert.equal(restoreParkedTurn(value, { campaignId: "game-a" }), null);
});

test("a kept skip whose lists were lost comes back with empty ones, not a crash", async () => {
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs: await keptSkip() }));
  delete record.turn.baseActions;
  record.turn.baseChats = "junk";
  delete record.turn.baseColors;
  record.replay = "junk";
  const { applyArgs } = restoreParkedTurn(record, { campaignId: "game-a" });
  assert.deepEqual(applyArgs.baseActions, []);
  assert.deepEqual(applyArgs.baseChats, []);
  assert.deepEqual(applyArgs.baseColors, {});
  assert.equal(await replayAnswer(applyArgs.replay, "timelineCurator", async () => "asked"), "asked");
});

test("a skip with no budget or review keeps none, and gets none back", async () => {
  const applyArgs = await keptSkip();
  applyArgs.projects = { ...applyArgs.projects, requests: null };
  const record = stored(parkedTurnRecord({ campaignId: "game-a", applyArgs }));
  assert.equal(record.requests, null);
  const restored = restoreParkedTurn(record, { campaignId: "game-a" }).applyArgs;
  assert.equal(restored.projects.requests, null);
  assert.equal(restored.projects.review, null);
  assert.equal(restoreJumpRequests(null), null);
  assert.equal(restoreJumpRequests({ used: 2 }), null);
});
