/*! Open Historia — update banner download tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/desktopDownload.test.js
//
// latest.json names the Apple Silicon zip for every Mac, and an Intel Mac
// cannot open it. The banner offers each Mac the zip built for its own chip.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { desktopDownloadFor } from "./desktopDownload.js";

const BETA = "https://github.com/Open-Historia/open-historia/releases/download/desktop-beta";
const manifest = {
  build: "41750144073",
  windows: `${BETA}/Open-Historia-Beta-Setup.exe`,
  mac: `${BETA}/Open-Historia-Beta-mac-arm64.zip`,
  linux: `${BETA}/Open-Historia-Beta-x86_64.AppImage`,
};

test("an Apple Silicon Mac is offered the arm64 zip", () => {
  assert.equal(desktopDownloadFor(manifest, { platform: "darwin", arch: "arm64" }), `${BETA}/Open-Historia-Beta-mac-arm64.zip`);
});

test("an Intel Mac is offered the x64 zip", () => {
  assert.equal(desktopDownloadFor(manifest, { platform: "darwin", arch: "x64" }), `${BETA}/Open-Historia-Beta-mac-x64.zip`);
});

test("Windows and Linux are offered their own installers", () => {
  assert.equal(desktopDownloadFor(manifest, { platform: "win32", arch: "x64" }), manifest.windows);
  assert.equal(desktopDownloadFor(manifest, { platform: "linux", arch: "x64" }), manifest.linux);
});

test("a feed without a download for this system offers none", () => {
  assert.equal(desktopDownloadFor({}, { platform: "darwin", arch: "x64" }), "");
  assert.equal(desktopDownloadFor(null, { platform: "darwin", arch: "arm64" }), "");
  assert.equal(desktopDownloadFor({ mac: 7 }, { platform: "darwin", arch: "arm64" }), "");
  assert.equal(desktopDownloadFor(manifest, { platform: "freebsd", arch: "x64" }), "");
});

// The swap only works while both workflows publish the two zips under these
// names; a rename there has to come here too.
test("both release workflows publish the Intel zip beside the Apple Silicon one", () => {
  const beta = fs.readFileSync(new URL("../electron-builder.beta.yml", import.meta.url), "utf8");
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(beta, /artifactName:\s*Open-Historia-Beta-mac-\$\{arch\}\.\$\{ext\}/);
  assert.equal(pkg.build.mac.artifactName, "Open-Historia-mac-${arch}.${ext}");
  const arches = pkg.build.mac.target.flatMap((target) => target.arch);
  assert.ok(arches.includes("x64") && arches.includes("arm64"));
  assert.match(beta, /\nmac:\s*\n\s*target:\s*\n\s*- target: zip\s*\n\s*arch:\s*\n\s*- x64\s*\n\s*- arm64/);
});
