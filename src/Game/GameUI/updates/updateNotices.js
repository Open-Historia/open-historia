/*! Open Historia — which update notices to show © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The notice behind the vault door (UpdateNotice.jsx, notes.js) shows each
// update once a device, and only an update that has a notice: "the popup
// showing the update should only happen if there is a new popup for a new
// update, not every time it opens or if someone forgot to add the log of the
// update (or if it was a quick hotfix so it doesnt have a popup made for it)"
// (the owner). A build is not an update here: a new build with no new entry in
// notes.js (a hotfix, a notice forgotten) shows nothing. The id of the newest
// update shown is kept in localStorage the moment it is shown (App.jsx), not
// when it is closed, so a page closed or reloaded on it does not show it
// again; and where nothing can be kept (storage refused) nothing is shown,
// since it would come back at every opening. The updates above the kept id in
// the list are new. One that missed
// several is shown all of them, newest first (at most UPDATES_SHOWN_MOST); one
// whose kept id is not in the list at all, or that has none (a first opening),
// is shown the newest and the MAJOR ones released within FIRST_LOOK_DAYS of it
// (so the music, released before there was a notice to tell of it, is told
// with the updates after it; the minor ones are in the history). Only the
// updates written as notices are ever shown (notes.js NOTICE_UPDATES), never
// the history from before them: "make sure people ONLY see the update popup
// things for the updates that are actually being added (plus the music one),
// not for every update in the history" (the owner, 2026-10-16). Opening the game with ?updateNotice=<id> (or "latest")
// shows that update whatever is kept, and keeps nothing: for whoever is making
// one.
//
// Pure but for the storage, which is handed in; no React.

import { NOTICE_UPDATES, UPDATES } from "./notes.js";

export const UPDATE_NOTE_KEY = "oh-update-note-seen";
export const UPDATE_NOTICE_PARAM = "updateNotice";
export const UPDATES_SHOWN_MOST = 4;
export const FIRST_LOOK_DAYS = 30;

// Days from one "YYYY-MM-DD" to another, or Infinity where either cannot be read.
const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) / 86400000 : Infinity;
};

const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

// The id of the newest update shown on this device, or null.
export const seenUpdate = (storage = browserStorage()) => {
  try {
    return storage?.getItem(UPDATE_NOTE_KEY) || null;
  } catch {
    return null;
  }
};

// Whether this device can keep what it was shown: a value written can be read back.
export const canRememberUpdates = (storage = browserStorage()) => {
  try {
    if (!storage) return false;
    const probe = "oh-update-note-probe";
    storage.setItem(probe, "1");
    const kept = storage.getItem(probe) === "1";
    storage.removeItem?.(probe);
    return kept;
  } catch {
    return false;
  }
};

// Kept as soon as its notice is shown: it is not shown again.
export const rememberUpdate = (id, storage = browserStorage()) => {
  try {
    if (id) storage?.setItem(UPDATE_NOTE_KEY, String(id));
  } catch {
    // Not kept: shown again the next time the game opens.
  }
};

// The updates to show at this opening, newest first ([] for none; none where nothing can be kept).
export const pendingUpdates = ({ updates = NOTICE_UPDATES, seen = seenUpdate(), keeps = canRememberUpdates() } = {}) => {
  if (updates.length === 0 || !keeps) return [];
  const at = seen ? updates.findIndex((update) => update.id === seen) : -1;
  if (at === 0) return [];
  if (at < 0) return updates.filter((update, index) => index === 0 || (update.kind === "major" && daysBetween(update.date, updates[0].date) <= FIRST_LOOK_DAYS)).slice(0, UPDATES_SHOWN_MOST);
  return updates.slice(0, Math.min(at, UPDATES_SHOWN_MOST));
};

// The update a preview asks for (?updateNotice=<id> or latest), as a list, or null for none asked.
export const previewedUpdates = (search = "", updates = UPDATES) => {
  let wanted = "";
  try {
    wanted = new URLSearchParams(search).get(UPDATE_NOTICE_PARAM) || "";
  } catch {
    wanted = "";
  }
  if (!wanted) return null;
  const update = wanted === "latest" ? updates[0] : updates.find((entry) => entry.id === wanted);
  return update ? [update] : null;
};

// The pages of a notice: every banner of every update in it, each with its update. A major update's pages come
// before every minor one's ("make major update popups always appear in front of the minor update popups": the owner,
// 2026-11-03), newest first within each; the list itself stays newest first, for which one is remembered as seen.
export const noticePages = (updates = []) => [...updates.filter((update) => update.kind === "major"), ...updates.filter((update) => update.kind !== "major")].flatMap((update) => (Array.isArray(update.banners) ? update.banners : [])
  .map((banner, index) => ({ key: `${update.id}#${index}`, update, banner })));
