import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const handlers = path.resolve(here, "..", "handlers");
const codecDir = path.resolve(here, "..", "imagecodec");
const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const real = { existsSync: fs.existsSync, execFile: childProcess.execFile, spawn: childProcess.spawn };
const realDocument = globalThis.document;
let loads = 0;
const temps = [];

const slash = (file) => String(file).split(path.sep).join("/");

const mock = ({ platform = "darwin", present = {}, execFile = null, spawn = null } = {}) => {
  Object.defineProperty(process, "platform", { ...realPlatform, value: platform });
  fs.existsSync = (file) => {
    const key = slash(file);
    for (const [pattern, value] of Object.entries(present)) {
      if (key === pattern || key.endsWith(pattern)) return value;
    }
    return real.existsSync(file);
  };
  childProcess.execFile = execFile ?? ((file, args, options, callback) => {
    (typeof options === "function" ? options : callback)(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" }), "", "");
  });
  childProcess.spawn = spawn ?? (() => {
    throw new Error("No helper should start here.");
  });
  syncBuiltinESMExports();
};

const load = async (name) => import(`${pathToFileURL(path.join(handlers, name)).href}?mac-${++loads}`);

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-mac-helpers-"));
  temps.push(dir);
  return dir;
};

const clean = (value) => String(value ?? "").trim();

afterEach(() => {
  Object.defineProperty(process, "platform", realPlatform);
  fs.existsSync = real.existsSync;
  childProcess.execFile = real.execFile;
  childProcess.spawn = real.spawn;
  syncBuiltinESMExports();
  if (realDocument === undefined) delete globalThis.document;
  else globalThis.document = realDocument;
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const fakeHelper = (answer) => {
  const calls = [];
  const spawn = (file, args) => {
    calls.push({ file, args });
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.kill = () => child.emit("exit", null);
    readline.createInterface({ input: child.stdin }).on("line", (line) => {
      const [source, target] = line.split("\t");
      child.stdout.write(`${answer(source, target)}\n`);
    });
    child.stdout.write("ready\n");
    return child;
  };
  return { calls, spawn };
};

const AVIS = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypavis\0\0\0\0avismsf1", "latin1"), Buffer.alloc(64, 7)]);

test("the Swift helper builds for both Mac architectures", async () => {
  mock();
  const codec = await load("imagecodec.mjs");
  assert.deepEqual(codec.imageCodecSwiftArgs("/tmp/out", "arm64"), ["swiftc", "-O", "-target", "arm64-apple-macos11.0", codec.IMAGE_CODEC_SWIFT, "-o", "/tmp/out"]);
  assert.deepEqual(codec.imageCodecSwiftArgs("/tmp/out", "x86_64").slice(0, 4), ["swiftc", "-O", "-target", "x86_64-apple-macos10.15"]);
  assert.deepEqual(codec.imageCodecSwiftArgs("/tmp/out", "x64").slice(0, 4), ["swiftc", "-O", "-target", "x86_64-apple-macos10.15"]);
  assert.ok(real.existsSync(codec.IMAGE_CODEC_SWIFT), "ImageCodec.swift ships next to the C# helper");
});

test("macOS uses the helper shipped in the bundle and reads its frames, durations and loops", async () => {
  const helper = fakeHelper((source, target) => {
    const stem = target.replace(/\.png$/, "");
    for (const file of [target, `${stem}.1.png`, `${stem}.2.png`]) fs.writeFileSync(file, "png");
    return "ok\t640\t360\ttrack\t3\t2\t0.25,0.25,0.1";
  });
  mock({ present: { "imagecodec/oh-imagecodec": true }, spawn: helper.spawn });
  const codec = await load("imagecodec.mjs");
  const cacheDir = tempDir();
  const handler = codec.register({ cacheDir, clean })["image.avif"];
  const first = await handler({ data: AVIS.toString("base64") });
  assert.equal(first.ok, true, first.error);
  assert.equal(helper.calls.length, 1);
  assert.equal(slash(helper.calls[0].file), slash(path.join(codecDir, "oh-imagecodec")));
  assert.deepEqual([first.width, first.height, first.frames.length, first.loops, first.cached], [640, 360, 3, 2, false]);
  assert.deepEqual(first.durations, [0.25, 0.25, 0.1]);
  assert.match(path.basename(first.frames[2]), /^[0-9a-f]{64}\.2\.png$/);
  const manifest = JSON.parse(fs.readFileSync(first.png.replace(/\.png$/, ".json"), "utf8"));
  assert.deepEqual(manifest.frames.length, 3);
  const again = await handler({ data: AVIS.toString("base64") });
  assert.equal(again.cached, true);
  assert.equal(helper.calls.length, 1);
});

test("macOS words a missing AVIF decoder for macOS, once for every later image", async () => {
  const helper = fakeHelper(() => "missing\tThis version of macOS cannot read AVIF images.");
  mock({ present: { "imagecodec/oh-imagecodec": true }, spawn: helper.spawn });
  const codec = await load("imagecodec.mjs");
  const handler = codec.register({ cacheDir: tempDir(), clean })["image.avif"];
  const reply = await handler({ data: AVIS.toString("base64") });
  assert.deepEqual(reply, { ok: false, missing: true, error: "This version of macOS cannot open AVIF images. macOS 13 Ventura or later can." });
  const other = await handler({ data: Buffer.concat([AVIS, Buffer.from([1])]).toString("base64") });
  assert.equal(other.missing, true);
});

test("without a shipped helper or developer tools, macOS never runs xcrun and says the reader is missing", async () => {
  const ran = [];
  mock({
    present: { "imagecodec/oh-imagecodec": false, "/usr/bin/xcrun": true, "/usr/bin/xcode-select": true },
    execFile: (file, args, options, callback) => {
      ran.push(slash(file));
      callback(Object.assign(new Error("xcode-select: error: unable to get active developer directory"), { code: 2 }), "", "");
    },
  });
  const codec = await load("imagecodec.mjs");
  const reply = await codec.register({ cacheDir: tempDir(), clean })["image.avif"]({ data: AVIS.toString("base64") });
  assert.deepEqual(reply, { ok: false, missing: true, error: "The app's AVIF reader is missing from this copy of the game." });
  assert.deepEqual(ran, ["/usr/bin/xcode-select"]);
});

test("with developer tools and no shipped helper, macOS compiles the Swift source into the cache once", async () => {
  const ran = [];
  const helper = fakeHelper((source, target) => {
    fs.writeFileSync(target, "png");
    return "ok\t837\t1628\town\t1\t-1\t";
  });
  mock({
    present: { "imagecodec/oh-imagecodec": false, "/usr/bin/xcrun": true, "/usr/bin/xcode-select": true, "/Library/Developer/CommandLineTools/usr/bin/swiftc": true },
    execFile: (file, args, options, callback) => {
      ran.push([slash(file), args]);
      if (file === "/usr/bin/xcode-select") callback(null, "/Library/Developer/CommandLineTools\n", "");
      else {
        fs.writeFileSync(args[args.length - 1], "binary");
        callback(null, "", "");
      }
    },
    spawn: helper.spawn,
  });
  const codec = await load("imagecodec.mjs");
  const cacheDir = tempDir();
  const reply = await codec.register({ cacheDir, clean })["image.avif"]({ data: AVIS.toString("base64") });
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual([reply.width, reply.height, reply.frames.length, reply.loops, reply.durations], [837, 1628, 1, -1, []]);
  assert.equal(ran.length, 2);
  assert.equal(ran[1][0], "/usr/bin/xcrun");
  const partial = ran[1][1][ran[1][1].length - 1];
  assert.deepEqual(ran[1][1], codec.imageCodecSwiftArgs(partial, process.arch));
  assert.match(slash(helper.calls[0].file), /\/imagecodec\/oh-imagecodec-[0-9a-f]{12}$/);
  assert.ok(real.existsSync(helper.calls[0].file));
  assert.equal(slash(path.dirname(helper.calls[0].file)), slash(path.join(cacheDir, "imagecodec")));
});

test("Windows still compiles and runs the C# helper", async () => {
  mock({ platform: "win32", present: { "imagecodec/oh-imagecodec.exe": true }, spawn: fakeHelper(() => "failed\tbroken").spawn });
  const codec = await load("imagecodec.mjs");
  assert.deepEqual(codec.IMAGE_CODEC_SOURCES.map((file) => path.basename(file)), ["ImageCodec.cs", "Sequence.cs"]);
  const reply = await codec.register({ cacheDir: tempDir(), clean })["image.avif"]({ data: AVIS.toString("base64") });
  assert.deepEqual(reply, { ok: false, missing: false, error: "broken" });
});

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), flush: () => {} };
};

const notifyContext = (storage = memoryStorage()) => ({
  storage,
  emit: () => {},
  clean,
  repo: tempDir(),
  standIn: false,
  engine: { getLibraryState: () => ({ activeGameId: "game-1" }) },
});

test("macOS notification text goes to osascript as arguments, never as script", async () => {
  mock();
  const notify = await load("notify.mjs");
  const args = notify.macNotificationArgs("Open Historia — \"Rome\" \\ end tell", "Line one\r\nline two\u0000 & 'quotes' \u0007");
  assert.deepEqual(args.slice(0, 6), ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run"]);
  assert.deepEqual(args.slice(6), ["Open Historia — \"Rome\" \\ end tell", "Line one line two & 'quotes'"]);
  assert.ok(args.every((arg) => !arg.includes("\u0000")));
});

test("macOS shows a desktop notification only when the window is minimised and notifications are on", async () => {
  const shown = [];
  mock({
    present: { "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => {
      shown.push([file, args]);
      callback(null, "", "");
    },
  });
  globalThis.document = { hidden: false, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const handlers = notify.register(notifyContext());
  assert.deepEqual(await handlers["notify.desktop.get"](), { permission: "default" });
  const message = { sender: "Rome", preview: "We accept \"your\" terms.", chatId: "chat-7", notice: 4 };
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "permission", permission: "default" });
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "granted" });
  assert.equal(shown.length, 0);
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "visible", permission: "granted" });
  assert.equal(shown.length, 0);
  globalThis.document.hidden = true;
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: true, permission: "granted" });
  assert.deepEqual(shown, [[notify.OSASCRIPT, notify.macNotificationArgs("Open Historia — Rome", "We accept \"your\" terms.")]]);
});

test("a failed osascript reports the notification as not shown", async () => {
  mock({
    present: { "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => callback(new Error("execution error: Notifications are not allowed (-1743)"), "", ""),
  });
  globalThis.document = { hidden: true, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const storage = memoryStorage();
  storage.setItem(notify.DESKTOP_PERMISSION_KEY, "granted");
  const reply = await notify.register(notifyContext(storage))["notify.desktop"]({ sender: "Rome", preview: "Hi", chatId: "c", notice: 1 });
  assert.equal(reply.shown, false);
  assert.equal(reply.reason, "failed");
  assert.match(reply.error, /-1743/);
});

test("a Mac without osascript, and other systems, have no desktop notifications", async () => {
  mock({ present: { "/usr/bin/osascript": false } });
  const notify = await load("notify.mjs");
  assert.deepEqual(await notify.register(notifyContext())["notify.desktop.get"](), { permission: "unsupported" });
  mock({ platform: "linux", present: { "/notify-send": false } });
  const linux = await load("notify.mjs");
  assert.deepEqual(await linux.register(notifyContext())["notify.desktop.get"](), { permission: "unsupported" });
});

const fakeNotifier = (answer) => {
  const calls = [];
  const requests = [];
  let child = null;
  const spawn = (file, args) => {
    calls.push({ file, args });
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit("exit", null, "SIGTERM");
    readline.createInterface({ input: child.stdin }).on("line", (line) => {
      const request = JSON.parse(line);
      requests.push(request);
      const reply = answer(request);
      if (reply) child.stdout.write(`${JSON.stringify({ seq: request.seq, ...reply })}\n`);
    });
    child.stdout.write(`${JSON.stringify({ ready: true, bundle: "io.github.arkniem.openhistoria.native.notifier" })}\n`);
    return child;
  };
  return { calls, requests, spawn, click: (body) => child.stdout.write(`${JSON.stringify({ event: "activated", ...body })}\n`) };
};

test("the notifier helper lives in the app's Helpers folder and builds for both Macs", async () => {
  mock();
  const notify = await load("notify.mjs");
  const stage = path.join(path.sep, "Applications", "Open Historia Native.app", "Contents", "Resources", "app");
  assert.equal(slash(notify.macNotifierPath(stage)), slash(path.resolve(path.sep, "Applications", "Open Historia Native.app", "Contents", "Helpers", "Open Historia Notifier.app", "Contents", "MacOS", "Open Historia Notifier")));
  assert.ok(notify.MAC_NOTIFIER_ID.startsWith("io.github.arkniem.openhistoria.native."));
  assert.deepEqual(notify.macNotifierSwiftArgs("/src/Notifier.swift", "/tmp/out", "arm64"), ["swiftc", "-O", "-target", "arm64-apple-macos11.0", "/src/Notifier.swift", "-o", "/tmp/out"]);
  assert.deepEqual(notify.macNotifierSwiftArgs("/src/Notifier.swift", "/tmp/out", "x86_64").slice(0, 4), ["swiftc", "-O", "-target", "x86_64-apple-macos10.15"]);
  assert.ok(real.existsSync(path.resolve(here, "..", "..", "macos", "notifier", "Notifier.swift")), "Notifier.swift ships with the macOS build files");
});

test("with the notifier in the bundle, macOS asks it for permission, posts through it and brings the game forward on a click", async () => {
  const osascript = [];
  const helper = fakeNotifier((request) => (request.op === "show" ? { shown: true, setting: "Enabled" } : { setting: "Enabled" }));
  const events = [];
  mock({
    present: { "Contents/MacOS/Open Historia Notifier": true, "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => {
      osascript.push(file);
      callback(null, "", "");
    },
    spawn: helper.spawn,
  });
  globalThis.document = { hidden: false, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const context = notifyContext();
  context.emit = (name, data) => events.push([name, data]);
  const handlers = notify.register(context);
  assert.deepEqual(await handlers["notify.desktop.get"](), { permission: "default" });
  const message = { sender: "Rome", preview: "We accept.", chatId: "chat-7", notice: 4 };
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "permission", permission: "default" });
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "granted" });
  assert.equal(slash(helper.calls[0].file), slash(notify.macNotifierPath(context.repo)));
  assert.deepEqual(helper.calls[0].args, ["--serve"]);
  assert.equal(helper.requests[0].op, "register");
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "visible", permission: "granted" });
  globalThis.document.hidden = true;
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: true, permission: "granted" });
  const shown = helper.requests.find((request) => request.op === "show");
  assert.deepEqual([shown.title, shown.body, shown.chatId, shown.notice, shown.gameId], ["Open Historia — Rome", "We accept.", "chat-7", 4, "game-1"]);
  assert.equal(shown.tag, notify.toastTag("chat-7"));
  assert.equal(helper.calls.length, 1);
  assert.deepEqual(osascript, []);
  helper.click({ notice: 4, chatId: "chat-7", gameId: "game-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [["notify.activated", { notice: 4, chatId: "chat-7", sameGame: true }]]);
});

test("a notifier turned off in System Settings records the refusal and never falls back to Script Editor", async () => {
  const osascript = [];
  const helper = fakeNotifier((request) => (request.op === "show" ? { shown: false, setting: "Disabled" } : { setting: "Disabled" }));
  mock({
    present: { "Contents/MacOS/Open Historia Notifier": true, "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => {
      osascript.push(file);
      callback(null, "", "");
    },
    spawn: helper.spawn,
  });
  globalThis.document = { hidden: true, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const storage = memoryStorage();
  storage.setItem(notify.DESKTOP_PERMISSION_KEY, "granted");
  const handlers = notify.register(notifyContext(storage));
  assert.deepEqual(await handlers["notify.desktop"]({ sender: "Rome", preview: "Hi", chatId: "c", notice: 1 }), { shown: false, permission: "denied" });
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "denied" });
  assert.deepEqual(osascript, []);
});

test("a notifier the system will not run falls back to osascript", async () => {
  const osascript = [];
  const helper = fakeNotifier(() => ({ setting: "Unknown", error: "UNErrorDomain 1: Notifications are not allowed for this application", unavailable: true }));
  mock({
    present: { "Contents/MacOS/Open Historia Notifier": true, "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => {
      osascript.push([file, args]);
      callback(null, "", "");
    },
    spawn: helper.spawn,
  });
  globalThis.document = { hidden: true, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const handlers = notify.register(notifyContext());
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "granted" });
  assert.deepEqual(await handlers["notify.desktop"]({ sender: "Rome", preview: "Hi", chatId: "c", notice: 1 }), { shown: true, permission: "granted" });
  assert.equal(helper.requests.length, 1);
  assert.deepEqual(osascript, [[notify.OSASCRIPT, notify.macNotificationArgs("Open Historia — Rome", "Hi")]]);
});

test("a notifier that cannot start falls back to osascript", async () => {
  const osascript = [];
  mock({
    present: { "Contents/MacOS/Open Historia Notifier": true, "/usr/bin/osascript": true },
    execFile: (file, args, options, callback) => {
      osascript.push(file);
      callback(null, "", "");
    },
    spawn: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      setImmediate(() => child.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" })));
      return child;
    },
  });
  globalThis.document = { hidden: true, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const storage = memoryStorage();
  storage.setItem(notify.DESKTOP_PERMISSION_KEY, "granted");
  const handlers = notify.register(notifyContext(storage));
  assert.deepEqual(await handlers["notify.desktop"]({ sender: "Rome", preview: "Hi", chatId: "c", notice: 1 }), { shown: true, permission: "granted" });
  assert.deepEqual(osascript, [notify.OSASCRIPT]);
});
