/*! Open Historia — a shared game's stand-in, as its own record says it is one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's screen draws the host's game on a game of this device's library: a
// copy of the host's scenario whose documents are the host's view while the
// shared game is open (src/multiplayer/client/sharedGame.js prepareStandIn). It
// is the shared game's frame on this device, never a game of the player's. It
// used to be made as one: listed in the library, kept after the guest left, and
// hosted as though it were a save (a round-1 copy, the gap audit of 2026-11-18).
//
// What makes a game one is its own record: game.json says so
// (`sharedGameStandIn`), with the game that was open before it, to go back to
// when the shared game closes. Both stores read it from there (this server's
// libraryStore.js, the website's src/runtime/web/libraryStore.js), so the
// library never lists one, a delete removes one for good instead of putting it
// in the trash among the player's own deleted games, and the host's engine
// refuses to share one. A record says it, not a name or an id: a game the player
// renamed is still what it was.
//
// Shared by the desktop's server and the website's store, so it imports nothing.

export const STAND_IN_FIELD = "sharedGameStandIn";

const clean = (value) => String(value ?? "").trim().slice(0, 200);

// The marker a stand-in's game.json is made with: `returnTo`, the game that was
// open before it ("" for none).
export const standInMark = ({ returnTo = "" } = {}) => ({ [STAND_IN_FIELD]: { returnTo: clean(returnTo) } });

// A game's stand-in marker, as the library lists it ({ returnTo }), or null for a
// game of the player's own. `game`: its game.json.
export const standInOf = (game) => {
  const mark = game && typeof game === "object" ? game[STAND_IN_FIELD] : null;
  if (!mark) return null;
  return { returnTo: typeof mark === "object" ? clean(mark.returnTo) : "" };
};
