/*! Open Historia — the translation model's requests always end © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/translationModel.test.js
//
// "in the Beta version, every time I open a game, 'Translating to Arabic...'
// appears and never disappears" (a player, 2026-11-09). A worker that never
// started, stopped, or was asked to load a model it had already loaded never
// answered, and the translator waited on it for good with its pill up. Every
// request now ends: answered, failed, or given up on after WORKER_SILENCE_MS
// of silence. A stand-in Worker plays the worker here.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workers = [];
class FakeWorker {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.sent = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    workers.push(this);
  }
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage?.({ data }); }
  fail(message) { this.onerror?.({ message }); }
}
globalThis.Worker = FakeWorker;

const { WORKER_SILENCE_MS, loadTranslationModel, translateWithModel } = await import("./translationModel.js");

const last = () => workers[workers.length - 1];
const flush = () => new Promise((resolve) => setImmediate(resolve));
// Every timer the module arms (the silence, the idle close) is a stand-in, so none outlives the tests.
const fakeTimers = (t) => t.mock.timers.enable({ apis: ["setTimeout"] });
// The worker a test leaves is closed under its own clock (its idle timer goes with it).
const closeLast = () => last().fail("End of the test.");

test("a load the worker answers resolves, its progress told on the way", async (t) => {
  fakeTimers(t);
  const seen = [];
  const loading = loadTranslationModel("ar", (progress) => seen.push(progress));
  const worker = last();
  assert.deepEqual(worker.sent.at(-1), { type: "load", language: "ar" });
  worker.reply({ type: "progress", loaded: 5, total: 10 });
  worker.reply({ type: "ready" });
  await loading;
  assert.deepEqual(seen, [{ loaded: 5, total: 10 }]);
  closeLast();
});

test("a worker that says nothing is given up on, closed, and the next request starts another", async (t) => {
  fakeTimers(t);
  const loading = loadTranslationModel("ar");
  const worker = last();
  let failure = null;
  loading.catch((error) => { failure = error; });
  // Progress keeps it waiting: silence is what ends it, not a slow download.
  t.mock.timers.tick(WORKER_SILENCE_MS - 1);
  worker.reply({ type: "progress", loaded: 1, total: 10 });
  t.mock.timers.tick(WORKER_SILENCE_MS - 1);
  await flush();
  assert.equal(failure, null);
  t.mock.timers.tick(1);
  await flush();
  assert.match(String(failure?.message), /stopped answering/);
  assert.equal(worker.terminated, true);
  const next = translateWithModel("ar", ["Kingdom of Egypt"]);
  assert.notEqual(last(), worker, "a new worker for the next request");
  const message = last().sent.at(-1);
  assert.equal(message.type, "translate");
  last().reply({ type: "result", id: message.id, outputs: ["مملكة مصر"] });
  assert.deepEqual(await next, ["مملكة مصر"]);
  closeLast();
});

test("a worker that fails to start rejects what waits on it, and is not asked again", async (t) => {
  fakeTimers(t);
  const loading = loadTranslationModel("ar");
  const worker = last();
  worker.fail("Failed to load the worker script.");
  await assert.rejects(loading, /Failed to load the worker script/);
  assert.equal(worker.terminated, true);
  const again = loadTranslationModel("ar");
  assert.notEqual(last(), worker);
  last().fail("Failed again.");
  await assert.rejects(again, /Failed again/);
});

test("a worker closed for another language fails what was waiting on it", async (t) => {
  fakeTimers(t);
  const waiting = translateWithModel("ar", ["Sultanate"]);
  const worker = last();
  const other = loadTranslationModel("de");
  assert.equal(worker.terminated, true);
  await assert.rejects(waiting, /closed/);
  last().reply({ type: "ready" });
  await other;
  closeLast();
});

test("the worker answers every load, the model already loaded included", () => {
  const worker = fs.readFileSync(new URL("./translationWorker.js", import.meta.url), "utf8");
  assert.match(worker, /message\.type === "load"\) \{[\s\S]*?load\(\)\.then\(\s*\(\) => post\(\{ type: "ready" \}\),\s*\(error\) => post\(\{ type: "error"/);
  assert.doesNotMatch(worker, /\}\)\(\)\s*\.then\(\(\) => post\(\{ type: "ready" \}\)\)/, "no single \"ready\" kept in the memoized load");
});

test("the translator's pill is up only while its queue runs", () => {
  const translator = fs.readFileSync(new URL("./translator.js", import.meta.url), "utf8");
  assert.match(translator, /if \(pending\.size === 0 \|\| modelCardEl \|\| !translating\(\) \|\| !inFlight\) \{/);
  assert.match(translator, /if \(!progressEl \|\| modelDownloading \|\| noticeUp\) return;/);
  const collect = translator.slice(translator.indexOf("const collectAndTranslate = "), translator.indexOf("// ---- a scenario's own pack"));
  assert.ok(collect.indexOf("void processQueue();") < collect.indexOf("showProgress();"), "the queue starts before the pill");
  assert.match(collect, /if \(pending\.size > 10 && inFlight\) \{/);
  // The queue's own end takes the pill down.
  assert.match(translator, /\} finally \{\r?\n\s*if \(inFlight === run\) inFlight = 0;\r?\n\s*updateProgress\(\);/);
});
