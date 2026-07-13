/*! Open Historia — root signing-key generator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Generates the project's Ed25519 ROOT signing key. Run this ONCE on an offline
// machine. The private key (trust/oh-root.key.pem) must stay offline and is
// git-ignored; the public key is printed so you can pin it in trust/pinned-key.js
// (compiled into both the client and the node software). Rotating the key = run
// this again and ship a release that pins the new key (keep a 1-release overlap).
//
//   node scripts/gen-signing-key.mjs [keyid]
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const TRUST_DIR = path.join(ROOT, "trust");
const KEY_PATH = path.join(TRUST_DIR, "oh-root.key.pem");
const keyid = process.argv[2] || "oh-root-1";

if (existsSync(KEY_PATH)) {
  console.error(`Refusing to overwrite existing private key at ${path.relative(ROOT, KEY_PATH)}.`);
  console.error("Delete it first if you really mean to generate a new root key.");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// The raw 32-byte public key is the tail of the SPKI DER (12-byte Ed25519 prefix).
const spkiDer = publicKey.export({ type: "spki", format: "der" });
const rawPublic = spkiDer.subarray(spkiDer.length - 32);
const publicB64 = rawPublic.toString("base64");

mkdirSync(TRUST_DIR, { recursive: true });
writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(
  path.join(TRUST_DIR, "oh-root.pub.json"),
  `${JSON.stringify({ keyid, alg: "ed25519", publicKey: publicB64 }, null, 2)}\n`,
);

console.log(`Private key written to ${path.relative(ROOT, KEY_PATH)} (KEEP OFFLINE, git-ignored).`);
console.log("\nPin this public key in trust/pinned-key.js:\n");
console.log(`  { keyid: ${JSON.stringify(keyid)}, alg: "ed25519", publicKey: ${JSON.stringify(publicB64)} }\n`);
