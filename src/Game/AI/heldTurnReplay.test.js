/*! Open Historia — a held turn's retry asks nothing it already asked © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/heldTurnReplay.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { createTurnReplay, replayAnswer } from "./heldTurnReplay.js";

// The shape of applySimulationResult before its board call: the curator, then
// on a thin skip the breadth repair and a second curator pass.
const runApply = async (replay, ask) => {
  replay?.rewind();
  const main = await replayAnswer(replay, "timelineCurator", () => ask("curator main"));
  const repair = await replayAnswer(replay, "breadthRepair", () => ask("breadth repair"));
  const second = await replayAnswer(replay, "timelineCurator", () => ask("curator repair"));
  return { main, repair, second };
};

test("a retry gets the first run's answers back without asking again", async () => {
  const replay = createTurnReplay();
  const asked = [];
  let round = 0;
  const ask = async (what) => {
    asked.push(what);
    return { judgments: [{ what, round }] };
  };
  const first = await runApply(replay, ask);
  round = 1;
  const retry = await runApply(replay, ask);
  assert.deepEqual(asked, ["curator main", "breadth repair", "curator repair"], "the retry must not send any of these again");
  assert.deepEqual(retry, first, "the retry must decide exactly as the first run did");
});

test("an answer is handed back as a copy, so a step that edits it cannot change the retry", async () => {
  const replay = createTurnReplay();
  const ask = async () => ({ events: [{ title: "Treaty signed" }], storylineUpdates: [] });
  const first = await runApply(replay, ask);
  first.repair.storylineUpdates.push({ id: "stale" });
  first.repair.events[0].title = "edited";
  const retry = await runApply(replay, ask);
  assert.deepEqual(retry.repair, { events: [{ title: "Treaty signed" }], storylineUpdates: [] });
});

test("a failed question is remembered, so the retry falls back the same way", async () => {
  const replay = createTurnReplay();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error("curator unavailable");
  };
  await assert.rejects(replayAnswer(replay, "timelineCurator", failing), /curator unavailable/);
  replay.rewind();
  await assert.rejects(replayAnswer(replay, "timelineCurator", failing), /curator unavailable/);
  assert.equal(calls, 1);
});

test("a cancel is not remembered", async () => {
  const replay = createTurnReplay();
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await assert.rejects(replayAnswer(replay, "timelineCurator", async () => { throw abort; }), { name: "AbortError" });
  replay.rewind();
  assert.equal(await replayAnswer(replay, "timelineCurator", async () => "asked again"), "asked again");
});

test("a run that asks something different from here on is asked afresh", async () => {
  const replay = createTurnReplay();
  await replayAnswer(replay, "timelineCurator", async () => "curated");
  await replayAnswer(replay, "breadthRepair", async () => "repaired");
  replay.rewind();
  assert.equal(await replayAnswer(replay, "timelineCurator", async () => "not asked"), "curated");
  assert.equal(await replayAnswer(replay, "somethingElse", async () => "fresh"), "fresh");
  replay.rewind();
  await replayAnswer(replay, "timelineCurator", async () => "not asked");
  assert.equal(await replayAnswer(replay, "somethingElse", async () => "not asked"), "fresh");
});

test("a failure asked not to be remembered is asked again: the board's, which holds the turn", async () => {
  const replay = createTurnReplay();
  let attempts = 0;
  const board = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("board unavailable");
    return { ops: [{ op: "progress" }] };
  };
  await replayAnswer(replay, "timelineCurator", async () => "curated");
  await assert.rejects(replayAnswer(replay, "projectsBoard", board, { rememberFailure: false }), /board unavailable/);
  replay.rewind();
  assert.equal(await replayAnswer(replay, "timelineCurator", async () => "not asked"), "curated");
  assert.deepEqual(await replayAnswer(replay, "projectsBoard", board, { rememberFailure: false }), { ops: [{ op: "progress" }] });
  replay.rewind();
  await replayAnswer(replay, "timelineCurator", async () => "not asked");
  assert.deepEqual(await replayAnswer(replay, "projectsBoard", board, { rememberFailure: false }), { ops: [{ op: "progress" }] });
  assert.equal(attempts, 2, "asked again once after it failed, and not after it answered");
});

test("a replay carried over a restart answers every question it was asked, failures included", async () => {
  const first = createTurnReplay();
  await replayAnswer(first, "timelineCurator", async () => ({ judgments: [{ keep: true }] }));
  await assert.rejects(replayAnswer(first, "breadthRepair", async () => { throw new TypeError("repair failed"); }));
  await replayAnswer(first, "projectsBoard", async () => ({ ops: [] }), { rememberFailure: false });
  await replayAnswer(first, "historyConsolidation", async () => null);
  await replayAnswer(first, "trackedStats", async () => ({ putOff: true }));

  // Through JSON, as the campaign's store keeps it.
  const carried = createTurnReplay(JSON.parse(JSON.stringify(first.saved())));
  const asked = [];
  const never = (label) => async () => {
    asked.push(label);
    return "asked";
  };
  assert.deepEqual(await replayAnswer(carried, "timelineCurator", never("curator")), { judgments: [{ keep: true }] });
  await assert.rejects(replayAnswer(carried, "breadthRepair", never("repair")), { name: "TypeError", message: "repair failed" });
  assert.deepEqual(await replayAnswer(carried, "projectsBoard", never("board"), { rememberFailure: false }), { ops: [] });
  assert.equal(await replayAnswer(carried, "historyConsolidation", never("history")), null);
  assert.deepEqual(await replayAnswer(carried, "trackedStats", never("stats")), { putOff: true });
  assert.deepEqual(asked, []);
});

test("a replay made from nothing usable asks everything", async () => {
  for (const saved of [undefined, null, "junk", [null, { value: 1 }, { label: 3 }]]) {
    const replay = createTurnReplay(saved);
    assert.equal(await replayAnswer(replay, "timelineCurator", async () => "asked"), "asked");
    assert.deepEqual(replay.saved(), [{ label: "timelineCurator", value: "asked" }]);
  }
});

test("without a replay every question is asked", async () => {
  let calls = 0;
  await runApply(null, async () => { calls += 1; return {}; });
  await runApply(null, async () => { calls += 1; return {}; });
  assert.equal(calls, 6);
});
