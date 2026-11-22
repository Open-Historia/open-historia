/*! Open Historia — the host's words about a conversation, shown in it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the host says about a line a player wrote reached them as a notice: a
// word under the round bar for 8 seconds, away from the conversation they wrote
// in, and lost if another came meanwhile. "Nobody answers this now: the host's
// AI has answered as many of your messages this round as it gives", "Their
// player is away", "The host's AI could not be reached". Rule 10 asks for every
// refusal and failure where the player acted.
//
// So a notice that answers a line names it (game/messages.js notice: `about`
// "thread", the conversation's `thread` and the `line` it answers), and the
// conversation shows it under that line for as long as the line is still the
// newest there. The notice is kept in the host's list under Players as well.
//
// Import-free: plain data in and out, tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// The most shown at once under one line.
export const THREAD_NOTES_SHOWN = 3;

// The notices (client/gameClient.js, newest last) that belong under `lastLine`,
// the newest line of the conversation `thread`: [{ level, text }], each once.
export const threadNotesFor = (notices, { thread = "", lastLine = "" } = {}) => {
  const id = clean(thread);
  const line = clean(lastLine);
  if (!id || !line) return [];
  const seen = new Set();
  const out = [];
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (notice?.about !== "thread" || clean(notice.thread) !== id || clean(notice.line) !== line) continue;
    const text = clean(notice.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ level: notice.level === "warn" ? "warn" : "info", text });
  }
  return out.slice(-THREAD_NOTES_SHOWN);
};

// The newest notice about `about` ("gm", "seat") that came after `since` (a
// time as the page's clock read it, `at`), for the screen where the player
// acted: null for none.
export const latestNoticeAbout = (notices, about, since = 0) => {
  const list = Array.isArray(notices) ? notices : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const notice = list[index];
    if (notice?.about === about && (Number(notice.at) || 0) >= since && clean(notice.text)) {
      return { level: notice.level === "warn" ? "warn" : "info", text: clean(notice.text) };
    }
  }
  return null;
};

// How many notices came after `readAt` (the last time the list was opened).
export const unreadNotices = (notices, readAt = 0) => (Array.isArray(notices) ? notices : [])
  .filter((notice) => (Number(notice?.at) || 0) > readAt).length;
