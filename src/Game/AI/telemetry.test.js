// Run: node --test src/Game/AI/telemetry.test.js
//
// Runs without node_modules or a browser: telemetry.js is import-free, and
// with neither localStorage nor IndexedDB present it runs in memory-only mode
// (recording on by default, persistence a silent no-op) — the mode a private
// window gets, so the promises here are the ones every environment keeps.
import test from "node:test";
import assert from "node:assert/strict";

import {
  attachAttemptOutcome,
  attachCallMetrics,
  clearAiRecords,
  exportTelemetryCsv,
  finishAiRecord,
  getAiRecords,
  isRatingEnabled,
  isTelemetryEnabled,
  normalizeParsedSummary,
  setGenerationRating,
  startAiRecord,
} from "./telemetry.js";

test.beforeEach(async () => { await clearAiRecords(); });

test("recording defaults to on and rating to off when nothing is stored", () => {
  assert.equal(isTelemetryEnabled(), true);
  assert.equal(isRatingEnabled(), false);
});

test("a direct call's record is complete when it finishes", async () => {
  const record = startAiRecord({
    taskKey: "advisor", provider: "gemini", systemPrompt: "SYS", userMessage: "hello", staticPrefixEnd: 2,
  });
  assert.equal(record.systemPrompt, "SYS");
  assert.equal(record.systemPromptChars, 3);
  assert.equal(record.userMessageChars, 5);
  assert.equal(record.attempt, 1);
  assert.equal(record.awaitingOutcome, false);
  attachCallMetrics(record, { model: "gemini-x", usage: { promptTokens: 10, outputTokens: 4 }, firstByteMs: 120 });
  finishAiRecord(record, { ok: true, rawResponse: "answer" });
  assert.equal(record.finished, true);
  assert.equal(record.ok, true);
  assert.equal(record.model, "gemini-x");
  assert.equal(record.usage.promptTokens, 10);
  assert.equal(record.firstByteMs, 120);
  assert.equal(record.responseChars, 6);
  assert.ok(record.latencyMs >= 0);
  const records = await getAiRecords();
  assert.deepEqual(records.map((entry) => entry.id), [record.id]);
});

test("a task-runner call waits for the validation outcome before it counts as complete", () => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "anthropic", awaitingOutcome: true, attempt: 2, maxAttempts: 2 });
  finishAiRecord(record, { ok: true, rawResponse: "{}" });
  assert.equal(record.finished, true);
  assert.equal(record.ok, null, "not judged until the runner reports");
  attachAttemptOutcome(record, { ok: false, validationError: "$.events must contain 3 events", parsedSummary: { eventCount: 1 } });
  assert.equal(record.ok, false);
  assert.equal(record.validationError, "$.events must contain 3 events");
  assert.deepEqual(record.parsedSummary, { eventCount: 1 });
  assert.equal(record.awaitingOutcome, false);

  // A transport failure is final on its own.
  const failed = startAiRecord({ taskKey: "jumpForward", awaitingOutcome: true });
  finishAiRecord(failed, { ok: false, error: "boom" });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "boom");
  assert.equal(failed.awaitingOutcome, false);

  // Finishing twice changes nothing.
  finishAiRecord(failed, { ok: true, rawResponse: "late" });
  assert.equal(failed.ok, false);
  assert.equal(failed.rawResponse, "");
});

test("ratings clamp to 1-10 and land on the record", async () => {
  const record = startAiRecord({ taskKey: "gameMaster" });
  finishAiRecord(record, { ok: true });
  assert.equal(await setGenerationRating(record.id, 14), true);
  assert.equal(record.rating, 10);
  assert.equal(await setGenerationRating(record.id, 0.4), true);
  assert.equal(record.rating, 1);
  assert.ok(record.ratedAt > 0);
  assert.equal(await setGenerationRating("missing", 5), false);
  assert.equal(await setGenerationRating(record.id, "x"), false);
});

test("the parsed summary counts beta's payload shape", () => {
  const summary = normalizeParsedSummary("jumpForward", {
    events: [
      { impacts: { regionTransfers: [{}, {}], regionControlOps: [{}], polityChanges: [], politicalActorOps: [{}], unitOps: [{}] } },
      { impacts: { regionTransfers: [{}] } },
      {},
    ],
    createdChats: [{}],
    diplomaticOutreach: [{}, {}],
    warUpdates: [{}],
    relationUpdates: [{}, {}, {}],
    storylineUpdates: [{}],
    stopDate: "2014-05-01",
  });
  assert.deepEqual(summary, {
    eventCount: 3,
    regionTransferCount: 3,
    controlOpCount: 1,
    polityChangeCount: 0,
    politicalActorOpCount: 1,
    unitOpCount: 1,
    chatCount: 3,
    warUpdateCount: 1,
    relationUpdateCount: 3,
    storylineUpdateCount: 1,
    stopDate: "2014-05-01",
  });
  assert.equal(normalizeParsedSummary("x", null), null);
  assert.equal(normalizeParsedSummary("eventConsolidator", { summary: "s" }).eventCount, 0);
});

test("the CSV export is one row per record with quoted free text", async () => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "openai" });
  attachCallMetrics(record, { model: "gpt-x", usage: { promptTokens: 100, outputTokens: 20, cachedTokens: 60 } });
  finishAiRecord(record, { ok: true, rawResponse: "{}" });
  attachAttemptOutcome(record, { ok: false, validationError: 'bad "shape",\nreally', parsedSummary: { eventCount: 2 } });
  const csv = exportTelemetryCsv(await getAiRecords());
  const [header, row] = csv.split("\n");
  assert.ok(header.startsWith("id,startedAt,provider,model,taskKey,"));
  assert.equal(csv.split("\n").length, 2);
  assert.ok(row.includes(",openai,gpt-x,jumpForward,"));
  assert.ok(row.includes(",100,20,60,"));
  assert.ok(row.includes('"bad ""shape"", really"'));
  assert.ok(row.endsWith(",failed,\"bad \"\"shape\"\", really\",,2,,,,"), row);
});

test("clearing forgets the session", async () => {
  startAiRecord({ taskKey: "actions" });
  assert.equal((await getAiRecords()).length, 1);
  await clearAiRecords();
  assert.equal((await getAiRecords()).length, 0);
});

test("a record keeps a system prompt longer than 80,000 characters whole", () => {
  // A jump's prompt is well past 80k. The console used to show it cut off at
  // exactly that length, which read as the game truncating what it sends.
  const systemPrompt = "S".repeat(120000);
  const userMessage = "U".repeat(30000);
  const rawResponse = "R".repeat(70000);
  const record = startAiRecord({ taskKey: "jumpForward", provider: "gemini", systemPrompt, userMessage });
  finishAiRecord(record, { ok: true, rawResponse });
  assert.equal(record.systemPrompt.length, 120000);
  assert.equal(record.systemPrompt.length, record.systemPromptChars);
  assert.equal(record.userMessage.length, 30000);
  assert.equal(record.rawResponse.length, 70000);
});

test("lookup rounds are kept on the record, whole, and exported", async () => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "gemini", awaitingOutcome: true });
  const { attachLookupRound } = await import("./telemetry.js");
  attachLookupRound(record, {
    round: 1,
    elapsedMs: 900,
    usage: { promptTokens: 1000, outputTokens: 40 },
    calls: [
      { name: "list_powers", args: {}, label: "list_powers()", response: "{\"count\":2}", ms: 3 },
      { name: "list_regions", args: { owner: "Russia" }, label: "list_regions(owner=\"Russia\")", response: { error: "\"Russia\" is not a power on this map." }, ms: 1, error: true },
    ],
  });
  attachLookupRound(record, { round: 2, calls: [{ name: "region_info", args: { regionId: "2026" }, response: "{\"id\":\"2026\"}" }] });
  assert.equal(record.lookups.rounds, 2);
  assert.equal(record.lookups.calls, 3);
  assert.deepEqual(record.lookups.entries.map((entry) => [entry.round, entry.name, entry.error]), [[1, "list_powers", false], [1, "list_regions", true], [2, "region_info", false]]);
  assert.equal(record.lookups.entries[1].response, "{\"error\":\"\\\"Russia\\\" is not a power on this map.\"}");
  assert.equal(record.lookups.chars, record.lookups.entries.reduce((sum, entry) => sum + entry.responseChars, 0));
  assert.deepEqual(record.lookups.roundUsage[0], { round: 1, elapsedMs: 900, promptTokens: 1000, outputTokens: 40 });
  finishAiRecord(record, { ok: true, rawResponse: "{}" });
  attachAttemptOutcome(record, { ok: true });
  const csv = exportTelemetryCsv(await getAiRecords());
  assert.match(csv.split("\n")[0], /lookupRounds,lookupCalls,lookupNames$/);
  assert.match(csv, /,2,3,list_powers list_regions region_info$/m);
});

test("a record without lookups exports empty lookup columns and attachLookupRound tolerates no record", async () => {
  const { attachLookupRound } = await import("./telemetry.js");
  attachLookupRound(null, { round: 1, calls: [] });
  const record = startAiRecord({ taskKey: "advisor", provider: "gemini" });
  finishAiRecord(record, { ok: true, rawResponse: "hi" });
  assert.equal(record.lookups, null);
  assert.match(exportTelemetryCsv([record]), /,,,$/m);
});
