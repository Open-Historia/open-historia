/*! Open Historia — checking what a host signed, with node:crypto © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A room in the listing is registered and changed only with a signature by its
// host key, the same Ed25519 key the game already signs its answers with
// (src/multiplayer/identity.js). The signature covers the room id, a timestamp
// and a hash of the whole room, so it cannot be moved to another room, replayed
// long after, or kept while the room's details are swapped underneath it.
//
// The bytes signed are identity.js's signedMessage, byte for byte:
//
//   "oh-mp/v1/room" \n roomId \n ts \n sha256hex(canonicalJson(room))
//
// canonicalJson is JSON with every object's keys sorted, so a room hashes the
// same whatever order its keys were written in, on whichever side. Anything
// that makes a room to sign must produce exactly these bytes; the game's
// client does it with the same function as this one.
//
// Verification is node:crypto's, so the server has no dependency for it. The
// host key and the signature must be canonical base64url (the one encoding of
// their bytes): a second spelling of the same key would otherwise count as a
// different host key.

import { createHash, createPublicKey, verify } from "node:crypto";

// What JSON.stringify leaves out of an object (and writes as null in a list).
const skipped = (value) => value === undefined || typeof value === "function" || typeof value === "symbol";

// JSON.stringify's output, but with object keys in sorted order (by UTF-16
// code units, Array.prototype.sort's default) at every depth. Meant for plain
// JSON values, which is what a validated message is.
export const canonicalJson = (value) => {
  if (skipped(value)) throw new TypeError("canonicalJson: not a JSON value.");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (skipped(item) ? "null" : canonicalJson(item))).join(",")}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (!skipped(value[key])) parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  }
  return `{${parts.join(",")}}`;
};

export const sha256Hex = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");

export const roomDigest = (room) => sha256Hex(canonicalJson(room));

// identity.js's signedMessage: a purpose label, then the fields in order, one
// per line. A field may not hold a line break, so no two different field lists
// make the same message.
export const signedMessage = (label, fields) => {
  for (const field of fields) {
    if (/[\r\n]/.test(String(field))) throw new TypeError("A signed field may not contain a line break.");
  }
  return Buffer.from([`oh-mp/v1/${label}`, ...fields.map(String)].join("\n"), "utf8");
};

export const roomMessage = (roomId, ts, room) => signedMessage("room", [roomId, ts, roomDigest(room)]);

// A public room's id is not chosen, it is derived: the first 16 bytes (32 hex)
// of the SHA-256 of
//
//   "oh-mp/v1/room-id" \n hostKey \n nonce
//
// where nonce (32 hex, in the ROOM) lets one host key hold different rooms.
// So an id belongs to one host key for good: when a room is gone (a restart,
// an unhost, its grace run out), nobody else can register a room under its id
// and inherit the players who kept it, and a joiner can check a listed id
// against the listed key itself.
export const roomIdFor = (hostKey, nonce) =>
  createHash("sha256").update(signedMessage("room-id", [hostKey, nonce])).digest("hex").slice(0, 32);

// The bytes of canonical, unpadded base64url of exactly `length` bytes, or null.
const decodeBase64Url = (text, length) => {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.length === length && bytes.toString("base64url") === text ? bytes : null;
};

// False for anything malformed as well as for a wrong signature.
export const verifySignature = (publicKey, message, signature) => {
  const key = decodeBase64Url(publicKey, 32);
  const sig = decodeBase64Url(signature, 64);
  if (!key || !sig) return false;
  try {
    const keyObject = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
    return verify(null, message, keyObject, sig);
  } catch {
    return false;
  }
};

// A host message's signature: by room.hostKey, over the room, its id and ts.
export const verifyRoom = ({ room, ts, sig }) => {
  try {
    return verifySignature(room.hostKey, roomMessage(room.roomId, ts, room), sig);
  } catch {
    return false;
  }
};
