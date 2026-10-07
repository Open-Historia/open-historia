// Run: node --test server/updateChunksRelease.test.js
//
// The release side of an update made of chunks: cutting a packed app
// (scripts/build-update-chunks.mjs), deciding what goes up to the release and
// what may come off it (scripts/publish-update-chunks.mjs), and the wiring that
// has to stay in step across the workflows, the shell and package.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildUpdateChunks } from "../scripts/build-update-chunks.mjs";
import { planPublish, settledStale } from "../scripts/publish-update-chunks.mjs";

const require = createRequire(import.meta.url);
const { FORMAT, chunkAssetName, manifestAssetName, readHead, readManifest, sha256 } = require("../electron/payloadChunks.cjs");
const { PROTOCOL } = require("../electron/payloadBoot.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-chunks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
// A packed app, as a folder: the few files the cutter reads by name, and some bulk.
const packedApp = (t, { build = "4242", extra = {} } = {}) => {
  const app = path.join(tempDir(t), "app");
  const files = {
    "package.json": JSON.stringify({ name: "open-historia", version: "0.0.77" }),
    "electron/build-id.json": JSON.stringify({ build }),
    "electron/payloadBoot.cjs": fs.readFileSync(path.join(ROOT, "electron/payloadBoot.cjs"), "utf8"),
    "electron/main.cjs": "// the shell\n",
    "dist/index.html": "<!doctype html>",
    "dist/assets/index-AAAAAAAA.js": "x".repeat(400_000),
    "server/server.js": "// the server\n",
    ...extra,
  };
  for (const [name, data] of Object.entries(files)) {
    if (data === null) continue;
    const file = path.join(app, ...name.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  return app;
};

test("a packed app becomes a head, the manifest it names, and the chunks the manifest names", (t) => {
  const app = packedApp(t);
  const out = path.join(tempDir(t), "chunks");
  const result = buildUpdateChunks({ app, out, platform: "win", channel: "beta", electron: "44.1.2" });

  const head = JSON.parse(fs.readFileSync(path.join(out, "payload-win.json"), "utf8"));
  assert.deepEqual(readHead(head), { head, error: "" });
  assert.deepEqual(
    { format: head.format, build: head.build, version: head.version, channel: head.channel, platform: head.platform, shell: head.shell },
    { format: FORMAT, build: "4242", version: "0.0.77", channel: "beta", platform: "win", shell: { electron: "44.1.2", protocol: PROTOCOL } },
  );
  const manifestText = fs.readFileSync(path.join(out, head.manifest.name));
  assert.equal(head.manifest.name, manifestAssetName(sha256(manifestText)));
  assert.equal(head.manifest.size, manifestText.length);
  const { manifest, error } = readManifest(JSON.parse(manifestText.toString("utf8")));
  assert.equal(error, "");
  assert.deepEqual(manifest.files.map((file) => file.path), ["dist/assets/index-AAAAAAAA.js", "dist/index.html", "electron/build-id.json", "electron/main.cjs", "electron/payloadBoot.cjs", "package.json", "server/server.js"]);
  // Every chunk is a file of its own, named by what is in it, and nothing else is written.
  const names = fs.readdirSync(out).sort();
  assert.deepEqual(names, ["payload-win.json", head.manifest.name, ...Object.keys(manifest.chunks).map(chunkAssetName)].sort());
  for (const id of Object.keys(manifest.chunks)) assert.equal(sha256(fs.readFileSync(path.join(out, chunkAssetName(id)))), id);
  assert.match(result.summary, /^win 0\.0\.77 \(build 4242, Electron 44\.1\.2\): 7 files/);

  // The same app again: the same head, byte for byte, and no chunk written twice.
  const again = buildUpdateChunks({ app, out, platform: "win", channel: "beta", electron: "44.1.2" });
  assert.equal(again.written, 0);
  assert.equal(fs.readFileSync(path.join(out, "payload-win.json"), "utf8"), JSON.stringify(head));
  // Another system's build of the same files shares every chunk; only its head differs.
  buildUpdateChunks({ app, out, platform: "linux", channel: "beta", electron: "44.1.2" });
  assert.deepEqual(fs.readdirSync(out).filter((name) => name.startsWith("c-")).sort(), names.filter((name) => name.startsWith("c-")));
});

test("the cutter says how much of a release is new since the one before", (t) => {
  const out = path.join(tempDir(t), "chunks");
  const before = buildUpdateChunks({ app: packedApp(t), out, platform: "win", electron: "44.1.2" });
  const after = buildUpdateChunks({
    app: packedApp(t, { build: "4243", extra: { "server/server.js": "// the server, fixed\n" } }),
    out,
    platform: "win",
    electron: "44.1.2",
    previous: before.manifest,
  });
  assert.match(after.summary, /since build 4242: [12] of \d+ chunks are new/);
});

test("only a release build is cut: an unstamped app, or one from before the bootstrap, is refused", (t) => {
  const out = path.join(tempDir(t), "chunks");
  assert.throws(() => buildUpdateChunks({ app: packedApp(t, { build: "" }), out, platform: "win", electron: "44.1.2" }), /no build id/);
  assert.throws(() => buildUpdateChunks({ app: packedApp(t, { extra: { "electron/build-id.json": null } }), out, platform: "win", electron: "44.1.2" }), /no build id/);
  assert.throws(() => buildUpdateChunks({ app: packedApp(t, { extra: { "electron/payloadBoot.cjs": null } }), out, platform: "win", electron: "44.1.2" }), /Cannot find module/);
  assert.throws(() => buildUpdateChunks({ app: packedApp(t), out, platform: "windows", electron: "44.1.2" }), /--platform/);
});

const chunk = (letter) => `c-${letter.repeat(40)}.bin`;
const manifestName = (letter) => `m-${letter.repeat(40)}.json`;

test("only what the release does not hold goes up, and the head is the one file replaced", () => {
  const local = [chunk("a"), chunk("b"), chunk("c"), manifestName("1"), "payload-win.json", "notes.txt"];
  const first = planPublish({ local, remote: [] });
  assert.deepEqual(first.upload, [chunk("a"), chunk("b"), chunk("c"), manifestName("1")]);
  assert.deepEqual(first.heads, ["payload-win.json"]);
  assert.deepEqual(first.stale, [], "nothing comes off a release unless it is asked for");
  // The next release changed one chunk; the other systems' files are on the release too.
  const remote = [chunk("a"), chunk("b"), chunk("c"), manifestName("1"), "payload-win.json", "payload-mac.json", manifestName("2"), chunk("d")];
  const next = planPublish({ local: [chunk("a"), chunk("b"), chunk("e"), manifestName("3"), "payload-win.json"], remote });
  assert.deepEqual(next.upload, [chunk("e"), manifestName("3")]);
  assert.equal(next.after, remote.length + 2);
  assert.equal(next.full, false);
});

test("asked to prune, the chunks and manifests no head leads to come off, and nothing a head leads to", () => {
  const remote = [chunk("a"), chunk("b"), chunk("c"), chunk("d"), manifestName("1"), manifestName("2"), "payload-win.json", "payload-mac.json", "Open-Historia-Setup.exe"];
  // After this publish: windows' head leads to manifest 3 (a, b, e); the mac's still to manifest 2 (a, d).
  const referenced = new Set([manifestName("3"), chunk("a"), chunk("b"), chunk("e"), manifestName("2"), chunk("d")]);
  const plan = planPublish({ local: [chunk("a"), chunk("b"), chunk("e"), manifestName("3"), "payload-win.json"], remote, referenced });
  assert.deepEqual(plan.stale, [chunk("c"), manifestName("1")]);
  assert.ok(!plan.stale.includes("Open-Historia-Setup.exe"), "only files this system names are ever its to remove");
  assert.equal(plan.after, remote.length + 2 - 2);
});

test("pruning alone uploads nothing, and only what is old enough to be sure of comes off", () => {
  const remote = [chunk("a"), chunk("b"), chunk("c"), manifestName("1"), manifestName("2"), "payload-win.json", "latest.json"];
  // The one head leads to manifest 2, which names a and b.
  const plan = planPublish({ local: [], remote, referenced: new Set([manifestName("2"), chunk("a"), chunk("b")]) });
  assert.deepEqual([plan.upload, plan.heads], [[], []]);
  assert.deepEqual(plan.stale, [chunk("c"), manifestName("1")]);
  // A file uploaded in the last six hours may belong to a publish still under way.
  const now = Date.parse("2026-10-07T12:00:00Z");
  const born = new Map([[chunk("c"), "2026-10-07T09:30:00Z"], [manifestName("1"), "2026-10-01T00:00:00Z"]]);
  assert.deepEqual(settledStale(plan.stale, born, now), [manifestName("1")]);
  // And one whose age cannot be read is left where it is.
  assert.deepEqual(settledStale([chunk("c")], new Map(), now), []);
  // With no head to go by, nothing is known to be unneeded.
  assert.deepEqual(planPublish({ local: [], remote, referenced: null }).stale, []);
});

test("a release that is nearly full stops the publish instead of failing halfway through it", () => {
  const remote = Array.from({ length: 940 }, (unused, index) => `c-${String(index).padStart(40, "0")}.bin`);
  const local = Array.from({ length: 30 }, (unused, index) => `c-${String(index + 5000).padStart(40, "f")}.bin`);
  assert.equal(planPublish({ local, remote }).full, true);
  assert.equal(planPublish({ local: local.slice(0, 5), remote }).full, false);
});

test("the app starts at the bootstrap, and the release workflows publish chunks to the release the app reads", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.main, "electron/bootstrap.cjs");
  assert.ok(packageJson.build.files.includes("electron/**"), "the bootstrap and the updater are packed");
  const main = read("electron/main.cjs");
  const feed = main.match(/const PAYLOAD_FEED = `([^`]+)`;/)?.[1];
  assert.equal(feed, 'https://github.com/Open-Historia/open-historia/releases/download/${IS_BETA ? "desktop-beta-chunks" : "desktop-stable-chunks"}/');
  // The override is for a release served from this machine only.
  assert.match(main, /if \(\/\^http:\\\/\\\/\(\?:127\\\.0\\\.0\\\.1\|localhost\)\(\?::\\d\+\)\?\\\/\/\.test\(override\)\)/);
  for (const [workflow, channel, tag] of [
    [".github/workflows/desktop-installer.yml", "stable", "desktop-stable"],
    [".github/workflows/desktop-beta.yml", "beta", "desktop-beta"],
  ]) {
    const text = read(workflow);
    assert.match(text, new RegExp(`node scripts/build-update-chunks\\.mjs --app "\\$app" --out update-chunks --platform "\\$platform" --channel ${channel}\\n`), workflow);
    assert.match(text, /node scripts\/publish-update-chunks\.mjs --dir update-chunks --tag "\$\{TAG\}-chunks" --repo "\$\{\{ github\.repository \}\}"/, workflow);
    assert.ok(text.includes(tag), `${workflow} publishes to ${tag}, so its chunks go to ${tag}-chunks`);
    // A problem with the chunks never costs the release its installers.
    const step = text.slice(text.indexOf("- name: Cut the app's files into update chunks"), text.indexOf("- name: Upload as a build artifact"));
    assert.equal(step.match(/continue-on-error: true/g)?.length, 2, workflow);
    assert.ok(text.indexOf("- name: Publish the update chunks") < text.indexOf("- name: Attach to the"), `${workflow}: the chunks are up before the installers announce the build`);
    // Old chunks come off in a job of their own, after every system's build, never beside a publish.
    assert.match(text, /\n {2}prune-chunks:\n {4}needs: build\n {4}if: \$\{\{ !cancelled\(\) && \(/, workflow);
    assert.match(text, /node scripts\/publish-update-chunks\.mjs --prune-only --tag "\$\{TAG\}-chunks" --repo "\$\{\{ github\.repository \}\}"/, workflow);
    assert.doesNotMatch(text, /--prune-unreferenced/, `${workflow}: a publish never prunes`);
  }
});

test("what a set of files is told by the bootstrap is what main.cjs reads", () => {
  const bootstrap = read("electron/bootstrap.cjs");
  const main = read("electron/main.cjs");
  assert.match(bootstrap, /globalThis\.__ohPayload = \{/);
  assert.match(main, /globalThis\.__ohPayload\?\.confirm\?\.\(\);/);
  assert.match(main, /payloadDir: path\.join\(USER_ROOT, payloadBoot\.PAYLOAD_FOLDER\),/);
  assert.match(bootstrap, /payloadDir = path\.join\(app\.getPath\("userData"\), boot\.PAYLOAD_FOLDER\);/);
  // Never for a dev run, which runs the working tree.
  assert.match(bootstrap, /if \(app\.isPackaged && process\.env\.OH_NO_PAYLOAD !== "1"\) \{/);
});
