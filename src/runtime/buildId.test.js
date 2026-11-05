/*! Open Historia — which build of the game is running: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/buildId.test.js
//
// The id the vault door is shown once for (runtime/vaultDoorDue.js). The
// server's side is server/appKind.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { appBuildId, askServerBuild, bundleBuildId, stampedBuildId } from "./buildId.js";

const answering = (body, { ok = true } = {}) => {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push({ url, options });
    return { ok, json: async () => body };
  };
  return { asked, fetchImpl };
};

test("the Android app and the website read their stamp from the bundle", () => {
  assert.equal(stampedBuildId({ VITE_OH_NATIVE: true, VITE_OH_WEB: true, VITE_APP_BUILD: "412", VITE_APP_TRACK: "beta" }), "android-beta-412");
  assert.equal(stampedBuildId({ VITE_OH_NATIVE: true, VITE_APP_BUILD: 7 }), "android-stable-7");
  // An Android build nobody stamped (a local build) has none.
  assert.equal(stampedBuildId({ VITE_OH_NATIVE: true, VITE_OH_WEB: true }), "");
  assert.equal(stampedBuildId({ VITE_OH_NATIVE: true, VITE_APP_BUILD: "0" }), "");
  assert.equal(stampedBuildId({ VITE_OH_WEB: true, VITE_WEB_BUILD: "1760000000000" }), "web-1760000000000");
  // Off the web vite.config.ts stamps an empty string.
  assert.equal(stampedBuildId({ VITE_WEB_BUILD: "" }), "");
  assert.equal(stampedBuildId({}), "");
  assert.equal(stampedBuildId(), "");
});

test("the desktop app's stamp is asked of its own server, and nothing else is taken for one", async () => {
  const desktop = answering({ app: "desktop", channel: "beta", build: "18123456789" });
  assert.equal(await askServerBuild(desktop.fetchImpl), "desktop-18123456789");
  assert.equal(desktop.asked.length, 1);
  assert.equal(desktop.asked[0].url, "/api/app-kind");
  assert.equal(desktop.asked[0].options.cache, "no-store");
  assert.equal(await askServerBuild(answering({ app: "uncounted", build: 42 }).fetchImpl), "desktop-42");
  // A server started by hand, an unstamped build, a refusal, nonsense: none.
  assert.equal(await askServerBuild(answering({ app: "local" }).fetchImpl), "");
  assert.equal(await askServerBuild(answering({ app: "desktop", channel: "stable" }).fetchImpl), "");
  assert.equal(await askServerBuild(answering({ app: "desktop", build: "  " }).fetchImpl), "");
  assert.equal(await askServerBuild(answering({ app: "desktop", build: { id: 1 } }).fetchImpl), "");
  assert.equal(await askServerBuild(answering(null).fetchImpl), "");
  assert.equal(await askServerBuild(answering({ build: "1" }, { ok: false }).fetchImpl), "");
  assert.equal(await askServerBuild(async () => { throw new TypeError("Failed to fetch"); }), "");
  assert.equal(await askServerBuild(async () => ({ ok: true, json: async () => { throw new SyntaxError("not JSON"); } })), "");
  assert.equal(await askServerBuild(null), "");
});

test("a server that does not answer in time is given up on, and the request is cancelled", async () => {
  let signal = null;
  const silent = (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  const started = Date.now();
  assert.equal(await askServerBuild(silent, { timeoutMs: 30 }), "");
  assert.ok(Date.now() - started < 1000);
  assert.equal(signal?.aborted, true);
});

test("anything else is known by the address of its code, without the query", () => {
  assert.equal(bundleBuildId("http://localhost:3000/assets/main-AbC123.js"), "bundle-/assets/main-AbC123.js");
  // A development run's module address, as Vite serves it after an edit, is the same address.
  assert.equal(bundleBuildId("http://localhost:5173/src/runtime/buildId.js?t=1760000000000"), "bundle-/src/runtime/buildId.js");
  assert.equal(bundleBuildId("not a url"), "");
  // By default, this module's own address.
  assert.match(bundleBuildId(), /^bundle-\/.*buildId\.js$/);
});

test("the running build: the bundle's stamp first, then the desktop app's server, then the code's address", async () => {
  const code = "http://localhost:3000/assets/main-AbC123.js";
  const server = answering({ app: "desktop", channel: "stable", build: "99" });
  // The website and the Android app never ask (their /api is the page's own).
  assert.equal(await appBuildId({ env: { VITE_OH_WEB: true, VITE_WEB_BUILD: "1760" }, fetchImpl: server.fetchImpl, moduleUrl: code }), "web-1760");
  assert.equal(await appBuildId({ env: { VITE_OH_NATIVE: true, VITE_OH_WEB: true, VITE_APP_BUILD: "412" }, fetchImpl: server.fetchImpl, moduleUrl: code }), "android-stable-412");
  assert.equal(await appBuildId({ env: { VITE_OH_NATIVE: true, VITE_OH_WEB: true }, fetchImpl: server.fetchImpl, moduleUrl: code }), "bundle-/assets/main-AbC123.js");
  assert.equal(server.asked.length, 0);
  // The desktop app.
  assert.equal(await appBuildId({ env: {}, fetchImpl: server.fetchImpl, moduleUrl: code }), "desktop-99");
  assert.equal(server.asked.length, 1);
  // A server with no stamp (by hand, unstamped): the code's address.
  assert.equal(await appBuildId({ env: {}, fetchImpl: answering({ app: "local" }).fetchImpl, moduleUrl: code }), "bundle-/assets/main-AbC123.js");
  // A development run asks nothing: its server has no stamp to give.
  const dev = answering({ app: "desktop", build: "99" });
  assert.equal(await appBuildId({ env: { DEV: true }, fetchImpl: dev.fetchImpl, moduleUrl: "http://localhost:5173/src/runtime/buildId.js" }), "bundle-/src/runtime/buildId.js");
  assert.equal(dev.asked.length, 0);
  // Nothing at all to go on.
  assert.equal(await appBuildId({ env: {}, fetchImpl: null, moduleUrl: "" }), "");
});

test("the stamps read here are the ones the builds are given", () => {
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const vite = read("../../vite.config.ts");
  assert.match(vite, /'import\.meta\.env\.VITE_WEB_BUILD': JSON\.stringify\(mode === 'web' \? WEB_BUILD_ID : ''\)/);
  assert.match(read("./AppUpdateBanner.jsx"), /const APP_BUILD = Number\(import\.meta\.env\.VITE_APP_BUILD\);/);
  assert.match(read("../../server/appKind.js"), /String\(env\?\.OH_DESKTOP_BUILD \?\? ""\)\.trim\(\)/);
});
