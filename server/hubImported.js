/*! Open Historia — the hub posts this player has imported before © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The community hub counts a post's imports by the downloads of its file
// (src/runtime/hubFiles.js). A post imported again (after deleting it, or a
// second copy) downloads the file's update copy instead, which the hub does
// not count; so the game remembers which posts it has imported, by post
// number only, in the ui-settings record (`hubImported`): the server's
// ui-settings.json on the desktop, the browser's own storage on the website
// and in the Android app (src/runtime/web/settingsStore.js). It is never sent
// anywhere. Pure and dependency-free: both stores and the page use it.

export const HUB_IMPORTED_KEY = "hubImported";
// Post numbers kept; the oldest go first past this.
export const MAX_HUB_IMPORTED = 5000;

const postNumber = (value) => {
  const number = typeof value === "string" && /^\d{1,15}$/.test(value.trim()) ? Number(value.trim()) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

// A stored or sent list, as post numbers in the order first imported, without
// repeats or anything that is not one.
export const normalizeHubImported = (list) => {
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    const number = postNumber(value);
    if (number !== null) seen.add(number);
  }
  return [...seen].slice(-MAX_HUB_IMPORTED);
};

// The stored list with `added` put on the end: what a PUT of ui-settings with
// { hubImported: [...] } keeps. Adding never removes a post that was there.
export const mergeHubImported = (stored, added) => normalizeHubImported([...normalizeHubImported(stored), ...normalizeHubImported(added)]);

export const hubImportedIncludes = (stored, postId) => {
  const number = postNumber(postId);
  return number !== null && normalizeHubImported(stored).includes(number);
};
