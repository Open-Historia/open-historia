/*! Open Historia — what the public multiplayer server accepts, message by message © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every frame a client sends is parsed with safeParse and checked against one
// of these closed schemas (validate.js) before anything reads it: a key that
// is not named here, a string too long, a number out of range or a list too
// big makes the message invalid, and what the server goes on to use is the
// checked copy, never the parsed original.
//
// Client to server:
//   { t: "host", v: 1, room: ROOM, ts, sig }     register or update this connection's room
//   { t: "unhost", roomId }                     take it down
//   { t: "list", filters?: FILTERS, page? }     one page of the public listing
//   { t: "signal", roomId, to, payload }        an offer to the host, or its answer or deny
//   { t: "turn", roomId? }                      TURN credentials for one connection: a
//                                               host's (no roomId), or a joiner's for roomId
//   { t: "ping", n }                            a pong back
//
// ts is milliseconds since 1970, as everywhere on the multiplayer wire.

import { B64URL, HEX_ID, NAME, bool, int, literal, num, obj, str, union, validate } from "./validate.js";

// The signaling payloads the server passes between a joiner and a host,
// copied line for line from the game's src/multiplayer/session/messages.js so
// the server can be deployed alone. The beacon is left out: a public room is
// found through the listing, not through beacons. test/validateParity.test.js
// fails when a line between the markers stops matching the game's.
// copy of messages.js: begin
export const PROTOCOL_VERSION = 1;
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
export const DENY_REASONS = Object.freeze(["full", "banned", "version", "closed", "busy"]);
const TS = int(0, 2 ** 45);
const SDP = str(16_000, { min: 10 });
const GAME_VERSION = str(40, { min: 1, pattern: /^[0-9A-Za-z._+-]+$/ });
const V = literal(PROTOCOL_VERSION);
export const SIGNAL = union("t", {
  offer: obj({ t: literal("offer"), v: V, session: HEX_ID(16), sdp: SDP, device: B64URL(32), name: NAME(40), version: GAME_VERSION, ts: TS }),
  answer: obj({ t: literal("answer"), v: V, session: HEX_ID(16), sdp: SDP, ts: TS, sig: B64URL(64) }),
  deny: obj({ t: literal("deny"), v: V, session: HEX_ID(16), reason: str(16, { enum: DENY_REASONS }), ts: TS, sig: B64URL(64) }),
});
export const isFresh = (ts, now) => Math.abs(now - ts) <= CLOCK_SKEW_MS;
// copy of messages.js: end

export const PAYMENTS = Object.freeze(["host", "cycle"]);
export const CHEATS = Object.freeze(["off", "host", "vote"]);
export const VISIBILITIES = Object.freeze(["public", "unlisted"]);

// A BCP 47 tag, cut down: a language and at most one subtag ("en", "pt-BR").
const LANGUAGE = str(12, { min: 2, pattern: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/ });
const PAYMENT = str(5, { enum: PAYMENTS });
const CHEAT_MODE = str(4, { enum: CHEATS });

// What a host says about its game. The listing shows it as given: the server
// checks its shape, not its truth (a host can claim more players than it has).
// The scenario id is a NAME rather than any string, so no control characters
// reach a player's screen through it either. roomId is derived from hostKey
// and nonce (signatures.js roomIdFor), and a room whose id is not is refused.
export const ROOM = obj({
  roomId: HEX_ID(16),
  hostKey: B64URL(32),
  nonce: HEX_ID(16),
  name: NAME(60),
  scenario: obj({ id: NAME(80), name: NAME(80), hash: HEX_ID(32) }),
  seats: int(1, 64),
  open: int(0, 64),
  round: obj({ minutes: int(1, 10_080), readyThreshold: num(0.5, 1), countdownSeconds: int(0, 3600) }),
  payment: PAYMENT,
  fog: bool(),
  cheats: CHEAT_MODE,
  language: LANGUAGE,
  version: GAME_VERSION,
  password: bool(),
  visibility: str(8, { enum: VISIBILITIES }),
});

// Every filter is optional; together they narrow the listing (rooms.js).
const FILTER_NAMES = ["scenario", "language", "version", "fog", "cheats", "payment", "password", "minOpen", "q"];
export const FILTERS = obj({
  scenario: NAME(80),
  language: LANGUAGE,
  version: GAME_VERSION,
  fog: bool(),
  cheats: CHEAT_MODE,
  payment: PAYMENT,
  password: bool(),
  minOpen: int(0, 64),
  // Empty means no search, so a cleared search box can be sent as it is.
  q: str(60, { pattern: /^\P{Cc}*$/u }),
}, FILTER_NAMES);

export const MAX_PAGE = 100;
const PAGE = int(0, MAX_PAGE);

// "host" for an offer on its way to the room's host, or the session id of the
// joiner a host's answer or deny is for.
const TO = str(32, { min: 4, pattern: /^(?:host|[0-9a-f]{32})$/ });

export const CLIENT_MESSAGE = union("t", {
  host: obj({ t: literal("host"), v: V, room: ROOM, ts: TS, sig: B64URL(64) }),
  unhost: obj({ t: literal("unhost"), roomId: HEX_ID(16) }),
  list: obj({ t: literal("list"), filters: FILTERS, page: PAGE }, ["filters", "page"]),
  signal: obj({ t: literal("signal"), roomId: HEX_ID(16), to: TO, payload: SIGNAL }),
  turn: obj({ t: literal("turn"), roomId: HEX_ID(16) }, ["roomId"]),
  ping: obj({ t: literal("ping"), n: int(0, 2 ** 31) }),
});

// A parsed value that names a message type this server knows. Anything else
// is refused as unknown before the schema is even tried, so a client learns
// the difference between "no such message" and "that message is malformed".
export const isKnownType = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && typeof value.t === "string" && Object.prototype.hasOwnProperty.call(CLIENT_MESSAGE.variants, value.t);

// The listing over HTTP (GET /api/rooms?…): the same filters, spelled as a
// query string. Each parameter may appear once, unknown ones are refused as
// the socket's closed objects would refuse them, and booleans and numbers must
// be spelled plainly ("true", "3"), never coerced from anything else.
const QUERY_KINDS = new Map([
  ["scenario", "text"], ["language", "text"], ["version", "text"], ["q", "text"],
  ["cheats", "text"], ["payment", "text"],
  ["fog", "boolean"], ["password", "boolean"],
  ["minOpen", "integer"],
]);
const LIST_QUERY = obj({ filters: FILTERS, page: PAGE });

export const parseListingQuery = (params) => {
  const filters = {};
  let page = 0;
  const seen = new Set();
  for (const [key, value] of params) {
    if (seen.size >= QUERY_KINDS.size + 1) return { ok: false, error: "too many parameters" };
    if (seen.has(key)) return { ok: false, error: `"${key.slice(0, 40)}" is given more than once` };
    seen.add(key);
    if (key === "page") {
      if (!/^\d{1,3}$/.test(value)) return { ok: false, error: `page must be a whole number from 0 to ${MAX_PAGE}` };
      page = Number(value);
      continue;
    }
    const kind = QUERY_KINDS.get(key);
    if (!kind) return { ok: false, error: `unknown filter "${key.slice(0, 40)}"` };
    if (kind === "boolean") {
      if (value !== "true" && value !== "false") return { ok: false, error: `${key} must be true or false` };
      filters[key] = value === "true";
    } else if (kind === "integer") {
      if (!/^\d{1,3}$/.test(value)) return { ok: false, error: `${key} must be a whole number` };
      filters[key] = Number(value);
    } else {
      filters[key] = value;
    }
  }
  const checked = validate(LIST_QUERY, { filters, page });
  return checked.ok ? { ok: true, filters: checked.value.filters, page: checked.value.page } : { ok: false, error: checked.error };
};
