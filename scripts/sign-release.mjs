/*! Open Historia — release signer © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const KEY_PATH = path.join(ROOT, "trust", "oh-root.key.pem");
const PUB_PATH = path.join(ROOT, "trust", "oh-root.pub.json");

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
const keyid = existsSync(PUB_PATH) ? JSON.parse(readFileSync(PUB_PATH, "utf8")).keyid : "oh-root-1";
// Sanity: the private key must match the pinned public key's raw bytes.
const rawPub = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64");

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
    const stamped = `${JSON.stringify(doc, null, 2)}\n`;
    writeFileSync(file, stamped);
    bytes = Buffer.from(stamped, "utf8");
  }

  const signature = cryptoSign(null, bytes, privateKey).toString("base64");
  writeFileSync(`${file}.sig`, `${signature}\n`);
  console.log(`signed ${rel} → ${rel}.sig  (keyid ${keyid})`);
}

console.log(`\nroot public key (raw b64): ${rawPub}`);
