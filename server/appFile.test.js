/*! Open Historia — each app downloads its own file once per install: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/appFile.test.js
//
// "A file downloaded by everyone who downloads the main app, a different file
// for the beta app ... only downloaded once when the app is installed or when
// people update to this update and never again." The desktop half is
// electron/appFile.cjs; the Android half is AppFile.java, checked here by its
// source, because the suite has no Android runtime.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { APP_FILE_RELEASE, appFileFor, appFileUrl, fetchAppFileOnce } = require("../electron/appFile.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8").replace(/\r\n/g, "\n");

const tempMark = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oh-app-file-")), "app-file.json");

// A fetch that records every URL it was asked for and answers as told.
const fakeFetch = (answer) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return { ok: answer >= 200 && answer < 300, status: answer, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  return { impl, calls };
};

test("each desktop build has its own file, and unknown builds have none", () => {
  assert.equal(appFileFor("stable"), "main.app.txt");
  assert.equal(appFileFor("beta"), "beta.app.txt");
  assert.equal(appFileFor("toString"), null);
  assert.equal(appFileFor(undefined), null);
  assert.equal(appFileUrl("main.app.txt"), "https://github.com/Open-Historia/open-historia/releases/download/app-files/main.app.txt");
});

test("the first start of an installed app downloads its file once, with nothing added to the address", async () => {
  const markFile = tempMark();
  const { impl, calls } = fakeFetch(200);
  const result = await fetchAppFileOnce({ channel: "beta", packaged: true, markFile, fs, fetchImpl: impl });
  assert.equal(result, "downloaded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${APP_FILE_RELEASE}beta.app.txt`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "omit");
  assert.ok(!calls[0].url.includes("?"));
  assert.equal(JSON.parse(fs.readFileSync(markFile, "utf8")).file, "beta.app.txt");
});

test("every later start downloads nothing", async () => {
  const markFile = tempMark();
  const { impl, calls } = fakeFetch(200);
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: impl }), "downloaded");
  for (let start = 0; start < 5; start += 1) {
    assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: impl }), "done-before");
  }
  assert.equal(calls.length, 1);
});

test("a start that could not download it leaves no mark, and the next start tries again", async () => {
  const markFile = tempMark();
  const offline = fakeFetch(new TypeError("fetch failed"));
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: offline.impl }), "failed");
  assert.equal(fs.existsSync(markFile), false);
  const refused = fakeFetch(503);
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: refused.impl }), "failed");
  assert.equal(fs.existsSync(markFile), false);
  const online = fakeFetch(200);
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: online.impl }), "downloaded");
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: true, markFile, fs, fetchImpl: online.impl }), "done-before");
  assert.equal(online.calls.length, 1);
});

test("a development run never downloads anything", async () => {
  const markFile = tempMark();
  const { impl, calls } = fakeFetch(200);
  assert.equal(await fetchAppFileOnce({ channel: "stable", packaged: false, markFile, fs, fetchImpl: impl }), "not-counted");
  assert.equal(await fetchAppFileOnce({ channel: "beta", packaged: false, markFile, fs, fetchImpl: impl }), "not-counted");
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(markFile), false);
});

test("the desktop shell asks after the launch update, with the build's channel, the packaged flag and a mark in its data folder", () => {
  const main = read("electron/main.cjs");
  const at = main.indexOf("void fetchAppFileOnce({");
  assert.ok(at > main.indexOf("if (launchUpdate.installing) return;"), "after a waiting update is installed");
  const call = main.slice(at, main.indexOf("});", at));
  assert.match(call, /channel: CHANNEL,/);
  assert.match(call, /packaged: app\.isPackaged,/);
  assert.match(call, /markFile: path\.join\(USER_ROOT, "app-file\.json"\),/);
});

test("the page never downloads an app file: only the app shells name the release", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(here, "..", dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(jsx?|mjs|cjs|html)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        if (read(rel).includes("releases/download/app-files")) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

test("each Android app downloads its own file once, never from a debuggable build, and keeps its mark outside the WebView", () => {
  const java = read("mobile/android/app/src/main/java/io/github/arkniem/openhistoria/AppFile.java");
  // The file is named in build.gradle, beside the application id each channel
  // gets; the handover build (an old id) downloads none.
  assert.match(java, /fileFor\(BuildConfig\.OH_APP_FILE\)/);
  const gradle = read("mobile/android/app/build.gradle");
  assert.match(gradle, /buildConfigField "String", "OH_APP_FILE", "\\"" \+ \(ohLegacyAppId \? "" : ohBeta \? "android\.beta\.app\.txt" : "android\.app\.txt"\) \+ "\\""/);
  assert.ok(java.includes(APP_FILE_RELEASE), "the same release as the desktop apps");
  assert.match(java, /FLAG_DEBUGGABLE/);
  assert.match(java, /getSharedPreferences\(/);
  assert.ok(!/localStorage/.test(java));
  const activity = read("mobile/android/app/src/main/java/io/github/arkniem/openhistoria/MainActivity.java");
  assert.match(activity, /AppFile\.fetchOnce\(/);
});
