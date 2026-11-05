/*! Open Historia — the Android app installs its own updates: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/appInstaller.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { canInstallUpdates, installUpdateWith } from "./appInstaller.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

// A stand-in for the native plugin: records calls, emits progress while installing.
const fakePlugin = ({ fail = null, progress = [] } = {}) => {
  const plugin = { installs: [], removed: 0, listeners: new Map() };
  plugin.addListener = async (event, fn) => {
    plugin.listeners.set(event, fn);
    return { remove: async () => { plugin.removed += 1; plugin.listeners.delete(event); } };
  };
  plugin.install = async (options) => {
    plugin.installs.push(options);
    for (const percent of progress) plugin.listeners.get("progress")?.({ percent });
    if (fail) throw new Error(fail);
  };
  return plugin;
};

test("downloads with progress, then hands the APK to Android's installer", async () => {
  const plugin = fakePlugin({ progress: [0, 12.4, 99.6, 140] });
  const seen = [];
  await installUpdateWith(plugin, "https://github.com/Open-Historia/open-historia/releases/download/android/open-historia.apk", {
    build: 16,
    onProgress: (percent) => seen.push(percent),
  });
  assert.deepEqual(plugin.installs, [{ url: "https://github.com/Open-Historia/open-historia/releases/download/android/open-historia.apk", build: 16 }]);
  assert.deepEqual(seen, [0, 12, 100, 100]);
  assert.equal(plugin.removed, 1, "the progress listener is removed afterwards");
});

test("no usable build number: always downloaded afresh", async () => {
  for (const build of [undefined, 0, -3, "x", NaN]) {
    const plugin = fakePlugin();
    await installUpdateWith(plugin, "https://example.org/a.apk", { build });
    assert.equal(plugin.installs[0].build, 0, String(build));
  }
});

test("a failed download rejects, and still removes its listener", async () => {
  const plugin = fakePlugin({ fail: "The update server answered 404." });
  await assert.rejects(installUpdateWith(plugin, "https://example.org/a.apk", { onProgress: () => {} }), /404/);
  assert.equal(plugin.removed, 1);
});

test("only https, and only with the plugin", async () => {
  await assert.rejects(installUpdateWith(fakePlugin(), "http://example.org/a.apk"), /https/);
  await assert.rejects(installUpdateWith(fakePlugin(), ""), /https/);
  await assert.rejects(installUpdateWith(null, "https://example.org/a.apk"), /cannot install/);
});

test("outside the app there is nothing to install with", () => {
  assert.equal(canInstallUpdates(), false);
});

// The Java side: the plugin exists, is registered before the bridge starts, and
// Android lets the app ask to install packages.
test("the native plugin is registered and allowed to install", () => {
  const java = read("../../../mobile/android/app/src/main/java/io/github/arkniem/openhistoria/UpdatePlugin.java");
  assert.match(java, /@CapacitorPlugin\(name = "OhUpdate"\)/);
  assert.match(java, /public void install\(PluginCall call\)/);
  assert.match(java, /public void cancel\(PluginCall call\)/);
  assert.match(java, /application\/vnd\.android\.package-archive/);
  assert.match(java, /FileProvider\.getUriForFile/);
  const activity = read("../../../mobile/android/app/src/main/java/io/github/arkniem/openhistoria/MainActivity.java");
  const register = activity.indexOf("registerPlugin(UpdatePlugin.class)");
  assert.ok(register > 0, "MainActivity registers it");
  assert.ok(register < activity.indexOf("super.onCreate(savedInstanceState)"), "before the bridge starts");
  const manifest = read("../../../mobile/android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  const paths = read("../../../mobile/android/app/src/main/res/xml/file_paths.xml");
  assert.match(paths, /<cache-path\b/, "the downloaded APK lives in the cache the FileProvider shares");
});
