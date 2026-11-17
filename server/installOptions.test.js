// Run: node --test server/installOptions.test.js
//
// The Windows installer's privacy page (build/installer.nsh), which SignPath
// Foundation requires of the software it signs: what the app does on its own
// with systems the player did not choose is named there, the privacy policy is
// linked, and each can be switched off at installation. The app honours it
// (electron/installOptions.cjs, main.cjs, server.js /api/app-update).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const { readInstallOptions, DEFAULT_INSTALL_OPTIONS, INSTALL_OPTIONS_FILE } = createRequire(import.meta.url)("../electron/installOptions.cjs");

const fakeFs = (content) => ({
  readFileSync: () => {
    if (content instanceof Error) throw content;
    return content;
  },
});

test("no file, or one that cannot be read, leaves everything on", () => {
  assert.deepEqual(DEFAULT_INSTALL_OPTIONS, { checkUpdates: true, countInstall: true, discordLaunch: true });
  assert.deepEqual(readInstallOptions(fakeFs(Object.assign(new Error("ENOENT"), { code: "ENOENT" })), "x"), DEFAULT_INSTALL_OPTIONS);
  assert.deepEqual(readInstallOptions(fakeFs("{not json"), "x"), DEFAULT_INSTALL_OPTIONS);
  assert.deepEqual(readInstallOptions(fakeFs("null"), "x"), DEFAULT_INSTALL_OPTIONS);
});

test("what the installer writes is read, and only an explicit false switches a thing off", () => {
  // As build/installer.nsh writes it, CRLF and all.
  const written = '{"checkUpdates":false,"countInstall":true,"discordLaunch":false}\r\n';
  assert.deepEqual(readInstallOptions(fakeFs(written), "x"), { checkUpdates: false, countInstall: true, discordLaunch: false });
  assert.deepEqual(readInstallOptions(fakeFs('﻿{"countInstall":false}'), "x"), { checkUpdates: true, countInstall: false, discordLaunch: true });
  assert.deepEqual(readInstallOptions(fakeFs('{"checkUpdates":0,"countInstall":"false"}'), "x"), DEFAULT_INSTALL_OPTIONS);
});

test("the installer's page names each thing, links the policy, and writes the file the app reads", () => {
  const nsh = read("build/installer.nsh");
  assert.match(nsh, /!macro customPageAfterChangeDir[\s\S]*Page custom OHPrivacyPageCreate OHPrivacyPageLeave\n!macroend/);
  assert.match(nsh, /https:\/\/openhistoria\.com\/privacy\//);
  for (const box of ["OHUpdateBox", "OHCountBox", "OHDiscordBox"]) assert.match(nsh, new RegExp(`\\$\\{NSD_CreateCheckbox\\}[^\\n]*\\n\\s*Pop \\$${box}\\n\\s*\\$\\{NSD_Check\\} \\$${box}`));
  assert.match(nsh, /FileWrite \$0 '\{"checkUpdates":\$OHUpdate,"countInstall":\$OHCount,"discordLaunch":\$OHDiscord\}\$\\r\$\\n'/);
  assert.ok(nsh.includes(`\\${INSTALL_OPTIONS_FILE}"`), "the same file name");
  // Where Electron keeps each build's data: package.json's name for the stable app, the set name (its
  // program's name) for the others. Not the product name, which the Windows beta shares with the stable app.
  assert.match(nsh, /!if "\$\{PRODUCT_FILENAME\}" == "Open Historia"\n\s*!define OH_DATA_DIR "\$APPDATA\\open-historia"\n\s*!else\n\s*!define OH_DATA_DIR "\$APPDATA\\\$\{PRODUCT_FILENAME\}"/);
  // The desktop-beta workflow deliberately stamps package.json before tests.
  // The beta must keep a different updater/deb package identity from stable.
  const channelStamp = path.join(ROOT, "electron", "channel.json");
  const channel = fs.existsSync(channelStamp)
    ? JSON.parse(read("electron/channel.json")).channel
    : "stable";
  const expectedPackageName = channel === "beta" ? "open-historia-beta" : "open-historia";
  assert.equal(JSON.parse(read("package.json")).name, expectedPackageName,
    "the package name must match the active release channel");
  // A silent update shows no page and leaves the player's answers alone.
  assert.match(nsh, /\$\{If\} \$OHPrivacyShown == "1"\n\s*CreateDirectory/);
});

test("the app does none of the three when switched off", () => {
  const main = read("electron/main.cjs");
  assert.match(main, /const INSTALL_OPTIONS = readInstallOptions\(fs, path\.join\(USER_ROOT, INSTALL_OPTIONS_FILE\)\);\nif \(!INSTALL_OPTIONS\.checkUpdates\) process\.env\.OH_UPDATE_CHECKS = "0";/);
  assert.match(main, /updater: INSTALL_OPTIONS\.checkUpdates \? updater : null,/);
  assert.match(main, /if \(INSTALL_OPTIONS\.countInstall\) void fetchAppFileOnce\(\{/);
  assert.match(main, /if \(!INSTALL_OPTIONS\.discordLaunch\) \{\n\s*try \{ app\.removeAsDefaultProtocolClient/);
  const server = read("server/server.js");
  assert.match(server, /if \(String\(process\.env\.OH_UPDATE_CHECKS \?\? ""\) === "0"\) \{\n\s*appUpdateReply\(res\);\n\s*return;\n\s*\}\n\s*if \(!manifestUrl\)/);
});
