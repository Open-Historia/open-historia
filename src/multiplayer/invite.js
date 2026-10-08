/*! Open Historia — the invite token for a multiplayer game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One token per game. Whoever holds it can find the host and ask to join, as
// many people as there are seats, until the host makes a new one. It holds:
//
//   version (1) | room id (16) | room secret (32) | host public key (32) | check (4)
//
// written as base64url after "oh1-". The room secret is what makes the token a
// key: the place the host listens (the topic) and the key every signaling
// message is encrypted with are both derived from it, so a relay, or anyone
// without the token, sees neither who is talking nor what is said. The host's
// public key is pinned in the token, because the host's answers are signed with
// it: holding the token lets someone knock, not impersonate the host. The check
// bytes catch a token mangled in copying before anything is tried with it.

import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, equalBytes, fromBase64Url, randomBytes, toBase64Url, toHex, utf8 } from "./bytes.js";

const PREFIX = "oh1-";
const VERSION = 1;
const BODY = 1 + 16 + 32 + 32;
const ENCODED_LENGTH = Math.ceil(((BODY + 4) * 4) / 3);

const checkOf = (body) => sha256(body).slice(0, 4);

export class InviteError extends Error {}

// A fresh token for a game hosted under `hostPublicKey` (identity.js).
export const createInvite = (hostPublicKey) => {
  if (!(hostPublicKey instanceof Uint8Array) || hostPublicKey.length !== 32) throw new TypeError("A host public key is 32 bytes.");
  const roomId = randomBytes(16);
  const roomSecret = randomBytes(32);
  const body = concatBytes(new Uint8Array([VERSION]), roomId, roomSecret, hostPublicKey);
  return {
    token: PREFIX + toBase64Url(concatBytes(body, checkOf(body))),
    roomId: toHex(roomId),
    roomSecret,
    hostKey: toBase64Url(hostPublicKey),
  };
};

// The token's parts, or an InviteError saying what is wrong with it in words
// a player can act on.
export const parseInvite = (input) => {
  const token = String(input ?? "").trim();
  if (!token.startsWith(PREFIX)) throw new InviteError("That is not an Open Historia invite: it should start with \"oh1-\".");
  const encoded = token.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new InviteError("That invite has characters that do not belong in one. Copy it again.");
  if (encoded.length !== ENCODED_LENGTH) throw new InviteError("That invite is the wrong length: part of it may be missing. Copy it again.");
  const bytes = fromBase64Url(encoded);
  const body = bytes.slice(0, BODY);
  if (!equalBytes(checkOf(body), bytes.slice(BODY))) throw new InviteError("That invite does not check out: a character was changed in copying. Copy it again.");
  if (body[0] !== VERSION) throw new InviteError("That invite is from another version of Open Historia.");
  return {
    token,
    roomId: toHex(body.slice(1, 17)),
    roomSecret: body.slice(17, 49),
    hostKey: toBase64Url(body.slice(49, 81)),
  };
};

// What the secret derives. Everything is bound to the room id as well, so two
// rooms can never share a topic or a key.
export const deriveRoomKeys = ({ roomId, roomSecret }) => {
  const salt = utf8(roomId);
  const derive = (label, length) => hkdf(sha256, roomSecret, salt, utf8(`oh-mp/v1/${label}`), length);
  const joinKey = derive("join", 32);
  return {
    // Where the room's signaling is found: meaningless to anyone else.
    topic: toHex(derive("topic", 16)),
    // The key every signaling message is sealed with.
    signalKey: derive("signal", 32),
    // Proof, inside the data channel, that a joiner holds the token.
    joinProof: (fields) => toBase64Url(hmac(sha256, joinKey, utf8(["oh-mp/v1/join", ...fields.map(String)].join("\n")))),
  };
};
