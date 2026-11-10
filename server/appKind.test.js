/*! Open Historia — which application this server is running inside: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/appKind.test.js
//
// "Make it track the application so how many people are playing in the main,
// and beta apps individually." The page asks its server which application it is
// (GET /api/app-kind); the page's side is src/runtime/visitCount.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { APP_CHANNELS, appKindOf } from "./appKind.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

test("the server started by hand is not the desktop app, whatever its environment says", () => {
  assert.deepEqual(appKindOf({ node: "22.0.0" }, {}), { app: "local" });
  assert.deepEqual(appKindOf({ node: "22.0.0" }, { OH_CHANNEL: "beta" }), { app: "local" });
  assert.deepEqual(appKindOf(undefined, undefined), { app: "local" });
});

test("inside the desktop app it says which build: the stable one or the beta", () => {
  const electron = { node: "22.0.0", electron: "38.0.0" };
  assert.deepEqual(appKindOf(electron, {}), { app: "desktop", channel: "stable" });
  assert.deepEqual(appKindOf(electron, { OH_CHANNEL: "stable" }), { app: "desktop", channel: "stable" });
  assert.deepEqual(appKindOf(electron, { OH_CHANNEL: "beta" }), { app: "desktop", channel: "beta" });
  // A channel nobody knows is the stable app, as it is everywhere else that asks.
  assert.deepEqual(appKindOf(electron, { OH_CHANNEL: "nightly" }), { app: "desktop", channel: "stable" });
});

test("the channels are the ones the desktop app can be stamped with", () => {
  const require = createRequire(import.meta.url);
  const { readChannel } = require("../electron/channel.cjs");
  assert.equal(readChannel(path.join(here, "no-such-folder"), {}), "stable");
  assert.ok(APP_CHANNELS.includes(readChannel(here, { OH_CHANNEL: "beta" })));
  assert.deepEqual([...APP_CHANNELS].sort(), ["beta", "stable"]);
  // And the desktop app tells its server, which is this same process.
  assert.ok(read("../electron/main.cjs").includes("process.env.OH_CHANNEL = CHANNEL;"));
});

test("a server told not to be counted says so, in the app or out of it", () => {
  assert.deepEqual(appKindOf({ node: "22.0.0" }, { OH_VISIT_COUNT: "0" }), { app: "uncounted" });
  assert.deepEqual(appKindOf({ electron: "38.0.0" }, { OH_VISIT_COUNT: "0", OH_CHANNEL: "beta" }), { app: "uncounted" });
  assert.deepEqual(appKindOf({ node: "22.0.0" }, { OH_VISIT_COUNT: "1" }), { app: "local" });
});

// "vault door by default only after a new update" (the owner, 2026-10-14): the
// page learns the desktop app's build here (src/runtime/buildId.js).
test("inside the desktop app it says which build is running, when the build is stamped", () => {
  const electron = { node: "22.0.0", electron: "38.0.0" };
  assert.deepEqual(appKindOf(electron, { OH_CHANNEL: "beta", OH_DESKTOP_BUILD: "18123456789" }), { app: "desktop", channel: "beta", build: "18123456789" });
  assert.deepEqual(appKindOf(electron, { OH_DESKTOP_BUILD: " 42 " }), { app: "desktop", channel: "stable", build: "42" });
  // Unstamped (a development run): nothing is said.
  assert.deepEqual(appKindOf(electron, { OH_DESKTOP_BUILD: "" }), { app: "desktop", channel: "stable" });
  // Told not to be counted, it still says its build: the door is not a counter.
  assert.deepEqual(appKindOf(electron, { OH_VISIT_COUNT: "0", OH_DESKTOP_BUILD: "42" }), { app: "uncounted", build: "42" });
  // A server started by hand is no desktop build, whatever its environment says.
  assert.deepEqual(appKindOf({ node: "22.0.0" }, { OH_DESKTOP_BUILD: "42" }), { app: "local" });
  assert.deepEqual(appKindOf({ node: "22.0.0" }, { OH_VISIT_COUNT: "0", OH_DESKTOP_BUILD: "42" }), { app: "uncounted" });
  // And electron/main.cjs is where the stamp is read.
  assert.ok(read("../electron/main.cjs").includes("process.env.OH_DESKTOP_BUILD = String("));
});

test("the server answers it from what it already knows", () => {
  const server = read("./server.js");
  assert.ok(server.includes('import { appKindOf } from "./appKind.js";'));
  assert.ok(server.includes('app.get("/api/app-kind", (req, res) => {\n  res.json(appKindOf(process.versions, process.env));\n});'));
});
