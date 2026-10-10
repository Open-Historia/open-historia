/*! Open Historia — release signer key check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/releaseSigning.test.js
//
// scripts/sign-release.mjs must refuse a private key that is not the pinned
// one: its signatures would be rejected by every client and node as
// bad-signature, and the only sign of it is a console warning in a browser.

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { findPinnedKey } from "../trust/pinned-key.js";
import { rawPublicKeyOf, signingKeyProblem } from "../scripts/sign-release.mjs";

const newRawKey = () => rawPublicKeyOf(generateKeyPairSync("ed25519").privateKey);

test("the raw public key is the 32-byte key pinned-key.js uses", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = rawPublicKeyOf(privateKey);
  assert.equal(Buffer.from(raw, "base64").length, 32);
  assert.equal(raw, publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"));
});

test("a key that matches its pin and oh-root.pub.json may sign", () => {
  const rawPub = newRawKey();
  const pinned = { keyid: "k1", alg: "ed25519", publicKey: rawPub };
  assert.equal(signingKeyProblem({ rawPub, keyid: "k1", pubJson: { ...pinned }, pinned }), "");
});

test("a key that is not the pinned one is refused", () => {
  const rawPub = newRawKey();
  const pinned = { keyid: "k1", alg: "ed25519", publicKey: newRawKey() };
  assert.match(signingKeyProblem({ rawPub, keyid: "k1", pinned }), /does not match the key pinned for k1/);
});

test("a key that does not match oh-root.pub.json is refused", () => {
  const rawPub = newRawKey();
  const pinned = { keyid: "k1", alg: "ed25519", publicKey: rawPub };
  const pubJson = { keyid: "k1", alg: "ed25519", publicKey: newRawKey() };
  assert.match(signingKeyProblem({ rawPub, keyid: "k1", pubJson, pinned }), /does not match trust\/oh-root\.pub\.json/);
});

test("a keyid nothing pins is refused", () => {
  const rawPub = newRawKey();
  assert.match(signingKeyProblem({ rawPub, keyid: "never-pinned", pinned: null }), /is not pinned/);
  assert.match(signingKeyProblem({ rawPub, keyid: "never-pinned" }), /is not pinned/);
});

test("the committed oh-root.pub.json is the key pinned for its keyid", () => {
  const pubJson = JSON.parse(fs.readFileSync(new URL("../trust/oh-root.pub.json", import.meta.url), "utf8"));
  const pinned = findPinnedKey(pubJson.keyid);
  assert.ok(pinned, `${pubJson.keyid} is pinned`);
  assert.equal(signingKeyProblem({ rawPub: pubJson.publicKey, keyid: pubJson.keyid, pubJson }), "");
});
