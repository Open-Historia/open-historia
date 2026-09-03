import test from "node:test";
import assert from "node:assert/strict";

import {
  attributeTurnPerfStallInterval,
  buildTurnPerfSummary,
} from "../src/runtime/turnPerf.js";

test("R4 stall attribution cannot assign more blocked time than physically overlaps a short stage", () => {
  const trace = {
    stallByStage: new Map(),
    stageWindows: new Map([
      [1, { id: 1, name: "pass1.motion-repair", startedAt: 1000, endedAt: 3050 }],
      [2, { id: 2, name: "final.history-compaction", startedAt: 5000, endedAt: 9000 }],
    ]),
  };

  const allocations = attributeTurnPerfStallInterval(trace, 2000, 10800);
  const motion = trace.stallByStage.get("pass1.motion-repair");
  const history = trace.stallByStage.get("final.history-compaction");
  const unattributed = trace.stallByStage.get("unattributed");

  assert.equal(Math.round(motion.totalMs), 1050);
  assert.equal(Math.round(history.totalMs), 4000);
  assert.equal(Math.round(unattributed.totalMs), 3750);
  assert.equal(
    Math.round(allocations.reduce((sum, row) => sum + row.ms, 0)),
    8800,
    "the delayed interval is partitioned once rather than double-counted",
  );
});

test("R4 summary exposes physically partitioned stall attribution", () => {
  const stallByStage = new Map([
    ["final.rollback-write", { stage: "final.rollback-write", count: 1, totalMs: 700, maxMs: 700 }],
    ["unattributed", { stage: "unattributed", count: 1, totalMs: 300, maxMs: 300 }],
  ]);
  const summary = buildTurnPerfSummary({
    startedAt: 0,
    endedAt: 2000,
    meta: { round: 76 },
    stages: [{ name: "final.rollback-write", ms: 800 }],
    aiAttempts: [],
    retries: [],
    fallbacks: [],
    stallByStage,
    stallIntervals: [{ start: 500, end: 1500, ms: 1000 }],
    maxMainThreadStallMs: 1000,
    totalMainThreadStallMs: 1000,
    stallCount: 1,
  });

  assert.equal(summary.version, "R4");
  assert.equal(summary.stallByStage[0].stage, "final.rollback-write");
  assert.equal(summary.stallByStage[0].totalMs, 700);
  assert.equal(summary.stallIntervals[0].ms, 1000);
});
