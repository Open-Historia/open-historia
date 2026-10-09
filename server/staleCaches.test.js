/*! Open Historia — clearing the map copies other ports left behind: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/staleCaches.test.js
//
// electron/staleCaches.cjs with a stand-in for Electron's session: which origins
// a launch clears, that the one it runs on is never among them, and that only
// Cache Storage is asked for.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PORT_SEARCH_SPAN, otherPortOrigins, clearOtherPortsCaches } = require("../electron/staleCaches.cjs");

test("every port a launch could have had, except its own", () => {
  const origins = otherPortOrigins(3002, 3000);
  assert.equal(origins.length, PORT_SEARCH_SPAN - 1);
  assert.equal(origins[0], "http://localhost:3000");
  assert.ok(origins.includes("http://localhost:3019"));
  assert.ok(!origins.includes("http://localhost:3002"), "never the origin about to load");
  assert.ok(!origins.includes("http://localhost:3020"));
});

test("a launch with PORT set covers its own span and the default one", () => {
  const origins = otherPortOrigins(8081, 8080);
  assert.ok(origins.includes("http://localhost:8080"));
  assert.ok(origins.includes("http://localhost:8099"));
  assert.ok(origins.includes("http://localhost:3000"), "copies left by earlier launches without PORT");
  assert.ok(!origins.includes("http://localhost:8081"));
  assert.equal(origins.length, 2 * PORT_SEARCH_SPAN - 1);
});

test("only Cache Storage is cleared, and a failure does not stop the rest", async () => {
  const calls = [];
  const session = {
    async clearStorageData(options) {
      calls.push(options);
      if (options.origin === "http://localhost:3001") throw new Error("busy");
    },
  };
  const result = await clearOtherPortsCaches(session, { port: 3000, requested: 3000 });
  assert.deepEqual(result, { origins: PORT_SEARCH_SPAN - 1, failed: 1 });
  assert.equal(calls.length, PORT_SEARCH_SPAN - 1);
  for (const call of calls) {
    assert.deepEqual(call.storages, ["cachestorage"]);
    assert.notEqual(call.origin, "http://localhost:3000");
  }
});

test("the desktop app clears them before the page loads, on the span it searches", () => {
  const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const attempts = main.match(/findFreePort = async \(start, attempts = (\d+)\)/)?.[1];
  assert.equal(Number(attempts), PORT_SEARCH_SPAN, "the span cleared is the span searched");
  const clear = main.indexOf("clearOtherPortsCaches(mainWindow.webContents.session");
  const load = main.indexOf("await mainWindow.loadURL(`http://localhost:${port}`)");
  assert.ok(clear > 0 && load > clear, "cleared before the page is loaded");
});
