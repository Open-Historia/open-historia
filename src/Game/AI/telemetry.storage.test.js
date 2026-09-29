// Run: node --test src/Game/AI/telemetry.storage.test.js
//
// The memory side of telemetry, against a small in-memory IndexedDB: only the
// newest records keep their text in memory once their stored copy is written,
// the console still sees every record whole, and trimming the store reads ids,
// not records. (telemetry.test.js covers the memory-only mode.)
import test from "node:test";
import assert from "node:assert/strict";

// Just enough of IndexedDB for telemetry.js: one store keyed by id, a
// startedAt index, requests that settle when their transaction runs.
const rows = new Map();
const calls = { getAll: 0, getAllKeys: 0 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
globalThis.indexedDB = {
  open: () => {
    const request = {};
    setTimeout(() => {
      request.result = {
        objectStoreNames: { contains: () => true },
        transaction: () => {
          const tx = { oncomplete: null, onerror: null };
          const queue = [];
          const ask = (work) => {
            const pending = { result: undefined, onsuccess: null };
            queue.push(() => { pending.result = work(); pending.onsuccess?.(); });
            return pending;
          };
          tx.objectStore = () => ({
            put: (value) => ask(() => { rows.set(value.id, structuredClone(value)); }),
            get: (id) => ask(() => (rows.has(id) ? structuredClone(rows.get(id)) : undefined)),
            getAll: () => ask(() => { calls.getAll += 1; return [...rows.values()].map((value) => structuredClone(value)); }),
            delete: (id) => ask(() => { rows.delete(id); }),
            clear: () => ask(() => { rows.clear(); }),
            index: () => ({
              getAllKeys: () => ask(() => {
                calls.getAllKeys += 1;
                return [...rows.values()].sort((a, b) => a.startedAt - b.startedAt).map((value) => value.id);
              }),
            }),
          });
          setTimeout(() => {
            for (const run of queue) run();
            tx.oncomplete?.();
          }, 0);
          return tx;
        },
      };
      request.onsuccess?.();
    }, 0);
    return request;
  },
};

const { attachAttemptOutcome, clearAiRecords, finishAiRecord, getAiRecords, setGenerationRating, startAiRecord } = await import("./telemetry.js");

// Settles every write in flight (each is a few macrotasks deep).
const flush = async () => { for (let step = 0; step < 6; step += 1) await settle(); };

const makeRecord = (index) => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "gemini", systemPrompt: `PROMPT ${index} ${"x".repeat(1000)}`, userMessage: `ask ${index}` });
  finishAiRecord(record, { ok: true, rawResponse: `ANSWER ${index}` });
  return record;
};

test.beforeEach(async () => { await clearAiRecords(); await flush(); rows.clear(); });

test("only the newest records keep their text in memory; the console still sees it all", async () => {
  const records = [];
  for (let index = 0; index < 25; index += 1) records.push(makeRecord(index));
  await flush();
  makeRecord(25);
  await flush();

  const light = records.filter((record) => record.systemPrompt === "");
  assert.equal(light.length, 6, "26 records, the newest 20 whole");
  assert.equal(records[0].rawResponse, "");
  assert.equal(records[0].systemPromptChars, 1009, "the counts stay");
  assert.equal(records[24].rawResponse, "ANSWER 24");

  const seen = await getAiRecords();
  assert.equal(seen.length, 26);
  assert.match(seen[0].systemPrompt, /^PROMPT 0 /, "the console reads the text back from the store");
  assert.equal(seen[0].rawResponse, "ANSWER 0");
});

test("a record waiting for its verdict keeps its text, and the verdict reaches the store", async () => {
  const waiting = startAiRecord({ taskKey: "jumpForward", systemPrompt: "WAITING", awaitingOutcome: true });
  finishAiRecord(waiting, { ok: true, rawResponse: "{}" });
  for (let index = 0; index < 22; index += 1) makeRecord(index);
  await flush();
  assert.equal(waiting.systemPrompt, "WAITING", "not final, so not lightened");

  attachAttemptOutcome(waiting, { ok: false, validationError: "$.events is empty" });
  await flush();
  makeRecord(99);
  await flush();
  assert.equal(waiting.systemPrompt, "", "final and stored: lightened");
  assert.equal(rows.get(waiting.id).systemPrompt, "WAITING");
  assert.equal(rows.get(waiting.id).validationError, "$.events is empty");

  // An outcome that lands after that is merged into the stored copy, text kept.
  attachAttemptOutcome(waiting, { ok: true, validationError: "" });
  await flush();
  assert.equal(rows.get(waiting.id).ok, true);
  assert.equal(rows.get(waiting.id).systemPrompt, "WAITING");
});

test("rating a lightened record keeps its stored text", async () => {
  const records = [];
  for (let index = 0; index < 22; index += 1) records.push(makeRecord(index));
  await flush();
  makeRecord(22);
  await flush();
  assert.equal(records[0].systemPrompt, "");

  assert.equal(await setGenerationRating(records[0].id, 8), true);
  await flush();
  assert.equal(rows.get(records[0].id).rating, 8);
  assert.match(rows.get(records[0].id).systemPrompt, /^PROMPT 0 /);
  assert.equal((await getAiRecords()).find((record) => record.id === records[0].id).rating, 8);
});

test("a record from an earlier session can still be rated", async () => {
  rows.set("gen-old-1", { id: "gen-old-1", startedAt: 1, taskKey: "gameMaster", systemPrompt: "OLD", rating: null });
  assert.equal(await setGenerationRating("gen-old-1", 3), true);
  await flush();
  assert.equal(rows.get("gen-old-1").rating, 3);
  assert.equal(await setGenerationRating("gen-missing", 3), false);
});

test("trimming the store reads ids from the index, never every record", async () => {
  for (let index = 0; index < 230; index += 1) {
    rows.set(`gen-seed-${index}`, { id: `gen-seed-${index}`, startedAt: index, systemPrompt: "S" });
  }
  calls.getAll = 0;
  calls.getAllKeys = 0;
  // The store trims on every 25th write.
  for (let index = 0; index < 25; index += 1) makeRecord(index);
  await flush();
  await flush();
  assert.equal(calls.getAll, 0);
  assert.ok(calls.getAllKeys >= 1);
  // Trimmed back to 200 at that write; the writes after it are still there.
  assert.ok(rows.size < 225, `${rows.size} rows`);
  assert.equal(rows.has("gen-seed-0"), false, "the oldest went first");
  assert.ok(rows.has("gen-seed-229"));
});
