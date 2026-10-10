// Run: node --test src/Game/AI/telemetry.storage.test.js
//
// The memory side of telemetry, against a small in-memory IndexedDB: only the
// newest records keep their text in memory once their stored copy is written,
// the console still sees every record whole, trimming the store reads ids and
// sizes, not records, and the console reads the store once and then follows
// the writes. (telemetry.test.js covers the memory-only mode.)
import test from "node:test";
import assert from "node:assert/strict";

// Just enough of IndexedDB for telemetry.js: one store keyed by id, a
// startedAt index, requests that settle when their transaction runs.
const rows = new Map();
const calls = { getAll: 0, getAllKeys: 0, get: [] };
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
            get: (id) => ask(() => { calls.get.push(id); return rows.has(id) ? structuredClone(rows.get(id)) : undefined; }),
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

// The size list lives in localStorage.
const local = new Map();
globalThis.localStorage = {
  getItem: (key) => (local.has(key) ? local.get(key) : null),
  setItem: (key, value) => { local.set(key, String(value)); },
  removeItem: (key) => { local.delete(key); },
};
const storedSizes = () => JSON.parse(local.get("ai_debug_telemetry_sizes") ?? "{}");

const { attachAttemptOutcome, clearAiRecords, finishAiRecord, getAiRecords, releaseAiRecords, setGenerationRating, startAiRecord } = await import("./telemetry.js");

// Settles every write in flight (each is a few macrotasks deep).
const flush = async () => { for (let step = 0; step < 6; step += 1) await settle(); };
// Waits for something a trim does, which can take a transaction per record.
const until = async (done) => { for (let step = 0; step < 500 && !done(); step += 1) await settle(); };

const makeRecord = (index) => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "gemini", systemPrompt: `PROMPT ${index} ${"x".repeat(1000)}`, userMessage: `ask ${index}` });
  finishAiRecord(record, { ok: true, rawResponse: `ANSWER ${index}` });
  return record;
};

test.beforeEach(async () => { releaseAiRecords(); await clearAiRecords(); await flush(); rows.clear(); });

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

// Off is the Android app's default: with no stored copy coming, an older record
// must still drop its text, or the session holds every prompt whole.
test("with recording off only the newest records keep their text as well", async (t) => {
  local.set("ai_debug_telemetry", "0");
  t.after(() => local.delete("ai_debug_telemetry"));
  const records = [];
  for (let index = 0; index < 25; index += 1) records.push(makeRecord(index));
  await flush();
  assert.equal(rows.size, 0, "nothing is stored");
  assert.equal(records.filter((record) => record.systemPrompt === "").length, 5, "the newest 20 whole");
  assert.equal(records[0].rawResponse, "");
  assert.equal(records[0].systemPromptChars, 1009, "the counts stay");
  assert.equal(records[24].rawResponse, "ANSWER 24");

  // A record that finished while recording was off is not waiting on a write
  // once it is back on.
  local.delete("ai_debug_telemetry");
  makeRecord(25);
  await flush();
  assert.equal(records[5].systemPrompt, "");
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
  const sizes = {};
  for (let index = 0; index < 230; index += 1) {
    rows.set(`gen-seed-${index}`, { id: `gen-seed-${index}`, startedAt: index, systemPrompt: "S" });
    sizes[`gen-seed-${index}`] = 1025;
  }
  local.set("ai_debug_telemetry_sizes", JSON.stringify(sizes));
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

const MB = 1024 * 1024;
const makeBigRecord = (index, chars) => {
  const record = startAiRecord({ taskKey: "jumpForward", provider: "gemini", systemPrompt: `BIG ${index} ${"x".repeat(chars)}` });
  finishAiRecord(record, { ok: true, rawResponse: `ANSWER ${index}` });
  return record;
};

test("the stored history is capped by size, oldest first, without reading the records", async () => {
  const records = [];
  for (let index = 0; index < 7; index += 1) {
    records.push(makeBigRecord(index, 3 * MB));
    await flush();
  }
  await until(() => rows.size <= 5);
  calls.getAll = 0;
  // 7 × 3 MB is past the 16 MB cap: the newest five fit.
  assert.deepEqual([...rows.keys()].sort(), records.slice(2).map((record) => record.id).sort());
  assert.equal(calls.getAll, 0);
  assert.deepEqual(Object.keys(storedSizes()).sort(), records.slice(2).map((record) => record.id).sort(), "the size list follows");
  assert.ok(Object.values(storedSizes()).every((bytes) => bytes > 3 * MB));
});

test("one record over the cap on its own is still kept", async () => {
  const record = makeBigRecord(0, 17 * MB);
  await flush();
  await flush();
  assert.ok(rows.has(record.id));
});

test("records stored before sizes were kept are sized once, one at a time, and trimmed", async () => {
  for (let index = 0; index < 8; index += 1) {
    rows.set(`gen-legacy-${index}`, { id: `gen-legacy-${index}`, startedAt: index, systemPrompt: "L".repeat(3 * MB) });
  }
  local.delete("ai_debug_telemetry_sizes");
  calls.getAll = 0;
  calls.get = [];
  // Some write in any 25 is a trim.
  for (let index = 0; index < 25; index += 1) makeRecord(index);
  await until(() => !rows.has("gen-legacy-2"));
  await flush();
  assert.equal(calls.getAll, 0);
  const legacyReads = calls.get.filter((id) => id.startsWith("gen-legacy-"));
  assert.deepEqual([...legacyReads].sort(), [...new Set(legacyReads)].sort(), "each legacy record read once to size it");
  assert.equal(legacyReads.length, 8);
  // 25 small records and the newest legacy ones within 16 MB; the oldest went.
  assert.equal(rows.has("gen-legacy-0"), false);
  assert.equal(rows.has("gen-legacy-1"), false);
  assert.equal(rows.has("gen-legacy-2"), false);
  assert.ok(rows.has("gen-legacy-7"));
  assert.ok(storedSizes()["gen-legacy-7"] > 3 * MB, "and it is on the size list now");

  // Sized: the next trim reads none of them again.
  calls.get = [];
  const keysRead = calls.getAllKeys;
  for (let index = 0; index < 25; index += 1) makeRecord(index);
  await until(() => calls.getAllKeys > keysRead);
  await flush();
  assert.deepEqual(calls.get.filter((id) => id.startsWith("gen-legacy-")), []);
});

test("the console reads the store once and then follows the writes", async () => {
  rows.set("gen-old-1", { id: "gen-old-1", startedAt: 1, taskKey: "gameMaster", systemPrompt: "OLD", rating: null });
  calls.getAll = 0;
  // A write that lands while the first read is still running is not lost.
  const first = getAiRecords();
  const during = makeRecord(1);
  const seen = await first;
  await flush();
  assert.equal(calls.getAll, 1);
  assert.ok(seen.some((record) => record.id === "gen-old-1"));

  const after = makeRecord(2);
  await flush();
  await setGenerationRating("gen-old-1", 7);
  await flush();
  const again = await getAiRecords();
  assert.equal(calls.getAll, 1, "no second read while the console is open");
  assert.deepEqual(again.map((record) => record.id), ["gen-old-1", during.id, after.id]);
  assert.equal(again[0].rating, 7, "a rating merged into a stored record is followed");
  assert.equal(again[0].systemPrompt, "OLD");

  releaseAiRecords();
  await getAiRecords();
  assert.equal(calls.getAll, 2, "closed and opened again: read afresh");
});

test("clearing empties the console's copy too", async () => {
  makeRecord(1);
  await flush();
  assert.equal((await getAiRecords()).length, 1);
  await clearAiRecords();
  await flush();
  assert.equal((await getAiRecords()).length, 0);
  assert.deepEqual(storedSizes(), {});
});
