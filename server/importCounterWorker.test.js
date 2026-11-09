/*! Open Historia — the import counter Worker: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/importCounterWorker.test.js
//
// tools/import-counter/worker.js counts a scenario's import only when the game
// reports a first import, never from a download: once per install token, once
// a day per address, only for a released scenario, only from the game's pages.
// D1 is played by node:sqlite (Node 22.13 or later; skipped before).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import worker, { HUB_INDEX_URL, MAX_POSTS_PER_ADDRESS_PER_DAY } from "../tools/import-counter/worker.js";

const sqlite = await import("node:sqlite").catch(() => null);
const skip = sqlite ? false : "node:sqlite is not available in this Node";

const SCENARIO = (number) => ({ number, kind: "scenario", labels: ["scenario"], title: `S${number}`, body: "", created_at: "2026-10-01T00:00:00Z" });
const INDEX = {
  version: 2,
  files: {},
  imports: { 12: 345, 7: 0, 9: "junk", 10: -4 },
  posts: [SCENARIO(12), SCENARIO(7), { ...SCENARIO(30), kind: "flag", labels: ["flag"] }, ...Array.from({ length: 30 }, (_, i) => SCENARIO(100 + i))],
};
const GAME = "https://openhistoria.com";
const token = (n) => n.toString(16).padStart(64, "0");

// D1 as much of it as the Worker uses, over an in-memory SQLite database.
const fakeD1 = () => {
  const db = new sqlite.DatabaseSync(":memory:");
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async (column) => {
      const row = db.prepare(sql).get(...args) ?? null;
      return column ? row?.[column] ?? null : row;
    },
    all: async () => ({ success: true, results: db.prepare(sql).all(...args) }),
  });
  return {
    db,
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const item of list) out.push(await item.run());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
};

// The Workers runtime's globals, as much of them as the Worker uses. No edge
// cache unless asked for, so every read sees the database as it is.
const runtime = (t, { index = INDEX, status = 200, edgeCache = false, env: extra = {} } = {}) => {
  const state = { upstream: 0, index, status, cached: new Map() };
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = async (input) => {
    assert.equal(String(input?.url ?? input), HUB_INDEX_URL, "the only place it ever asks");
    state.upstream += 1;
    return new Response(JSON.stringify(state.index), { status: state.status });
  };
  if (edgeCache) {
    globalThis.caches = {
      default: {
        match: async (request) => state.cached.get(request.url)?.clone() ?? null,
        put: async (request, response) => { state.cached.set(request.url, response); },
      },
    };
  } else {
    delete globalThis.caches;
  }
  t.after(() => {
    globalThis.fetch = original.fetch;
    if (original.caches === undefined) delete globalThis.caches;
    else globalThis.caches = original.caches;
  });
  const DB = sqlite ? fakeD1() : null;
  const env = { DB, COUNT_KEY: "a test key that is long enough", ...extra };
  const waited = [];
  const ctx = { waitUntil: (promise) => waited.push(promise) };
  const call = async (path, init) => {
    const response = await worker.fetch(new Request(`https://oh-import-counter.example${path}`, init), env, ctx);
    await Promise.all(waited.splice(0));
    return response;
  };
  const report = (post, tokenValue, { origin = GAME, address = "203.0.113.5" } = {}) =>
    call("/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(address ? { "CF-Connecting-IP": address } : {}) },
      body: JSON.stringify({ post, token: tokenValue }),
    });
  const counts = async () => (await call("/counts")).json();
  return { state, env, call, report, counts };
};

test("an install's first import counts once; reporting it again does not", { skip }, async (t) => {
  const { report, counts } = runtime(t);
  assert.deepEqual(await (await report(12, token(1))).json(), { post: 12, counted: true });
  assert.deepEqual(await counts(), { 7: { count: 0 }, 12: { count: 346 } }, "on top of what it had");
  assert.deepEqual(await (await report(12, token(1), { address: "198.51.100.9" })).json(), { post: 12, counted: false, reason: "again" });
  assert.equal((await counts())[12].count, 346);
});

test("one address counts a post once a day, whatever tokens it makes up", { skip }, async (t) => {
  const { report, counts } = runtime(t);
  assert.equal((await (await report(7, token(1))).json()).counted, true);
  for (let n = 2; n < 50; n += 1) assert.equal((await (await report(7, token(n))).json()).reason, "address");
  assert.equal((await counts())[7].count, 1);
  // Another address is another player.
  assert.equal((await (await report(7, token(99), { address: "198.51.100.9" })).json()).counted, true);
  assert.equal((await counts())[7].count, 2);
});

test("one address counts only so many posts a day", { skip }, async (t) => {
  const { report } = runtime(t);
  const answers = [];
  for (let n = 0; n < 30; n += 1) answers.push((await (await report(100 + n, token(n + 1))).json()).reason ?? "counted");
  assert.equal(answers.filter((reason) => reason === "counted").length, MAX_POSTS_PER_ADDRESS_PER_DAY);
  assert.ok(answers.slice(MAX_POSTS_PER_ADDRESS_PER_DAY).every((reason) => reason === "address limit"));
});

test("only the game's pages count, only for a released scenario, only in the right shape", { skip }, async (t) => {
  const { report, call, counts } = runtime(t);
  for (const origin of ["", "https://evil.example", "https://openhistoria.com.evil.example", "null"]) {
    const response = await report(12, token(5), { origin });
    assert.equal(response.status, 403, origin || "no Origin");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:3001", "http://app.openhistoria", "https://abc123.open-historia.pages.dev"]) {
    const preflight = await call("/import", { method: "OPTIONS", headers: { Origin: origin } });
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  }
  assert.equal((await report(30, token(5))).status, 404, "a flag post is no scenario");
  assert.equal((await report(999, token(5))).status, 404, "a post the hub has not released");
  assert.equal((await report(12, "not-a-token")).status, 400);
  assert.equal((await report("12; DROP TABLE counts", token(5))).status, 400);
  assert.equal((await report(12, token(5), { address: "" })).status, 400, "no address, no count");
  assert.equal((await counts())[12].count, 345);
});

test("without its secret or its database it counts nothing", { skip }, async (t) => {
  const noKey = runtime(t, { env: { COUNT_KEY: undefined } });
  assert.equal((await noKey.report(12, token(1))).status, 503);
  assert.equal((await noKey.counts())[12].count, 345);
  const noDb = runtime(t, { env: { DB: undefined } });
  assert.equal((await noDb.report(12, token(1))).status, 503);
  assert.deepEqual(await noDb.counts(), { 7: { count: 0 }, 12: { count: 345 } }, "the retired Worker's answer, from the index");
});

test("the rate limiter is asked by address and can refuse", { skip }, async (t) => {
  const keys = [];
  const { report, counts } = runtime(t, { env: { LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } } });
  const response = await report(12, token(1));
  assert.equal(response.status, 429);
  assert.deepEqual(keys, ["203.0.113.5"]);
  assert.equal((await counts())[12].count, 345);
});

test("the old counts are frozen once: later downloads in the index are never read", { skip }, async (t) => {
  const { state, report, counts, call } = runtime(t);
  assert.equal((await counts())[12].count, 345);
  state.index = { ...INDEX, imports: { 12: 99999, 7: 5000 } };
  assert.deepEqual(await counts(), { 7: { count: 0 }, 12: { count: 345 } });
  await report(12, token(1));
  assert.deepEqual(await (await call("/count/12")).json(), { id: "12", count: 346 });
  assert.deepEqual(await (await call("/count/4242")).json(), { id: "4242", count: 0 });
});

test("an index that cannot be read freezes nothing and counts nothing, and is tried again", { skip }, async (t) => {
  const { state, report, counts } = runtime(t, { status: 503 });
  assert.equal((await report(12, token(1))).status, 503);
  assert.equal(state.upstream >= 1, true);
  state.status = 200;
  assert.equal((await counts())[12].count, 345);
  assert.equal((await (await report(12, token(1))).json()).counted, true);
});

test("/hit from the oldest builds is answered and never counted", { skip }, async (t) => {
  const { call, counts } = runtime(t);
  const response = await call("/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "12", title: "Old World" }) });
  assert.deepEqual(await response.json(), { id: "12", count: 345, retired: true });
  assert.equal((await call("/hit", { method: "POST", body: "{}" })).status, 400);
  assert.equal((await counts())[12].count, 345);
});

test("no address is stored, only a day's key of it, and the cron deletes old days", { skip }, async (t) => {
  const { env, report } = runtime(t);
  await report(12, token(1), { address: "203.0.113.5" });
  const rows = env.DB.db.prepare("SELECT day, who, post FROM addresses").all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].who, /^[0-9a-f]{32}$/);
  const dump = JSON.stringify([rows, env.DB.db.prepare("SELECT * FROM installs").all(), env.DB.db.prepare("SELECT * FROM meta").all()]);
  assert.doesNotMatch(dump, /203\.0\.113\.5/);
  env.DB.db.prepare("INSERT INTO addresses (day, who, post) VALUES (?, 'old', 7)").run(rows[0].day - 2);
  env.DB.db.prepare("INSERT INTO addresses (day, who, post) VALUES (?, 'yesterday', 7)").run(rows[0].day - 1);
  await worker.scheduled({}, env, { waitUntil: () => {} });
  assert.deepEqual(env.DB.db.prepare("SELECT who FROM addresses ORDER BY who").all().map((row) => row.who).sort(), [rows[0].who, "yesterday"].sort());
});

test("the counts are kept at the edge for a while", { skip }, async (t) => {
  const { call } = runtime(t, { edgeCache: true });
  const first = await call("/counts");
  assert.equal(first.headers.get("cache-control"), "public, max-age=300");
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await (await call("/counts")).json(), await first.json());
});

test("the Worker's code reads no KV, keeps no raw address, and holds no secret", () => {
  const source = fs.readFileSync(new URL("../tools/import-counter/worker.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /env\.IMPORTS|getWithMetadata|HASH_SALT/);
  // The address goes only into the limiter's key and the day's HMAC.
  assert.equal((source.match(/\baddress\b/g) ?? []).length >= 1, true);
  assert.doesNotMatch(source, /bind\([^)]*\baddress\b/, "the raw address is never bound into a query");
  const toml = fs.readFileSync(new URL("../tools/import-counter/wrangler.toml", import.meta.url), "utf8");
  assert.doesNotMatch(toml, /COUNT_KEY\s*=/, "the secret is set with wrangler secret put, never in the file");
});
