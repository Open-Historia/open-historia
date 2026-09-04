/*! Open Historia — beta packaging consistency tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test server/betaPackaging.test.js
//
// The beta desktop build is described in four places that have to agree and that
// nothing at runtime checks:
//
//   electron-builder.beta.yml      what is installed, and where it looks for updates
//   electron/main.cjs              what the running app thinks it is, and where the
//                                  update BANNER polls
//   .github/workflows/desktop-beta.yml  where the build is actually published
//   package.json                   the stable build, which none of this may touch
//
// Every way they can disagree fails silently on a player's machine: a tester is
// told an update exists by one feed while the installer feed points somewhere with
// nothing in it, or the banner offers a download URL for a filename electron-builder
// never produced, or the beta quietly ships without a file the stable build packages.
// So the disagreements are caught here instead.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const builderYml = read("electron-builder.beta.yml");
const mainCjs = read("electron/main.cjs");
const workflow = read(".github/workflows/desktop-beta.yml");
const packageJson = JSON.parse(read("package.json"));
const gitignore = read(".gitignore");

// A top-level block of the config, up to the next unindented line. Enough for a
// flat file like this one, and it keeps the tests free of a YAML dependency the
// project does not otherwise carry.
const block = (source, name) => {
  const lines = source.split(/\r?\n/);
  const at = lines.indexOf(`${name}:`);
  assert.notEqual(at, -1, `no ${name}: block in electron-builder.beta.yml`);
  const out = [];
  for (let index = at + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z#]/.test(lines[index])) break;
    out.push(lines[index]);
  }
  return out.join("\n");
};

const value = (source, key) => {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  assert.ok(match, `no ${key}: in the given block`);
  return match[1];
};

// The last path segment of a release-download URL is the release tag.
const tagOf = (url) => {
  const match = String(url).match(/releases\/download\/([^/"\s]+)/);
  assert.ok(match, `not a release-download URL: ${url}`);
  return match[1];
};

test("the beta's two update feeds and its workflow name one tag", () => {
  // What electron-updater downloads from (app-update.yml is built from this).
  const installerFeed = tagOf(value(block(builderYml, "publish"), "url"));
  // What makes the banner appear: server.js polls this and compares build ids.
  const bannerFeed = tagOf(mainCjs.match(/BETA_UPDATE_MANIFEST\s*=\s*"([^"]+)"/s)?.[1]
    ?? mainCjs.match(/BETA_UPDATE_MANIFEST\s*=\s*\r?\n\s*"([^"]+)"/)?.[1]
    ?? "");
  // Where the workflow actually puts the build.
  const published = workflow.match(/TAG:\s*\$\{\{\s*inputs\.tag\s*\|\|\s*'([^']+)'\s*\}\}/)?.[1];

  assert.equal(installerFeed, "desktop-beta");
  assert.equal(bannerFeed, installerFeed, "the banner would announce an update the installer feed cannot find");
  assert.equal(published, installerFeed, "the build is published somewhere neither feed reads");
});

test("the beta is a different application from the stable build", () => {
  const stable = packageJson.build;
  const appId = value(builderYml, "appId");
  const productName = value(builderYml, "productName");

  assert.notEqual(appId, stable.appId, "same appId: the beta would upgrade over the official app");
  assert.notEqual(productName, stable.productName, "same productName: same install folder and same userData");
  // productName is also the Windows install folder, but only while it matches
  // electron-builder's allow-list; anything else falls back to package.json's
  // `name` and lands the beta in the same …\Programs\open-historia as a stable
  // install. Parentheses are the easy way to trip this.
  assert.match(productName, /^[-_+0-9a-zA-Z .]+$/, "productName would not be used as the install folder name");
  // The running app renames itself to match, which is what gives the beta its own
  // Chromium profile and its own save library.
  assert.equal(mainCjs.match(/BETA_APP_NAME\s*=\s*"([^"]+)"/)?.[1], productName);

  assert.notEqual(
    tagOf(value(block(builderYml, "publish"), "url")),
    tagOf(stable.publish[0].url),
    "the beta would publish into the stable app's update feed",
  );
});

test("latest.json offers files electron-builder actually produces", () => {
  // The banner's download links. electron-builder writes ${arch}/${ext} into the
  // artifact names, so the two only agree by inspection — and a mismatch is a 404
  // a tester meets, not a failing build.
  const fill = (pattern, arch, ext) => pattern.replace("${arch}", arch).replace("${ext}", ext).replace("${os}", "");
  const expected = {
    windows: fill(value(block(builderYml, "nsis"), "artifactName"), "", "exe"),
    mac: fill(value(block(builderYml, "mac"), "artifactName"), "arm64", "zip"),
    linux: fill(value(block(builderYml, "linux"), "artifactName"), "x86_64", "AppImage"),
  };

  for (const [key, filename] of Object.entries(expected)) {
    const offered = workflow.match(new RegExp(`"${key}": "%s/([^"]+)"`))?.[1];
    assert.equal(offered, filename, `latest.json's ${key} link does not name the built artifact`);
  }
});

test("the workflow publishes the feed files electron-updater reads", () => {
  // Without latest*.yml at the tag, `publish` in the config points at nothing:
  // the banner still appears, pressing update fails, and nothing in CI notices.
  const files = workflow.match(/^\s*files=\((.+)\)\s*$/m)?.[1] ?? "";
  assert.match(files, /release\/latest\*\.yml/);
  assert.match(files, /release\/\*\.exe(?!\.)/);
  assert.match(files, /release\/\*-mac-\*\.zip/);
  assert.match(files, /release\/\*\.AppImage/);
});

test("the beta packages exactly what the stable build packages", () => {
  // --config replaces package.json's `build` block wholesale, so the two file
  // lists are maintained separately. A file added to one and not the other ships
  // a beta that is missing something the stable app has — the default scenario,
  // the language packs — and only shows up when a player opens the game.
  const listed = block(builderYml, "files")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/^"(.*)"$/, "$1"));

  assert.deepEqual(listed, packageJson.build.files);
  assert.equal(value(builderYml, "afterPack"), packageJson.build.afterPack);
});

test("the channel stamp is never committed", () => {
  // electron/channel.json is what tells a build it is the beta. Committed, it
  // would make the STABLE installer rename itself, move its saves and poll the
  // beta's update feed — all without a single line of code having changed.
  assert.match(gitignore, /^electron\/channel\.json$/m);
});
