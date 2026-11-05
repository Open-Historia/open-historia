/*! Open Historia — the system's own speech recognition in the desktop app: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/systemSpeech.test.js
//
// electron/speechSystem.cjs with a stand-in program: where it looks for the
// program, the lines it passes on, how a turn ends, and what it says when
// there is no program. Then the packaging every Windows and macOS build needs
// for it, and, on a Windows machine where it has been built, the real
// program's probe (it opens no microphone).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createSystemSpeech, helperPath, cleanLanguage, HELPERS } = require("../electron/speechSystem.cjs");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// A program that writes what the test tells it to, and records what it is sent.
const fakeProgram = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.input = "";
  child.killed = false;
  child.stdin.on("data", (chunk) => { child.input += String(chunk); });
  child.kill = () => { child.killed = true; child.exit(null); };
  child.write = (...events) => child.stdout.write(events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  child.exit = (code) => {
    if (child.exitCode != null) return;
    child.exitCode = code ?? 1;
    child.stdout.end();
    setImmediate(() => child.emit("close", code));
  };
  return child;
};

const existing = (files) => ({
  statSync: (file) => {
    if (!files.includes(file)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return { isFile: () => true };
  },
  chmodSync: () => {},
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the program is looked for beside the app's files, outside the archive", () => {
  const dir = path.join("C:", "Program Files", "Open Historia", "resources", "app.asar", "electron");
  const expected = path.join("C:", "Program Files", "Open Historia", "resources", "app.asar.unpacked", "electron", "speech", "oh-speech-windows.exe");
  assert.equal(helperPath({ platform: "win32", dir, fs: existing([expected]) }), expected);
  assert.equal(helperPath({ platform: "win32", dir, fs: existing([]) }), null);
  assert.equal(helperPath({ platform: "linux", dir, fs: existing([expected]) }), null);
  assert.deepEqual(Object.keys(HELPERS).sort(), ["darwin", "win32"]);
});

test("language tags only: nothing else reaches a command line", () => {
  assert.equal(cleanLanguage("en-US"), "en-US");
  assert.equal(cleanLanguage("fil-PH"), "fil-PH");
  assert.equal(cleanLanguage("zh-Hans-CN"), "zh-Hans-CN");
  for (const bad of ["", "en US", "en-US; calc", "--help", "e", null, "en-US\nstop"]) assert.equal(cleanLanguage(bad), null, String(bad));
});

test("a turn passes the program's lines on, and stop asks it to finish", async () => {
  const dir = path.join(ROOT, "electron");
  const file = path.join(dir, "speech", "oh-speech-windows.exe");
  const programs = [];
  const speech = createSystemSpeech({
    platform: "win32",
    dir,
    fs: existing([file]),
    spawn: (command, args, options) => {
      const child = fakeProgram();
      programs.push({ command, args, options, child });
      return child;
    },
  });
  assert.equal(speech.available(), true);
  const events = [];
  const session = speech.listen({ language: "en-US", onEvent: (event) => events.push(event) });
  assert.equal(programs.length, 1);
  assert.equal(programs[0].command, file);
  assert.deepEqual(programs[0].args, ["listen", "en-US"]);
  assert.equal(programs[0].options.windowsHide, true);
  const { child } = programs[0];
  child.stdout.write('{"type":"ready","language":"en-US"}\n{"type":"partial","te');
  child.stdout.write('xt":"Declare"}\nnot json\n');
  child.write({ type: "final", text: "Declare war." });
  await settle();
  assert.deepEqual(events, [
    { type: "ready", language: "en-US" },
    { type: "partial", text: "Declare" },
    { type: "final", text: "Declare war." },
  ]);
  session.stop();
  await settle();
  assert.equal(child.input, "stop\n");
  child.write({ type: "end" });
  child.exit(0);
  await settle();
  assert.deepEqual(events.at(-1), { type: "end" });
  assert.equal(events.filter((event) => event.type === "end").length, 1);
});

test("a program that does not finish is killed; one that dies is a failure; a second turn ends the first", async () => {
  const dir = path.join(ROOT, "electron");
  const file = path.join(dir, "speech", "oh-speech-windows.exe");
  const children = [];
  const speech = createSystemSpeech({
    platform: "win32",
    dir,
    fs: existing([file]),
    spawn: () => {
      const child = fakeProgram();
      children.push(child);
      return child;
    },
  });
  const first = [];
  speech.listen({ language: "en-US", onEvent: (event) => first.push(event) });
  const second = [];
  speech.listen({ language: "en-US", onEvent: (event) => second.push(event) });
  assert.equal(children[0].input, "stop\n", "the second turn asks the first to stop");
  children[1].exit(3);
  await settle();
  assert.deepEqual(second, [{ type: "error", code: "failed" }, { type: "end" }]);
  // Two seconds on, the first is killed.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(children[0].killed, true);
  assert.deepEqual(first.at(-1), { type: "end" });
});

test("no program, or a language that is not a tag: an error and an end, nothing started", () => {
  let started = 0;
  const spawn = () => { started += 1; return fakeProgram(); };
  const none = createSystemSpeech({ platform: "linux", spawn });
  assert.equal(none.available(), false);
  const events = [];
  none.listen({ language: "en-US", onEvent: (event) => events.push(event) });
  assert.deepEqual(events, [{ type: "error", code: "unavailable" }, { type: "end" }]);
  const dir = path.join(ROOT, "electron");
  const windows = createSystemSpeech({ platform: "win32", dir, fs: existing([path.join(dir, "speech", "oh-speech-windows.exe")]), spawn });
  const refused = [];
  windows.listen({ language: "en-US & calc", onEvent: (event) => refused.push(event) });
  assert.deepEqual(refused, [{ type: "error", code: "language" }, { type: "end" }]);
  assert.equal(started, 0);
});

test("every build ships the program outside its archive, and macOS says why it wants speech recognition", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.build.asarUnpack.includes("electron/speech/**"));
  assert.ok(pkg.build.files.includes("!electron/speech/*.{cs,swift,plist}"));
  assert.match(pkg.build.mac.extendInfo.NSSpeechRecognitionUsageDescription, /Advisor/);
  for (const file of ["electron-builder.beta.yml", "electron-builder.multiplayer.yml"]) {
    const yml = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(yml, /^asarUnpack:\r?\n(?: {2}.*\r?\n)*? {2}- electron\/speech\/\*\*\r?$/m, file);
    assert.match(yml, /^ {4}NSSpeechRecognitionUsageDescription: .*Advisor/m, file);
  }
  const plist = fs.readFileSync(path.join(ROOT, "electron", "speech", "macos-Info.plist"), "utf8");
  assert.match(plist, /<key>NSSpeechRecognitionUsageDescription<\/key>/);
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>/);
  for (const workflow of ["desktop-beta.yml", "desktop-installer.yml"]) {
    const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", workflow), "utf8");
    assert.match(yml, /node scripts\/build-speech-helpers\.mjs \$\{\{ matrix\.args \}\} --required/, workflow);
  }
});

const builtWindowsProgram = path.join(ROOT, "electron", "speech", "oh-speech-windows.exe");
test("the Windows program, where it is built, reports the dictation languages", { skip: process.platform !== "win32" || !fs.existsSync(builtWindowsProgram) }, () => {
  const run = spawnSync(builtWindowsProgram, ["probe"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  const probe = JSON.parse(run.stdout.trim());
  assert.equal(probe.type, "probe");
  assert.ok(Array.isArray(probe.languages));
  assert.ok([true, false, null].includes(probe.privacy));
});
