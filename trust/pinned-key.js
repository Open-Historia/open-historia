/*! Open Historia — pinned root public key(s) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The project's ROOT public key(s), compiled into BOTH the client and the node
// software. The matching private key is offline (never in the repo). Every
// signed artifact — content manifest, node directory, node-software update
// manifest, timestamp — is verified against these keys before it is trusted.
//
// KEY ROTATION: to rotate, generate a new key (scripts/gen-signing-key.mjs),
// add it here alongside the old one (keep BOTH for one release so in-flight
// clients/nodes still validate), ship a release, then drop the retired key.
export const PINNED_ROOT_KEYS = [
  { keyid: "oh-root-1", alg: "ed25519", publicKey: "XGC4cpxoVNAhTtpPC2aqmOOND3U7oBrwzCPwTs1eHZk=" },
];

export const findPinnedKey = (keyid) =>
  PINNED_ROOT_KEYS.find((k) => k.keyid === keyid) || null;
