/*! Open Historia — the first file the desktop app runs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// package.json's "main". It decides which copy of the app's files this start
// runs from, and runs it: the ones the installer put in app.asar, or a newer set
// an update put together in the player's data folder out of the chunks that had
// changed (electron/payloadUpdate.cjs). The rules are in payloadBoot.cjs.
//
// This file and the two it requires are the part of the app an update made of
// chunks never replaces: the copy that runs is always the installed one. Keep
// it this small, and raise PROTOCOL (payloadBoot.cjs) when what it does for a
// set of files changes.

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const boot = require("./payloadBoot.cjs");
const { BETA_APP_NAME, readChannel } = require("./channel.cjs");
const { MULTIPLAYER_APP_NAME } = require("./channel.cjs");

// Before the data folder is asked for: Electron names it after the app, and
// the beta has a name, and so a folder, of its own (see main.cjs).
if (readChannel(__dirname) === "beta") app.setName(BETA_APP_NAME);
// So has the multiplayer build. Unnamed here, it would ask for the official
// app's data folder, and Electron keeps the first answer: its saves would be
// the official app's, and a set of files an update left there would be run in
// its place, which is the official game without multiplayer.
const IS_MULTIPLAYER = readChannel(__dirname) === "multiplayer";
if (IS_MULTIPLAYER) app.setName(MULTIPLAYER_APP_NAME);

const bundledBuild = () => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, "build-id.json"), "utf8")).build || "");
  } catch {
    return ""; // a dev build: unstamped, and never updated
  }
};

// The multiplayer build has no feed, so nothing in its data folder is an update
// of its own, and main.cjs starts no updater on this channel: it only ever runs
// the files its installer put down. The switch below is thrown for it.
if (IS_MULTIPLAYER) process.env.OH_NO_PAYLOAD = "1";

let chosen = { root: null, build: "", reason: IS_MULTIPLAYER ? "the multiplayer build takes no updates" : "unpackaged" };
let payloadDir = "";
// Never for a dev run: `electron .` runs the working tree, whatever a packaged
// app of the same name left in the data folder. OH_NO_PAYLOAD=1 is the same
// switch for a packaged app, for telling a fault in an update from a fault in
// the app.
if (app.isPackaged && process.env.OH_NO_PAYLOAD !== "1") {
  try {
    payloadDir = path.join(app.getPath("userData"), boot.PAYLOAD_FOLDER);
    chosen = boot.choosePayload({ payloadDir, bundledBuild: bundledBuild(), shell: boot.shellOf() });
    if (chosen.root) boot.beginBoot(payloadDir);
    boot.sweep(payloadDir, chosen.root ? chosen.build : "");
  } catch (error) {
    chosen = { root: null, build: "", reason: `unreadable (${error?.message || error})` };
  }
}

// What the files that run are told: where they are, and how to say the game's
// window came up (main.cjs calls it once it has).
globalThis.__ohPayload = {
  root: chosen.root,
  build: chosen.build,
  reason: chosen.reason,
  dir: payloadDir,
  confirm: () => {
    if (!chosen.root) return;
    try {
      boot.confirmBoot(payloadDir);
    } catch {
      /* the count stays; the next start that gets this far clears it */
    }
  },
};

if (!chosen.root) {
  require("./main.cjs");
} else {
  try {
    require(path.join(chosen.root, ...boot.ENTRY_FILE.split("/")));
  } catch (error) {
    // It could not even be loaded. This process has half-run it, so the
    // installed files are started in a fresh one, and that set is not tried
    // again.
    console.error("[bootstrap] the updated files could not be started; going back to the installed ones.", error);
    boot.markBad(payloadDir, chosen.build);
    app.relaunch();
    app.exit(0);
  }
}
