/*! Open Historia — what the player chose in the Windows installer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Windows installer's privacy page (build/installer.nsh) offers to switch
// off what the app does on its own with systems the player did not choose, as
// SignPath Foundation requires of the software it signs (docs/code-signing.md):
//
//   checkUpdates   asking GitHub for a newer version when the game opens and
//                  while it runs (electron/launchUpdate.cjs, /api/app-update)
//   countInstall   the one download that counts the install (electron/appFile.cjs)
//   discordLaunch  the link handler Windows keeps so Discord can start the game
//                  from a friend's invitation (main.cjs registerDiscordLaunch)
//
// It writes them to install-options.json beside the app's data. Anything else
// (no file: macOS, Linux, an install from before this, a silent update; a file
// that cannot be read) leaves every one on, as the app always was.

const INSTALL_OPTIONS_FILE = "install-options.json";
const DEFAULT_INSTALL_OPTIONS = Object.freeze({ checkUpdates: true, countInstall: true, discordLaunch: true });

const readInstallOptions = (fs, file) => {
  let saved = null;
  try {
    saved = JSON.parse(String(fs.readFileSync(file, "utf8")).replace(/^﻿/, ""));
  } catch {
    return { ...DEFAULT_INSTALL_OPTIONS };
  }
  const options = { ...DEFAULT_INSTALL_OPTIONS };
  if (saved && typeof saved === "object") {
    // Only an explicit false switches a thing off.
    for (const key of Object.keys(options)) if (saved[key] === false) options[key] = false;
  }
  return options;
};

module.exports = { INSTALL_OPTIONS_FILE, DEFAULT_INSTALL_OPTIONS, readInstallOptions };
