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

import worker, { FALLBACK_TTL_SECONDS, HUB_INDEX_URL, MAX_POSTS_PER_ADDRESS_PER_DAY, addressBucket } from "../tools/import-counter/worker.js";

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

// D1 as much of it as the Worker uses, over an in-memory SQLite database. With
// `latency` (ms) every call waits that long first, as a round trip to D1 does,
// so requests that arrive together interleave between their statements; each
// statement, and each batch, still runs whole, one at a time, as D1 runs them.
const fakeD1 = ({ latency = 0 } = {}) => {
  const db = new sqlite.DatabaseSync(":memory:");
  const reads = [];
  const wait = () => (latency ? new Promise((resolve) => setTimeout(resolve, latency)) : null);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      await wait();
      return { success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } };
    },
    first: async (column) => {
      await wait();
      const row = db.prepare(sql).get(...args) ?? null;
      return column ? row?.[column] ?? null : row;
    },
    all: async () => {
      await wait();
      reads.push(sql);
      return { success: true, results: db.prepare(sql).all(...args) };
    },
  });
  let chain = Promise.resolve();
  const runBatch = async (list) => {
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
  };
  return {
    db,
    reads,
    prepare: (sql) => statement(sql),
    batch: (list) => {
      const done = chain.then(() => runBatch(list));
      chain = done.catch(() => {});
      return done;
    },
  };
};

// The same database as D1 answers it once the free plan's day is used up: the
// listed calls throw. (A new object each time, as a new isolate sees D1.)
const D1_LIMIT = "D1_ERROR: Exceeded maximum rows read for the day";
const overLimit = (DB, { on = ["first", "all", "run", "batch"], message = D1_LIMIT } = {}) => {
  const fail = async () => { throw new Error(message); };
  const wrap = (statement) => ({
    bind: (...args) => wrap(statement.bind(...args)),
    run: on.includes("run") ? fail : statement.run,
    first: on.includes("first") ? fail : statement.first,
    all: on.includes("all") ? fail : statement.all,
  });
  return { db: DB.db, prepare: (sql) => wrap(DB.prepare(sql)), batch: on.includes("batch") ? fail : DB.batch };
};

// The Workers runtime's globals, as much of them as the Worker uses. No edge
// cache unless asked for, so every read sees the database as it is.
const runtime = (t, { index = INDEX, status = 200, edgeCache = false, latency = 0, env: extra = {} } = {}) => {
  const state = { upstream: 0, index, status, cached: new Map(), asked: [] };
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  globalThis.fetch = async (input, init = {}) => {
    const asked = String(input?.url ?? input);
    assert.equal(asked.replace(/\?.*$/, ""), HUB_INDEX_URL, "the only place it ever asks");
    state.upstream += 1;
    state.asked.push({ url: asked, cf: init.cf ?? null });
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
  const DB = sqlite ? fakeD1({ latency }) : null;
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

test("D1 over its day's limits: the reads answer the hub index's counts a short while, an import is refused, nothing is frozen again", { skip }, async (t) => {
  const { state, env, report, call, counts } = runtime(t);
  const DB = env.DB;
  assert.equal((await (await report(12, token(1))).json()).counted, true);
  assert.equal((await counts())[12].count, 346);
  // The downloads have gone on since the freeze; the index says so.
  state.index = { ...INDEX, imports: { 12: 500, 7: 4 } };

  env.DB = overLimit(DB);
  const answer = await call("/counts");
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { 7: { count: 4 }, 12: { count: 500 } }, "the old method");
  assert.equal(answer.headers.get("cache-control"), `public, max-age=${FALLBACK_TTL_SECONDS}`);
  assert.deepEqual(await (await call("/count/12")).json(), { id: "12", count: 500 });
  const hit = await call("/hit", { method: "POST", body: JSON.stringify({ id: "7" }) });
  assert.deepEqual(await hit.json(), { id: "7", count: 4, retired: true });
  const refused = await report(7, token(2));
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), { post: 7, counted: false, reason: "over limit" });

  // Reads failing while writes still go through: never taken for "not frozen yet".
  env.DB = overLimit(DB, { on: ["first", "all"] });
  assert.equal((await counts())[12].count, 500);
  assert.equal((await report(7, token(3))).status, 503);
  // Writes failing after the day's address read: the import is refused, not thrown.
  env.DB = overLimit(DB, { on: ["run", "batch"] });
  assert.deepEqual(await (await report(7, token(4))).json(), { post: 7, counted: false, reason: "over limit" });

  // And should the freeze run again anyway (here: a "missing table" that is not), it changes nothing.
  env.DB = overLimit(DB, { on: ["first"], message: "D1_ERROR: no such table: meta: SQLITE_ERROR" });
  await call("/counts");
  // (A new object: what a new isolate, with nothing kept in memory, sees.)
  env.DB = { ...DB };
  assert.deepEqual(await counts(), { 7: { count: 0 }, 12: { count: 346 } }, "D1 back: its counts, the legacy ones as frozen");
});

test("the index's answer for a failing D1 is kept at the edge only a short while", { skip }, async (t) => {
  const { state, env, call } = runtime(t, { edgeCache: true });
  env.DB = overLimit(env.DB);
  await call("/counts");
  const kept = state.cached.get("https://oh-import-counter.example/counts");
  assert.equal(kept.headers.get("cache-control"), `public, max-age=${FALLBACK_TTL_SECONDS}`);
  assert.equal((await call("/counts")).headers.get("cache-control"), `public, max-age=${FALLBACK_TTL_SECONDS}`, "the browser too");
});

test("D1 failing and the index unreadable: an error, never kept", { skip }, async (t) => {
  const { env, call } = runtime(t, { status: 503 });
  env.DB = overLimit(env.DB);
  const response = await call("/counts");
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
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
  // (The edge keeps it an hour; the browser ten minutes.)
  assert.equal(first.headers.get("cache-control"), "public, max-age=600");
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await (await call("/counts")).json(), await first.json());
});

// Moves the Worker's clock (Date.now) on by `ms` at each call, for this test.
const clock = (t) => {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real() + offset;
  t.after(() => {
    Date.now = real;
  });
  return (ms) => {
    offset += ms;
  };
};

test("an IPv6 address is kept by its /64, an IPv4-mapped one as the IPv4 address", () => {
  assert.equal(addressBucket("203.0.113.5"), "203.0.113.5");
  for (const same of ["2001:db8:1:2::1", "2001:DB8:1:2::ffff", "2001:0db8:0001:0002:abcd:0:0:9", "2001:db8:1:2:1:2:3:4", "2001:db8:1:2::1%eth0"]) {
    assert.equal(addressBucket(same), "2001:db8:1:2::/64", same);
  }
  assert.equal(addressBucket("2001:db8:1:3::1"), "2001:db8:1:3::/64");
  assert.equal(addressBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressBucket("::1"), "0:0:0:0::/64");
  for (const mapped of ["::ffff:203.0.113.5", "::FFFF:cb00:7105", "0:0:0:0:0:ffff:203.0.113.5", "0000:0000:0000:0000:0000:ffff:cb00:7105"]) {
    assert.equal(addressBucket(mapped), "203.0.113.5", mapped);
  }
  // What is not an address at all is kept as it came (it is only ever hashed).
  assert.equal(addressBucket("1:2:3"), "1:2:3");
  assert.equal(addressBucket("1::2::3"), "1::2::3");
});

test("an IPv6 home's whole /64 is one address: rotating through it counts nothing more", { skip }, async (t) => {
  const keys = [];
  const { report, counts } = runtime(t, { env: { LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } } });
  let counted = 0;
  for (let n = 1; n <= 25; n += 1) {
    if ((await (await report(12, token(5000 + n), { address: `2001:db8:1:2::${n.toString(16)}` })).json()).counted) counted += 1;
  }
  assert.equal(counted, 1, "25 addresses of one /64, 25 fresh tokens: one count");
  assert.equal((await counts())[12].count, 346);
  assert.deepEqual([...new Set(keys)], ["2001:db8:1:2::/64"], "the rate limiter is asked by the /64 too");
  // Another /64 is another home.
  assert.equal((await (await report(12, token(6000), { address: "2001:db8:1:3::1" })).json()).counted, true);
  // The day's posts are capped per /64 too.
  const answers = [];
  for (let n = 0; n < 30; n += 1) {
    answers.push((await (await report(100 + n, token(7000 + n), { address: `2001:db8:9:9:${n.toString(16)}::1` })).json()).reason ?? "counted");
  }
  assert.equal(answers.filter((reason) => reason === "counted").length, MAX_POSTS_PER_ADDRESS_PER_DAY);
  // An IPv4 address written as IPv6 is that IPv4 address.
  assert.equal((await (await report(7, token(8000), { address: "203.0.113.77" })).json()).counted, true);
  assert.equal((await (await report(7, token(8001), { address: "::ffff:203.0.113.77" })).json()).reason, "address");
});

test("a burst from one address, all at once, counts once; and stops at the day's cap", { skip }, async (t) => {
  const { report, counts } = runtime(t, { latency: 5 });
  await report(7, token(999), { address: "198.51.100.200" }); // (the legacy counts frozen first)
  const burst = await Promise.all(Array.from({ length: 10 }, (_, n) => report(12, token(1000 + n)).then((response) => response.json())));
  assert.equal(burst.filter((answer) => answer.counted).length, 1, JSON.stringify(burst));
  assert.ok(burst.filter((answer) => !answer.counted).every((answer) => answer.reason === "address"));
  assert.equal((await counts())[12].count, 346);
  // Thirty posts at once from one address: twenty count, however they interleave.
  const many = await Promise.all(Array.from({ length: 30 }, (_, n) =>
    report(100 + n, token(2000 + n), { address: "198.51.100.7" }).then((response) => response.json())));
  assert.equal(many.filter((answer) => answer.counted).length, MAX_POSTS_PER_ADDRESS_PER_DAY, JSON.stringify(many));
  assert.ok(many.filter((answer) => !answer.counted).every((answer) => answer.reason === "address limit"));
  // One install's token sent from many addresses at once still counts once.
  const again = await Promise.all(Array.from({ length: 10 }, (_, n) =>
    report(7, token(3000), { address: `192.0.2.${n + 1}` }).then((response) => response.json())));
  assert.equal(again.filter((answer) => answer.counted).length, 1, JSON.stringify(again));
  assert.ok(again.filter((answer) => !answer.counted).every((answer) => answer.reason === "again"));
});

test("a token sent again uses up nothing of its address's day", { skip }, async (t) => {
  const { env, report } = runtime(t);
  assert.equal((await (await report(12, token(1), { address: "203.0.113.5" })).json()).counted, true);
  assert.equal((await (await report(12, token(1), { address: "198.51.100.9" })).json()).reason, "again");
  // Someone else at that address imports the post for the first time: it counts.
  assert.equal((await (await report(12, token(2), { address: "198.51.100.9" })).json()).counted, true);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM addresses").get().n, 2, "one row per counted import");
});

test("the counts are read from D1 once per isolate for five minutes, not once per request", { skip }, async (t) => {
  const step = clock(t);
  const { env, call, report, counts } = runtime(t);
  const reads = () => env.DB.reads.filter((sql) => /FROM counts/.test(sql)).length;
  assert.equal((await counts())[12].count, 345);
  await call("/count/12");
  await call("/hit", { method: "POST", body: JSON.stringify({ id: "12" }) });
  await counts();
  assert.equal(reads(), 1, "on workers.dev the edge cache keeps nothing, so the isolate does");
  // An import counted in this isolate is in its copy at once, without reading D1 again.
  assert.equal((await (await report(12, token(1))).json()).counted, true);
  assert.equal((await counts())[12].count, 346);
  assert.deepEqual(await (await call("/count/12")).json(), { id: "12", count: 346 });
  assert.equal(reads(), 1);
  step(5 * 60 * 1000 + 1000);
  assert.equal((await counts())[12].count, 346);
  assert.equal(reads(), 2, "read again once the five minutes are up");
  // Requests that find it out of date together share the one read.
  step(5 * 60 * 1000 + 1000);
  await Promise.all([counts(), counts(), call("/count/7")]);
  assert.equal(reads(), 3);
});

test("a post the isolate does not know reads the index again, really fresh, at most every five minutes", { skip }, async (t) => {
  const step = clock(t);
  const { state, report } = runtime(t, { edgeCache: true });
  assert.equal((await report(555, token(1))).status, 404, "not released yet");
  const before = state.upstream;
  // Released a minute later: the index says so; the Worker's copy (an hour) does not.
  state.index = { ...INDEX, posts: [...INDEX.posts, SCENARIO(555)] };
  step(60 * 1000);
  assert.equal((await report(555, token(1))).status, 404, "within five minutes of the last read: not read again");
  assert.equal(state.upstream, before);
  step(4 * 60 * 1000 + 1000);
  assert.equal((await (await report(555, token(1))).json()).counted, true);
  const fresh = state.asked.at(-1);
  assert.notEqual(fresh.url, HUB_INDEX_URL, "past every cache on the way (the address made new)");
  assert.equal(fresh.cf?.cacheTtl, 0, "and not kept at Cloudflare's edge");
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
