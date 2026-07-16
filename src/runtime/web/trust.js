/*! Open Historia — client-side signature verification © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Verifies project-signed manifests (content manifest, node directory) against
// the pinned root public key before the client trusts them. Web build only.
// A manifest that is unsigned, mis-signed, keyid-unknown, or expired is NOT
// trusted — the client then simply doesn't use nodes and falls back to the
// canonical origin, so a broken trust chain degrades safely.

import * as ed from "@noble/ed25519";
import { PINNED_ROOT_KEYS, findPinnedKey } from "../../../trust/pinned-key.js";

const b64ToBytes = (b64) => {
  const binary = atob(String(b64).trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Verify a detached base64 signature over `bytes` against the pinned key(s).
// If keyid is given, only that pinned key is tried.
export const verifyDetached = async (bytes, sigB64, keyid) => {
  let sig;
  try {
    sig = b64ToBytes(sigB64);
  } catch {
    return false;
  }
  const keys = keyid ? [findPinnedKey(keyid)].filter(Boolean) : PINNED_ROOT_KEYS;
  for (const key of keys) {
    try {
      if (await ed.verifyAsync(sig, bytes, b64ToBytes(key.publicKey))) return true;
    } catch {
      // try the next pinned key
    }
  }
  return false;
};

// Fetch a JSON manifest and its detached `.sig`, verify the signature over the
// EXACT served bytes, and enforce keyid + freshness. Returns
// { valid, data, reason }. valid=false ⇒ do not trust the manifest.
export const fetchSignedJson = async (url) => {
  try {
    const [docResp, sigResp] = await Promise.all([
      fetch(url, { cache: "no-store" }),
      fetch(`${url}.sig`, { cache: "no-store" }),
    ]);
    if (!docResp.ok) return { valid: false, data: null, reason: "missing-doc" };
    if (!sigResp.ok) return { valid: false, data: null, reason: "unsigned" };

    const bytes = new Uint8Array(await docResp.arrayBuffer());
    const sigB64 = await sigResp.text();
    const data = JSON.parse(new TextDecoder().decode(bytes));

    if (!(await verifyDetached(bytes, sigB64, data.keyid))) {
      return { valid: false, data: null, reason: "bad-signature" };
    }
    if (data.expires && Date.parse(data.expires) < Date.now()) {
      return { valid: false, data: null, reason: "expired" };
    }
    return { valid: true, data, reason: "ok" };
  } catch {
    return { valid: false, data: null, reason: "error" };
  }
};
