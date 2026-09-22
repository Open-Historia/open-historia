/*! Open Historia — the shared SHA-256 © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/sha256.test.js
//
// The Android app's WebView is an http origin, so crypto.subtle is withheld
// there and every digest used to throw. The pure-JS path has to give the same
// hex WebCrypto gives, byte for byte, or a flag deduped on the website would
// duplicate on the phone.
import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, sha256HexPure } from "./sha256.js";

// The one everybody knows.
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

test("the pure path is SHA-256", () => {
  assert.equal(sha256HexPure(""), EMPTY);
  assert.equal(sha256HexPure("abc"), ABC);
  assert.equal(sha256HexPure(new TextEncoder().encode("abc")), ABC, "bytes in, same answer");
});

test("the WebCrypto path and the pure path agree", async () => {
  for (const input of ["", "abc", "a flag as a data URL: data:image/png;base64,iVBORw0KGgo=", "ünïcödé ✓"]) {
    assert.equal(await sha256Hex(input), sha256HexPure(input), JSON.stringify(input));
  }
  const bytes = new Uint8Array(1024).map((_, index) => index % 251);
  assert.equal(await sha256Hex(bytes), sha256HexPure(bytes));
  assert.equal(await sha256Hex(bytes.buffer), sha256HexPure(bytes), "an ArrayBuffer is taken whole");
});

test("without WebCrypto the answer is the same", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    assert.equal(await sha256Hex("abc"), ABC);
  } finally {
    if (saved) Object.defineProperty(globalThis, "crypto", saved); else delete globalThis.crypto;
  }
});
