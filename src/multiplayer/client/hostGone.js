/*! Open Historia — a guest cut off from its host, and a shared game that ends for this page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "I closed the lobby but this person says they are still in it" (the owner,
// 2026-11-18). The guest's connection to the host closed, and the page went on
// in the shared game's screens with no word that the host was gone, tried to
// reconnect for as long as it was open, and was never taken out.
// "When the game ends, it should actually kick the player from the game" (the
// owner, 2026-11-18): a guest the host banned, or one whose window was replaced
// by another, was left in the dead game's screens under a box that said it had
// ended, until they pressed it.
//
// Now (client/sharedGame.js, session/client.js):
//   - cut off, the guest's screen says so at once, and nothing it does is
//     taken: each request is refused with that reason (cutOffRefusal), and what
//     it had asked before the drop goes again once it is back;
//   - the session tries for a bounded time; when the host is gone for good (it
//     said it closed the game, its lobby left the relays, or the time ran out)
//     the shared game ends;
//   - however a guest's session ends for a page that was in the game (the host
//     closed it or is gone, the host removed or banned this player, this device
//     took its place from another window), the player is taken out at once, as
//     Leave takes them out: the stand-in is closed and the page goes back to the
//     menu, which says why (endedWords, keepEndedNotice), once. Nothing of the
//     game is kept to reopen it: a page reloaded meanwhile opens the menu, never
//     the dead game. A joining that never got in is told why it failed
//     (joinProgress.js joinFailure).
//   - not so the host's own screen whose engine window stopped answering: a
//     window that is only busy (a long time skip can block it well over the
//     loopback's 20 s) must never end the game for every player. The host is
//     told, and leaves itself (client/sharedGame.js onGone).
// Runtime-free: the storage is the page's sessionStorage, given.

import { joinFailure } from "./joinProgress.js";

export const RECONNECTING = "Reconnecting to the host…";
export const CUT_OFF_REFUSAL = "Not sent: the connection to the host is lost. Reconnecting…";
export const HOST_CLOSED = "The host closed the game.";
export const HOST_GONE = "The host can no longer be reached.";
export const REMOVED = "The host removed you from the game.";
export const BANNED = "The host banned you from this game.";

const ENDED_KEY = "oh_shared_game_ended_v1";

// Whether a guest's request is refused now, and with what words ("" for none).
export const cutOffRefusal = ({ role = "", connection = "" } = {}) => (role === "guest" && connection === "reconnecting" ? CUT_OFF_REFUSAL : "");

// Why a shared game ended for this page, by how its session ended
// (session/client.js onState: rejected, lost or invalid, and its reason).
// `wasIn`: the host had let this page in (session.player), and it is taken out
// of the game with these words; a page still joining was never in it, and is
// told why the joining failed.
const IN_GAME_ENDS = Object.freeze({
  "host-closed": HOST_CLOSED,
  closed: HOST_CLOSED,
  "host-gone": HOST_GONE,
  "gave-up": HOST_GONE,
  kicked: REMOVED,
  banned: BANNED,
});
export const endedWords = ({ wasIn = false, connection = "", reason = "", message = "", network = "" } = {}) => (
  wasIn && Object.hasOwn(IN_GAME_ENDS, reason)
    ? IN_GAME_ENDS[reason]
    : joinFailure({ connection, reason, message, network })
);

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
