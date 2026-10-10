/*! Open Historia — invite token and identity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/invite.test.js
//
// One token per game, usable by many; a token mangled in copying is caught
// before anything is tried with it; and the keys a token derives belong to its
// room alone. With them, the identities: a device key that persists, a host key
// whose signatures cover exactly what they were made for.

import test from "node:test";
import assert from "node:assert/strict";
import { InviteError, createInvite, deriveRoomKeys, parseInvite } from "./invite.js";
import { createIdentity, identityFromSecret, loadDeviceIdentity, signFields, verifyFields } from "./identity.js";

test("a token round-trips: the room, its secret and the pinned host key", () => {
  const host = createIdentity();
  const invite = createInvite(host.publicKey);
  assert.match(invite.token, /^oh1-[A-Za-z0-9_-]+$/);
  assert.ok(invite.token.length < 130, invite.token.length);
  const parsed = parseInvite(`  ${invite.token}\n`);
  assert.equal(parsed.roomId, invite.roomId);
  assert.deepEqual(parsed.roomSecret, invite.roomSecret);
  assert.equal(parsed.hostKey, host.id);
});

test("a mangled token says what is wrong with it", () => {
  const { token } = createInvite(createIdentity().publicKey);
  const flip = (text, index) => text.slice(0, index) + (text[index] === "A" ? "B" : "A") + text.slice(index + 1);
  for (const [bad, pattern] of [
    ["", /should start with/],
    ["https://example.com/join", /should start with/],
    [token.slice(0, -5), /wrong length/],
    [`${token}AAAA`, /wrong length/],
    [token.replace(/.$/, "!"), /characters that do not belong/],
    [flip(token, 20), /does not check out/],
    [flip(token, 60), /does not check out/],
  ]) {
    assert.throws(() => parseInvite(bad), (error) => error instanceof InviteError && pattern.test(error.message), bad);
  }
});

test("each room derives its own topic and keys; the same token always derives the same", () => {
  const host = createIdentity();
  const a = parseInvite(createInvite(host.publicKey).token);
  const b = parseInvite(createInvite(host.publicKey).token);
  const keysA = deriveRoomKeys(a);
  assert.match(keysA.topic, /^[0-9a-f]{32}$/);
  assert.equal(keysA.signalKey.length, 32);
  assert.deepEqual(deriveRoomKeys(a).signalKey, keysA.signalKey);
  assert.equal(deriveRoomKeys(a).topic, keysA.topic);
  assert.notEqual(deriveRoomKeys(b).topic, keysA.topic);
  assert.notDeepEqual(deriveRoomKeys(b).signalKey, keysA.signalKey);
  // The join proof depends on the room and on every field it covers.
  const proof = keysA.joinProof(["session", "fp1", "fp2"]);
  assert.equal(keysA.joinProof(["session", "fp1", "fp2"]), proof);
  assert.notEqual(keysA.joinProof(["session", "fp1", "fp3"]), proof);
  assert.notEqual(deriveRoomKeys(b).joinProof(["session", "fp1", "fp2"]), proof);
});

test("a signature covers exactly its purpose and its fields", () => {
  const host = createIdentity();
  const signature = signFields(host, "answer", ["room", "session", "sdp"]);
  assert.equal(verifyFields(host.id, "answer", ["room", "session", "sdp"], signature), true);
  assert.equal(verifyFields(host.id, "hello", ["room", "session", "sdp"], signature), false, "another purpose");
  assert.equal(verifyFields(host.id, "answer", ["room", "session", "sdp2"], signature), false, "another field");
  assert.equal(verifyFields(createIdentity().id, "answer", ["room", "session", "sdp"], signature), false, "another key");
  assert.equal(verifyFields("garbage", "answer", ["room"], signature), false);
  assert.equal(verifyFields(host.id, "answer", ["room"], "garbage"), false);
  assert.throws(() => signFields(host, "answer", ["a\nb"]), /line break/);
});

test("a device keeps its identity across loads; without storage it still has one", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const first = loadDeviceIdentity(storage);
  const second = loadDeviceIdentity(storage);
  assert.equal(second.id, first.id);
  assert.equal(identityFromSecret(first.secretHex).id, first.id);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.match(loadDeviceIdentity(broken).id, /^[A-Za-z0-9_-]{43}$/);
  assert.match(loadDeviceIdentity(null).id, /^[A-Za-z0-9_-]{43}$/);
});
