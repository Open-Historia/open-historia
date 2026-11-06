/*! Open Historia — the app's file, read once per install © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Each installed application downloads one small text file of its own, once:
// on the first start after it is installed, or after it is updated to a build
// that has this. The files sit on the `app-files` release of the public
// repository, and GitHub counts how often each one is downloaded, which is how
// many installs each application has. The request is a plain GET: no id, no
// query string, nothing about the player or the game. A start that cannot
// reach GitHub (offline) leaves no mark and the next start tries again; once a
// download has gone through, the mark beside the app's data says so and no
// start downloads it again.
//
// Only the installed stable and beta apps do this. A development run
// (`npm run electron`, not packaged) and the multiplayer build never do; the
// website and the page code never do, because this is the desktop shell's own.
// The Android apps (mobile/android .../AppFile.java) and the native app keep
// their own file and their own mark.

const APP_FILE_RELEASE = "https://github.com/Open-Historia/open-historia/releases/download/app-files/";

// GitHub serves an uploaded "main app.txt" as main.app.txt: a space in an
// asset's name becomes a dot. The release page shows the spaced name.
const APP_FILES = Object.freeze({
  stable: "main.app.txt",
  beta: "beta.app.txt",
});

// The file this build downloads, or null for a build that downloads none.
const appFileFor = (channel) => (Object.hasOwn(APP_FILES, channel) ? APP_FILES[channel] : null);

const appFileUrl = (file) => `${APP_FILE_RELEASE}${file}`;

// Downloads this build's file unless the mark says it already has.
// Never throws: nothing here may stop the game from opening.
// Resolves to what happened: "not-counted" (no file for this build, or not
// installed), "done-before", "downloaded" or "failed".
const fetchAppFileOnce = async ({
  channel,
  packaged,
  markFile,
  fs,
  fetchImpl = globalThis.fetch,
  log = () => {},
  timeoutMs = 30_000,
  now = () => new Date(),
}) => {
  const file = appFileFor(channel);
  if (!file || !packaged || !markFile) return "not-counted";
  try {
    if (fs.existsSync(markFile)) return "done-before";
  } catch {
    return "failed";
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  timer?.unref?.();
  try {
    const response = await fetchImpl(appFileUrl(file), {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      credentials: "omit",
      signal: controller?.signal,
    });
    if (!response || !response.ok) {
      log("info", "appFile.later", `GitHub answered ${response?.status ?? "nothing"}; the next start tries again.`);
      return "failed";
    }
    // Read to the end, so the download is a whole one.
    await response.arrayBuffer?.();
    fs.writeFileSync(markFile, JSON.stringify({ file, at: now().toISOString() }));
    log("info", "appFile.done", `${file} downloaded once; it will not be downloaded again.`);
    return "downloaded";
  } catch (error) {
    log("info", "appFile.later", `${String(error?.message || error)}; the next start tries again.`);
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
};

module.exports = { APP_FILE_RELEASE, APP_FILES, appFileFor, appFileUrl, fetchAppFileOnce };
