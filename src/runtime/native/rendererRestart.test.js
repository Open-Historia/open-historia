/*! Open Historia — the page's renderer, gone and started again: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/rendererRestart.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { describeRendererRestart, reportRendererRestart } from "./rendererRestart.js";

const note = { at: Date.UTC(2026, 8, 29, 12, 0, 0), crashed: false, priority: 2, recent: 1, restarted: true };

test("a renderer Android stopped: logged as a memory restart, flagged as a problem", async () => {
  const logged = [];
  const entry = await reportRendererRestart({
    plugin: { lastRestart: async () => note },
    log: (...args) => logged.push(args),
  });
  assert.equal(entry.message, "Android stopped the page's renderer to free memory and the app started the page again.");
  assert.equal(logged.length, 1);
  const [category, message, detail, options] = logged[0];
  assert.equal(category, "app");
  assert.equal(message, entry.message);
  assert.equal(detail.at, "2026-09-29T12:00:00.000Z");
  assert.equal(detail.rendererPriority, "important");
  assert.equal(detail.crashed, false);
  assert.deepEqual(options, { problem: true });
});

test("a crash, and the fourth death in a minute, say so", () => {
  assert.match(describeRendererRestart({ ...note, crashed: true }).message, /^The page's renderer crashed and the app started/);
  assert.match(describeRendererRestart({ ...note, restarted: false, recent: 4 }).message, /fourth time in a minute, and the app closed\.$/);
});

test("nothing happened, or no app: nothing is logged", async () => {
  const logged = [];
  const log = (...args) => logged.push(args);
  assert.equal(await reportRendererRestart({ plugin: { lastRestart: async () => ({}) }, log }), null);
  assert.equal(await reportRendererRestart({ plugin: { lastRestart: async () => { throw new Error("no bridge"); } }, log }), null);
  assert.equal(await reportRendererRestart({ log }), null, "outside the app there is no plugin");
  assert.equal(logged.length, 0);
});

test("the app wires both halves", () => {
  const read = (relative) => fs.readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");
  assert.match(read("src/main.jsx"), /if \(import\.meta\.env\.VITE_OH_NATIVE\) void reportRendererRestart\(\);/);
  const javaDir = "mobile/android/app/src/main/java/io/github/arkniem/openhistoria";
  const activity = read(`${javaDir}/MainActivity.java`);
  assert.match(activity, /registerPlugin\(RendererRestartPlugin\.class\);/);
  assert.match(activity, /public boolean onRenderProcessGone\(WebView view, RenderProcessGoneDetail detail\) \{\s*return restartAfterRendererGone\(view, detail\);/);
  assert.match(activity, /view != webView\(\)\) \{[\s\S]*?return true;/, "a death is counted once, by the live WebView");
  assert.match(activity, /recreate\(\);\s*return true;/);
  const plugin = read(`${javaDir}/RendererRestartPlugin.java`);
  assert.match(plugin, /@CapacitorPlugin\(name = "OhRenderer"\)/);
  assert.match(plugin, /public void lastRestart\(PluginCall call\)/);
});
