/*! Open Historia — content-node updater tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/nodeUpdater.test.js
//
// scripts/node-updater.mjs used to record the offered version as installed the
// moment it had staged the files, before anything applied them. A node whose
// apply step failed or never ran then claimed the new version, kept running the
// old code, and was never offered that update again.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateUpdate, readInstalledVersion, stageAndApply } from "../scripts/node-updater.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const FILES = { "a.url": "server code", "b.url": "more code" };
const fakeFetch = async (u) => Buffer.from(FILES[u] ?? "unexpected");
const manifest = (version = 2, artifacts = [
  { path: "server/server.js", url: "a.url", sha256: sha("server code") },
  { path: "README.md", url: "b.url", sha256: sha("more code") },
]) => ({ version, channel: "stable", artifacts });

const installDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-node-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, ".node-version.json"), JSON.stringify({ version: 1 }));
  return dir;
};

const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
};

test("the version is recorded only after the apply hook succeeds", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const seen = [];
  const result = await stageAndApply({
    version: 2,
    updateManifest: manifest(),
    installDir: dir,
    applyCommand: "apply",
    fetchImpl: fakeFetch,
    runApply: async (command, context) => {
      seen.push({ command, staged: fs.readFileSync(path.join(context.stageDir, "server", "server.js"), "utf8") });
      assert.equal(readInstalledVersion(dir), 1, "not recorded before the hook has run");
      return 0;
    },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(seen, [{ command: "apply", staged: "server code" }]);
  assert.equal(readInstalledVersion(dir), 2);
  assert.equal(fs.existsSync(result.stageDir), false);
});

test("a failed apply keeps the old version, so the same update is offered again", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const result = await stageAndApply({
    version: 2,
    updateManifest: manifest(),
    installDir: dir,
    applyCommand: "apply",
    fetchImpl: fakeFetch,
    runApply: async () => 1,
  });
  assert.deepEqual([result.applied, result.reason], [false, "apply-failed"]);
  assert.equal(readInstalledVersion(dir), 1);
  const again = evaluateUpdate({ installedVersion: readInstalledVersion(dir), updateManifest: manifest() });
  assert.deepEqual([again.shouldUpdate, again.version], [true, 2]);
});

test("with no apply hook the update is staged but not recorded", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const result = await stageAndApply({ version: 2, updateManifest: manifest(), installDir: dir, applyCommand: "", fetchImpl: fakeFetch });
  assert.deepEqual([result.applied, result.reason], [false, "no-apply-hook"]);
  assert.equal(fs.readFileSync(path.join(result.stageDir, "README.md"), "utf8"), "more code");
  assert.equal(readInstalledVersion(dir), 1);
});

test("the real hook runs through the shell and its exit code decides", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const node = JSON.stringify(process.execPath);
  const failing = await stageAndApply({
    version: 2, updateManifest: manifest(), installDir: dir, fetchImpl: fakeFetch,
    applyCommand: `${node} -e "process.exit(3)"`,
  });
  assert.equal(failing.applied, false);
  assert.equal(readInstalledVersion(dir), 1);
  const passing = await stageAndApply({
    version: 2, updateManifest: manifest(), installDir: dir, fetchImpl: fakeFetch,
    applyCommand: `${node} -e "process.exit(process.env.OH_NODE_VERSION === '2' && require('fs').existsSync(process.env.OH_NODE_STAGED_DIR) ? 0 : 5)"`,
  });
  assert.equal(passing.applied, true);
  assert.equal(readInstalledVersion(dir), 2);
});

test("an artifact with no sha256 is refused and nothing is staged", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const unchecked = manifest(2, [
    { path: "server/server.js", url: "a.url", sha256: sha("server code") },
    { path: "extra.js", url: "b.url" },
  ]);
  let applied = false;
  await assert.rejects(
    stageAndApply({ version: 2, updateManifest: unchecked, installDir: dir, applyCommand: "apply", fetchImpl: fakeFetch, runApply: async () => { applied = true; return 0; } }),
    /has no sha256/,
  );
  assert.equal(applied, false);
  assert.equal(fs.existsSync(path.join(dir, ".staged-2")), false);
  assert.equal(readInstalledVersion(dir), 1);
});

test("an artifact whose bytes do not match its sha256 is refused", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const tampered = manifest(2, [{ path: "server/server.js", url: "a.url", sha256: sha("something else") }]);
  await assert.rejects(
    stageAndApply({ version: 2, updateManifest: tampered, installDir: dir, applyCommand: "apply", fetchImpl: fakeFetch, runApply: async () => 0 }),
    /failed hash check/,
  );
  assert.equal(readInstalledVersion(dir), 1);
});

test("an artifact path that climbs out of the staging folder is refused", async (t) => {
  quiet(t);
  const dir = installDir(t);
  const escaping = manifest(2, [{ path: "../../outside.js", url: "a.url", sha256: sha("server code") }]);
  await assert.rejects(
    stageAndApply({ version: 2, updateManifest: escaping, installDir: dir, applyCommand: "apply", fetchImpl: fakeFetch, runApply: async () => 0 }),
    /outside the staging folder/,
  );
});
