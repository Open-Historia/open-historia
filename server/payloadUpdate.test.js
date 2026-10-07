// Run: node --test server/payloadUpdate.test.js
//
// An update made of the chunks that changed (electron/payloadUpdate.cjs), from
// a release served by a local server to a folder on disk; which copy of the
// app's files a start runs from (electron/payloadBoot.cjs); and the one updater
// that stands in front of the chunks and the installer
// (electron/layeredUpdate.cjs).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chunkAssetName, headOf, planPayload, sha256 } = require("../electron/payloadChunks.cjs");
const boot = require("../electron/payloadBoot.cjs");
const { createPayloadUpdater, indexLocal, listFiles } = require("../electron/payloadUpdate.cjs");
const { createLayeredUpdater } = require("../electron/layeredUpdate.cjs");

const noise = (bytes, seed = 1) => {
  const data = Buffer.alloc(bytes);
  let state = seed >>> 0;
  for (let index = 0; index < bytes; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = state >>> 24;
  }
  return data;
};
const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-payload-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const writeTree = (root, entries) => {
  for (const entry of entries) {
    const file = path.join(root, ...entry.path.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entry.data);
  }
};
const readTree = (root) => new Map(listFiles(root).map((relative) => [relative, sha256(fs.readFileSync(path.join(root, ...relative.split("/"))))]));

const SHELL = { electron: "44.0.0", protocol: boot.PROTOCOL };

// Release 100, as installed, and release 200 beside it: one bundle rebuilt
// with a small change, one source file edited, one file gone, one new.
const installed = () => [
  { path: "dist/assets/index-AAAAAAAA.js", data: noise(3 * 1024 * 1024, 1) },
  { path: "dist/assets/map-BBBBBBBB.js", data: noise(2 * 1024 * 1024, 2) },
  { path: "electron/main.cjs", data: Buffer.from("// main 100\n") },
  { path: "electron/build-id.json", data: Buffer.from('{"build":"100"}') },
  { path: "server/server.js", data: noise(50_000, 3) },
  { path: "server/old.js", data: noise(4000, 4) },
  ...Array.from({ length: 40 }, (unused, index) => ({ path: `node_modules/dep/file${index}.js`, data: noise(2000 + index, 100 + index) })),
];
const newer = () => installed().flatMap((entry) => {
  if (entry.path === "dist/assets/index-AAAAAAAA.js") {
    return [{ path: "dist/assets/index-CCCCCCCC.js", data: Buffer.concat([entry.data.subarray(0, 1_500_000), noise(200, 9), entry.data.subarray(1_500_200)]) }];
  }
  if (entry.path === "electron/main.cjs") return [{ path: entry.path, data: Buffer.from("// main 200\n") }];
  if (entry.path === "electron/build-id.json") return [{ path: entry.path, data: Buffer.from('{"build":"200"}') }];
  if (entry.path === "server/server.js") return [{ path: entry.path, data: Buffer.concat([entry.data, Buffer.from("// fixed\n")]) }];
  if (entry.path === "server/old.js") return [];
  return [entry];
}).concat([{ path: "server/new.js", data: noise(3000, 77) }]);

// A release on a local server: the head under its fixed name, and the manifest
// and each chunk under the name its content gives it.
const publish = async (t, entries, details = {}) => {
  const { manifest, chunks } = planPayload(entries, { build: "200", version: "0.0.200", channel: "stable", shell: SHELL, ...details });
  const files = new Map();
  // (Re)publishes a manifest and the head that names it.
  const setManifest = (value, changeHead = (head) => head) => {
    const manifestText = JSON.stringify(value);
    const head = changeHead(headOf(value, manifestText));
    files.set(head.manifest.name, Buffer.from(manifestText));
    files.set("payload-test.json", Buffer.from(JSON.stringify(head)));
    return head;
  };
  const head = setManifest(manifest);
  for (const [id, data] of chunks) files.set(chunkAssetName(id), data);
  const asked = [];
  const tamper = new Map();
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(request.url.split("/").pop());
    asked.push(name);
    const body = tamper.has(name) ? tamper.get(name)(files.get(name)) : files.get(name);
    if (!body) {
      response.writeHead(404).end("no such file");
      return;
    }
    response.writeHead(200, { "content-length": body.length }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { manifest, head, setManifest, chunks, files, asked, tamper, feed: `http://127.0.0.1:${server.address().port}/release/` };
};

const install = (t) => {
  const root = tempDir(t);
  const app = path.join(root, "app");
  writeTree(app, installed());
  return { root, app, payloadDir: path.join(root, "data", boot.PAYLOAD_FOLDER) };
};
const updaterFor = (place, release, extra = {}) => createPayloadUpdater({
  feed: release.feed,
  manifestName: "payload-test.json",
  payloadDir: place.payloadDir,
  currentRoot: place.app,
  currentBuild: "100",
  shell: SHELL,
  retryDelayMs: 1,
  ...extra,
});

test("an update fetches only the chunks the installed files cannot supply, and ends as the release's files exactly", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  const updater = updaterFor(place, release);
  const found = await updater.check();
  assert.equal(found.state, "available");
  assert.equal(found.build, "200");

  const progress = [];
  const done = await updater.apply(found.manifest, { onProgress: (step) => progress.push(step) });
  assert.equal(done.root, path.join(place.payloadDir, "200"));

  // The folder is the release, file for file.
  const want = new Map(newer().map((entry) => [entry.path, sha256(entry.data)]));
  want.set(boot.MANIFEST_FILE, sha256(Buffer.from(JSON.stringify(release.manifest))));
  assert.deepEqual([...readTree(done.root)].sort(), [...want].sort());
  assert.equal(fs.existsSync(path.join(done.root, "server", "old.js")), false, "a file the release dropped is not carried over");

  // A small share of it came down the wire, and no chunk twice.
  const chunkRequests = release.asked.filter((name) => name.startsWith("c-"));
  assert.equal(new Set(chunkRequests).size, chunkRequests.length);
  assert.ok(chunkRequests.length < release.chunks.size / 2, `${chunkRequests.length} of ${release.chunks.size} chunks fetched`);
  assert.ok(done.fetchedBytes < done.totalBytes / 3, `${done.fetchedBytes} of ${done.totalBytes} bytes fetched`);
  assert.equal(done.fetchedBytes + done.reusedBytes >= done.totalBytes - 16, true);

  // The next start is pointed at it, and the installed files are untouched.
  assert.deepEqual(boot.readJson(path.join(place.payloadDir, boot.CURRENT_FILE)), { build: "200", shell: SHELL, attempts: 0 });
  assert.deepEqual([...readTree(place.app)].sort(), installed().map((entry) => [entry.path, sha256(entry.data)]).sort());
  assert.equal(fs.existsSync(path.join(place.payloadDir, "chunks")), false, "the downloaded chunks are not kept once the files are made");
  assert.equal(progress.at(-1).phase, "building");
  assert.ok(progress.some((step) => step.phase === "downloading" && step.percent === 100));
  assert.ok(progress.filter((step) => step.phase === "downloading").every((step) => step.percent >= 0 && step.percent <= 100));
});

test("an app already on the release, or ahead of it, is told there is nothing", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  assert.equal((await updaterFor(place, release, { currentBuild: "200" }).check()).state, "none");
  assert.equal((await updaterFor(place, release, { currentBuild: "250" }).check()).state, "none");
  // Which is all a start with nothing to fetch costs: the head, a few hundred bytes.
  assert.deepEqual(release.asked, ["payload-test.json", "payload-test.json"]);
  assert.ok(release.files.get("payload-test.json").length < 1000);
  assert.equal((await updaterFor(place, release, { currentBuild: "" }).check()).state, "available", "an unstamped build is older than any release");
});

test("a release built for another runtime, or in a format this app does not read, comes by the installer", async (t) => {
  const place = install(t);
  const electron = await publish(t, newer(), { shell: { electron: "45.1.0", protocol: boot.PROTOCOL } });
  const answer = await updaterFor(place, electron).check();
  assert.equal(answer.state, "installer");
  assert.match(answer.reason, /another version of the runtime/);
  const protocol = await publish(t, newer(), { shell: { electron: SHELL.electron, protocol: boot.PROTOCOL + 1 } });
  assert.equal((await updaterFor(place, protocol).check()).state, "installer");
  const format = await publish(t, newer());
  format.setManifest(format.manifest, (head) => ({ ...head, format: 99 }));
  assert.equal((await updaterFor(place, format).check()).state, "installer");
});

test("a set of files the app could not start from is not fetched a second time", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  boot.markBad(place.payloadDir, "200");
  const answer = await updaterFor(place, release).check();
  assert.equal(answer.state, "installer");
  assert.match(answer.reason, /could not start from it/);
});

test("a manifest that cannot be trusted is refused before anything is written", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  const bad = JSON.parse(JSON.stringify(release.manifest));
  bad.files[0].path = "../../outside.js";
  release.setManifest(bad);
  await assert.rejects(updaterFor(place, release).check(), /leaves the app's folder/);
  // A manifest that is not the bytes the head names: swapped on the release, or cut short on the way.
  const good = release.setManifest(release.manifest);
  release.files.set(good.manifest.name, Buffer.from(JSON.stringify({ ...release.manifest, build: "201" })));
  await assert.rejects(updaterFor(place, release).check(), /not the one its head names/);
  release.files.delete(good.manifest.name);
  await assert.rejects(updaterFor(place, release).check(), /answered 404/);
  // A head that names no manifest, is not JSON, or is not there.
  release.setManifest(release.manifest, (head) => ({ ...head, manifest: { ...head.manifest, name: "payload-test.json" } }));
  await assert.rejects(updaterFor(place, release).check(), /does not say which manifest/);
  release.files.set("payload-test.json", Buffer.from("<html>not found</html>"));
  await assert.rejects(updaterFor(place, release).check(), /not JSON/);
  release.files.delete("payload-test.json");
  await assert.rejects(updaterFor(place, release).check(), /answered 404/);
  assert.equal(fs.existsSync(place.payloadDir), false);
});

test("a chunk that arrives damaged is asked for again, and one that stays damaged fails the update and leaves the app as it was", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  const updater = updaterFor(place, release);
  const { manifest } = await updater.check();
  assert.deepEqual(release.asked, ["payload-test.json", release.head.manifest.name], "the head, and the manifest once there is something to fetch");

  // One of the chunks this update needs, with its last bit flipped the first
  // time it is served: the second asking is good.
  const { planUpdate } = require("../electron/payloadChunks.cjs");
  const needed = planUpdate(manifest, indexLocal(place.app)).fetch;
  let served = 0;
  release.tamper.set(chunkAssetName(needed[0]), (body) => {
    served += 1;
    return served === 1 ? Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([body[body.length - 1] ^ 1])]) : body;
  });
  const done = await updater.apply(manifest);
  assert.equal(served, 2, "asked twice");
  assert.equal(fs.readFileSync(path.join(done.root, "electron", "main.cjs"), "utf8"), "// main 200\n");

  // Damaged every time: three askings, then the update fails.
  const place2 = install(t);
  const release2 = await publish(t, newer());
  const updater2 = updaterFor(place2, release2);
  const answer2 = await updater2.check();
  const needed2 = planUpdate(answer2.manifest, indexLocal(place2.app)).fetch;
  release2.tamper.set(chunkAssetName(needed2[0]), (body) => body.subarray(0, body.length - 3));
  await assert.rejects(updater2.apply(answer2.manifest), /could not be downloaded/);
  assert.equal(release2.asked.filter((name) => name === chunkAssetName(needed2[0])).length, 3);
  assert.equal(fs.existsSync(path.join(place2.payloadDir, boot.CURRENT_FILE)), false, "nothing is pointed at");
  assert.equal(fs.existsSync(path.join(place2.payloadDir, "200")), false);
  assert.equal(fs.existsSync(path.join(place2.payloadDir, "staging")), false);

  // The chunks that did arrive are kept, so the next attempt fetches only the rest.
  release2.tamper.clear();
  const before = release2.asked.length;
  await updater2.apply(answer2.manifest);
  const again = release2.asked.slice(before).filter((name) => name.startsWith("c-"));
  assert.ok(again.length < needed2.length, `${again.length} of ${needed2.length} fetched again`);
  assert.ok(again.includes(chunkAssetName(needed2[0])));
});

test("a chunk the release does not have fails at once, and a cancelled update stops", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  const updater = updaterFor(place, release);
  const { manifest } = await updater.check();
  const { planUpdate } = require("../electron/payloadChunks.cjs");
  const [missing] = planUpdate(manifest, indexLocal(place.app)).fetch;
  release.files.delete(chunkAssetName(missing));
  await assert.rejects(updater.apply(manifest), /could not be downloaded.*404/);
  assert.equal(release.asked.filter((name) => name === chunkAssetName(missing)).length, 1, "not asked for three times");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(updater.apply(manifest, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(fs.existsSync(path.join(place.payloadDir, boot.CURRENT_FILE)), false);
});

test("a file changed on disk since it was indexed is caught when the new set is put together", async (t) => {
  const place = install(t);
  const release = await publish(t, newer());
  // A file system that hands back other bytes the second time a file is read.
  const reads = new Map();
  const shifty = {
    ...fs,
    readFileSync: (file, ...rest) => {
      const data = fs.readFileSync(file, ...rest);
      const count = (reads.get(file) ?? 0) + 1;
      reads.set(file, count);
      return count > 1 && String(file).endsWith("map-BBBBBBBB.js") ? Buffer.concat([data.subarray(1), Buffer.from([0])]) : data;
    },
  };
  const updater = updaterFor(place, release, { fs: shifty });
  const { manifest } = await updater.check();
  await assert.rejects(updater.apply(manifest), /is not what the release published/);
  assert.equal(fs.existsSync(path.join(place.payloadDir, boot.CURRENT_FILE)), false);
});

// --- which copy a start runs from ---------------------------------------------

const settle = (t, { build = "200", shell = SHELL, attempts = 0, entry = true } = {}) => {
  const payloadDir = path.join(tempDir(t), boot.PAYLOAD_FOLDER);
  const root = path.join(payloadDir, build);
  fs.mkdirSync(path.join(root, "electron"), { recursive: true });
  fs.writeFileSync(path.join(root, boot.MANIFEST_FILE), JSON.stringify({ build }));
  if (entry) fs.writeFileSync(path.join(root, "electron", "main.cjs"), "");
  boot.writeJsonAtomically(path.join(payloadDir, boot.CURRENT_FILE), { build, shell, attempts });
  return { payloadDir, root };
};

test("a start runs the newer set only when it is finished, newer, for this runtime and has not failed twice", (t) => {
  const good = settle(t);
  assert.deepEqual(boot.choosePayload({ payloadDir: good.payloadDir, bundledBuild: "100", shell: SHELL }), { root: good.root, build: "200", reason: "newer" });
  // An installer run since then brought the same release, or a later one.
  assert.equal(boot.choosePayload({ payloadDir: good.payloadDir, bundledBuild: "200", shell: SHELL }).reason, "installed-is-newer");
  assert.equal(boot.choosePayload({ payloadDir: good.payloadDir, bundledBuild: "300", shell: SHELL }).root, null);
  // Build ids are numbers, not text: 99 is older than 100.
  assert.equal(boot.compareBuilds("99", "100"), -1);
  assert.equal(boot.compareBuilds("1000", "999"), 1);
  assert.equal(boot.compareBuilds("", "1"), -1);
  assert.equal(boot.compareBuilds("7", "7"), 0);
  // Another Electron, or another protocol.
  assert.equal(boot.choosePayload({ payloadDir: good.payloadDir, bundledBuild: "100", shell: { ...SHELL, electron: "45.0.0" } }).reason, "other-runtime");
  assert.equal(boot.choosePayload({ payloadDir: good.payloadDir, bundledBuild: "100", shell: { ...SHELL, protocol: SHELL.protocol + 1 } }).reason, "other-runtime");
  // Nothing there, or not finished.
  assert.equal(boot.choosePayload({ payloadDir: path.join(tempDir(t), "none"), bundledBuild: "100", shell: SHELL }).reason, "none");
  assert.equal(boot.choosePayload({ payloadDir: settle(t, { entry: false }).payloadDir, bundledBuild: "100", shell: SHELL }).reason, "incomplete");
  // A name that is a path is never joined to the folder.
  const sly = settle(t);
  boot.writeJsonAtomically(path.join(sly.payloadDir, boot.CURRENT_FILE), { build: "../200", shell: SHELL });
  assert.equal(boot.choosePayload({ payloadDir: sly.payloadDir, bundledBuild: "100", shell: SHELL }).reason, "unreadable");
});

test("a set the app cannot start from is tried twice and then given up on for good", (t) => {
  const { payloadDir, root } = settle(t);
  const choose = () => boot.choosePayload({ payloadDir, bundledBuild: "100", shell: SHELL });
  // Two starts that never reach the game's window.
  assert.equal(choose().root, root);
  boot.beginBoot(payloadDir);
  assert.equal(choose().root, root);
  boot.beginBoot(payloadDir);
  assert.equal(choose().reason, "would-not-start");
  assert.deepEqual(boot.readState(payloadDir).badBuilds, ["200"]);
  assert.equal(choose().reason, "none", "and it is no longer pointed at");

  // A start that does reach the window clears the count.
  const fine = settle(t);
  boot.beginBoot(fine.payloadDir);
  boot.confirmBoot(fine.payloadDir);
  boot.beginBoot(fine.payloadDir);
  boot.confirmBoot(fine.payloadDir);
  boot.beginBoot(fine.payloadDir);
  assert.equal(boot.choosePayload({ payloadDir: fine.payloadDir, bundledBuild: "100", shell: SHELL }).root, fine.root);
});

test("old sets are swept away, and the chunks of an unfinished download are kept", (t) => {
  const { payloadDir } = settle(t);
  for (const name of ["150", "staging", "chunks"]) fs.mkdirSync(path.join(payloadDir, name), { recursive: true });
  boot.sweep(payloadDir, "200");
  assert.deepEqual(fs.readdirSync(payloadDir).sort(), ["200", "chunks", boot.CURRENT_FILE].sort());
  boot.sweep(payloadDir, "");
  assert.deepEqual(fs.readdirSync(payloadDir).sort(), ["chunks", boot.CURRENT_FILE].sort());
  boot.sweep(path.join(payloadDir, "missing"), "");
});

// --- one updater in front of the two -------------------------------------------

const fakeInstaller = ({ available = true, version = "0.0.200" } = {}) => {
  const installer = new EventEmitter();
  installer.calls = [];
  installer.checkForUpdates = async () => {
    installer.calls.push("check");
    return { isUpdateAvailable: available, updateInfo: { version } };
  };
  installer.downloadUpdate = async () => {
    installer.calls.push("download");
    installer.emit("download-progress", { percent: 50 });
    installer.emit("update-downloaded", { version });
  };
  installer.quitAndInstall = (...args) => installer.calls.push(`install:${args.join(",")}`);
  return installer;
};
const heard = (updater) => {
  const events = [];
  for (const name of ["checking-for-update", "update-available", "update-not-available", "download-progress", "update-downloaded", "error"]) {
    updater.on(name, (payload) => events.push(payload?.percent !== undefined ? `${name}:${payload.percent}` : name));
  }
  return events;
};
const fakePayload = (answer, { fail = false } = {}) => ({
  calls: [],
  async check() {
    this.calls.push("check");
    if (answer instanceof Error) throw answer;
    return answer;
  },
  async apply(manifest, { onProgress }) {
    this.calls.push("apply");
    onProgress({ phase: "reading", percent: 0 });
    onProgress({ phase: "downloading", percent: 40 });
    if (fail) throw new Error("a chunk failed");
    onProgress({ phase: "downloading", percent: 100 });
    onProgress({ phase: "building", percent: 100 });
    return { root: "somewhere" };
  },
});
const AVAILABLE = { state: "available", build: "200", manifest: { build: "200", version: "0.0.200" } };

test("an update that can be made of chunks is, and the installer is never asked", async () => {
  const installer = fakeInstaller();
  const payload = fakePayload(AVAILABLE);
  let relaunched = 0;
  const updater = createLayeredUpdater({ installer, payload, runningVersion: "0.0.100", relaunch: () => { relaunched += 1; } });
  const events = heard(updater);
  const result = await updater.checkForUpdates();
  assert.deepEqual(result, { isUpdateAvailable: true, updateInfo: { version: "0.0.200" } });
  await updater.downloadUpdate();
  updater.quitAndInstall(true, true);
  // One bar for both halves of the wait: the download is its first 60%, putting the files in place the rest.
  assert.deepEqual(events, ["checking-for-update", "update-available", "download-progress:24", "download-progress:60", "download-progress:100", "update-downloaded"]);
  assert.deepEqual(installer.calls, []);
  assert.equal(relaunched, 1, "restarting is all there is to installing it");
});

test("nothing newer in chunks is nothing newer: the installer's feed is not asked", async () => {
  const installer = fakeInstaller();
  const updater = createLayeredUpdater({ installer, payload: fakePayload({ state: "none", build: "200" }), runningVersion: "0.0.200", relaunch: () => {} });
  const events = heard(updater);
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  assert.deepEqual(events, ["checking-for-update", "update-not-available"]);
  assert.deepEqual(installer.calls, []);
  await assert.rejects(updater.downloadUpdate(), /No update has been found/);
});

test("a release that needs the installer, or chunks that cannot be looked up, goes to the installer", async () => {
  for (const answer of [{ state: "installer", build: "200", reason: "it is built for another version of the runtime" }, new Error("offline")]) {
    const installer = fakeInstaller();
    const updater = createLayeredUpdater({ installer, payload: fakePayload(answer), runningVersion: "0.0.100", relaunch: () => assert.fail("not a restart") });
    const events = heard(updater);
    assert.equal((await updater.checkForUpdates()).isUpdateAvailable, true);
    await updater.downloadUpdate();
    updater.quitAndInstall(true, true);
    assert.deepEqual(events, ["checking-for-update", "update-available", "download-progress:50", "update-downloaded"]);
    assert.deepEqual(installer.calls, ["check", "download", "install:true,true"]);
  }
});

test("the installer's feed offering the release this app already runs is not an update", async () => {
  // After an update made of chunks the installed files are the older ones.
  const installer = fakeInstaller({ version: "0.0.200" });
  const updater = createLayeredUpdater({ installer, payload: fakePayload(new Error("offline")), runningVersion: "0.0.200", relaunch: () => {} });
  const events = heard(updater);
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  assert.deepEqual(events, ["checking-for-update", "update-not-available"]);
});

test("chunks that fail partway fall back to the installer, and without one the update fails", async () => {
  const installer = fakeInstaller();
  const updater = createLayeredUpdater({ installer, payload: fakePayload(AVAILABLE, { fail: true }), runningVersion: "0.0.100", relaunch: () => assert.fail("not a restart") });
  const events = heard(updater);
  await updater.checkForUpdates();
  await updater.downloadUpdate();
  updater.quitAndInstall(true, true);
  assert.deepEqual(installer.calls, ["check", "download", "install:true,true"]);
  assert.deepEqual(events, ["checking-for-update", "update-available", "download-progress:24", "update-available", "download-progress:50", "update-downloaded"]);

  const alone = createLayeredUpdater({ installer: null, payload: fakePayload(AVAILABLE, { fail: true }), runningVersion: "0.0.100", relaunch: () => {} });
  const lonely = heard(alone);
  await alone.checkForUpdates();
  await assert.rejects(alone.downloadUpdate(), /a chunk failed/);
  assert.equal(lonely.at(-1), "error");
});

test("with no installer that can run in place, chunks are still an update", async () => {
  let relaunched = 0;
  const updater = createLayeredUpdater({ installer: null, payload: fakePayload(AVAILABLE), runningVersion: "0.0.100", relaunch: () => { relaunched += 1; } });
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, true);
  await updater.downloadUpdate();
  updater.quitAndInstall();
  assert.equal(relaunched, 1);
  const none = createLayeredUpdater({ installer: null, payload: fakePayload({ state: "installer", build: "200", reason: "runtime" }), relaunch: () => {} });
  assert.equal((await none.checkForUpdates()).isUpdateAvailable, false);
});
