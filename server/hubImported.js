/*! Open Historia — the hub posts this player has imported before © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A post's import is counted once, by the game, on its first import here
// (src/runtime/hubImportCount.js); a post imported again (after deleting it,
// or a second copy) is not counted again, and downloads the file's update copy
// too. So the game remembers which posts it has imported, by post number only,
// in the ui-settings record (`hubImported`): the server's ui-settings.json on
// the desktop, the browser's own storage on the website and in the Android app
// (src/runtime/web/settingsStore.js). The list is never sent anywhere. Pure and
// dependency-free: both stores and the page use it.
//
// Beside it, `hubCountKey`: a random key made once per install and kept in the
// same record, never sent anywhere either. What the counter receives for an
// import is a hash of this key and the post's number (hubImportCount.js
// importToken), which tells it whether this install has counted that post
// already, and nothing it could match with the same install's other imports.

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

export const HUB_COUNT_KEY = "hubCountKey";

// The install's counting key as stored or sent: 64 lowercase hex digits, or
// null for anything else.
export const normalizeHubCountKey = (value) => (typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null);

// What a PUT of ui-settings with { hubCountKey } keeps: the key already there,
// for good, or the one sent when there is none. Never replaced, so two windows
// that make a key at once both end up with the first one stored.
export const keepHubCountKey = (stored, offered) => normalizeHubCountKey(stored) ?? normalizeHubCountKey(offered);
