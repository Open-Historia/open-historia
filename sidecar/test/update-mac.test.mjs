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
const macUpdater = await import(pathToFileURL(path.join(sidecar, "macUpdater.mjs")).href);
const { startFeedServer } = await import(pathToFileURL(path.join(here, "update-feed-server.mjs")).href);

const BUILD_A = "20261028100000";
const BUILD_B = "20261028110000";
const APP = "Open Historia Native.app";
const darwin = process.platform === "darwin";
const work = fs.realpathSync(fs.mkdtempSync(path.join(process.env.OH_UPDATE_TEST_DIR || os.tmpdir(), "oh-native-update-mac-")));
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

const plist = ({ build, version = "0.1.0", shell = "" }) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "\t<key>CFBundleExecutable</key>",
  "\t<string>Open Historia</string>",
  "\t<key>CFBundleIdentifier</key>",
  "\t<string>org.openhistoria.native.updatetest</string>",
  "\t<key>CFBundleName</key>",
  "\t<string>Open Historia Native</string>",
  "\t<key>CFBundlePackageType</key>",
  "\t<string>APPL</string>",
  "\t<key>CFBundleShortVersionString</key>",
  `\t<string>${version}</string>`,
  "\t<key>CFBundleVersion</key>",
  `\t<string>${build}</string>`,
  ...(shell ? [`\t<key>${kit.MAC_SHELL_KEY}</key>`, `\t<string>${shell}</string>`] : []),
  "</dict>",
  "</plist>",
  "",
].join("\n");

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

const macFixture = (name, { shell = "shell-1", installedShell = shell } = {}) => {
  const root = path.join(work, name);
  fs.rmSync(root, { recursive: true, force: true });
  const a = path.join(root, "A");
  write(a, "runtime/node", random(3 * 1024 * 1024, "node"));
  write(a, "runtime/Open Historia.pck", random(2 * 1024 * 1024, "pck"));
  write(a, update.MAC_UPDATER, fs.readFileSync(path.join(sidecar, "macUpdater.mjs")));
  for (let index = 0; index < 20; index += 1) write(a, `native/godot/scripts/s${String(index).padStart(2, "0")}.gd`, `extends Node\n# ${index}\n${"var x := 1\n".repeat(200 + index)}`);
  write(a, "native/godot/version.json", JSON.stringify({ version: "0.1.0", build: BUILD_A }));
  write(a, "old.txt", "gone in B\n");
  write(a, ".oh-native-install", "A\n");
  kit.writeRelease({ stage: a, out: path.join(root, "a-chunks"), details: { build: BUILD_A, version: "0.1.0", platform: "macos", shell } });

  const b = path.join(root, "B");
  fs.cpSync(a, b, { recursive: true });
  fs.rmSync(path.join(b, kit.INSTALLED_MANIFEST));
  fs.rmSync(path.join(b, "old.txt"));
  write(b, "native/godot/scripts/s07.gd", `extends Node\n# changed in B\n${"var y := 2\n".repeat(220)}`);
  write(b, "native/godot/scripts/added.gd", "extends Node\n");
  write(b, "native/godot/version.json", JSON.stringify({ version: "0.1.1", build: BUILD_B }));
  const winStage = path.join(root, "B-windows");
  fs.cpSync(b, winStage, { recursive: true });

  const release = path.join(root, "release");
  const chunks = kit.writeRelease({ stage: b, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1", platform: "macos", shell } });
  const winChunks = kit.writeRelease({ stage: winStage, out: path.join(release, "chunks"), details: { build: BUILD_B, version: "0.1.1" } });
  const zip = random(4 * 1024 * 1024, "zip");
  write(release, update.NATIVE_MAC_ZIP_NAME, zip);
  const feed = (platform, list) => ({
    version: "0.1.1",
    build: BUILD_B,
    sha256: kit.sha256(zip),
    size: zip.length,
    url: "https://example.invalid/x",
    notes: "B",
    ...(platform ? { platform } : {}),
    chunks: kit.feedChunks(list, "https://example.invalid/"),
  });
  write(release, update.NATIVE_MAC_MANIFEST_NAME, JSON.stringify(feed("macos", chunks)));
  write(release, update.NATIVE_MANIFEST_NAME, JSON.stringify(feed("", winChunks)));

  const app = path.join(root, "install", APP);
  const install = path.join(app, "Contents", "Resources", "app");
  fs.cpSync(a, install, { recursive: true });
  write(app, "Contents/Info.plist", plist({ build: BUILD_A, shell: installedShell }));
  write(app, "Contents/MacOS/Open Historia", "#!/bin/sh\nexit 0\n");
  return { root, a, b, release, app, install, data: path.join(root, "data"), chunks, winChunks, zipSize: zip.length };
};

const macUpdaterFor = (fixture, feedUrl, calls, extra = {}) => update.createUpdater({
  current: { version: "0.1.0", build: BUILD_A },
  manifestUrl: feedUrl,
  downloadDir: path.join(fixture.data, "updates"),
  recordFile: path.join(fixture.data, "launch-update.json"),
  installRoot: fixture.install,
  platform: "darwin",
  nodePath: "/fake/node",
  waitPids: [111, 222],
  spawnImpl: fakeSpawn(calls),
  log: (level, message) => lines.push(`${level}: ${message}`),
  retryDelayMs: 20,
  stallMs: 5000,
  ...extra,
});

describe("the macOS feed and paths (any system)", () => {
  test("each system reads its own feed; the Windows feed name is unchanged", () => {
    assert.equal(update.manifestUrlFor({}, "darwin"), update.NATIVE_MAC_UPDATE_MANIFEST);
    assert.equal(update.manifestUrlFor({}, "win32"), update.NATIVE_UPDATE_MANIFEST);
    assert.match(update.NATIVE_UPDATE_MANIFEST, /\/native-experimental\/native-latest\.json$/);
    assert.match(update.NATIVE_MAC_UPDATE_MANIFEST, /\/native-experimental\/native-latest-mac\.json$/);
    assert.match(update.NATIVE_MAC_ZIP_URL, /\/native-experimental\/Open-Historia-Native-macOS\.zip$/);
    assert.equal(update.manifestUrlFor({ OH_NATIVE_UPDATE_URL: "http://127.0.0.1:9/native-latest-mac.json" }, "darwin"), "http://127.0.0.1:9/native-latest-mac.json");
    assert.equal(update.manifestUrlFor({ OH_STANDIN_MODEL: "1" }, "darwin"), "");
    assert.equal(update.feedPlatformFor("darwin"), "macos");
    assert.equal(update.feedPlatformFor("win32"), "windows");
  });

  test("the macOS file list carries a prefix, its pieces are shared, and each feed only parses for its system", () => {
    const fixture = macFixture("names");
    assert.match(fixture.chunks.manifestName, /^mac-m-[0-9a-f]{40}\.json$/);
    assert.match(fixture.winChunks.manifestName, /^m-[0-9a-f]{40}\.json$/);
    assert.equal(kit.manifestAssetName("a".repeat(64)), `m-${"a".repeat(40)}.json`);
    assert.equal(kit.manifestAssetName("a".repeat(64), "windows"), `m-${"a".repeat(40)}.json`);
    assert.equal(kit.manifestAssetName("a".repeat(64), "macos"), `mac-m-${"a".repeat(40)}.json`);
    const shared = Object.keys(fixture.chunks.manifest.chunks).filter((id) => Object.hasOwn(fixture.winChunks.manifest.chunks, id));
    assert.equal(shared.length, Object.keys(fixture.chunks.manifest.chunks).length, "the same files cut into the same pieces on both systems");
    assert.equal(fixture.chunks.manifest.platform, "macos");
    assert.equal(fixture.chunks.manifest.shell, "shell-1");

    const macFeed = JSON.parse(fs.readFileSync(path.join(fixture.release, update.NATIVE_MAC_MANIFEST_NAME), "utf8"));
    const winFeed = JSON.parse(fs.readFileSync(path.join(fixture.release, update.NATIVE_MANIFEST_NAME), "utf8"));
    assert.equal(update.parseManifest(macFeed, { platform: "macos" }).chunks.manifest.name, fixture.chunks.manifestName);
    assert.equal(update.parseManifest(macFeed, { platform: "windows" }), null);
    assert.equal(update.parseManifest(winFeed, { platform: "macos" }), null);
    assert.equal(update.parseManifest(winFeed, { platform: "windows" }).chunks.manifest.name, fixture.winChunks.manifestName);
    assert.equal(update.parseManifest(winFeed).platform, "windows");
    const renamed = { ...macFeed, chunks: { ...macFeed.chunks, manifest: { ...macFeed.chunks.manifest, name: kit.manifestAssetName(macFeed.chunks.manifest.sha256) } } };
    assert.equal(update.parseManifest(renamed, { platform: "macos" }).chunks, null, "a macOS feed naming an unprefixed list gets no chunks");
  });

  test("data folders mirror Windows: own root, shared map from the official app's folder", () => {
    const mac = paths.nativeDataPaths({ platform: "darwin", env: {}, home: "/Users/tester" });
    assert.equal(mac.dataRoot, "/Users/tester/Library/Application Support/Open Historia Native");
    assert.equal(mac.dataDir, "/Users/tester/Library/Application Support/Open Historia Native/server/data");
    assert.equal(mac.nativeDir, "/Users/tester/Library/Application Support/Open Historia Native/native");
    assert.equal(mac.cacheDir, "/Users/tester/Library/Application Support/Open Historia Native/native-cache");
    assert.equal(mac.stableAssets, "/Users/tester/Library/Application Support/open-historia/public/assets");
    assert.equal(mac.ownAssets, "/Users/tester/Library/Application Support/Open Historia Native/public/assets");
    assert.equal(paths.nativeDataPaths({ platform: "darwin", env: { APPDATA: "C:\\nope" }, home: "/Users/tester" }).appData, "/Users/tester/Library/Application Support", "APPDATA is a Windows variable");
    const win = paths.nativeDataPaths({ platform: "win32", env: { APPDATA: "C:\\Users\\t\\AppData\\Roaming" }, home: "C:\\Users\\t" });
    assert.equal(win.dataRoot, "C:\\Users\\t\\AppData\\Roaming\\Open Historia Native");
    assert.equal(win.stableAssets, "C:\\Users\\t\\AppData\\Roaming\\open-historia\\public\\assets");
    assert.equal(paths.nativeDataPaths({ platform: "darwin", env: { OH_NATIVE_ROOT: "/tmp/x" }, home: "/Users/t" }).cacheDir, "/tmp/x/native-cache");
    assert.equal(macUpdater.appBundleOf(path.join("/Applications", APP, "Contents", "Resources", "app")), path.resolve("/Applications", APP));
    assert.equal(kit.macBundleOf(path.join("/Applications", APP, "Contents", "Resources", "app")), path.resolve("/Applications", APP));
    assert.equal(kit.macBundleOf(path.join("/Applications", "Open Historia Native")), "");
  });

  test("a Mac downloads only the changed pieces of its own list and hands them to the bundled node", async () => {
    const fixture = macFixture("staged");
    const feed = await startFeedServer({ dir: fixture.release, log: (line) => lines.push(`feed: ${line}`) });
    try {
      const calls = [];
      const updater = macUpdaterFor(fixture, `${feed.address}/${update.NATIVE_MAC_MANIFEST_NAME}`, calls);
      assert.equal(updater.snapshot().canInstall, true);
      const manual = await updater.check({ manual: true });
      assert.equal(manual.status, "available");
      assert.equal(manual.kind, "chunks");
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "chunks");
      assert.ok(feed.requests.some((request) => request.path === `/chunks/${fixture.chunks.manifestName}`), "the macOS file list was read");
      assert.ok(!feed.requests.some((request) => request.path === `/chunks/${fixture.winChunks.manifestName}`), "the Windows file list was not");
      assert.ok(!feed.requests.some((request) => request.path.startsWith("/setup/")), "the zip was not fetched");
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
      assert.equal(fs.readFileSync(path.join(stage, "updater.mjs"), "utf8"), fs.readFileSync(path.join(sidecar, "macUpdater.mjs"), "utf8"));
    } finally {
      await feed.close();
    }
  });

  test("each system refuses the other's feed", async () => {
    const fixture = macFixture("crossed");
    const feed = await startFeedServer({ dir: fixture.release });
    try {
      const mac = macUpdaterFor(fixture, `${feed.address}/${update.NATIVE_MANIFEST_NAME}`, []);
      assert.equal((await mac.check({ manual: true })).status, "error");
      const windows = macUpdaterFor(fixture, `${feed.address}/${update.NATIVE_MAC_MANIFEST_NAME}`, [], { platform: "win32" });
      assert.equal((await windows.check({ manual: true })).status, "error");
    } finally {
      await feed.close();
    }
  });

  test("when the app around the files changed, the whole zip is downloaded and swapped in instead", async () => {
    const fixture = macFixture("shell", { shell: "shell-2", installedShell: "shell-1" });
    const feed = await startFeedServer({ dir: fixture.release });
    try {
      const calls = [];
      const updater = macUpdaterFor(fixture, `${feed.address}/${update.NATIVE_MAC_MANIFEST_NAME}`, calls);
      updater.download();
      const done = await waitFor(updater, ["ready", "error"]);
      assert.equal(done.state, "ready", done.error);
      assert.equal(done.kind, "full");
      assert.ok(feed.requests.some((request) => request.path === `/setup/${update.NATIVE_MAC_ZIP_NAME}`));
      await updater.install({ relaunch: false });
      const zip = path.join(fixture.data, "updates", "setup", BUILD_B, update.NATIVE_MAC_ZIP_NAME);
      assert.deepEqual(calls[0].args, [path.join(path.dirname(zip), "updater.mjs"), "--update", fixture.install, "--zip", zip, "--no-relaunch", "--wait", "111,222"]);
    } finally {
      await feed.close();
    }
  });

  test("a start that is confirmed removes the previous app kept beside it, and nothing else", () => {
    const fixture = macFixture("confirm");
    const stage = path.join(fixture.data, "updates", "staged", BUILD_A);
    const holder = path.join(path.dirname(fixture.app), `.oh-previous-${BUILD_A}`);
    write(holder, `${APP}/Contents/Info.plist`, "old");
    write(stage, "applied", BUILD_A);
    write(stage, "previous-app", holder);
    const updater = macUpdaterFor(fixture, "http://127.0.0.1:9/native-latest-mac.json", []);
    assert.equal(updater.confirm().confirmed, true);
    assert.equal(fs.existsSync(holder), false);

    const outside = path.join(fixture.root, "keep-me");
    write(outside, "file.txt", "x");
    write(stage, "applied", BUILD_A);
    write(stage, "previous-app", outside);
    const again = macUpdaterFor(fixture, "http://127.0.0.1:9/native-latest-mac.json", []);
    assert.equal(again.confirm().confirmed, true);
    assert.equal(fs.existsSync(path.join(outside, "file.txt")), true);
  });

  test("the updater's arguments and plan reading", () => {
    assert.deepEqual(macUpdater.parseArgs(["--apply-staged", "/s", "--no-relaunch", "--wait", "1,2,x"]), { mode: "apply", stage: "/s", install: "", zip: "", relaunch: false, wait: [1, 2] });
    assert.throws(() => macUpdater.inside("/root", "../x"), /outside/);
    assert.equal(macUpdater.isHolderName(".oh-previous-20261028110000"), true);
    assert.equal(macUpdater.isHolderName("Open Historia Native.app"), false);
  });
});

const sh = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
};
const haveCc = darwin && sh("/usr/bin/xcrun", ["--find", "cc"]).ok;

describe("the macOS updater on a real .app", { skip: !darwin ? "needs macOS" : !haveCc ? "needs the Xcode command line tools" : false }, () => {
  const tools = path.join(work, "tools");
  const compile = (name, source) => {
    fs.mkdirSync(tools, { recursive: true });
    const file = path.join(tools, `${name}.c`);
    fs.writeFileSync(file, source);
    const out = path.join(tools, name);
    const built = sh("/usr/bin/xcrun", ["cc", "-O1", "-o", out, file]);
    if (!built.ok) throw new Error(`cc ${name}: ${built.out}`);
    return out;
  };
  let game = "";
  let helperA = "";
  let helperB = "";
  const launched = [];

  const signed = (app) => sh("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const quarantined = (file) => sh("/usr/bin/xattr", ["-p", macUpdater.QUARANTINE, file]).ok;
  const readText = (app, relative) => fs.readFileSync(path.join(app, "Contents", "Resources", "app", ...relative.split("/")), "utf8");
  const plistValue = (app, key) => sh("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents", "Info.plist")]).out;

  const makeApp = (parent, build, { mode = "ok", text = "A", helper = helperA } = {}) => {
    const app = path.join(parent, APP);
    fs.rmSync(app, { recursive: true, force: true });
    const root = path.join(app, "Contents", "Resources", "app");
    write(app, "Contents/Info.plist", plist({ build, shell: "shell-1" }));
    write(app, "Contents/MacOS/Open Historia", fs.readFileSync(game));
    fs.chmodSync(path.join(app, "Contents", "MacOS", "Open Historia"), 0o755);
    write(root, ".oh-native-install", "x\n");
    write(root, "native/godot/version.json", JSON.stringify({ version: build === BUILD_A ? "0.1.0" : "0.1.1", build }));
    write(root, "runtime/helper", fs.readFileSync(helper));
    fs.chmodSync(path.join(root, "runtime", "helper"), 0o755);
    write(root, "data/a.txt", text);
    write(root, "old.txt", "old\n");
    write(root, "mode.txt", mode);
    const helperSigned = sh("/usr/bin/codesign", ["--force", "--sign", "-", path.join(root, "runtime", "helper")]);
    assert.ok(helperSigned.ok, helperSigned.out);
    const appSigned = sh("/usr/bin/codesign", ["--force", "--sign", "-", app]);
    assert.ok(appSigned.ok, appSigned.out);
    assert.ok(signed(app).ok, signed(app).out);
    return app;
  };

  const makeStage = (name, app, build, puts, removes = []) => {
    const stage = path.join(work, "stages", name);
    fs.rmSync(stage, { recursive: true, force: true });
    for (const [relative, data] of Object.entries(puts)) write(path.join(stage, "files"), relative, data);
    const root = path.join(app, "Contents", "Resources", "app");
    const lines = [`install\t${root}`, `build\t${build}`, `from\t${BUILD_A}`, ...Object.keys(puts).map((relative) => `put\t${relative}`), ...removes.map((relative) => `remove\t${relative}`), ""];
    write(stage, "apply.txt", lines.join("\r\n"));
    write(stage, "ready", build);
    return stage;
  };

  const updaterWith = (extra = {}) => macUpdater.createMacUpdater({
    log: (message) => lines.push(`mac: ${message}`),
    launchApp: async (app) => {
      const child = spawn(path.join(app, "Contents", "MacOS", "Open Historia"), [], { stdio: "ignore" });
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

  test("tools build", () => {
    game = compile("game", '#include <stdio.h>\n#include <string.h>\n#include <unistd.h>\n#include <libgen.h>\nint main(int argc, char **argv) { char path[4096]; char mode[16] = {0}; snprintf(path, sizeof path, "%s/../Resources/app/mode.txt", dirname(argv[0])); FILE *file = fopen(path, "r"); if (file) { fread(mode, 1, 15, file); fclose(file); } if (strncmp(mode, "fail", 4) == 0) return 3; sleep(20); return 0; }\n');
    helperA = compile("helperA", "int main(void) { return 0; }\n");
    helperB = compile("helperB", "int main(void) { return 1; }\n");
  });

  test("a staged update is applied to a copy, signed, unquarantined and swapped in; then rolled back", async () => {
    const parent = path.join(work, "apps", "apply");
    const app = makeApp(parent, BUILD_A);
    sh("/usr/bin/xattr", ["-w", macUpdater.QUARANTINE, "0083;65f00000;Safari;", app]);
    sh("/usr/bin/xattr", ["-w", macUpdater.QUARANTINE, "0083;65f00000;Safari;", path.join(app, "Contents", "Resources", "app", "data", "a.txt")]);
    const stage = makeStage("apply", app, BUILD_B, {
      "data/a.txt": "B",
      "data/new.txt": "new",
      "runtime/helper": fs.readFileSync(helperB),
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
    assert.equal(fs.existsSync(path.join(app, "Contents", "Resources", "app", "old.txt")), false);
    assert.ok(fs.statSync(path.join(app, "Contents", "Resources", "app", "runtime", "helper")).mode & 0o100);
    const check = signed(app);
    assert.ok(check.ok, check.out);
    assert.equal(quarantined(app), false);
    assert.equal(quarantined(path.join(app, "Contents", "Resources", "app", "data", "a.txt")), false);
    assert.equal(plistValue(app, "CFBundleVersion"), BUILD_B);
    assert.equal(plistValue(app, kit.MAC_SHELL_KEY), "shell-1");
    assert.equal(kit.readMacShell(app), "shell-1");
    const holder = fs.readFileSync(path.join(stage, "previous-app"), "utf8");
    const kept = path.join(holder, APP);
    assert.equal(readText(kept, "data/a.txt"), "A");
    assert.ok(signed(kept).ok, "the kept app still carries its own signature");
    assert.deepEqual(fs.readdirSync(parent).filter((name) => name.startsWith(".oh-update-")), []);

    assert.equal(await updater.rollback({ stage, relaunch: false, wait: [] }), 0);
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.equal(readText(app, "old.txt"), "old\n");
    assert.equal(plistValue(app, "CFBundleVersion"), BUILD_A);
    assert.ok(signed(app).ok);
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.equal(fs.existsSync(path.join(stage, "applied")), false);
    assert.equal(fs.existsSync(holder), false);
    assert.deepEqual(fs.readdirSync(parent), [APP]);
  });

  test("a new version that closes before it confirms is rolled back and the old one reopened", async () => {
    const parent = path.join(work, "apps", "fail");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("fail", app, BUILD_B, { "mode.txt": "fail", "data/a.txt": "B", "native/godot/version.json": JSON.stringify({ version: "0.1.1", build: BUILD_B }) });
    const updater = updaterWith();
    const code = await updater.apply({ stage, relaunch: true, wait: [] });
    assert.equal(code, 1, lines.slice(-8).join("\n"));
    assert.equal(launched.length, 2, "the new version, then the old one");
    stopLaunched();
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.equal(readText(app, "mode.txt"), "ok");
    assert.ok(signed(app).ok);
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.deepEqual(fs.readdirSync(parent), [APP]);
  });

  test("the command line applies a stage with the node that runs it", () => {
    const parent = path.join(work, "apps", "cli");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("cli", app, BUILD_B, { "data/a.txt": "B", "native/godot/version.json": JSON.stringify({ version: "0.1.1", build: BUILD_B }) });
    fs.copyFileSync(path.join(sidecar, "macUpdater.mjs"), path.join(stage, "updater.mjs"));
    const run = sh(process.execPath, [path.join(stage, "updater.mjs"), "--apply-staged", stage, "--no-relaunch", "--wait", "999999"], { env: { ...process.env, OH_MAC_UPDATER_QUIET: "1" } });
    assert.ok(run.ok, run.out);
    assert.equal(readText(app, "data/a.txt"), "B");
    assert.ok(fs.existsSync(path.join(stage, "applied")));
    assert.ok(signed(app).ok);
  });

  test("a broken signature in the copy leaves the installed app untouched", async () => {
    const parent = path.join(work, "apps", "unsigned");
    const app = makeApp(parent, BUILD_A);
    const stage = makeStage("unsigned", app, BUILD_B, { "data/a.txt": "B" });
    const updater = updaterWith({ tools: { ...macUpdater.TOOLS, codesign: "/usr/bin/false" } });
    assert.equal(await updater.apply({ stage, relaunch: false, wait: [] }), 1);
    assert.equal(readText(app, "data/a.txt"), "A");
    assert.ok(signed(app).ok);
    assert.ok(fs.existsSync(path.join(stage, "rolled-back")));
    assert.deepEqual(fs.readdirSync(parent), [APP]);
  });

  test("the full zip is unpacked beside the app, unquarantined and swapped in", async () => {
    const parent = path.join(work, "apps", "zip");
    const app = makeApp(parent, BUILD_A);
    const fresh = makeApp(path.join(work, "apps", "zip-source"), BUILD_B, { text: "B", helper: helperB });
    const zip = path.join(work, "apps", update.NATIVE_MAC_ZIP_NAME);
    const zipped = sh("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", fresh, zip]);
    assert.ok(zipped.ok, zipped.out);
    sh("/usr/bin/xattr", ["-w", macUpdater.QUARANTINE, "0083;65f00000;Safari;", zip]);
    const updater = updaterWith();
    assert.equal(await updater.update({ install: path.join(app, "Contents", "Resources", "app"), zip, relaunch: false, wait: [] }), 0, lines.slice(-8).join("\n"));
    assert.equal(readText(app, "data/a.txt"), "B");
    assert.ok(signed(app).ok);
    assert.equal(quarantined(app), false);
    assert.deepEqual(fs.readdirSync(parent), [APP]);
  });
});
