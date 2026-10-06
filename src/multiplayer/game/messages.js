/*! Open Historia — what a multiplayer game says between players and the host © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game's own messages, on top of the session's (session/messages.js).
//
// From a player to the host, every one is a REQUEST, never a write. A player
// cannot change a document; it asks the host to (the plan's "intents"), and
// the host checks the request against these schemas, against who is asking and
// against the round's phase before it changes anything. Each request carries
// an id the host answers with an `ack`, so a player's screen can show what was
// accepted or refused, and a request sent twice over a shaky connection is
// applied once.
//
// From the host, the player receives the lobby, the round, answers, notices
// and its VIEW: its own projection of the game's documents (host/projection.js),
// never anyone else's. The view is large and comes only from the host, so it
// is copied as plain JSON (validate.js "json") and then read through the game's
// own normalizers, like any document the game loads.

import { HEX_ID, NAME, bool, int, json, list, literal, num, obj, str } from "../protocol/validate.js";
import { SETTINGS_SCHEMA } from "../host/settings.js";

// A host and its players must speak the same game: raised whenever these
// messages or the views (host/projection.js) change in a way an older player's
// screen would misread. The session refuses a player on another version.
export const SHARED_GAME_VERSION = "2";

// Orders are free text in single player; in a shared game one is held to this.
export const ORDER_MAX_CHARS = 1500;
export const SAY_MAX_CHARS = 2000;
const COUNTRY = NAME(80);
const REQUEST_ID = HEX_ID(8);

export const PLAYER_REQUESTS = Object.freeze({
  // The lobby.
  pick: obj({ t: literal("pick"), id: REQUEST_ID, country: COUNTRY }),
  unpick: obj({ t: literal("unpick"), id: REQUEST_ID }),
  // The round.
  ready: obj({ t: literal("ready"), id: REQUEST_ID, value: bool() }),
  revealed: obj({ t: literal("revealed"), id: REQUEST_ID, round: int(0, 1_000_000) }),
  // The player's government.
  order: obj({ t: literal("order"), id: REQUEST_ID, text: str(ORDER_MAX_CHARS, { min: 1 }) }),
  unorder: obj({ t: literal("unorder"), id: REQUEST_ID, order: str(120, { min: 1 }) }),
  goal: obj({ t: literal("goal"), id: REQUEST_ID, text: str(600) }),
  // The player's own Projects board, whole. The host puts it through the
  // game's own normalizer, which holds it to a board's shape and size, and the
  // session holds the message to its own size limit (session/host.js).
  board: obj({ t: literal("board"), id: REQUEST_ID, projects: json(12) }),
  // The player's forces: raise a formation where the player put it (it waits
  // there for the next skip to confirm it), or stand one down. What a formation
  // is to DO is an order like any other, in words.
  deploy: obj({
    t: literal("deploy"), id: REQUEST_ID, type: str(24, { min: 1 }), strength: num(1, 100),
    name: str(80), composition: str(200), lng: num(-540, 540), lat: num(-90, 90),
  }),
  disband: obj({ t: literal("disband"), id: REQUEST_ID, unit: str(160, { min: 1 }) }),
  // The player's agents: place one in `target`, call `spy` home, send a
  // caught one home or turn it, and say what a turned one reports.
  agent: obj({
    t: literal("agent"), id: REQUEST_ID, op: str(8, { enum: ["deploy", "recall", "expel", "turn", "story"] }),
    target: str(80), spy: str(160), story: str(300),
  }),
  // A country's stat sheet, for the host to write when the player's Stats pane
  // has none to show (`fresh`: write it again although there is one).
  sheet: obj({ t: literal("sheet"), id: REQUEST_ID, country: COUNTRY, fresh: bool() }),
  // Diplomacy: into a thread the player is in, or to open one with `to`.
  say: obj({
    t: literal("say"), id: REQUEST_ID, thread: str(120, { nullable: true }),
    to: list(COUNTRY, 8), text: str(SAY_MAX_CHARS, { min: 1 }),
  }),
});

const SEAT = obj({
  country: COUNTRY,
  name: str(40),
  status: str(8, { enum: ["human", "away", "ai"] }),
  you: bool(),
});

export const HOST_MESSAGES = Object.freeze({
  lobby: obj({
    t: literal("lobby"),
    settings: SETTINGS_SCHEMA,
    scenario: obj({ id: str(120), name: str(120), hash: str(64) }),
    countries: list(COUNTRY, 600),
    seats: list(SEAT, 64),
    started: bool(),
  }),
  round: obj({
    t: literal("round"),
    phase: str(12, { enum: ["lobby", "planning", "countdown", "resolving", "revealing"] }),
    round: int(0, 1_000_000),
    remainingMs: int(0, 30 * 24 * 3600 * 1000),
    paused: bool(),
    ready: list(COUNTRY, 64),
    counted: int(0, 64),
    needed: int(0, 64),
  }),
  ack: obj({ t: literal("ack"), id: REQUEST_ID, ok: bool(), error: str(300, { nullable: true }) }),
  notice: obj({ t: literal("notice"), level: str(8, { enum: ["info", "warn"] }), text: str(500) }),
  // The player's own view of the game's documents; only the ones that changed
  // since the last, whole. `rev` only goes up.
  view: obj({ t: literal("view"), rev: int(0, 2 ** 40), docs: json(64) }),
});

// Everything either side may send, for the session's message schema.
export const GAME_MESSAGES = Object.freeze({ ...PLAYER_REQUESTS, ...HOST_MESSAGES });
export const PLAYER_REQUEST_NAMES = Object.freeze(Object.keys(PLAYER_REQUESTS));
export const HOST_MESSAGE_NAMES = Object.freeze(Object.keys(HOST_MESSAGES));
