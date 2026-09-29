/*! Open Historia — release signer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Signs manifests with the offline root private key (trust/oh-root.key.pem),
// writing a detached base64 signature next to each (<file>.sig). Run on the
// offline signing machine. For JSON manifests, --stamp injects keyid + issued +
// expires before signing so the signature covers freshness/rotation metadata.
//
//   node scripts/sign-release.mjs public/content-manifest.json public/node-directory.json
//   node scripts/sign-release.mjs --stamp --days 1 public/node-directory.json
//   node scripts/sign-release.mjs --stamp --days 30 dist-node/update-manifest.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import path from "node:path";
import url from "node:url";
import { findPinnedKey } from "../trust/pinned-key.js";
import { verifyDetached } from "../server/trust.js";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const KEY_PATH = path.join(ROOT, "trust", "oh-root.key.pem");
const PUB_PATH = path.join(ROOT, "trust", "oh-root.pub.json");

// The raw 32-byte Ed25519 public key (base64), the encoding pinned-key.js and
// oh-root.pub.json use: the tail of the SPKI DER.
export const rawPublicKeyOf = (privateKey) =>
  createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64");

// Why this private key must not sign as `keyid`, or "" when it may. A key that
// does not match the pinned one still produces .sig files, and every client and
// node then rejects them as bad-signature — after a rotation, that is a
// mismatched oh-root.key.pem and oh-root.pub.json turning the swarm off with
// nothing but console warnings in players' browsers.
export const signingKeyProblem = ({ rawPub, keyid, pubJson = null, pinned = findPinnedKey(keyid) }) => {
  if (pubJson && pubJson.publicKey !== rawPub) {
    return `trust/oh-root.key.pem does not match trust/oh-root.pub.json (the key is ${rawPub}, the file says ${pubJson.publicKey}).`;
  }
  if (!pinned) {
    return `keyid ${keyid} is not pinned in trust/pinned-key.js, so nothing would accept its signatures. Pin its public key (${rawPub}) and ship that release first.`;
  }
  if (pinned.publicKey !== rawPub) {
    return `trust/oh-root.key.pem does not match the key pinned for ${keyid} in trust/pinned-key.js (the key is ${rawPub}, the pin is ${pinned.publicKey}).`;
  }
  return "";
};

const main = () => {
  const args = process.argv.slice(2);
  const stamp = args.includes("--stamp");
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 30;
  const files = args.filter((a, i) => !a.startsWith("--") && !(daysIdx >= 0 && i === daysIdx + 1));

  if (!existsSync(KEY_PATH)) {
    console.error(`Missing private key at ${path.relative(ROOT, KEY_PATH)}. Run scripts/gen-signing-key.mjs first.`);
    process.exit(1);
  }
  if (!files.length) {
    console.error("Usage: node scripts/sign-release.mjs [--stamp] [--days N] <manifest.json> [...]");
    process.exit(1);
  }

  const privateKey = createPrivateKey(readFileSync(KEY_PATH));
  const pubJson = existsSync(PUB_PATH) ? JSON.parse(readFileSync(PUB_PATH, "utf8")) : null;
  const keyid = pubJson?.keyid ?? "oh-root-1";
  // The private key must match the pinned public key's raw bytes, checked
  // BEFORE any file is stamped or any .sig written.
  const rawPub = rawPublicKeyOf(privateKey);
  const problem = signingKeyProblem({ rawPub, keyid, pubJson });
  if (problem) {
    console.error(`Refusing to sign: ${problem}`);
    process.exit(1);
  }

  const nowMs = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  for (const rel of files) {
    const file = path.resolve(ROOT, rel);
    if (!existsSync(file)) {
      console.error(`SKIP ${rel}: not found`);
      continue;
    }

    let bytes = readFileSync(file);
    if (stamp && file.endsWith(".json")) {
      const doc = JSON.parse(bytes.toString("utf8"));
      doc.keyid = keyid;
      doc.issued = iso(nowMs);
      doc.expires = iso(nowMs + days * 86400000);
      bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
    }

    const signature = cryptoSign(null, bytes, privateKey).toString("base64");
    // Round trip through the same check the nodes run, before writing anything.
    if (!verifyDetached(bytes, signature, keyid)) {
      console.error(`Refusing to write ${rel}: its signature does not verify against the pinned key ${keyid}.`);
      process.exit(1);
    }
    if (stamp && file.endsWith(".json")) writeFileSync(file, bytes);
    writeFileSync(`${file}.sig`, `${signature}\n`);
    console.log(`signed ${rel} → ${rel}.sig  (keyid ${keyid})`);
  }

  console.log(`\nroot public key (raw b64): ${rawPub}`);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) main();
