import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecar = path.resolve(here, "..");
const update = await import(pathToFileURL(path.join(sidecar, "handlers", "update.mjs")).href);
const kit = await import(pathToFileURL(path.join(sidecar, "updateChunks.mjs")).href);
const paths = await import(pathToFileURL(path.join(sidecar, "dataPaths.mjs")).href);
const linuxUpdater = await import(pathToFileURL(path.join(sidecar, "linuxUpdater.mjs")).href);
const { startFeedServer } = await import(pathToFileURL(path.join(here, "update-feed-server.mjs")).href);

const BUILD_A = "20261028100000";
const BUILD_B = "20261028110000";
const FOLDER = "Open Historia Native";
const linux = process.platform === "linux";
const work = fs.realpathSync(fs.mkdtempSync(path.join(process.env.OH_UPDATE_TEST_DIR || os.tmpdir(), "oh-native-update-linux-")));
const lines = [];

after(() => {
  if (process.env.OH_UPDATE_TEST_KEEP !== "1") fs.rmSync(work, { recursive: true, force: true });
  if (process.env.OH_UPDATE_TEST_LOG) fs.writeFileSync(process.env.OH_UPDATE_TEST_LOG, `${lines.join("\n")}\n`);
});

const write = (root, relative, data) => {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const random = (bytes, seed) => {
  const out = Buffer.alloc(bytes);
  let block = crypto.createHash("sha256").update(seed).digest();
  for (let at = 0; at < bytes; at += 32) {
    block.copy(out, at);
    block = crypto.createHash("sha256").update(block).digest();
  }
  return out;
};

const fakeSpawn = (calls) => (file, args, options) => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => {};
  calls.push({ file, args, options });
  setImmediate(() => child.emit("spawn"));
  return child;
};

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

const linuxFixture = (name) => {
  const root = path.join(work, name);
  fs.rmSync(root, { recursive: true, force: true });
  const a = path.join(root, "A");
  write(a, "runtime/node", random(3 * 1024 * 1024, "node"));
  write(a, "runtime/Open Historia.pck", random(2 * 1024 * 1024, "pck"));
  write(a, "runtime/Open Historia.x86_64", "#!/bin/sh\nexit 0\n");
  write(a, update.LINUX_UPDATER, fs.readFileSync(path.join(sidecar, "linuxUpdater.mjs")));
  for (let index = 0; index < 20; index += 1) write(a, `native/godot/scripts/s${String(index).padStart(2, "0")}.gd`, `extends Node\n# ${index}\n${"var x := 1\n".repeat(200 + index)}`);
  write(a, "native/godot/version.json", JSON.stringify({ version: "0.1.0", build: BUILD_A }));
  write(a, "old.txt", "gone in B\n");
  write(a, ".oh-native-install", "A\n");
  kit.writeRelease({ stage: a, out: path.join(root, "a-chunks"), details: { build: BUILD_A, version: "0.1.0", platform: "linux" } });

  const b = path.join(root, "B");
  fs.cpSync(a, b, { recursive: true });
  fs.rmSync(path.join(b, kit.INSTALLED_MANIFEST));
  fs.rmSync(path.join(b, "old.txt"));
  write(b, "native/godot/scripts/s07.gd", `extends Node\n# changed in B\n${"var y := 2\n".repeat(220)}`);
  write(b, "native/godot/scripts/added.gd", "extends Node\n");
  write(b, "native/godot/version.json", JSON.stringify({ version: "0.1.1", build: BUILD_B }));
  const others = path.join(root, "B-others");
  fs.cpSync(b, others, { recursive: true });

  const release = path.join(root, "release");
  const chunks = kit.writeRelease({ stage: b, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1", platform: "linux" } });
  const macChunks = kit.writeRelease({ stage: others, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1", platform: "macos" } });
  const winChunks = kit.writeRelease({ stage: others, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1" } });
  const archive = random(4 * 1024 * 1024, "archive");
  write(release, update.NATIVE_LINUX_ARCHIVE_NAME, archive);
  write(release, update.NATIVE_MAC_ZIP_NAME, archive);
  write(release, update.NATIVE_SETUP_NAME, archive);
  const feed = (platform, list) => ({
    version: "0.1.1",
    build: BUILD_B,
    sha256: kit.sha256(archive),
    size: archive.length,
    url: "https://example.invalid/x",
    notes: "B",
    ...(platform ? { platform } : {}),
    chunks: kit.feedChunks(list, "https://example.invalid/"),
  });
  write(release, update.NATIVE_LINUX_MANIFEST_NAME, JSON.stringify(feed("linux", chunks)));
  write(release, update.NATIVE_MAC_MANIFEST_NAME, JSON.stringify(feed("macos", macChunks)));
  write(release, update.NATIVE_MANIFEST_NAME, JSON.stringify(feed("", winChunks)));

  const install = path.join(root, "games", FOLDER);
  fs.cpSync(a, install, { recursive: true });
  return { root, a, b, release, install, data: path.join(root, "data"), chunks, macChunks, winChunks };
};

const updaterFor = (fixture, feedUrl, calls, extra = {}) => update.createUpdater({
  current: { version: "0.1.0", build: BUILD_A },
  manifestUrl: feedUrl,
  downloadDir: path.join(fixture.data, "updates"),
  recordFile: path.join(fixture.data, "launch-update.json"),
  installRoot: fixture.install,
  platform: "linux",
  nodePath: "/fake/node",
  waitPids: [111, 222],
  spawnImpl: fakeSpawn(calls),
  log: (level, message) => lines.push(`${level}: ${message}`),
  retryDelayMs: 20,
  stallMs: 5000,
  ...extra,
});

describe("the Linux feed and paths (any system)", () => {
  test("each system reads its own feed; the Windows and macOS feed names are unchanged", () => {
    assert.equal(update.manifestUrlFor({}, "linux"), update.NATIVE_LINUX_UPDATE_MANIFEST);
    assert.equal(update.manifestUrlFor({}, "darwin"), update.NATIVE_MAC_UPDATE_MANIFEST);
    assert.equal(update.manifestUrlFor({}, "win32"), update.NATIVE_UPDATE_MANIFEST);
    assert.match(update.NATIVE_LINUX_UPDATE_MANIFEST, /\/native-experimental\/native-latest-linux\.json$/);
    assert.match(update.NATIVE_LINUX_ARCHIVE_URL, /\/native-experimental\/Open-Historia-Native-Linux-x86_64\.tar\.gz$/);
    assert.match(update.NATIVE_UPDATE_MANIFEST, /\/native-experimental\/native-latest\.json$/);
    assert.match(update.NATIVE_MAC_UPDATE_MANIFEST, /\/native-experimental\/native-latest-mac\.json$/);
    assert.equal(update.manifestUrlFor({ OH_STANDIN_MODEL: "1" }, "linux"), "");
    assert.equal(update.feedPlatformFor("linux"), "linux");
    assert.equal(update.feedPlatformFor("darwin"), "macos");
    assert.equal(update.feedPlatformFor("win32"), "windows");
  });

  test("the Linux file list carries its own prefix, and no other system parses a Linux feed", () => {
    const fixture = linuxFixture("names");
    assert.match(fixture.chunks.manifestName, /^linux-m-[0-9a-f]{40}\.json$/);
    assert.match(fixture.macChunks.manifestName, /^mac-m-[0-9a-f]{40}\.json$/);
    assert.match(fixture.winChunks.manifestName, /^m-[0-9a-f]{40}\.json$/);
    assert.equal(kit.manifestAssetName("a".repeat(64), "linux"), `linux-m-${"a".repeat(40)}.json`);
    assert.equal(fixture.chunks.manifest.platform, "linux");
    const read = (name) => JSON.parse(fs.readFileSync(path.join(fixture.release, name), "utf8"));
    const linuxFeed = read(update.NATIVE_LINUX_MANIFEST_NAME);
    assert.equal(update.parseManifest(linuxFeed, { platform: "linux" }).chunks.manifest.name, fixture.chunks.manifestName);
    assert.equal(update.parseManifest(linuxFeed, { platform: "windows" }), null);
    assert.equal(update.parseManifest(linuxFeed, { platform: "macos" }), null);
    assert.equal(update.parseManifest(read(update.NATIVE_MANIFEST_NAME), { platform: "linux" }), null);
    assert.equal(update.parseManifest(read(update.NATIVE_MAC_MANIFEST_NAME), { platform: "linux" }), null);
    const unprefixed = { ...linuxFeed, chunks: { ...linuxFeed.chunks, manifest: { ...linuxFeed.chunks.manifest, name: kit.manifestAssetName(linuxFeed.chunks.manifest.sha256) } } };
    assert.equal(update.parseManifest(unprefixed, { platform: "linux" }).chunks, null, "a Linux feed naming an unprefixed list gets no chunks");
  });

  test("Linux data lives under XDG_DATA_HOME; the map is shared from the official app's Linux folder", () => {
    const plain = paths.nativeDataPaths({ platform: "linux", env: {}, home: "/home/tester" });
    assert.equal(plain.dataRoot, "/home/tester/.local/share/Open Historia Native");
    assert.equal(plain.dataDir, "/home/tester/.local/share/Open Historia Native/server/data");
    assert.equal(plain.cacheDir, "/home/tester/.local/share/Open Historia Native/native-cache");
    assert.equal(plain.ownAssets, "/home/tester/.local/share/Open Historia Native/public/assets");
    assert.equal(plain.stableAssets, "/home/tester/.config/open-historia/public/assets");
    assert.equal(plain.stablePublic, "/home/tester/.config/open-historia/public");
    const xdg = paths.nativeDataPaths({ platform: "linux", env: { XDG_DATA_HOME: "/data/x", XDG_CONFIG_HOME: "/conf/y" }, home: "/home/tester" });
    assert.equal(xdg.dataRoot, "/data/x/Open Historia Native");
    assert.equal(xdg.stableAssets, "/conf/y/open-historia/public/assets");
    assert.equal(paths.nativeDataPaths({ platform: "linux", env: { XDG_DATA_HOME: "relative/path" }, home: "/home/t" }).dataRoot, "/home/t/.local/share/Open Historia Native", "a relative XDG_DATA_HOME is ignored");
    assert.equal(paths.nativeDataPaths({ platform: "linux", env: { OH_NATIVE_ROOT: "/tmp/x" }, home: "/home/t" }).cacheDir, "/tmp/x/native-cache");
    assert.equal(paths.nativeDataPaths({ platform: "darwin", env: { XDG_DATA_HOME: "/data/x" }, home: "/Users/t" }).dataRoot, "/Users/t/Library/Application Support/Open Historia Native");
    assert.equal(paths.nativeDataPaths({ platform: "win32", env: { APPDATA: "C:\\R", XDG_DATA_HOME: "/data/x" }, home: "C:\\Users\\t" }).dataRoot, "C:\\R\\Open Historia Native");
  });

  test("Linux downloads only the changed pieces of its own list and hands them to the bundled node", async () => {
    const fixture = linuxFixture("staged");
    const feed = await startFeedServer({ dir: fixture.release, log: (line) => lines.push(`feed: ${line}`) });
    try {
      const calls = [];
      const updater = updaterFor(fixture, `${feed.address}/${update.NATIVE_LINUX_MANIFEST_NAME}`, calls);
      assert.equal(updater.snapshot().canInstall, true);
      assert.equal(updater.snapshot().downloadUrl, update.NATIVE_LINUX_ARCHIVE_URL);
      const manual = await updater.check({ manual: true });
      assert.equal(manual.status, "available");
      assert.equal(manual.kind, "chunks");
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "chunks");
      assert.ok(feed.requests.some((request) => request.path === `/chunks/${fixture.chunks.manifestName}`), "the Linux file list was read");
      assert.ok(!feed.requests.some((request) => request.path === `/chunks/${fixture.winChunks.manifestName}` || request.path === `/chunks/${fixture.macChunks.manifestName}`), "no other system's file list was read");
      assert.ok(!feed.requests.some((request) => request.path.startsWith("/setup/")), "the archive was not fetched");
      const stage = path.join(fixture.data, "updates", "staged", BUILD_B);
      const plan = fs.readFileSync(path.join(stage, "apply.txt"), "utf8");
      assert.ok(plan.includes(`install\t${fixture.install}`));
      assert.match(plan, /put\tnative\/godot\/scripts\/s07\.gd/);
      assert.match(plan, /remove\told\.txt/);
      assert.doesNotMatch(plan, /runtime\/node|\.pck/);
      const result = await updater.install({});
      assert.equal(result.kind, "staged");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].file, "/fake/node");
      assert.deepEqual(calls[0].args, [path.join(stage, "updater.mjs"), "--apply-staged", stage, "--wait", "111,222"]);
      assert.equal(fs.readFileSync(path.join(stage, "updater.mjs"), "utf8"), fs.readFileSync(path.join(sidecar, "linuxUpdater.mjs"), "utf8"));
    } finally {
      await feed.close();
    }
  });

  test("each system refuses the others' feeds", async () => {
    const fixture = linuxFixture("crossed");
    const feed = await startFeedServer({ dir: fixture.release });
    try {
      const onLinux = (name) => updaterFor(fixture, `${feed.address}/${name}`, []);
      assert.equal((await onLinux(update.NATIVE_MANIFEST_NAME).check({ manual: true })).status, "error");
      assert.equal((await onLinux(update.NATIVE_MAC_MANIFEST_NAME).check({ manual: true })).status, "error");
      for (const platform of ["win32", "darwin"]) {
        const other = updaterFor(fixture, `${feed.address}/${update.NATIVE_LINUX_MANIFEST_NAME}`, [], { platform });
        assert.equal((await other.check({ manual: true })).status, "error", `${platform} read the Linux feed`);
      }
    } finally {
      await feed.close();
    }
  });

  test("when the pieces cannot be had, the whole archive is downloaded and handed to the updater", async () => {
    const fixture = linuxFixture("full");
    const feed = await startFeedServer({ dir: fixture.release });
    try {
      feed.knobs.missing = fixture.chunks.manifestName;
      const calls = [];
      const updater = updaterFor(fixture, `${feed.address}/${update.NATIVE_LINUX_MANIFEST_NAME}`, calls);
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "full");
      assert.ok(feed.requests.some((request) => request.path === `/setup/${update.NATIVE_LINUX_ARCHIVE_NAME}`));
      await updater.install({ relaunch: false });
      const archive = path.join(fixture.data, "updates", "setup", BUILD_B, update.NATIVE_LINUX_ARCHIVE_NAME);
      assert.deepEqual(calls[0].args, [path.join(path.dirname(archive), "updater.mjs"), "--update", fixture.install, "--archive", archive, "--no-relaunch", "--wait", "111,222"]);
      assert.equal(fs.readFileSync(path.join(path.dirname(archive), "updater.mjs"), "utf8"), fs.readFileSync(path.join(sidecar, "linuxUpdater.mjs"), "utf8"));
    } finally {
      await feed.close();
    }
  });

  test("a folder without the installation marker is not offered an in-place update", () => {
    const fixture = linuxFixture("missing-marker");
    fs.rmSync(path.join(fixture.install, ".oh-native-install"));
    assert.equal(updaterFor(fixture, "http://127.0.0.1:9/native-latest-linux.json", []).snapshot().canInstall, false);
  });

  test("a start that is confirmed removes the previous folder kept beside it, and nothing else", () => {
    const fixture = linuxFixture("confirm");
    const stage = path.join(fixture.data, "updates", "staged", BUILD_A);
    const holder = path.join(path.dirname(fixture.install), `.oh-previous-${BUILD_A}`);
    write(holder, `${FOLDER}/old.txt`, "old");
    write(stage, "applied", BUILD_A);
    write(stage, "previous-app", holder);
    const updater = updaterFor(fixture, "http://127.0.0.1:9/native-latest-linux.json", []);
    assert.equal(updater.confirm().confirmed, true);
    assert.equal(fs.existsSync(holder), false);

    const outside = path.join(fixture.root, "keep-me");
    write(outside, "file.txt", "x");
    write(stage, "applied", BUILD_A);
    write(stage, "previous-app", outside);
    const again = updaterFor(fixture, "http://127.0.0.1:9/native-latest-linux.json", []);
    assert.equal(again.confirm().confirmed, true);
    assert.equal(fs.existsSync(path.join(outside, "file.txt")), true);
  });

  test("the updater's arguments and plan reading", () => {
    assert.deepEqual(linuxUpdater.parseArgs(["--apply-staged", "/s", "--no-relaunch", "--wait", "1,2,x"]), { mode: "apply", stage: "/s", install: "", archive: "", relaunch: false, wait: [1, 2] });
    assert.deepEqual(linuxUpdater.parseArgs(["--update", "/g", "--archive", "/a.tar.gz"]).archive, "/a.tar.gz");
    assert.throws(() => linuxUpdater.inside("/root", "../x"), /outside/);
    assert.throws(() => linuxUpdater.inside("/root", "a\\b"), /outside/);
    assert.equal(linuxUpdater.isHolderName(".oh-previous-20261028110000"), true);
    assert.equal(linuxUpdater.isHolderName(FOLDER), false);
    assert.equal(linuxUpdater.gameOf("/g"), path.join("/g", "runtime", "Open Historia.x86_64"));
  });
});

const sh = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
};

describe("the Linux updater on a real folder", { skip: !linux && "needs Linux" }, () => {
  const launched = [];
  const GAME = '#!/bin/sh\nhere="$(dirname "$0")"\nif [ "$(cat "$here/../mode.txt")" = fail ]; then exit 3; fi\nsleep 20\n';
  const readText = (app, relative) => fs.readFileSync(path.join(app, ...relative.split("/")), "utf8");
  const modeOf = (file) => fs.statSync(file).mode & 0o777;

  const makeApp = (parent, build, { mode = "ok", text = "A" } = {}) => {
    const app = path.join(parent, FOLDER);
    fs.rmSync(app, { recursive: true, force: true });
    write(app, ".oh-native-install", "x\n");
    write(app, "native/godot/version.json", JSON.stringify({ version: build === BUILD_A ? "0.1.0" : "0.1.1", build }));
    write(app, linuxUpdater.GAME_EXE, GAME);
    fs.chmodSync(linuxUpdater.gameOf(app), 0o755);
    write(app, "runtime/helper", "#!/bin/sh\nexit 0\n");
    fs.chmodSync(path.join(app, "runtime", "helper"), 0o755);
    write(app, "data/a.txt", text);
    write(app, "old.txt", "old\n");
    write(app, "mode.txt", mode);
    fs.symlinkSync("data/a.txt", path.join(app, "link-to-a"));
    return app;
  };

  const makeStage = (name, app, build, puts, removes = []) => {
    const stage = path.join(work, "stages", name);
    fs.rmSync(stage, { recursive: true, force: true });
    for (const [relative, data] of Object.entries(puts)) write(path.join(stage, "files"), relative, data);
    const rows = [`install\t${app}`, `build\t${build}`, `from\t${BUILD_A}`, ...Object.keys(puts).map((relative) => `put\t${relative}`), ...removes.map((relative) => `remove\t${relative}`), ""];
    write(stage, "apply.txt", rows.join("\r\n"));
    write(stage, "ready", build);
    return stage;
  };

  const updaterWith = (extra = {}) => linuxUpdater.createLinuxUpdater({
    log: (message) => lines.push(`linux: ${message}`),
    launchApp: async (app) => {
      const child = spawn(linuxUpdater.gameOf(app), [], { stdio: "ignore" });
      launched.push(child);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return child.pid;
    },
    watchSeconds: 30,
    ...extra,
  });

  const stopLaunched = () => {
    for (const child of launched.splice(0)) {
      try {
        child.kill("SIGKILL");
      } catch {
        void 0;
      }
    }
  };

  after(stopLaunched);

  test("a staged update is applied to a copy and swapped in, keeping modes and links; then rolled back", async () => {
    const parent = path.join(work, "apps", "apply");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("apply", app, BUILD_B, {
      "data/a.txt": "B",
      "data/new.txt": "new",
      "runtime/helper": "#!/bin/sh\nexit 1\n",
      "runtime/new-tool": "#!/bin/sh\nexit 0\n",
      "native/godot/version.json": JSON.stringify({ version: "0.1.1", build: BUILD_B }),
    }, ["old.txt"]);
    const updater = updaterWith();
    const running = updater.apply({ stage, relaunch: true, wait: [] });
    const deadline = Date.now() + 30000;
    while (!(launched.length && fs.existsSync(path.join(stage, "applied"))) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(stage, "confirmed"), BUILD_B);
    assert.equal(await running, 0, lines.slice(-8).join("\n"));
    stopLaunched();
    assert.equal(readText(app, "data/a.txt"), "B");
    assert.equal(readText(app, "data/new.txt"), "new");
    assert.equal(readText(app, "link-to-a"), "B", "the link still points inside the folder");
    assert.equal(fs.lstatSync(path.join(app, "link-to-a")).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(app, "old.txt")), false);
    assert.equal(modeOf(path.join(app, "runtime", "helper")), 0o755);
    assert.equal(modeOf(path.join(app, "runtime", "new-tool")) & 0o111, 0o111, "a new script is executable");
    assert.equal(modeOf(path.join(app, "data", "new.txt")) & 0o111, 0, "a new data file is not");
    const holder = fs.readFileSync(path.join(stage, "previous-app"), "utf8");
    assert.equal(readText(path.join(holder, FOLDER), "data/a.txt"), "A");
    assert.deepEqual(fs.readdirSync(parent).filter((name) => name.startsWith(".oh-update-")), []);

    assert.equal(await updater.rollback({ stage, relaunch: false, wait: [] }), 0);
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.equal(readText(app, "old.txt"), "old\n");
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.equal(fs.existsSync(path.join(stage, "applied")), false);
    assert.equal(fs.existsSync(holder), false);
    assert.deepEqual(fs.readdirSync(parent), [FOLDER]);
  });

  test("a new version that closes before it confirms is rolled back and the old one reopened", async () => {
    const parent = path.join(work, "apps", "fail");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("fail", app, BUILD_B, { "mode.txt": "fail", "data/a.txt": "B", "native/godot/version.json": JSON.stringify({ version: "0.1.1", build: BUILD_B }) });
    const code = await updaterWith().apply({ stage, relaunch: true, wait: [] });
    assert.equal(code, 1, lines.slice(-8).join("\n"));
    assert.equal(launched.length, 2, "the new version, then the old one");
    stopLaunched();
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.equal(readText(app, "mode.txt"), "ok");
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.deepEqual(fs.readdirSync(parent), [FOLDER]);
  });

  test("the updater waits for the running game to close, and stops it when it will not", async () => {
    const parent = path.join(work, "apps", "busy");
    const app = makeApp(parent, BUILD_A);
    const game = spawn(linuxUpdater.gameOf(app), [], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const updater = updaterWith();
    assert.ok(updater.running(app, []).includes(game.pid), "the game is found by its folder");
    const stage = makeStage("busy", app, BUILD_B, { "data/a.txt": "B" });
    const exited = new Promise((resolve) => game.once("exit", resolve));
    assert.equal(await updater.apply({ stage, relaunch: false, wait: [game.pid] }), 0, lines.slice(-8).join("\n"));
    await exited;
    assert.equal(readText(app, "data/a.txt"), "B");
  });

  test("the command line applies a stage with the node that runs it", () => {
    const parent = path.join(work, "apps", "cli");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("cli", app, BUILD_B, { "data/a.txt": "B", "native/godot/version.json": JSON.stringify({ version: "0.1.1", build: BUILD_B }) });
    fs.copyFileSync(path.join(sidecar, "linuxUpdater.mjs"), path.join(stage, "updater.mjs"));
    const run = sh(process.execPath, [path.join(stage, "updater.mjs"), "--apply-staged", stage, "--no-relaunch", "--wait", "999999"], { env: { ...process.env, OH_LINUX_UPDATER_QUIET: "1" } });
    assert.ok(run.ok, run.out);
    assert.equal(readText(app, "data/a.txt"), "B");
    assert.ok(fs.existsSync(path.join(stage, "applied")));
  });

  test("a copy that lost its game program leaves the installed folder untouched", async () => {
    const parent = path.join(work, "apps", "broken");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("broken", app, BUILD_B, { "data/a.txt": "B", [linuxUpdater.GAME_EXE]: "not a program" });
    assert.equal(await updaterWith().apply({ stage, relaunch: false, wait: [] }), 1);
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.deepEqual(fs.readdirSync(parent), [FOLDER]);
  });

  test("the full archive is unpacked beside the folder and swapped in", async () => {
    const parent = path.join(work, "apps", "archive");
    const app = makeApp(parent, BUILD_A);
    const source = path.join(work, "apps", "archive-source");
    makeApp(source, BUILD_B, { text: "B" });
    const archive = path.join(work, "apps", update.NATIVE_LINUX_ARCHIVE_NAME);
    const packed = sh("tar", ["-czf", archive, "-C", source, FOLDER]);
    assert.ok(packed.ok, packed.out);
    assert.equal(await updaterWith().update({ install: app, archive, relaunch: false, wait: [] }), 0, lines.slice(-8).join("\n"));
    assert.equal(readText(app, "data/a.txt"), "B");
    assert.equal(modeOf(linuxUpdater.gameOf(app)) & 0o111, 0o111);
    assert.deepEqual(fs.readdirSync(parent), [FOLDER]);
  });

  test("an archive that is not the game leaves the folder alone", async () => {
    const parent = path.join(work, "apps", "bad-archive");
    const app = makeApp(parent, BUILD_A);
    const junk = path.join(work, "apps", "junk");
    write(junk, "something/readme.txt", "hello");
    const archive = path.join(work, "apps", "junk.tar.gz");
    assert.ok(sh("tar", ["-czf", archive, "-C", junk, "something"]).ok);
    assert.equal(await updaterWith().update({ install: app, archive, relaunch: false, wait: [] }), 1);
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.deepEqual(fs.readdirSync(parent), [FOLDER]);
  });
});
