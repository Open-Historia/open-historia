/*! Open Historia — a guest cut off from its host, and a shared game ended by the host's going © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "I closed the lobby but this person says they are still in it" (the owner,
// 2026-11-18). The guest's connection to the host closed, and the page went on
// in the shared game's screens with no word that the host was gone, tried to
// reconnect for as long as it was open, and was never taken out.
//
// Now (client/sharedGame.js, session/client.js):
//   - cut off, the guest's screen says so at once, and nothing it does is
//     taken: each request is refused with that reason (cutOffRefusal), and what
//     it had asked before the drop goes again once it is back;
//   - the session tries for a bounded time; when the host is gone for good (it
//     said it closed the game, its lobby left the relays, or the time ran out)
//     the shared game ends as Leave ends it: the stand-in is closed and the
//     page goes back to the menu, which says why (endedNotice), once. Nothing
//     of the game is kept to reopen it: a page reloaded while the host is gone
//     opens the menu, never the dead game.
// Runtime-free: the storage is the page's sessionStorage, given.

export const RECONNECTING = "Reconnecting to the host…";
export const CUT_OFF_REFUSAL = "Not sent: the connection to the host is lost. Reconnecting…";
export const HOST_CLOSED = "The host closed the game.";
export const HOST_GONE = "The host can no longer be reached.";

const ENDED_KEY = "oh_shared_game_ended_v1";

// Whether a guest's request is refused now, and with what words ("" for none).
export const cutOffRefusal = ({ role = "", connection = "" } = {}) => (role === "guest" && connection === "reconnecting" ? CUT_OFF_REFUSAL : "");

// Why a game this guest was in ended, by the session's reason (session/client.js);
// "" for a reason that is not the host's going.
export const hostGoneWords = (reason = "") => {
  if (reason === "host-closed") return HOST_CLOSED;
  if (reason === "host-gone" || reason === "gave-up") return HOST_GONE;
  return "";
};

// Kept for the page that loads next, so the menu says why, once.
export const keepEndedNotice = (storage, text) => {
  try {
    storage?.setItem(ENDED_KEY, JSON.stringify({ text: String(text || "").slice(0, 300) }));
  } catch {
    // unsaved: the menu says nothing, and the game is closed all the same
  }
};

// The notice kept by the page before, taken (it is said once), or "".
export const takeEndedNotice = (storage) => {
  try {
    const kept = JSON.parse(storage?.getItem(ENDED_KEY) || "null");
    storage?.removeItem(ENDED_KEY);
    return String(kept?.text || "");
  } catch {
    return "";
  }
};
