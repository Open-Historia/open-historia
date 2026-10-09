/*! Open Historia — retired-account cleanup tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/retiredAccount.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const fake = installFakeIndexedDb();
const { STORES, kvGet, kvPut } = await import("./idb.js");
const { RETIRED_ACCOUNT_KEYS, forgetRetiredAccount } = await import("./retiredAccount.js");

test("a leftover sign-in is dropped, and nothing else in kv is touched", async () => {
  fake.clear();
  await kvPut("account:session", "sess-123");
  await kvPut("account:email", "player@example.com");
  await kvPut("account:dek", "AAAA");
  await kvPut("sync:versions", { "games:a": { version: 3 } });
  await kvPut("ui-settings", { language: "fr" });
  await kvPut("game-manifest", { activeGameId: "g1", order: ["g1"] });

  await forgetRetiredAccount();

  for (const key of RETIRED_ACCOUNT_KEYS) assert.equal(await kvGet(key, null), null, key);
  assert.deepEqual(await kvGet("ui-settings"), { language: "fr" });
  assert.deepEqual(await kvGet("game-manifest"), { activeGameId: "g1", order: ["g1"] });
  assert.deepEqual([...fake.rows("open-historia-web", STORES.kv).keys()].sort(), ["game-manifest", "ui-settings"]);
});

test("a browser that never signed in is a no-op", async () => {
  fake.clear();
  await forgetRetiredAccount();
  assert.equal(fake.rows("open-historia-web", STORES.kv).size, 0);
});
