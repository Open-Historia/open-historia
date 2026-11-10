import test from "node:test";
import assert from "node:assert/strict";
import { groupGenerationRows } from "./groupTelemetry.js";

test("ten group speakers show as one expandable logical interaction, preserving all call records", () => {
  const records = Array.from({ length: 4 }, (_, index) => ({
    id: "call-" + index, groupTurnId: "group-1", groupName: "Russian Ministry Cabinet",
    groupTotalSpeakers: 10, groupSpeakerIds: Array.from({ length: index === 3 ? 1 : 3 },
      (_, sub) => "advisor-" + (index * 3 + sub)),
    requests: { ok: 1, failed: 0, refused: 0 },
    usage: { promptTokens: 1000, outputTokens: 250 },
    ok: true,
  }));
  const lone = { id: "single", taskKey: "diplomacy", requests: { ok: 1, failed: 0, refused: 0 } };
  const grouped = groupGenerationRows([records[3], lone, ...records.slice(0, 3)]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].kind, "group");
  assert.equal(grouped[0].records.length, 4);
  assert.equal(grouped[0].requests, 4);
  assert.equal(grouped[0].completedSpeakers, 10);
  assert.equal(grouped[0].totalSpeakers, 10);
  assert.equal(grouped[0].promptTokens, 4000);
  assert.strictEqual(grouped[0].records[0], records[3]);
  assert.equal(grouped[1].record.id, "single");
});

test("failed and pending provider batches stay visible in the one group summary", () => {
  const rows = groupGenerationRows([
    { id: "1", groupTurnId: "t", groupSpeakerIds: ["a", "b"], groupTotalSpeakers: 5, ok: true, requests: { ok: 1 } },
    { id: "2", groupTurnId: "t", groupSpeakerIds: ["c", "d"], groupTotalSpeakers: 5, ok: false, requests: { refused: 1 } },
    { id: "3", groupTurnId: "t", groupSpeakerIds: ["e"], groupTotalSpeakers: 5, ok: null },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completedSpeakers, 2);
  assert.equal(rows[0].failedBatches, 1);
  assert.equal(rows[0].pendingBatches, 1);
  assert.equal(rows[0].requests, 2);
});
