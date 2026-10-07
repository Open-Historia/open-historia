/*! Open Historia — who a device and a host are, on the multiplayer wire © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Two kinds of Ed25519 key:
//   - a device key, made once per install and kept, which is how a host knows
//     a returning player and binds them to the connection they arrive on;
//   - a host key, made per hosted game and kept with it, which the invite token
//     carries: every answer the host sends is signed with it, so another holder
//     of the token cannot pose as the host.
// Signing is pure JavaScript (@noble/curves). WebCrypto is not there on the
// Android app's insecure origin, and nothing here may depend on it.
//
// Every signature covers a labelled message (signedMessage below), so one
// signed for one purpose can never be replayed as another.

import { ed25519 } from "@noble/curves/ed25519.js";
import { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from "./bytes.js";

export const createIdentity = () => identityFromSecret(ed25519.utils.randomSecretKey());

export const identityFromSecret = (secret) => {
  const secretKey = typeof secret === "string" ? fromHex(secret) : secret;
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) throw new TypeError("An identity secret is 32 bytes.");
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    publicKey,
    id: toBase64Url(publicKey),
    secretHex: toHex(secretKey),
    sign: (message) => ed25519.sign(message, secretKey),
  };
};

// The bytes a signature is made over: a purpose label, then the fields in
// order, one per line. A field may not hold a line break, so no two different
// field lists can make the same message.
export const signedMessage = (label, fields) => {
  for (const field of fields) {
    if (/[\r\n]/.test(String(field))) throw new TypeError("A signed field may not contain a line break.");
  }
  return utf8([`oh-mp/v1/${label}`, ...fields.map(String)].join("\n"));
};

export const signFields = (identity, label, fields) => toBase64Url(identity.sign(signedMessage(label, fields)));

// False for anything malformed as well as for a wrong signature: whatever came
// in from another machine is not trusted to be well-formed.
export const verifyFields = (publicKeyB64, label, fields, signatureB64) => {
  try {
    const publicKey = fromBase64Url(publicKeyB64);
    const signature = fromBase64Url(signatureB64);
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    return ed25519.verify(signature, signedMessage(label, fields), publicKey);
  } catch {
    return false;
  }
};

const DEVICE_KEY = "oh:mp:device";

// This install's device identity, made the first time it is asked for and kept
// in localStorage. Where storage is not available (a private window, a test),
// it lives for the session only; a player then returns as someone new.
export const loadDeviceIdentity = (storage = globalThis.localStorage) => {
  try {
    const stored = storage?.getItem?.(DEVICE_KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return identityFromSecret(stored);
  } catch {
    // unreadable storage: make one below
  }
  const identity = createIdentity();
  try {
    storage?.setItem?.(DEVICE_KEY, identity.secretHex);
  } catch {
    // unwritable storage: this session only
  }
  return identity;
};
