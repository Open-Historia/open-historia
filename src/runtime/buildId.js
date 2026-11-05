/*! Open Historia — which build of the game is running © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The id of the build that is running, for what is to happen once per update:
// the vault door shows the first time the game opens after one
// (runtime/vaultDoorDue.js). Each kind of app learns its own a different way:
//
//   - the Android app: VITE_APP_BUILD, the number the APK workflow stamps in,
//     with its track (VITE_APP_TRACK), as the update banner reads it;
//   - the website: VITE_WEB_BUILD, the id vite.config.ts bakes into each web
//     build (and writes to version.json beside it);
//   - the desktop app: OH_DESKTOP_BUILD, the release workflow's stamp, which
//     only its server knows, and says with the app's kind (GET /api/app-kind,
//     server/appKind.js);
//   - anything else (a server started by hand, an unstamped desktop build, a
//     development run): the address of the running code.
//     A release build's files are named after a hash of their content, so a
//     new version has a new address; a development run's address never
//     changes, so there the door shows the first time and then only when
//     asked to every time.
//
// Ids carry their kind ("android-stable-412", "web-1760000000000",
// "desktop-18123456789", "bundle-/assets/main-AbC123.js"). Nothing here
// throws, and "" is a build that could not be learnt at all.

// How long the desktop app's server is given to answer. It is this computer's
// own, and answers at once; the startup screen waits for it.
export const SERVER_ASK_TIMEOUT_MS = 1500;

// The id stamped into this bundle, or "". Pure: the caller hands in
// import.meta.env.
export const stampedBuildId = (env = {}) => {
  // Checked first: the Android build is a web build too (VITE_OH_WEB is set).
  if (env.VITE_OH_NATIVE) {
    const build = Number(env.VITE_APP_BUILD);
    return Number.isFinite(build) && build > 0 ? `android-${String(env.VITE_APP_TRACK || "stable")}-${build}` : "";
  }
  const web = String(env.VITE_WEB_BUILD || "").trim();
  return web ? `web-${web}` : "";
};

// The desktop app's stamp, asked of its server, or "" (any other server, an
// unstamped build, no answer in time).
export const askServerBuild = async (fetchImpl, { timeoutMs = SERVER_ASK_TIMEOUT_MS } = {}) => {
  if (typeof fetchImpl !== "function") return "";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const kind = await Promise.race([
      (async () => {
        const response = await fetchImpl("/api/app-kind", { cache: "no-store", signal: controller?.signal });
        return response?.ok ? response.json() : null;
      })(),
      late,
    ]);
    const build = typeof kind?.build === "string" || typeof kind?.build === "number" ? String(kind.build).trim() : "";
    return build ? `desktop-${build}` : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
};

// The address of the running code, without its query or hash: in a release
// build, a file named after a hash of its content.
export const bundleBuildId = (moduleUrl = import.meta.url) => {
  try {
    const path = new URL(String(moduleUrl)).pathname;
    return path ? `bundle-${path}` : "";
  } catch {
    return "";
  }
};

const browserFetch = () => (typeof fetch === "function" ? (...args) => fetch(...args) : null);

// The running build's id (see above). Only the desktop app's own server is
// asked: the website and the Android app have none of their own (VITE_OH_WEB:
// the page answers their /api), and a development run's server has no stamp.
export const appBuildId = async ({ env = {}, fetchImpl = browserFetch(), moduleUrl = import.meta.url, timeoutMs } = {}) => {
  const stamped = stampedBuildId(env);
  if (stamped) return stamped;
  if (!env.VITE_OH_WEB && !env.DEV) {
    const desktop = await askServerBuild(fetchImpl, { timeoutMs });
    if (desktop) return desktop;
  }
  return bundleBuildId(moduleUrl);
};
