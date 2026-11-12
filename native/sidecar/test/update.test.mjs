import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createUpdater } = await import(pathToFileURL(path.resolve(here, "..", "handlers", "update.mjs")).href);
const kit = await import(pathToFileURL(path.resolve(here, "..", "updateChunks.mjs")).href);
const { BUILD_A, BUILD_B, buildTools, makeFixture, treeHashes } = await import(pathToFileURL(path.join(here, "update-fixture.mjs")).href);
const { startFeedServer } = await import(pathToFileURL(path.join(here, "update-feed-server.mjs")).href);

const windows = process.platform === "win32";
const work = fs.mkdtempSync(path.join(process.env.OH_UPDATE_TEST_DIR || os.tmpdir(), "oh-native-update-"));
let tools = null;
const lines = [];

const updaterFor = (fixture, install, data, { current = { version: "0.1.0", build: BUILD_A }, feedUrl }) => createUpdater({
  current,
  manifestUrl: feedUrl,
  downloadDir: path.join(data, "updates"),
  recordFile: path.join(data, "launch-update.json"),
  installRoot: install,
  log: (level, message) => lines.push(`${level}: ${message}`),
  retryDelayMs: 20,
  stallMs: 5000,
});

const waitFor = async (updater, states, seconds = 60) => {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    await updater.idle();
    const now = updater.snapshot();
    if (states.includes(now.state)) return now;
    if (Date.now() > deadline) throw new Error(`still ${now.state}: ${now.error}`);
    await new Promise((done) => setTimeout(done, 50));
  }
};

const runExe = (file, args) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code));
});

const waitForMarker = async (file, seconds = 60) => {
  const deadline = Date.now() + seconds * 1000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`${file} never appeared`);
    await new Promise((done) => setTimeout(done, 200));
  }
};

const prepare = async (name, options = {}) => {
  const fixture = makeFixture(path.join(work, name), { tools, ...options });
  const install = path.join(fixture.root, "install");
  fs.cpSync(fixture.a, install, { recursive: true });
  const data = path.join(fixture.root, "data");
  const feed = await startFeedServer({ dir: fixture.release, log: (line) => lines.push(`feed: ${line}`) });
  return { fixture, install, data, feed };
};

before(() => {
  if (windows) tools = buildTools(path.join(work, "tools"));
});

after(() => {
  if (process.env.OH_UPDATE_TEST_KEEP !== "1") fs.rmSync(work, { recursive: true, force: true });
  if (process.env.OH_UPDATE_TEST_LOG) fs.writeFileSync(process.env.OH_UPDATE_TEST_LOG, `${lines.join("\n")}\n`);
});

describe("native chunked updates", { skip: !windows && "the updater is a Windows program" }, () => {
  test("the same stage is always cut into the same chunks, and a script edit changes only its pack", () => {
    const fixture = makeFixture(path.join(work, "cut"), { tools });
    const a = kit.readInstalledManifest(fixture.a);
    const b = kit.readInstalledManifest(fixture.b);
    const again = kit.planPayload(kit.stageEntries(fixture.b).filter((entry) => entry.path !== kit.INSTALLED_MANIFEST), { build: BUILD_B, version: "0.1.1" }).manifest;
    assert.deepEqual(Object.keys(again.chunks).sort(), Object.keys(b.chunks).sort());
    const fresh = Object.keys(b.chunks).filter((id) => !Object.hasOwn(a.chunks, id));
    assert.ok(fresh.length <= 4, `${fresh.length} new chunks`);
    assert.equal(kit.readManifest(b).error, "");
    assert.match(kit.readManifest({ ...b, files: [{ ...b.files[0], path: "../evil.dll" }] }).error, /leaves the app's folder/);
    assert.match(kit.readManifest({ ...b, files: [{ ...b.files[0], path: "uninstall.ps1" }] }).error, /may not write/);
  });

  test("a newer build with one script changed downloads only that script's pieces, then up to date", async () => {
    const { fixture, install, data, feed } = await prepare("newer");
    try {
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      const manual = await updater.check({ manual: true });
      assert.equal(manual.status, "available");
      assert.equal(manual.kind, "chunks");
      assert.ok(manual.downloadBytes > 0 && manual.downloadBytes < manual.fullBytes / 50, `${manual.downloadBytes} of ${manual.fullBytes}`);
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "chunks");
      assert.equal(done.staged, BUILD_B);
      assert.equal(done.downloadBytes, manual.downloadBytes);
      assert.ok(!feed.requests.some((request) => request.path.startsWith("/setup/")), "the installer was not fetched");
      const stage = path.join(data, "updates", "staged", BUILD_B);
      const plan = fs.readFileSync(path.join(stage, "apply.txt"), "utf8");
      assert.match(plan, /put\tnative\/godot\/scripts\/s07\.gd/);
      assert.match(plan, /put\tnative\/godot\/scripts\/added\.gd/);
      assert.match(plan, /remove\told\.txt/);
      assert.doesNotMatch(plan, /node\.exe|oh_gdext\.dll|theme\.mp3/);
      lines.push(`measured: ${done.downloadBytes} bytes fetched for B, the installer is ${fixture.setupSize}, B is ${fixture.chunks.manifest.bytes} bytes in ${fixture.chunks.chunkCount} chunks`);

      const restarted = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      assert.equal(restarted.snapshot().state, "ready", "a stage left by the last run is picked up at the next start");
      const atLaunch = await restarted.launch();
      assert.equal(atLaunch.update, true);
      assert.equal(atLaunch.staged, true, "and installed at once from the launch screen");
      assert.equal(restarted.download({ launch: true }).already, true);

      const latest = updaterFor(fixture, install, data, { current: { version: "0.1.1", build: BUILD_B }, feedUrl: feed.feedUrl });
      const current = await latest.check({ manual: true });
      assert.equal(current.status, "current");
    } finally {
      await feed.close();
    }
  });

  test("a corrupt piece is retried and then the full installer is downloaded instead", async () => {
    const { fixture, install, data, feed } = await prepare("corrupt");
    try {
      feed.knobs.corrupt = "all";
      feed.knobs.corruptTimes = -1;
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "full");
      const first = feed.requests.find((request) => request.path.startsWith("/chunks/c-"));
      const tries = feed.requests.filter((request) => request.path === first.path).length;
      assert.equal(tries, 3, "the bad piece was asked for three times");
      assert.ok(feed.requests.some((request) => request.path.startsWith("/setup/")), "the installer was fetched");
      assert.ok(fs.existsSync(path.join(data, "updates", "setup", BUILD_B, "Open-Historia-Native-Setup.exe")));
    } finally {
      await feed.close();
    }
  });

  test("a piece corrupted once is fetched again and the chunk path still wins", async () => {
    const { fixture, install, data, feed } = await prepare("corrupt-once");
    try {
      feed.knobs.corrupt = "all";
      feed.knobs.corruptTimes = 1;
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "chunks");
      assert.ok(lines.some((line) => /attempt 1 of 3 failed: .*not the piece/.test(line)));
    } finally {
      await feed.close();
    }
  });

  test("an interrupted download resumes where it stopped", async () => {
    const { fixture, install, data, feed } = await prepare("resume");
    try {
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      await updater.check({ manual: true });
      const manifest = kit.readInstalledManifest(fixture.b);
      const plan = kit.planUpdate(manifest, await kit.indexInstalled(install));
      const biggest = plan.fetch.map((id) => [id, kit.wireSize(manifest, id)]).sort((x, y) => y[1] - x[1])[0];
      feed.knobs.cut = kit.chunkAssetName(biggest[0]);
      feed.knobs.cutAfter = Math.floor(biggest[1] / 2);
      feed.knobs.cutTimes = 1;
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "chunks");
      const asks = feed.requests.filter((request) => request.path === `/chunks/${feed.knobs.cut}`);
      assert.equal(asks.length, 2);
      assert.equal(asks[1].range, `bytes=${feed.knobs.cutAfter}-`);
    } finally {
      await feed.close();
    }
  });

  test("applying at quit swaps in only the changed files, and the next start confirms it", async () => {
    const { fixture, install, data, feed } = await prepare("apply");
    try {
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      updater.download();
      assert.equal((await waitFor(updater, ["ready", "error"])).state, "ready");
      const untouched = fs.statSync(path.join(install, "runtime", "node.exe")).mtimeMs;
      const started = await updater.install({ relaunch: false });
      assert.equal(started.kind, "staged");
      const stage = path.join(data, "updates", "staged", BUILD_B);
      await waitForMarker(path.join(stage, "applied"));
      await new Promise((done) => setTimeout(done, 1500));
      assert.deepEqual(treeHashes(install), treeHashes(fixture.b));
      assert.equal(kit.readInstalledManifest(install).build, BUILD_B);
      assert.equal(fs.statSync(path.join(install, "runtime", "node.exe")).mtimeMs, untouched);
      assert.ok(fs.existsSync(path.join(stage, "previous", "old.txt")));

      const next = updaterFor(fixture, install, data, { current: { version: "0.1.1", build: BUILD_B, notes: "B brings a changed script." }, feedUrl: feed.feedUrl });
      assert.equal(next.snapshot().justUpdated.build, BUILD_B);
      assert.equal((await next.launch()).update, false);
      assert.equal(next.confirm().confirmed, true);
      assert.ok(!fs.existsSync(stage), "the stage is deleted once the new start is confirmed");
    } finally {
      await feed.close();
    }
  });

  test("a start that never confirms is rolled back to the previous files", async () => {
    const { fixture, install, data, feed } = await prepare("rollback");
    try {
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      updater.download();
      assert.equal((await waitFor(updater, ["ready", "error"])).state, "ready");
      await updater.install({ relaunch: false });
      const stage = path.join(data, "updates", "staged", BUILD_B);
      await waitForMarker(path.join(stage, "applied"));
      await new Promise((done) => setTimeout(done, 1500));
      const asB = { current: { version: "0.1.1", build: BUILD_B }, feedUrl: feed.feedUrl };
      updaterFor(fixture, install, data, asB);
      updaterFor(fixture, install, data, asB);
      const third = updaterFor(fixture, install, data, asB);
      const told = await third.launch();
      assert.equal(told.rollback, true);
      assert.equal(third.confirm().confirmed, false);
      const rolling = await third.rollback({ relaunch: false });
      assert.ok(rolling.rollingBack);
      await waitForMarker(path.join(stage, "rolled-back"));
      await new Promise((done) => setTimeout(done, 1500));
      assert.deepEqual(treeHashes(install), treeHashes(fixture.a));
      const back = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      assert.equal(back.snapshot().rolledBack, BUILD_B);
      assert.ok(!fs.existsSync(stage));
      await back.check();
      back.download();
      const again = await waitFor(back, ["ready", "error"]);
      assert.equal(again.kind, "full", "a build that was rolled back comes by the installer");
      assert.equal((await back.launch()).update, false, "and not at launch");
    } finally {
      await feed.close();
    }
  });

  test("a relaunch that exits with an error is rolled back by the updater itself", async () => {
    const { fixture, install, data, feed } = await prepare("broken-start", { breakGame: true });
    try {
      const updater = updaterFor(fixture, install, data, { feedUrl: feed.feedUrl });
      updater.download();
      assert.equal((await waitFor(updater, ["ready", "error"])).state, "ready");
      const stage = path.join(data, "updates", "staged", BUILD_B);
      await updater.install({ relaunch: true });
      await waitForMarker(path.join(stage, "rolled-back"), 90);
      await new Promise((done) => setTimeout(done, 2500));
      assert.deepEqual(treeHashes(install), treeHashes(fixture.a));
    } finally {
      await feed.close();
    }
  });

  test("the updater refuses a stage whose plan writes outside the install", async () => {
    const root = path.join(work, "escape");
    const install = path.join(root, "install");
    const stage = path.join(root, "stage");
    fs.mkdirSync(path.join(stage, "files"), { recursive: true });
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(path.join(install, ".oh-native-install"), "x");
    fs.writeFileSync(path.join(root, "outside.txt"), "mine");
    fs.writeFileSync(path.join(stage, "files", "x.txt"), "evil");
    fs.writeFileSync(path.join(stage, "ready"), "1");
    fs.writeFileSync(path.join(stage, "apply.txt"), `install\t${install}\r\nbuild\t1\r\nput\t../outside.txt\r\n`);
    const code = await runExe(tools.updater, ["--apply-staged", stage, "--no-relaunch"]);
    assert.notEqual(code, 0);
    assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "mine");
  });
});
