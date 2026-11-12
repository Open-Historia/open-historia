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
const realPath = process.env.PATH;
const real = { existsSync: fs.existsSync, execFile: childProcess.execFile, spawn: childProcess.spawn };
const realDocument = globalThis.document;
let loads = 0;
const temps = [];

const slash = (file) => String(file).split(path.sep).join("/");

const mock = ({ platform = "linux", present = {}, execFile = null, spawn = null, pathVar = "/usr/local/bin:/usr/bin:/bin" } = {}) => {
  Object.defineProperty(process, "platform", { ...realPlatform, value: platform });
  process.env.PATH = pathVar;
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

const load = async (name) => import(`${pathToFileURL(path.join(handlers, name)).href}?linux-${++loads}`);

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-linux-helpers-"));
  temps.push(dir);
  return dir;
};

const clean = (value) => String(value ?? "").trim();

afterEach(() => {
  Object.defineProperty(process, "platform", realPlatform);
  process.env.PATH = realPath;
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

const AVIS = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypavis\0\0\0\0avismsf1", "latin1"), Buffer.alloc(64, 9)]);

test("Linux runs the helper shipped beside the handlers and reads its frames, durations and loops", async () => {
  const helper = fakeHelper((source, target) => {
    const stem = target.replace(/\.png$/, "");
    for (const file of [target, `${stem}.1.png`]) fs.writeFileSync(file, "png");
    return "ok\t320\t180\tnone\t2\t2\t0.2,0.2";
  });
  mock({ present: { "imagecodec/oh-imagecodec": true }, spawn: helper.spawn });
  const codec = await load("imagecodec.mjs");
  const handler = codec.register({ cacheDir: tempDir(), clean })["image.avif"];
  const first = await handler({ data: AVIS.toString("base64") });
  assert.equal(first.ok, true, first.error);
  assert.equal(slash(helper.calls[0].file), slash(path.join(codecDir, "oh-imagecodec")));
  assert.deepEqual([first.width, first.height, first.frames.length, first.loops, first.durations], [320, 180, 2, 2, [0.2, 0.2]]);
  assert.equal((await handler({ data: AVIS.toString("base64") })).cached, true);
  assert.equal(helper.calls.length, 1);
});

test("Linux without the shipped helper says the reader is missing and never compiles anything", async () => {
  const ran = [];
  mock({ present: { "imagecodec/oh-imagecodec": false }, execFile: (file, args, options, callback) => { ran.push(file); callback(new Error("no"), "", ""); } });
  const codec = await load("imagecodec.mjs");
  const reply = await codec.register({ cacheDir: tempDir(), clean })["image.avif"]({ data: AVIS.toString("base64") });
  assert.deepEqual(reply, { ok: false, missing: true, error: "The app's AVIF reader is missing from this copy of the game." });
  assert.deepEqual(ran, []);
});

test("a picture the Linux helper cannot read is only that picture's failure", async () => {
  const helper = fakeHelper(() => "failed\tThe image could not be read (BMFF parsing failed).");
  mock({ present: { "imagecodec/oh-imagecodec": true }, spawn: helper.spawn });
  const codec = await load("imagecodec.mjs");
  const handler = codec.register({ cacheDir: tempDir(), clean })["image.avif"];
  assert.deepEqual(await handler({ data: AVIS.toString("base64") }), { ok: false, missing: false, error: "The image could not be read (BMFF parsing failed)." });
  const helperAgain = fakeHelper((source, target) => {
    fs.writeFileSync(target, "png");
    return "ok\t8\t8\tnone\t1\t-1\t";
  });
  childProcess.spawn = helperAgain.spawn;
  syncBuiltinESMExports();
  codec.stopImageCodec();
  const other = await handler({ data: Buffer.concat([AVIS, Buffer.from([2])]).toString("base64") });
  assert.equal(other.ok, true, other.error);
});

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), flush: () => {} };
};

const notifyContext = (storage = memoryStorage(), repo = tempDir()) => ({
  storage,
  emit: () => {},
  clean,
  repo,
  standIn: false,
  engine: { getLibraryState: () => ({ activeGameId: "game-1" }) },
});

test("Linux notification text goes to notify-send as arguments after --", async () => {
  mock();
  const notify = await load("notify.mjs");
  assert.deepEqual(notify.notifySendArgs("Open Historia — -Rome", "Line one\r\nline two\u0000", "/icon.png"), ["--app-name=Open Historia", "--icon=/icon.png", "--hint=string:desktop-entry:io.github.arkniem.openhistoria.native", "--", "Open Historia — -Rome", "Line one line two"]);
  assert.deepEqual(notify.notifySendArgs("t", "b"), ["--app-name=Open Historia", "--hint=string:desktop-entry:io.github.arkniem.openhistoria.native", "--", "t", "b"]);
  assert.equal(notify.findOnPath("notify-send", { PATH: "relative:/nowhere" }), "");
});

test("Linux shows notifications through notify-send only when the window is hidden and notifications are on", async () => {
  const shown = [];
  const started = [];
  mock({
    present: { "/usr/bin/notify-send": true, "/usr/local/bin/notify-send": false },
    execFile: (file, args, options, callback) => {
      shown.push([file, args]);
      callback(null, "", "");
    },
    spawn: (file) => {
      started.push(file);
      throw new Error("no long-running helper on Linux");
    },
  });
  const listeners = [];
  globalThis.document = { hidden: false, addEventListener: (name, listener) => listeners.push(listener) };
  const notify = await load("notify.mjs");
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, "public"), { recursive: true });
  fs.writeFileSync(path.join(repo, "public", "icon-192.png"), "png");
  const handlers = notify.register(notifyContext(memoryStorage(), repo));
  assert.deepEqual(await handlers["notify.desktop.get"](), { permission: "default" });
  const message = { sender: "Rome", preview: "We accept.", chatId: "chat-7", notice: 4 };
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "permission", permission: "default" });
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "granted" });
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: false, reason: "visible", permission: "granted" });
  globalThis.document.hidden = true;
  for (const listener of listeners) listener();
  assert.deepEqual(await handlers["notify.desktop"](message), { shown: true, permission: "granted" });
  assert.deepEqual(shown, [["/usr/bin/notify-send", notify.notifySendArgs("Open Historia — Rome", "We accept.", path.join(repo, "public", "icon-192.png"))]]);
  assert.deepEqual(started, [], "nothing long-running is started on Linux");
});

test("a failed notify-send reports the notification as not shown", async () => {
  mock({ present: { "/usr/bin/notify-send": true }, execFile: (file, args, options, callback) => callback(new Error("Cannot autolaunch D-Bus without X11 $DISPLAY"), "", "") });
  globalThis.document = { hidden: true, addEventListener: () => {} };
  const notify = await load("notify.mjs");
  const storage = memoryStorage();
  storage.setItem(notify.DESKTOP_PERMISSION_KEY, "granted");
  const reply = await notify.register(notifyContext(storage))["notify.desktop"]({ sender: "Rome", preview: "Hi", chatId: "c", notice: 1 });
  assert.equal(reply.shown, false);
  assert.equal(reply.reason, "failed");
  assert.match(reply.error, /D-Bus/);
});

test("Linux without notify-send has no desktop notifications, quietly", async () => {
  mock({ present: { "/notify-send": false } });
  const notify = await load("notify.mjs");
  const handlers = notify.register(notifyContext());
  assert.deepEqual(await handlers["notify.desktop.get"](), { permission: "unsupported" });
  assert.deepEqual(await handlers["notify.desktop.request"](), { permission: "unsupported" });
  assert.deepEqual(await handlers["notify.desktop"]({ sender: "Rome", preview: "Hi" }), { shown: false, reason: "permission", permission: "unsupported" });
});
