/*! Open Historia — what the multiplayer session says, and what it signs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two layers of messages.
//
// Signaling (sealed, through the relays), before a connection exists:
//   offer    a player asks to join: its WebRTC offer and its device key
//   answer   the host's WebRTC answer to one offer, signed with the host key
//   deny     the host turns an offer away (full, banned, another version…)
//   beacon   the host is here: the room's name and how many seats are open
//
// Session (inside the data channel), once it is open:
//   hello    the player's device key, signed over both ends' DTLS
//            fingerprints, with proof it holds the invite token
//   welcome  the host takes the player in
//   reject   the host turns the player away and closes
//   ping / pong / bye
// The game's own messages are added to these by the app (createMessageSchema);
// none may reuse a session message's name.
//
// Everything the host signs covers the room id, so nothing signed for one room
// can be replayed into another, and a timestamp the receiver checks.

import { sha256 } from "@noble/hashes/sha2.js";
import { toHex, utf8 } from "../bytes.js";
import { B64URL, HEX_ID, NAME, int, literal, obj, str, union } from "../protocol/validate.js";

export const PROTOCOL_VERSION = 1;
// How far apart two clocks may be and a signed message still count as fresh.
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const DENY_REASONS = Object.freeze(["full", "banned", "version", "closed", "busy"]);
export const REJECT_REASONS = Object.freeze(["full", "banned", "version", "bad-hello", "closed", "kicked", "replaced", "misbehaving", "timeout"]);
export const BYE_REASONS = Object.freeze(["left", "closed", "kicked"]);

const TS = int(0, 2 ** 45);
const SDP = str(16_000, { min: 10 });
const GAME_VERSION = str(40, { min: 1, pattern: /^[0-9A-Za-z._+-]+$/ });
const V = literal(PROTOCOL_VERSION);

export const SIGNAL = union("t", {
  offer: obj({ t: literal("offer"), v: V, session: HEX_ID(16), sdp: SDP, device: B64URL(32), name: NAME(40), version: GAME_VERSION, ts: TS }),
  answer: obj({ t: literal("answer"), v: V, session: HEX_ID(16), sdp: SDP, ts: TS, sig: B64URL(64) }),
  deny: obj({ t: literal("deny"), v: V, session: HEX_ID(16), reason: str(16, { enum: DENY_REASONS }), ts: TS, sig: B64URL(64) }),
  beacon: obj({ t: literal("beacon"), v: V, name: NAME(60), open: int(0, 64), seats: int(1, 64), version: GAME_VERSION, ts: TS, sig: B64URL(64) }),
});

const sessionMessages = {
  hello: obj({
    t: literal("hello"), v: V, session: HEX_ID(16), device: B64URL(32), name: NAME(40),
    version: GAME_VERSION, proof: B64URL(32), sig: B64URL(64),
  }),
  welcome: obj({ t: literal("welcome"), v: V, player: HEX_ID(8), room: obj({ name: NAME(60), seats: int(1, 64) }) }),
  reject: obj({ t: literal("reject"), v: V, reason: str(16, { enum: REJECT_REASONS }) }),
  ping: obj({ t: literal("ping"), n: int(0, 2 ** 31) }),
  pong: obj({ t: literal("pong"), n: int(0, 2 ** 31) }),
  bye: obj({ t: literal("bye"), reason: str(16, { enum: BYE_REASONS }) }),
};
export const SESSION_MESSAGE_NAMES = Object.freeze(Object.keys(sessionMessages));

// The union a session validates every data channel message against: its own
// messages and the app's.
export const createMessageSchema = (appMessages = {}) => {
  for (const name of Object.keys(appMessages)) {
    if (Object.prototype.hasOwnProperty.call(sessionMessages, name)) throw new Error(`"${name}" is a session message and cannot be reused.`);
  }
  return union("t", { ...sessionMessages, ...appMessages });
};

// What each signature covers (identity.js signFields / verifyFields). An SDP
// holds line breaks, so its hash is signed rather than the text.
const sdpHash = (sdp) => toHex(sha256(utf8(sdp)));
export const signed = {
  answer: (roomId, { session, ts, sdp }) => ["answer", [roomId, session, ts, sdpHash(sdp)]],
  deny: (roomId, { session, reason, ts }) => ["deny", [roomId, session, reason, ts]],
  beacon: (roomId, { name, open, seats, version, ts }) => ["beacon", [roomId, name, open, seats, version, ts]],
  hello: (roomId, { session, hostFingerprint, playerFingerprint }) => ["hello", [roomId, session, hostFingerprint, playerFingerprint]],
};

export const isFresh = (ts, now) => Math.abs(now - ts) <= CLOCK_SKEW_MS;
