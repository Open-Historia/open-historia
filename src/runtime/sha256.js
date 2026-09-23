/*! Open Historia — SHA-256 that works everywhere the game runs © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One SHA-256 for the client, with a pure-JS fallback.
//
// Why: the Android app's WebView is served from http://app.paxhistoria, and an
// http origin that is not localhost is not a secure context. Chromium withholds
// crypto.subtle there, so every `crypto.subtle.digest("SHA-256", …)` threw — a
// flag upload, a basemap dedup and the archive warm all failed on the phone
// while working on the website. The origin cannot change (it is the key to
// every player's IndexedDB library), so the hash does: WebCrypto where it
// exists, @noble/hashes where it does not, the same hex either way.
//
// Kept import-light and free of DOM so `node --test` can hold the two paths to
// the same answer.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

const toBytes = (input) => {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new TextEncoder().encode(String(input ?? ""));
};

const toHex = (bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

// The pure-JS path on its own, for the test and for a caller that must not touch
// WebCrypto (an insecure context throws on the mere property access in some
// engines, so it is guarded, not assumed).
export const sha256HexPure = (input) => toHex(nobleSha256(toBytes(input)));

export const sha256Hex = async (input) => {
  const bytes = toBytes(input);
  let subtle = null;
  try { subtle = globalThis.crypto?.subtle ?? null; } catch { subtle = null; }
  if (subtle) {
    try {
      return toHex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
    } catch {
      /* not available after all (insecure context) — fall through */
    }
  }
  return sha256HexPure(bytes);
};
