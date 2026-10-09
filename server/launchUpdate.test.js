/*! Open Historia — installing a waiting update when the game opens: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/launchUpdate.test.js
//
// electron/launchUpdate.cjs with a stand-in for electron-updater: the check, the
// progress the setup window is sent, "Open the game now", the install, and the
// record that keeps a broken update from holding every launch up.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { runLaunchUpdate, LAUNCH_FAILURE_LIMIT } = require("../electron/launchUpdate.cjs");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// An updater whose check and download the test settles by hand.
const fakeUpdater = ({ check, download } = {}) => {
  const updater = new EventEmitter();
  updater.installs = [];
  updater.checkForUpdates = () => check();
  updater.downloadUpdate = () => download(updater);
  updater.quitAndInstall = (...args) => updater.installs.push(args);
  return updater;
};

const available = (version = "0.0.40") => async () => ({ isUpdateAvailable: true, updateInfo: { version } });

const setup = (t, overrides = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-launch-update-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  const timers = [];
  let windows = 0;
  let pressLater = () => {};
  const later = new Promise((resolve) => { pressLater = resolve; });
  const run = (updater, extra = {}) =>
    runLaunchUpdate({
      updater,
      fs,
      recordFile: path.join(dir, "launch-update.json"),
      showWindow: async () => { windows += 1; },
      send: (payload) => sent.push(payload),
      waitForLater: () => later,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); },
      ...overrides,
      ...extra,
    });
  return {
    dir,
    sent,
    timers,
    run,
    pressLater: () => pressLater(),
    windows: () => windows,
    record: () => { try { return JSON.parse(fs.readFileSync(path.join(dir, "launch-update.json"), "utf8")); } catch { return null; } },
  };
};

test("a build that cannot update itself opens the game straight away", async (t) => {
  const s = setup(t);
  assert.deepEqual(await s.run(null), { installing: false, reason: "unsupported" });
  assert.equal(s.windows(), 0);
});

test("nothing newer: no window, the game opens", async (t) => {
  const s = setup(t);
  const current = fakeUpdater({ check: async () => ({ isUpdateAvailable: false, updateInfo: { version: "0.0.39" } }) });
  assert.equal((await s.run(current)).reason, "current");
  // null is electron-updater declining to run at all (an AppImage run outside its bundle).
  const declined = fakeUpdater({ check: async () => null });
  assert.equal((await s.run(declined)).reason, "current");
  assert.equal(s.windows(), 0);
  assert.deepEqual(s.sent, []);
});

test("offline or a failing feed: the game opens as it always did", async (t) => {
  const s = setup(t);
  const offline = fakeUpdater({ check: async () => { throw new Error("net::ERR_INTERNET_DISCONNECTED"); } });
  const logged = [];
  assert.equal((await s.run(offline, { log: (...args) => logged.push(args) })).reason, "check-failed");
  assert.equal(logged[0][1], "updater.launchCheckFailed");
  assert.equal(s.windows(), 0);
});

test("a feed slower than the timeout does not hold the launch", async (t) => {
  const s = setup(t, { setTimer: (fn) => fn() });
  const slow = fakeUpdater({ check: () => new Promise(() => {}) });
  assert.equal((await s.run(slow, { checkTimeoutMs: 10 })).reason, "timeout");
  assert.equal(s.windows(), 0);
});

test("an update found at launch downloads with progress, then quits into the installer", async (t) => {
  const s = setup(t);
  let finish;
  const updater = fakeUpdater({
    check: available("0.0.40"),
    download: () => new Promise((resolve) => { finish = resolve; }),
  });
  const running = s.run(updater);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.windows(), 1, "the setup window opens only once an update is found");
  assert.deepEqual(s.sent[0], { version: "0.0.40", percent: 0 });
  updater.emit("download-progress", { percent: 41.6 });
  updater.emit("download-progress", { percent: 250 });
  assert.deepEqual(s.sent.slice(1), [{ version: "0.0.40", percent: 42 }, { version: "0.0.40", percent: 100 }]);
  finish();
  const result = await running;
  assert.deepEqual(result, { installing: true, reason: "installing", version: "0.0.40" });
  assert.deepEqual(s.sent.at(-1), { version: "0.0.40", percent: 100, installing: true });
  assert.equal(updater.installs.length, 0, "deferred, so the window can say it is installing");
  s.timers.at(-1).fn();
  assert.deepEqual(updater.installs, [[true, true]], "silent, and the game reopens");
  assert.equal(updater.listenerCount("download-progress"), 0);
});

test("'Open the game now' opens the game and leaves the download running", async (t) => {
  const s = setup(t);
  const updater = fakeUpdater({ check: available("0.0.40"), download: () => new Promise(() => {}) });
  const running = s.run(updater);
  await new Promise((resolve) => setImmediate(resolve));
  s.pressLater();
  assert.deepEqual(await running, { installing: false, reason: "later", version: "0.0.40" });
  assert.deepEqual(s.sent.at(-1), { version: "0.0.40", opening: true });
  s.timers.forEach((timer) => timer.fn());
  assert.equal(updater.installs.length, 0, "it installs when the game is closed (autoInstallOnAppQuit), not now");
  assert.equal(s.record(), null, "choosing to play is not a failure");
});

test(`a version that fails to download ${LAUNCH_FAILURE_LIMIT} times is left to the banner`, async (t) => {
  const s = setup(t);
  const broken = () => fakeUpdater({ check: available("0.0.40"), download: async () => { throw new Error("sha512 checksum mismatch"); } });
  for (let attempt = 1; attempt <= LAUNCH_FAILURE_LIMIT; attempt += 1) {
    const result = await s.run(broken());
    assert.equal(result.reason, "download-failed");
    assert.equal(s.record().failures, attempt);
    assert.deepEqual(s.sent.at(-1), { version: "0.0.40", opening: true, failed: true });
  }
  const windowsBefore = s.windows();
  assert.equal((await s.run(broken())).reason, "failed-before");
  assert.equal(s.windows(), windowsBefore, "no window for a launch that is not going to try");

  // A newer version gets its own tries.
  const fixed = fakeUpdater({ check: available("0.0.41"), download: async () => {} });
  assert.equal((await s.run(fixed)).reason, "installing");
  assert.deepEqual(s.record(), {}, "an install clears the record");
});

test("main.cjs runs the launch update before the server and stops for an install", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8").replace(/\r\n/g, "\n");
  const boot = main.slice(main.indexOf("const boot = async"));
  const launch = boot.indexOf("runLaunchUpdate(");
  assert.ok(launch > 0, "boot() runs the launch update");
  assert.ok(launch < boot.indexOf("startServer()"), "before the server starts");
  assert.ok(launch < boot.indexOf("missingAssets()"), "before the map download");
  assert.match(boot, /if \(launchUpdate\.installing\) return;/);
  assert.match(boot, /ipcMain\.removeHandler\("setup:update-later"\)/, "a stale 'Open the game now' handler never lingers");
  assert.match(main, /return autoUpdater;\n\};/, "installAutoUpdater hands boot() the updater");
});

// Every installer keeps one name on a rolling release, so the block map
// electron-updater takes for the installed version's is the new one. A player's
// log: old and new block-map addresses the same file, "To download: 0 KB (0%)",
// then "Cannot download differentially, fallback to full download: Error:
// sha512 checksum mismatch", on every update.
test("an update is downloaded in full: no differential download is tried", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8").replace(/\r\n/g, "\n");
  // The installer's own updater; the chunked update in front of it downloads no installer at all.
  const setup = main.slice(main.indexOf("const setupInstallerUpdater = () => {"), main.indexOf("const setupPayloadUpdater = () => {"));
  assert.match(setup, /autoUpdater\.autoDownload = false;\n(?: *\/\/[^\n]*\n)* *autoUpdater\.disableDifferentialDownload = true;\n/);
  // The reason it cannot work: no installer's name carries its version.
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).build;
  const beta = fs.readFileSync(path.join(ROOT, "electron-builder.beta.yml"), "utf8");
  assert.doesNotMatch(`${JSON.stringify(build)}\n${beta.replace(/^\s*#.*$/gm, "")}`, /artifactName[^\n,}]*\$\{version\}/);
});

test("the setup window can show the update and offer to open the game now", () => {
  const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
  const page = fs.readFileSync(path.join(ROOT, "electron/setup.html"), "utf8");
  assert.match(preload, /onUpdate: \(fn\) => ipcRenderer\.on\("setup:update"/);
  assert.match(preload, /updateLater: \(\) => ipcRenderer\.invoke\("setup:update-later"\)/);
  assert.match(page, /window\.ohSetup\.onUpdate\(/);
  assert.match(page, /window\.ohSetup\.updateLater\(\)/);
  assert.match(page, /id="later"/);
});

// The stable app's update screen offers the beta; the beta's own never does.
test("the stable app's update screen offers the beta, opened in the player's browser", () => {
  const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  const page = read("electron/setup.html");
  assert.match(main, /send: \(payload\) => sendToSetup\("setup:update", \{ \.\.\.payload, betaOffer: !IS_BETA \}\)/, "offered by the stable build only");
  assert.match(main, /ipcMain\.handle\("setup:open-beta", \(\) => shell\.openExternal\(BETA_DOWNLOAD_URL\)\)/);
  const url = /const BETA_DOWNLOAD_URL = process\.platform === "win32"\s*\? "([^"]+)"\s*: "([^"]+)";/.exec(main);
  assert.ok(url, "the beta's address is a constant in main.cjs");
  assert.equal(url[1], "https://github.com/Open-Historia/open-historia/releases/download/desktop-beta/Open-Historia-Beta-Setup.exe");
  assert.equal(url[2], "https://github.com/Open-Historia/open-historia/releases/tag/desktop-beta");
  assert.match(preload, /openBeta: \(\) => ipcRenderer\.invoke\("setup:open-beta"\)/);
  assert.match(page, /<div class="beta" id="beta" hidden>/, "hidden until the app says to offer it");
  assert.match(page, /beta\.hidden = !betaOffer;/);
  assert.match(page, /window\.ohSetup\.openBeta\(\)/);
  // The map download is not an update: no beta offer there.
  const mapMode = page.slice(page.indexOf("const showMapDownload"), page.indexOf("window.ohSetup.onUpdate("));
  assert.match(mapMode, /beta\.hidden = true;/);
});

// The Android app's update cover (AppUpdateBanner.jsx) makes the same offer.
test("the stable Android app's update cover offers the Android beta", () => {
  const banner = fs.readFileSync(path.join(ROOT, "src/runtime/AppUpdateBanner.jsx"), "utf8");
  assert.match(
    banner,
    /const ANDROID_BETA_APK = "https:\/\/github\.com\/Open-Historia\/open-historia\/releases\/download\/android-beta\/open-historia-beta\.apk";/,
  );
  assert.match(banner, /const offerBeta = isApp && APP_TRACK !== "beta";/, "the stable app only: not the beta, not the website");
  assert.match(banner, /\{offerBeta \? \(/);
  assert.match(banner, /onClick=\{openBetaDownload\}/);
  // Only while the update downloads: the offer sits in the cover's download stage.
  const cover = banner.slice(banner.indexOf("if (launch) {"));
  assert.ok(cover.indexOf("Not now") < cover.indexOf("{offerBeta ? ("), "after the cover's own button");
});
