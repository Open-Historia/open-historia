/*! Open Historia — tests for what a host signs, and how the server checks it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/signatures.test.js
//
// canonicalJson has to give the same text on the game's side and the
// server's for the same room, whatever order its keys were written in, or no
// room would ever verify. The signed bytes have to be identity.js's
// signedMessage exactly. And verification has to say no to everything that is
// not a good signature by that key: another key, another message, and
// malformed or non-canonical keys and signatures.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson, roomDigest, roomIdFor, roomMessage, signedMessage, verifyRoom, verifySignature } from "../src/signatures.js";
import { deriveRoomId, hostIdentity, makeRoom, signRoom } from "./helpers.js";

test("canonicalJson sorts keys at every depth and keeps list order", () => {
  assert.equal(
    canonicalJson({ b: 1, a: [{ d: 2, c: [3, { f: null, e: "x" }] }], "é": true, A: "\n\"" }),
    '{"A":"\\n\\"","a":[{"c":[3,{"e":"x","f":null}],"d":2}],"b":1,"é":true}',
  );
  assert.equal(canonicalJson([]), "[]");
  assert.equal(canonicalJson({}), "{}");
  assert.equal(canonicalJson("text"), '"text"');
  assert.equal(canonicalJson(0.66), "0.66");
});

test("canonicalJson is the same for the same room written in any key order", () => {
  const room = makeRoom(hostIdentity());
  const reversed = Object.fromEntries(Object.entries(room).reverse().map(([key, value]) => [
    key,
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse()) : value,
  ]));
  assert.notEqual(JSON.stringify(reversed), JSON.stringify(room));
  assert.equal(canonicalJson(reversed), canonicalJson(room));
  assert.equal(roomDigest(reversed), roomDigest(room));
  // And it parses back to the same room: it is JSON.
  assert.deepEqual(JSON.parse(canonicalJson(room)), room);
});

test("canonicalJson treats what JSON cannot hold as JSON.stringify does", () => {
  assert.equal(canonicalJson({ a: undefined, b: 1, c: () => {} }), '{"b":1}');
  assert.equal(canonicalJson([undefined, 1]), "[null,1]");
  assert.throws(() => canonicalJson(undefined), TypeError);
});

test("the signed bytes are identity.js's signedMessage: label, then one field per line", () => {
  const bytes = signedMessage("room", ["00ff", 1234, "cafe"]);
  assert.equal(bytes.toString("utf8"), "oh-mp/v1/room\n00ff\n1234\ncafe");
  assert.throws(() => signedMessage("room", ["a\nb"]), /line break/);
  const room = makeRoom(hostIdentity());
  const expected = ["oh-mp/v1/room", room.roomId, "1700000000000", createHash("sha256").update(canonicalJson(room)).digest("hex")].join("\n");
  assert.equal(roomMessage(room.roomId, 1_700_000_000_000, room).toString("utf8"), expected);
});

test("a room signed by its host key verifies; anything else does not", () => {
  const identity = hostIdentity();
  const room = makeRoom(identity);
  const ts = Date.now();
  const sig = signRoom(identity, room, ts);
  assert.equal(verifyRoom({ room, ts, sig }), true);

  // Another ts, another room, other contents, another key.
  assert.equal(verifyRoom({ room, ts: ts + 1, sig }), false);
  assert.equal(verifyRoom({ room: { ...room, roomId: "0".repeat(32) }, ts, sig }), false);
  assert.equal(verifyRoom({ room: { ...room, open: room.open - 1 }, ts, sig }), false);
  assert.equal(verifyRoom({ room: { ...room, scenario: { ...room.scenario, name: "Other" } }, ts, sig }), false);
  const other = hostIdentity();
  assert.equal(verifyRoom({ room: { ...room, hostKey: other.hostKey }, ts, sig }), false);
  assert.equal(verifyRoom({ room, ts, sig: signRoom(other, room, ts) }), false);
});

test("malformed and non-canonical keys and signatures are refused, never thrown", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ format: "jwk" }).x;
  const message = Buffer.from("oh-mp/v1/room\nx");
  const sig = sign(null, message, privateKey).toString("base64url");
  assert.equal(verifySignature(key, message, sig), true);

  // The last character of a 32-byte key carries two unused bits (and of a
  // 64-byte signature, four). Setting them spells the same bytes differently.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const respell = (text, spare) => text.slice(0, -1) + alphabet[alphabet.indexOf(text.at(-1)) | spare];
  assert.equal(Buffer.from(respell(key, 1), "base64url").equals(Buffer.from(key, "base64url")), true);
  assert.equal(verifySignature(respell(key, 1), message, sig), false);
  assert.equal(verifySignature(key, message, respell(sig, 1)), false);

  for (const [badKey, badSig] of [
    ["", sig], [key.slice(1), sig], [`${key}A`, sig], ["A".repeat(43), sig], [key, ""], [key, sig.slice(2)],
    [key, `${sig}==`], [null, sig], [key, null], [{}, sig], ["+".repeat(43), sig],
  ]) {
    let result;
    assert.doesNotThrow(() => { result = verifySignature(badKey, message, badSig); });
    assert.equal(result, false, `${String(badKey)} / ${String(badSig)}`);
  }
  assert.equal(verifyRoom({ room: null, ts: 1, sig }), false);
});

test("a room id is derived from its host key and nonce, and from nothing else", () => {
  // A fixed vector, worked out with another SHA-256 than node's.
  assert.equal(roomIdFor("A".repeat(43), "00".repeat(16)), "58486e2b5618bb4d561625a7c1f97d35");
  const { hostKey } = hostIdentity();
  const nonce = "ab".repeat(16);
  assert.equal(roomIdFor(hostKey, nonce), deriveRoomId(hostKey, nonce));
  assert.match(roomIdFor(hostKey, nonce), /^[0-9a-f]{32}$/);
  assert.notEqual(roomIdFor(hostKey, "cd".repeat(16)), roomIdFor(hostKey, nonce));
  assert.notEqual(roomIdFor(hostIdentity().hostKey, nonce), roomIdFor(hostKey, nonce));
});
