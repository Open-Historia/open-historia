import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTurnPerfSummary,
  formatTurnPerfSummary,
} from "../src/runtime/turnPerf.js";

test("turn profiler aggregates AI calls, retries, stages and main-thread stalls", () => {
  const summary = buildTurnPerfSummary({
    startedAt: 100,
    endedAt: 3100,
    meta: {
      round: 72,
      originDate: "2019-10-25",
      targetDate: "2019-11-25",
    },
    stages: [
      { name: "pass1.template-context", ms: 300 },
      { name: "pass1.world-ai", ms: 1200 },
      { name: "pass1.world-ai", ms: 200 },
    ],
    aiAttempts: [
      { taskKey: "jumpForward", attempt: 1, ms: 1000 },
      { taskKey: "jumpForward", attempt: 2, ms: 900 },
      { taskKey: "worldMotionRepair", attempt: 1, ms: 400 },
    ],
    retries: [{ taskKey: "jumpForward", reason: "validation" }],
    fallbacks: [],
    maxMainThreadStallMs: 680,
    totalMainThreadStallMs: 920,
    stallCount: 2,
  });

  assert.equal(summary.wallMs, 3000);
  assert.equal(summary.aiCalls, 3);
  assert.equal(summary.aiRetryCount, 1);
  assert.equal(summary.cumulativeAiMs, 2300);
  assert.equal(summary.maxMainThreadStallMs, 680);
  assert.equal(summary.aiByTask[0].taskKey, "jumpForward");
  assert.equal(summary.aiByTask[0].calls, 2);
  assert.equal(summary.aiByTask[0].ms, 1900);

  const rendered = formatTurnPerfSummary(summary);
  assert.match(rendered, /\[OH TURN PERF R72\]/);
  assert.match(rendered, /UI starvation: max 680ms/);
  assert.match(rendered, /worldMotionRepair 1×/);
});
