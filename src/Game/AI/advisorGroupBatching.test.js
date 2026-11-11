import test from "node:test";
import assert from "node:assert/strict";
import { groupSpeakerBatches, parseAdvisorGroupBatch } from "./advisorGroupBatching.js";
import { clampAdvisorBatchSize, readAdvisorGroupSettings, setAdvisorGroupSettings } from "./advisorGroupSettings.js";
import { createMemoryStorage } from "./requestBudget.js";

test("ten speakers contribute in 3 + 3 + 3 + 1 sequential requests", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `speaker-${i}`);
  assert.deepEqual(groupSpeakerBatches(ids, 3).map((batch) => batch.length), [3,3,3,1]);
  assert.deepEqual(groupSpeakerBatches(ids, 1).map((batch) => batch.length), Array(10).fill(1));
  assert.deepEqual(groupSpeakerBatches(ids, 10).map((batch) => batch.length), [10]);
  assert.deepEqual(groupSpeakerBatches([], 3), []);
  assert.throws(() => groupSpeakerBatches(["a", "a"], 3), /distinct/);
});

test("settings default to individual requests and persist the inactive batch slider", () => {
  const store = createMemoryStorage();
  assert.deepEqual(readAdvisorGroupSettings(store), { individual: true, batchSize: 3, effectiveBatchSize: 1 });
  assert.equal(setAdvisorGroupSettings({ individual: false, batchSize: 7 }, store).effectiveBatchSize, 7);
  assert.equal(setAdvisorGroupSettings({ individual: true }, store).effectiveBatchSize, 1);
  assert.equal(readAdvisorGroupSettings(store).batchSize, 7);
  assert.equal(clampAdvisorBatchSize(0), 1);
  assert.equal(clampAdvisorBatchSize(100), 10);
  assert.equal(clampAdvisorBatchSize("n/a"), 3);
});

test("shared JSON accepts one exact attributable reply per selected member including native fences", () => {
  const ids = ["chief", "advisor-marina"];
  const input = { replies: [
    { speakerId: "chief", text: "I disagree with Marina." },
    { speakerId: "advisor-marina", text: "A project is appropriate.\n```projects\n{\"ops\":[]}\n```" },
  ] };
  assert.deepEqual(parseAdvisorGroupBatch(JSON.stringify(input), ids).map((r) => r.speakerId), ids);
  assert.equal(parseAdvisorGroupBatch("```json\n" + JSON.stringify(input) + "\n```", ids).length, 2);
});

test("batch parser fails closed on missing, duplicated, reordered, unknown or malformed speakers", () => {
  const ids = ["chief", "advisor-marina", "advisor-boris"];
  const entries = ids.map((speakerId) => ({ speakerId, text: "Opinion." }));
  const check = (replies) => assert.throws(() => parseAdvisorGroupBatch(JSON.stringify({ replies }), ids), /speaker|exactly/);
  check(entries.slice(0, 2));
  check([...entries.slice(0, 2), entries[1]]);
  check([entries[1], entries[0], entries[2]]);
  check([...entries.slice(0, 2), { speakerId: "stranger", text: "Hi" }]);
  check([...entries.slice(0, 2), { speakerId: ids[2], text: "" }]);
  assert.throws(() => parseAdvisorGroupBatch("not json", ids), /valid JSON/);
  assert.throws(() => parseAdvisorGroupBatch('{"replies":[]}', ids), /exactly/);
});
