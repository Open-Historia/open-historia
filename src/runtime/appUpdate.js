/*! Open Historia — in-app update-check helpers © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Pure, dependency-free so the version comparison is unit-tested without a browser
// or a running server. The banner (AppUpdateBanner.jsx) is the only consumer.
//
// Why the check goes through the app's OWN server (/api/app-update) rather than
// fetching GitHub from the client: the game runs at the embedded server's origin
// (127.0.0.1:3000), NOT the Capacitor origin, so it has no native-HTTP bridge and a
// direct fetch to a GitHub release asset is subject to WebView CORS. The server
// fetches server-side (no CORS) and caches the result for the same window below, so
// thousands of clients polling every few minutes still hit GitHub only ~20x/hour per
// device — against a CDN release asset, never the 60/hour REST API. That keeps it
// safe even behind shared carrier IPs.

// Effective poll cadence (the server caches for the same window, so this is also the
// real GitHub lookup rate per device).
export const APP_UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;
// A re-check when the app regains focus, throttled so rapid focus flips can't hammer it.
export const APP_UPDATE_REFOCUS_THROTTLE_MS = 60 * 1000;

// A positive integer build number, or null for anything else (dev/web/desktop have
// no stamped build, so they can never see an "update available").
export const toBuild = (value) => {
  // Number(symbol) throws; guard so a hostile/unexpected value can never crash a check.
  if (value == null || typeof value === "symbol") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

// Normalize an /api/app-update payload into { build, apk, notes }, or null if it
// carries no usable build number.
export const parseUpdateManifest = (data) => {
  if (!data || typeof data !== "object") return null;
  const build = toBuild(data.build);
  if (build == null) return null;
  return {
    build,
    apk: typeof data.apk === "string" ? data.apk.trim() : "",
    notes: typeof data.notes === "string" ? data.notes.trim() : "",
  };
};

// True only when `latest` is a well-formed manifest describing a build strictly newer
// than the running one. A null/invalid current build (dev, web, desktop) is never an
// update.
export const isUpdateAvailable = (currentBuild, latest) => {
  const current = toBuild(currentBuild);
  const manifest = parseUpdateManifest(latest);
  if (current == null || !manifest) return false;
  return manifest.build > current;
};
