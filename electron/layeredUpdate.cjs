/*! Open Historia — one updater in front of two ways to update © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The app can now take an update two ways: the chunks that changed
// (electron/payloadUpdate.cjs), or the whole installer (electron-updater), which
// is what a release that needs a newer Electron still takes. Everything that
// drives an update (the launch screen, the banner's routes) was written against
// electron-updater's updater, so this has that updater's shape: the same
// methods, the same events. Chunks are tried first, and the installer is what
// it falls back to, at the check and again if the chunks cannot be fetched or
// put together.
//
// Dependency-free but for node's events; the two updaters are handed in.

const { EventEmitter } = require("node:events");

// How much of the progress bar is the download when an update is made of chunks.
const DOWNLOAD_SHARE = 0.6;

const createLayeredUpdater = ({
  installer = null,
  payload = null,
  // The version of the files that are RUNNING, which after an update made of
  // chunks is newer than the installed ones electron-updater compares against.
  runningVersion = "",
  // Start the app again, into the files the chunks were put together as.
  relaunch,
  log = () => {},
}) => {
  const events = new EventEmitter();
  // Which of the two the update found is coming by, once one is found.
  let mode = "";
  let manifest = null;

  // The installer's own progress and outcome are passed on only while an
  // installer update is what is under way. What it says while it CHECKS is not
  // passed on: the answer is decided here (see viaInstaller).
  if (installer) {
    for (const name of ["download-progress", "update-downloaded", "error"]) {
      installer.on(name, (...args) => {
        if (mode === "installer") events.emit(name, ...args);
      });
    }
  }

  const nothing = (info = {}) => {
    mode = "";
    events.emit("update-not-available", info);
    return { isUpdateAvailable: false, updateInfo: info };
  };

  const viaInstaller = async () => {
    if (!installer) return nothing();
    const result = await installer.checkForUpdates();
    // electron-updater answers null when it declines to run at all (an AppImage
    // started outside its bundle). Passed on as it is: the caller tells the two
    // apart.
    if (!result) {
      mode = "";
      return result;
    }
    if (!result.isUpdateAvailable) return nothing(result.updateInfo ?? {});
    // The installed files are older than the running ones after an update made
    // of chunks, so the installer's feed offers the release this app is already
    // on. That is not an update.
    if (runningVersion && String(result.updateInfo?.version ?? "") === String(runningVersion)) return nothing(result.updateInfo);
    mode = "installer";
    events.emit("update-available", result.updateInfo ?? {});
    return result;
  };

  const checkForUpdates = async () => {
    events.emit("checking-for-update");
    if (payload) {
      try {
        const answer = await payload.check();
        if (answer.state === "available") {
          mode = "payload";
          manifest = answer.manifest;
          const info = { version: String(manifest.version || manifest.build) };
          events.emit("update-available", info);
          return { isUpdateAvailable: true, updateInfo: info };
        }
        if (answer.state === "none") return nothing();
        log("info", `this update comes by the installer: ${answer.reason}`);
      } catch (error) {
        log("warn", `the update's chunks could not be looked up (${error?.message || error}); asking the installer's feed`);
      }
    }
    return viaInstaller();
  };

  const downloadUpdate = async () => {
    if (mode === "installer") return installer.downloadUpdate();
    if (mode !== "payload") throw new Error("No update has been found to download.");
    const version = String(manifest.version || manifest.build);
    try {
      const done = await payload.apply(manifest, {
        // One bar for the whole of it. Fetching the chunks is the smaller part
        // of the wait on a fast line (a few megabytes); putting ten thousand
        // files in place is the rest.
        onProgress: (progress) => {
          if (progress.phase === "downloading") events.emit("download-progress", { percent: Math.round(progress.percent * DOWNLOAD_SHARE) });
          else if (progress.phase === "building") events.emit("download-progress", { percent: Math.round(100 * DOWNLOAD_SHARE + progress.percent * (1 - DOWNLOAD_SHARE)) });
        },
      });
      events.emit("update-downloaded", { version });
      return done;
    } catch (error) {
      log("warn", `the update could not be made from its chunks (${error?.message || error})`);
      // The same release, whole. Where there is no installer to fall back to
      // the failure is the update's.
      let whole = null;
      try {
        whole = await viaInstaller();
      } catch (installerError) {
        log("warn", `the installer's feed could not be read either (${installerError?.message || installerError})`);
      }
      if (!whole?.isUpdateAvailable) {
        mode = "";
        events.emit("error", error);
        throw error;
      }
      return installer.downloadUpdate();
    }
  };

  // electron-updater's signature. An update made of chunks has nothing to
  // install: the files are in place and the next start runs from them.
  const quitAndInstall = (isSilent, isForceRunAfter) => {
    if (mode === "installer") return installer.quitAndInstall(isSilent, isForceRunAfter);
    return relaunch();
  };

  return {
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on: (name, listener) => events.on(name, listener),
    removeListener: (name, listener) => events.removeListener(name, listener),
    get mode() { return mode; },
  };
};

module.exports = { createLayeredUpdater };
