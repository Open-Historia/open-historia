import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { APP_FILE_RELEASE, NATIVE_APP_FILE, fetchAppFileOnce } = await import(pathToFileURL(path.resolve(here, "..", "handlers", "update.mjs")).href);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-native-app-file-"));

const answering = (status, calls) => async (url, init) => {
  calls.push({ url, init });
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => new ArrayBuffer(4) };
};

test("an installed native app downloads its own file once, a plain GET, and marks it", async () => {
  const markFile = path.join(work, "once", "app-file.json");
  const calls = [];
  assert.equal(await fetchAppFileOnce({ installed: true, markFile, fetchImpl: answering(200, calls), now: () => new Date("2026-11-05T12:00:00Z") }), "downloaded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${APP_FILE_RELEASE}native.app.txt`);
  assert.equal(NATIVE_APP_FILE, "native.app.txt");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(JSON.parse(fs.readFileSync(markFile, "utf8")).file, "native.app.txt");
  assert.equal(await fetchAppFileOnce({ installed: true, markFile, fetchImpl: answering(200, calls) }), "done-before");
  assert.equal(calls.length, 1);
});

test("a failed or offline start leaves no mark, and the next start tries again", async () => {
  const markFile = path.join(work, "offline", "app-file.json");
  const calls = [];
  assert.equal(await fetchAppFileOnce({ installed: true, markFile, fetchImpl: answering(503, calls) }), "failed");
  assert.equal(fs.existsSync(markFile), false);
  assert.equal(await fetchAppFileOnce({ installed: true, markFile, fetchImpl: async () => { throw new Error("offline"); } }), "failed");
  assert.equal(fs.existsSync(markFile), false);
  assert.equal(await fetchAppFileOnce({ installed: true, markFile, fetchImpl: answering(200, calls) }), "downloaded");
  assert.equal(fs.existsSync(markFile), true);
});

test("a copy that was not installed by its installer downloads nothing", async () => {
  const calls = [];
  assert.equal(await fetchAppFileOnce({ installed: false, markFile: path.join(work, "dev", "app-file.json"), fetchImpl: answering(200, calls) }), "not-counted");
  assert.equal(calls.length, 0);
});

test("the native app counts itself only from an installed build with a version, never in a stand-in run", () => {
  const source = fs.readFileSync(path.resolve(here, "..", "handlers", "update.mjs"), "utf8");
  assert.match(source, /installed: Boolean\(current\?\.build\) && !ctx\.standIn && exists\(path\.join\(installRoot, INSTALL_MARKER\)\)/);
  assert.match(source, /markFile: path\.join\(ctx\.dataRoot, APP_FILE_MARK\)/);
});
