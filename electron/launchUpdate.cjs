/*! Open Historia — installing a waiting update when the game opens © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Opening the game installs a waiting update first; the update banner is for an
// update found while the game is already open (asked for 2026-09-29). main.cjs
// runs this before the game window: the check is quick and shows nothing, and
// only an update actually found opens the setup window, downloads with a
// progress bar and restarts into the new version (silently: the installer is
// assisted and per-user, see main.cjs's restart).
//
// Offline, a feed slower than the timeout, a failed download, or the player
// choosing to open the game now: the game opens as it always did, a download
// already under way carries on and installs when the game is next closed
// (autoInstallOnAppQuit), and the banner offers the update once the game is up.
// A version that failed to download at launch twice is not tried at launch again
// (the banner still offers it), so a broken update cannot hold every launch up.
//
// No electron in here: main.cjs hands in the updater and the setup window, so it
// is tested in node (server/launchUpdate.test.js).

const LAUNCH_CHECK_TIMEOUT_MS = 6000;
const LAUNCH_FAILURE_LIMIT = 2;
const INSTALL_DELAY_MS = 600;

const percentOf = (progress) => Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));

const readRecord = (fs, file) => {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record && typeof record === "object" ? record : {};
  } catch {
    return {};
  }
};
const writeRecord = (fs, file, record) => {
  try {
    fs.writeFileSync(file, JSON.stringify(record));
  } catch {
    /* best effort: the worst case is one more attempt */
  }
};

// Resolves to { installing, reason, version? }. `installing` true means the app is
// about to quit into the installer and nothing else should start.
const runLaunchUpdate = async ({
  updater,
  fs,
  recordFile,
  showWindow,
  send,
  waitForLater,
  log = () => {},
  checkTimeoutMs = LAUNCH_CHECK_TIMEOUT_MS,
  installDelayMs = INSTALL_DELAY_MS,
  setTimer = setTimeout,
}) => {
  if (!updater) return { installing: false, reason: "unsupported" };

  let result;
  try {
    result = await Promise.race([
      Promise.resolve(updater.checkForUpdates()),
      new Promise((resolve) => setTimer(() => resolve("timeout"), checkTimeoutMs)),
    ]);
  } catch (error) {
    log("warn", "updater.launchCheckFailed", String(error?.message || error));
    return { installing: false, reason: "check-failed" };
  }
  if (result === "timeout") return { installing: false, reason: "timeout" };
  // null: the updater declined to run (see main.cjs's download route).
  if (!result?.isUpdateAvailable) return { installing: false, reason: "current" };

  const version = String(result.updateInfo?.version || "");
  const record = readRecord(fs, recordFile);
  const failuresBefore = record.version === version ? Number(record.failures) || 0 : 0;
  if (failuresBefore >= LAUNCH_FAILURE_LIMIT) {
    log("warn", "updater.launchSkipped", `${version} failed at launch ${failuresBefore} times; the banner offers it instead.`);
    return { installing: false, reason: "failed-before", version };
  }

  await showWindow();
  send({ version, percent: 0 });
  const onProgress = (progress) => send({ version, percent: percentOf(progress) });
  updater.on("download-progress", onProgress);
  try {
    const outcome = await Promise.race([
      Promise.resolve(updater.downloadUpdate()).then(() => "downloaded"),
      Promise.resolve(waitForLater()).then(() => "later"),
    ]);
    if (outcome === "later") {
      log("info", "updater.launchLater", version);
      send({ version, opening: true });
      return { installing: false, reason: "later", version };
    }
    writeRecord(fs, recordFile, {});
    send({ version, percent: 100, installing: true });
    setTimer(() => updater.quitAndInstall(true, true), installDelayMs);
    return { installing: true, reason: "installing", version };
  } catch (error) {
    writeRecord(fs, recordFile, { version, failures: failuresBefore + 1, at: new Date().toISOString() });
    log("warn", "updater.launchFailed", String(error?.message || error), { version });
    send({ version, opening: true, failed: true });
    return { installing: false, reason: "download-failed", version };
  } finally {
    if (typeof updater.removeListener === "function") updater.removeListener("download-progress", onProgress);
  }
};

module.exports = { runLaunchUpdate, LAUNCH_CHECK_TIMEOUT_MS, LAUNCH_FAILURE_LIMIT };
