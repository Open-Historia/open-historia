/*! Open Historia — which application this server is running inside © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The page is an ordinary localhost page whether the desktop app opened it or
// somebody started the server from the zip, and the stable app and the beta
// both serve the same page. The visit counter
// (src/runtime/visitCount.js) counts each of them apart, so it asks.
//
// `versions`: process.versions. server.js is imported into the desktop app's
// main process (electron/main.cjs startServer), so `electron` is there exactly
// when this is the app. `env.OH_CHANNEL` is what electron/main.cjs set from
// electron/channel.cjs.

export const APP_CHANNELS = Object.freeze(["stable", "beta"]);

// OH_VISIT_COUNT=0: no visit counter, neither Google Analytics nor Umami, on
// the game page or on the pages served beside it (the guides, the privacy
// policy). Both go through one gate (public/consent.js), which loads nothing
// for an application that answers "uncounted". For a test server, and for
// anybody running the server who would rather not be counted.
//
// `build`: the desktop app's own build id, `env.OH_DESKTOP_BUILD`, which
// electron/main.cjs read from the release's electron/build-id.json. The page
// has no other way to learn it, and it tells an update from the build that ran
// before (src/runtime/buildId.js: the vault door shows the first time the game
// opens after an update). Only inside the app and only when the build is
// stamped: a development run has none, and says
// nothing. It stays on this computer: the visit counters read `app` and
// `channel` alone.

export const appKindOf = (versions = {}, env = {}) => {
  const build = versions?.electron ? String(env?.OH_DESKTOP_BUILD ?? "").trim() : "";
  const stamped = (kind) => (build ? { ...kind, build } : kind);
  if (String(env?.OH_VISIT_COUNT ?? "") === "0") return stamped({ app: "uncounted" });
  if (!versions?.electron) return { app: "local" };
  const channel = String(env?.OH_CHANNEL || "stable");
  return stamped({ app: "desktop", channel: APP_CHANNELS.includes(channel) ? channel : "stable" });
};
