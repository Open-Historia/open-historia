/*! Open Historia — in-app update-check helpers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

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

// The desktop updater states that will never change again on their own. A progress
// poll that sees one has nothing left to wait for and can stop; every OTHER state is
// transient and must keep it alive.
//
// Listing what is FINISHED rather than what is running, deliberately. The updater
// passes through "available" between finding an update and its first
// download-progress event, and a poll that only recognized "checking" and
// "downloading" tore itself down there and never restarted — leaving the banner
// frozen mid-update while the download ran to completion behind it. Written this way
// round, an unrecognized state keeps polling instead of silently stopping, so
// another lifecycle state can be added without reintroducing that freeze.
export const APP_UPDATE_SETTLED_STATES = ["ready", "error", "none"];

// Whether the app's own updater has come to rest. Anything unrecognized — including
// no reading at all — counts as still moving.
export const isUpdateSettled = (state) => APP_UPDATE_SETTLED_STATES.includes(state);

// Desktop release ids are opaque CI build ids. Keep the renderer's updater state
// tied to the exact release the player asked it to download: a "ready" result for
// an older build is not evidence that a newly-published build is ready too.
export const desktopUpdateProgressMatchesBuild = (progressBuild, availableBuild) => {
  const target = String(progressBuild ?? "").trim();
  const available = String(availableBuild ?? "").trim();
  return Boolean(target && available && target === available);
};

// If a newer release appears while an older attempt is still downloading, let the
// in-flight updater finish rather than starting two operations concurrently. Once
// that older attempt settles, however, its result is stale UI state and must not
// become "Restart now" for the newly-advertised build.
export const desktopUpdateProgressIsStale = (progressBuild, availableBuild, state) =>
  Boolean(
    String(progressBuild ?? "").trim()
      && String(availableBuild ?? "").trim()
      && !desktopUpdateProgressMatchesBuild(progressBuild, availableBuild)
      && isUpdateSettled(state),
  );

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

// What the banner says when the app's own updater gives up. The main process
// keeps electron-updater's message verbatim (main.cjs updateState.error) and the
// banner used to swallow it: a player saw "0%" flip back to "Update now" and
// nothing else. One sentence, the reason kept when there is one, clipped so a
// stack trace cannot take over the banner.
export const describeUpdateFailure = (error) => {
  const reason = String(error ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const clipped = reason.length > 160 ? `${reason.slice(0, 159)}…` : reason;
  return clipped ? `The app could not update itself: ${clipped}.` : "The app could not update itself.";
};

// Opening the game installs a waiting update; the banner is for one found while
// the game is open (asked for 2026-09-29). The desktop does it before its window
// opens (electron/launchUpdate.cjs). The website and the Android app can only do
// it from the page, so there "opening" is the FIRST check after the page loads,
// and only while the player can still be on the start screen: a first check
// that took longer than this answers with the banner instead, so a reload or an
// installer never lands in the middle of a turn.
export const LAUNCH_UPDATE_WINDOW_MS = 15 * 1000;
// Launch attempts per build before that build is left to the banner. A feed that
// names a build it cannot deliver (a website cache still serving the old bundle
// after the reload, an APK that is not the build its manifest says) would
// otherwise reload or download at every launch, for ever.
export const LAUNCH_UPDATE_ATTEMPT_LIMIT = 2;
export const LAUNCH_UPDATE_KEY = "oh-launch-update";

// How many launch attempts `build` has had, from the stored record (a JSON
// string, or anything unreadable = none). A record for another build is none.
export const launchUpdateAttempts = (stored, build) => {
  try {
    const record = JSON.parse(String(stored ?? ""));
    if (!record || typeof record !== "object" || String(record.build) !== String(build)) return 0;
    const attempts = Number(record.attempts);
    return Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  } catch {
    return 0;
  }
};

// The record after one more attempt at `build`.
export const recordLaunchUpdateAttempt = (stored, build) =>
  JSON.stringify({ build: String(build), attempts: launchUpdateAttempts(stored, build) + 1 });

// Whether a check's answer should update the game now rather than show the
// banner: the first check since the page opened, inside the launch window, for
// a build that has not already failed to take at launch.
export const shouldUpdateAtLaunch = ({ firstCheck, elapsedMs, build, stored }) =>
  Boolean(firstCheck)
  && Number.isFinite(elapsedMs)
  && elapsedMs >= 0
  && elapsedMs <= LAUNCH_UPDATE_WINDOW_MS
  && build != null
  && String(build) !== ""
  && launchUpdateAttempts(stored, build) < LAUNCH_UPDATE_ATTEMPT_LIMIT;
