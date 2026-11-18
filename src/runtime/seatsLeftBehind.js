/*! Open Historia — a game that was left while it was shared © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Stop sharing" holds what is the other players' apart from the host's own
// game (multiplayer/host/heldSeats.js) and forgets who they are
// (game.humanCountries). A game left while it was shared (the app closed
// mid-round, a crash, a save exported from a host) never ran it: the save
// still names its people, and their queued orders, threads and secret events
// are still in the documents single player reads whole. Opened alone, it
// would show the host every one of them as its own, and its first skip would
// carry out the others' orders.
//
// So when a game is opened in single player and its save still names its
// people, what is theirs is held now, exactly as Stop would have held it, and
// the people are forgotten, in one commit; the session taken up again gives it
// all back (host/gameHost.js). A save that was never shared names nobody and
// is not touched. Never in the engine window that hosts the game; and while a
// game is shared the server refuses every other writer (server/oneWriter.js),
// so a host screen reloading mid-game changes nothing.

import { mutateCanonicalTurnState, readGameData } from "./gameState.js";
import { hostingSharedGame } from "./humanPolities.js";
import { holdSeatRecords } from "../multiplayer/host/heldSeats.js";
import { formerNamesOf } from "../multiplayer/host/foundings.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// The commit, given the game's documents: null when the save names no people.
export const seatsLeftBehindPatch = ({ world, actions, chats, events, game } = {}) => {
  const people = list(game?.humanCountries).map(clean).filter(Boolean);
  if (!people.length) return null;
  const host = clean(game?.country);
  const held = holdSeatRecords({ world, actions, chats, events }, { host, readers: formerNamesOf(game, host), people });
  const { humanCountries: _gone, ...rest } = game;
  return {
    ...(held.changed ? { world: held.world, actions: held.actions, chats: held.chats, events: held.events } : {}),
    game: rest,
  };
};

export const holdSeatsLeftBehind = async () => {
  if (hostingSharedGame()) return null;
  // Most games were never shared: one small read, and nothing more.
  const game = await readGameData({ force: true }).catch(() => null);
  if (!list(game?.humanCountries).length) return null;
  return mutateCanonicalTurnState((docs) => seatsLeftBehindPatch(docs));
};
