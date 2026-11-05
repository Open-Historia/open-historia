/*! Open Historia — which build this is, for the Logging file © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The "Build:" line of the diagnostics log (debugLog.js). Triage starts with
// "which build?", and there are stable and beta Android apps, the website, and
// desktop channels, so the line names the one it is and its stamp.
//
// It used to be set from VITE_OH_WEB alone, which the Android build also sets,
// so every phone reported "web", and the desktop app and the zip's local server
// both said "desktop/local". Pure: main.jsx hands in import.meta.env.

export const buildLabel = (env = {}) => {
  // Checked first: the Android build is a web build too (VITE_OH_WEB is set).
  if (env.VITE_OH_NATIVE) {
    const track = String(env.VITE_APP_TRACK || "stable");
    const build = Number(env.VITE_APP_BUILD);
    return Number.isFinite(build) && build > 0 ? `android ${track} #${build}` : `android ${track}`;
  }
  if (env.VITE_OH_WEB) return env.VITE_WEB_BUILD ? `web ${env.VITE_WEB_BUILD}` : "web";
  if (env.DEV) return "dev";
  // The desktop app's build id is known only to its server (OH_DESKTOP_BUILD);
  // desktopBuildLabel refines this once /api/app-update has answered.
  return "desktop/local";
};

// From the /api/app-update reply's `current`, which only the server running
// inside the desktop app sets. An empty one leaves the label as it was.
export const desktopBuildLabel = (current) => (current ? `desktop #${current}` : "");
