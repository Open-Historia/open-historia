/*! Open Historia — what a game's card offers in the library © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A guest's card in a shared game is its stand-in: the game of the host's
// scenario that the shared game is drawn on (runtime/standInGames.js), listed
// only while that game is open, so that its Current takes the guest back in
// (runtime/library.js applyLibraryCatalog). It is no game of the player's:
// Edit, Clone and Archive were refused ("Leave the shared game first"), and
// Export exported the stand-in (the review of 2026-11-19, F7). Its menu offers
// what works: leaving the shared game. Every other game's card is as it was.

const EVERY_GAME = Object.freeze(["edit", "clone", "recover", "archive", "export"]);
const STAND_IN = Object.freeze(["leave"]);

// The card menu's actions for `game`, in order, by id.
export const gameCardActions = (game) => (game?.standIn ? STAND_IN : EVERY_GAME);
