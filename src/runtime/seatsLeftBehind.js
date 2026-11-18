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
import { SEATS_HELD_KEY, hasSeatsHeld, holdSeatRecords, mergedSeatsHeld } from "../multiplayer/host/heldSeats.js";
import { formerNamesOf } from "../multiplayer/host/foundings.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

// A restore point put back while nobody shares the game (gameplay.js
// rollBackToSnapshot): `state` is what it restores ({ world, actions, chats,
// events, game }), `live` the world as it stands now. What is held for the
// other players is theirs, not the turn's, and stays held, whatever the restore
// point had (as the player's standing goal stays the player's): restoring a
// world without it threw their orders, threads and secret events away for
// good. And a restore point that still names the people (one captured while
// the game was shared, before such restore points were marked as a shared
// round's, runtime/turnCommit.js) is held as Stop holds a game: its other
// players' records apart, its people forgotten. It put their queued orders,
// letters and secret events back into the host's own game, which single player
// reads whole (FOLLOWUPS A9). Returns the state to write. In the engine that
// hosts a game, the state as it is.
export const restoredAlone = (state = {}, { live = null } = {}) => {
  if (hostingSharedGame()) return state;
  const held = isRecord(live?.[SEATS_HELD_KEY]) || isRecord(state.world?.[SEATS_HELD_KEY])
    ? mergedSeatsHeld(state.world?.[SEATS_HELD_KEY], live?.[SEATS_HELD_KEY])
    : null;
  const holding = held && hasSeatsHeld({ [SEATS_HELD_KEY]: held });
  const world = holding ? { ...(isRecord(state.world) ? state.world : {}), [SEATS_HELD_KEY]: held } : state.world;
  // A row the game holds for them is not also the host's: the restore point's
  // copy of it goes.
  const ids = (rows) => new Set(rows.map((row) => clean(row?.id)).filter(Boolean));
  const heldIds = holding ? { orders: ids(held.orders), threads: ids(held.threads), events: ids(held.events.map((entry) => entry.event)) } : null;
  const unheld = (rows, kind) => (heldIds && Array.isArray(rows) ? rows.filter((row) => !heldIds[kind].has(clean(row?.id))) : rows);
  const docs = { ...state, world, actions: unheld(state.actions, "orders"), chats: unheld(state.chats, "threads"), events: unheld(state.events, "events") };
  const patch = seatsLeftBehindPatch(docs);
  return patch ? { ...docs, ...patch } : docs;
};

export const holdSeatsLeftBehind = async () => {
  if (hostingSharedGame()) return null;
  // Most games were never shared: one small read, and nothing more.
  const game = await readGameData({ force: true }).catch(() => null);
  if (!list(game?.humanCountries).length) return null;
  return mutateCanonicalTurnState((docs) => seatsLeftBehindPatch(docs));
};
