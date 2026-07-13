/*! Open Historia — node-side signature verification © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Verifies project-signed artifacts (the node-software update manifest +
// timestamp) against the pinned root public key, using Node's built-in crypto
// (no extra dependency). A node applies an update ONLY when the manifest is
// validly signed, fresher than what it runs, and not expired (see
// scripts/node-updater.mjs).

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { PINNED_ROOT_KEYS, findPinnedKey } from "../trust/pinned-key.js";

// Fixed SPKI DER prefix for an Ed25519 public key; the raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const rawToPublicKey = (b64) => {
  const raw = Buffer.from(b64, "base64");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
};

// Precompute KeyObjects for the pinned keys.
const KEY_OBJECTS = PINNED_ROOT_KEYS.map((k) => ({ keyid: k.keyid, key: rawToPublicKey(k.publicKey) }));

// Verify a detached base64 signature over `bytes` (Buffer/Uint8Array). If keyid
// is given, only that pinned key is tried.
export const verifyDetached = (bytes, sigB64, keyid) => {
  let sig;
  try {
    sig = Buffer.from(String(sigB64).trim(), "base64");
  } catch {
    return false;
  }
  const candidates = keyid
    ? KEY_OBJECTS.filter((k) => k.keyid === keyid)
    : KEY_OBJECTS;
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  for (const { key } of candidates) {
    try {
      if (cryptoVerify(null, buffer, key, sig)) return true;
    } catch {
      // try the next pinned key
    }
  }
  return false;
};

// Verify a signed JSON manifest's bytes + detached signature and enforce keyid +
// freshness. Returns { valid, data, reason }.
export const verifySignedManifest = (bytes, sigB64) => {
  let data;
  try {
    data = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return { valid: false, data: null, reason: "bad-json" };
  }
  if (data.keyid && !findPinnedKey(data.keyid)) {
    return { valid: false, data: null, reason: "unknown-keyid" };
  }
  if (!verifyDetached(bytes, sigB64, data.keyid)) {
    return { valid: false, data: null, reason: "bad-signature" };
  }
  if (data.expires && Date.parse(data.expires) < Date.now()) {
    return { valid: false, data: null, reason: "expired" };
  }
  return { valid: true, data, reason: "ok" };
};
