/*! Open Historia — retired-account cleanup tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/retiredAccount.test.js

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("the website drops it at boot, and asks the registry for no account, sync or presence", () => {
  const boot = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(boot, /import \{ forgetRetiredAccount \} from "\.\/retiredAccount\.js";/);
  // (Saves are moved into the current storage layout in between, on a timer.)
  assert.match(boot, /installWebApiRouter\(\);\s*requestPersistentStorage\(\);[\s\S]{0,600}?forgetRetiredAccount\(\);/);

  // The sign-in, the sync engine and the corner chip are gone, and nothing in
  // the web backend names their routes.
  const files = readdirSync(new URL("./", import.meta.url)).filter((name) => /\.js$/.test(name) && !/\.test\.js$/.test(name));
  for (const gone of ["account.js", "sync.js", "accountWidget.js"]) assert.equal(files.includes(gone), false, `${gone} is back`);
  for (const name of files) {
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(text, /\/account\/|\/sync\/|reportPresence|VITE_OH_ACCOUNT_URL|VITE_OH_GOOGLE_CLIENT_ID|Authorization/, name);
  }
});

// The website carries its own map: no content node, node directory or signed
// manifest is asked for, and every map file is read from the build's own assets/.
test("the website asks no content node for anything, and reads its map from its own assets", () => {
  const files = readdirSync(new URL("./", import.meta.url)).filter((name) => /\.js$/.test(name) && !/\.test\.js$/.test(name));
  for (const gone of ["nodeConnect.js", "contentTrust.js", "trust.js"]) assert.equal(files.includes(gone), false, `${gone} is back`);
  for (const name of files) {
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(text, /VITE_OH_PMTILES_URL|VITE_OH_DIRECTORY_URL|node-directory|content-manifest|\/oh\/v1\//, name);
  }
  const base = readFileSync(new URL("../worldFiles.js", import.meta.url), "utf8");
  assert.match(base, /import\.meta\.env\.BASE_URL/);
  const env = readFileSync(new URL("../../../.env.web", import.meta.url), "utf8");
  assert.doesNotMatch(env, /VITE_OH_PMTILES_URL|VITE_OH_DIRECTORY_URL/);
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["build:site"], /stage-map-assets\.mjs dist-web/);
  assert.match(pkg.scripts["build:web"], /stage-map-assets\.mjs dist-web/);
});
