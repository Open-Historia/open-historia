/*! Open Historia — which build this is, and what the beta is called © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Read in two places that must agree: electron/bootstrap.cjs, which has to know
// the app's name before it can look in the player's data folder, and
// electron/main.cjs, which does everything else with it.

const fs = require("node:fs");
const path = require("node:path");

// One name for the beta: its Chromium profile, its save library, its window title
// and the Start Menu shortcut the installer creates. It has to match `productName`
// in electron-builder.beta.yml, because that is the name the player sees, and
// nothing derives one from the other.
const BETA_APP_NAME = "Open Historia Beta";

// Which build this is. scripts/stamp-channel.mjs writes electron/channel.json for
// the beta build (`npm run dist:win:beta` and the beta release workflow); the
// stable build ships no such file, reads "stable", and every branch that asks is
// the behaviour it has always had. OH_CHANNEL overrides it for `npm run electron`,
// which is the only way to exercise the beta paths unpackaged.
// `dir`: the electron/ folder the stamp sits in.
const readChannel = (dir, env = process.env) => {
  if (env.OH_CHANNEL) return String(env.OH_CHANNEL);
  try {
    const stamp = fs.readFileSync(path.join(dir, "channel.json"), "utf8");
    return String(JSON.parse(stamp).channel || "stable");
  } catch {
    return "stable"; // no stamp: the stable build, or a dev run
  }
};

module.exports = { BETA_APP_NAME, readChannel };
