/*! Open Historia — multiplayer packaging consistency tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/multiplayerPackaging.test.js
//
// The multiplayer desktop build is described in four places that have to agree:
//
//   electron-builder.multiplayer.yml  what is installed, and under which name
//   electron/main.cjs                 what the running app calls itself, which is
//                                     what gives it a profile of its own
//   scripts/stamp-channel.mjs         how the build learns it is the multiplayer one
//   package.json                      the script that builds it, and the stable
//                                     build, which none of this may touch
//
// Each disagreement fails on a player's machine and nowhere else: a build that
// installs over the official app, or opens the official app's saves, or offers the
// stable installer as an "update" and so walks its player out of multiplayer.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const builderYml = read("electron-builder.multiplayer.yml");
const betaYml = read("electron-builder.beta.yml");
const mainCjs = read("electron/main.cjs");
const stampChannel = read("scripts/stamp-channel.mjs");
const packageJson = JSON.parse(read("package.json"));

// A top-level block of a flat config, up to the next unindented line.
const block = (source, name) => {
  const lines = source.split(/\r?\n/);
  const at = lines.indexOf(`${name}:`);
  assert.notEqual(at, -1, `no ${name}: block`);
  const out = [];
  for (let index = at + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z#]/.test(lines[index])) break;
    out.push(lines[index]);
  }
  return out.join("\n");
};

const value = (source, key) => {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  assert.ok(match, `no ${key}:`);
  return match[1];
};

const listOf = (source, name) => block(source, name)
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*-\s*(.+?)\s*$/)?.[1])
  .filter(Boolean)
  .map((entry) => entry.replace(/^"(.*)"$/, "$1"));

test("the multiplayer build is its own application, beside the official app and the beta", () => {
  const appId = value(builderYml, "appId");
  const productName = value(builderYml, "productName");

  assert.notEqual(appId, packageJson.build.appId, "same appId as the official app: it would install over it");
  assert.notEqual(appId, value(betaYml, "appId"), "same appId as the beta: it would install over it");
  assert.notEqual(productName, packageJson.build.productName);
  assert.notEqual(productName, value(betaYml, "productName"));
  // The install folder takes productName only while it passes electron-builder's
  // allow-list; otherwise it falls back to package.json's `name`, the official
  // app's folder.
  assert.match(productName, /^[-_+0-9a-zA-Z .]+$/);
  // The running app renames itself to the same name: that is its own profile.
  assert.equal(mainCjs.match(/MULTIPLAYER_APP_NAME\s*=\s*"([^"]+)"/)?.[1], productName);
  assert.match(mainCjs, /if \(IS_BETA \|\| IS_MULTIPLAYER\) app\.setName\(APP_NAME\);/);
  // Its shortcut and uninstall entry say so too.
  assert.equal(value(block(builderYml, "nsis"), "shortcutName"), productName);
  assert.equal(value(block(builderYml, "nsis"), "uninstallDisplayName"), productName);
});

test("the multiplayer build never borrows the official app's map folder", () => {
  // The beta reads the official app's downloaded map; this build keeps its own.
  const assets = mainCjs.match(/const ASSETS_DIR = ([^;]+);/s)?.[1] ?? "";
  assert.match(assets, /IS_BETA && app\.isPackaged/);
  assert.doesNotMatch(assets, /MULTIPLAYER/);
});

test("the multiplayer build has no update feed, and never offers the stable installer", () => {
  assert.match(builderYml, /^publish: null\s*$/m, "a publish block would pack an app-update.yml");
  assert.match(mainCjs, /AUTO_UPDATE_SUPPORTED = [^;\n]*!IS_MULTIPLAYER/, "the updater would start");
  assert.match(mainCjs, /if \(!IS_MULTIPLAYER\) \{\s*process\.env\.OH_DESKTOP_BUILD/, "a build id would bring up the stable banner");
});

test("it packages what the official build packages, and its script stamps its channel", () => {
  assert.deepEqual(listOf(builderYml, "files"), packageJson.build.files);
  assert.match(stampChannel, /\["beta", "multiplayer"\]\.includes\(process\.argv\[2\]\)/);
  assert.equal(
    packageJson.scripts["dist:win:multiplayer"],
    "node scripts/stamp-channel.mjs multiplayer && npm run build && electron-builder --win --config electron-builder.multiplayer.yml",
  );
  assert.ok(fs.existsSync(new URL(`../${value(block(builderYml, "win"), "icon")}`, import.meta.url)), "the icon is missing");
});
