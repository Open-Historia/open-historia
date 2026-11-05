/*! Open Historia — the desktop app's microphone permission: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/microphonePermission.test.js
//
// electron/microphone.cjs with a stand-in session: the microphone for the
// game's own page, nothing for any other page or for a camera, every other
// permission as Electron answers it by default, and macOS's own prompt.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { installMicrophonePermission } = require("../electron/microphone.cjs");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const fakeSession = () => {
  const session = {};
  session.setPermissionRequestHandler = (fn) => { session.request = fn; };
  session.setPermissionCheckHandler = (fn) => { session.check = fn; };
  return session;
};

const ask = (session, permission, details) => new Promise((resolve) => {
  session.request({ getURL: () => "" }, permission, resolve, details);
});

test("the microphone is the game's own page's, audio only", async () => {
  const session = fakeSession();
  installMicrophonePermission(session, { origin: () => "http://localhost:3001", platform: "win32" });
  assert.equal(await ask(session, "media", { requestingUrl: "http://localhost:3001/", mediaTypes: ["audio"] }), true);
  assert.equal(await ask(session, "media", { requestingUrl: "http://localhost:3000/", mediaTypes: ["audio"] }), false);
  assert.equal(await ask(session, "media", { requestingUrl: "https://example.com/", mediaTypes: ["audio"] }), false);
  assert.equal(await ask(session, "media", { requestingUrl: "http://localhost:3001/", mediaTypes: ["audio", "video"] }), false);
  assert.equal(await ask(session, "media", { requestingUrl: "http://localhost:3001/", mediaTypes: [] }), false);
  // Everything else is answered as Electron does with no handler.
  assert.equal(await ask(session, "notifications", { requestingUrl: "https://example.com/" }), true);
  assert.equal(session.check(null, "media", "http://localhost:3001", { mediaType: "audio" }), true);
  assert.equal(session.check(null, "media", "http://localhost:3001", { mediaType: "video" }), false);
  assert.equal(session.check(null, "media", "https://example.com", { mediaType: "audio" }), false);
  assert.equal(session.check(null, "clipboard-sanitized-write", "https://example.com", {}), true);
});

test("on macOS the system's own prompt decides", async () => {
  for (const [status, answer, expected] of [["granted", false, true], ["not-determined", true, true], ["denied", false, false]]) {
    const asked = [];
    const session = fakeSession();
    installMicrophonePermission(session, {
      origin: () => "http://localhost:3000",
      platform: "darwin",
      systemPreferences: {
        getMediaAccessStatus: () => status,
        askForMediaAccess: async (type) => { asked.push(type); return answer; },
      },
    });
    assert.equal(await ask(session, "media", { requestingUrl: "http://localhost:3000/", mediaTypes: ["audio"] }), expected, status);
    assert.deepEqual(asked, status === "granted" ? [] : ["microphone"]);
  }
});

test("every macOS build says why it wants the microphone", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.build.mac.extendInfo.NSMicrophoneUsageDescription, /Advisor/);
  for (const file of ["electron-builder.beta.yml", "electron-builder.multiplayer.yml"]) {
    const yml = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(yml, /^ {2}extendInfo:\r?\n {4}NSMicrophoneUsageDescription: .*Advisor/m, file);
  }
});
