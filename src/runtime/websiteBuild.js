/*! Open Historia — the website's own build © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whether this is the website's browser demo: a web build (VITE_OH_WEB) that
// is not the Android app, which is a web build too (VITE_OH_NATIVE). Known by
// the build's own flags (vite.config.ts, compile-time literals). Pure: callers
// hand in import.meta.env.
//
// The demo leaves out what belongs to the installed game: update notices
// (updates/updateNotices.js), the vault door and the theme pickers ("make it
// so the theme picker and the vault door dont appear on the website demo", the
// owner, 2026-11-09): App.jsx, FirstSetup.jsx, settings.jsx.
export const isWebsiteBuild = (env = {}) => Boolean(env.VITE_OH_WEB && !env.VITE_OH_NATIVE);
