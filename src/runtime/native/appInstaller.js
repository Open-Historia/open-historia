/*! Open Historia — the Android app installs its own updates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The app used to answer "a new version exists" by sending the APK's address to
// the phone's browser, which downloaded it somewhere for the player to find and
// open. Now the app downloads it itself, with a progress bar, and hands it
// straight to Android's installer (UpdatePlugin.java, "OhUpdate"). Android always
// asks the player to confirm an install, and the first time it also asks them to
// allow installs from Open Historia; both are Android's own screens.
//
// The update is checked by Android against the installed app's signing key, so
// only an APK signed like the one installed can replace it.
import { nativePlugin, nativeReady } from "./bridge.js";

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

// The logic, free of the bridge so it can be tested: download `url` and open the
// installer, reporting progress. Resolves once Android's installer is on screen.
// `build` is the release's build number: an APK already downloaded for that
// build is installed again without downloading it twice.
export const installUpdateWith = async (plugin, url, { build, onProgress } = {}) => {
  if (!plugin || typeof plugin.install !== "function") throw new Error("This app cannot install updates itself.");
  if (!/^https:\/\//i.test(String(url || ""))) throw new Error("An update must come over https.");
  let listener = null;
  try {
    if (typeof onProgress === "function" && typeof plugin.addListener === "function") {
      listener = await plugin.addListener("progress", (event) => onProgress(clampPercent(event?.percent)));
    }
    const number = Math.floor(Number(build));
    await plugin.install({ url: String(url), build: Number.isFinite(number) && number > 0 ? number : 0 });
  } finally {
    try {
      await listener?.remove?.();
    } catch {
      /* the listener goes with the page anyway */
    }
  }
};

// In the app only; false on the website and the desktop.
export const canInstallUpdates = () => nativeReady() && Boolean(nativePlugin("OhUpdate"));

export const installUpdate = (url, options) => installUpdateWith(nativePlugin("OhUpdate"), url, options);

// Stops a download in progress; the pending install() rejects.
export const cancelUpdateDownload = async () => {
  try {
    await nativePlugin("OhUpdate")?.cancel?.();
  } catch {
    /* nothing was downloading */
  }
};
