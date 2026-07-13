/*! Open Historia — content-node populator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Fills a content node's directory with hash-named, verified copies of the map
// assets listed in scripts/map-assets.json. Each file is copied to
// <content-dir>/<sha256> only after its SHA-256 is confirmed, so a node can only
// ever serve canonical bytes.
//
//   node scripts/populate-node.mjs                 # from public/assets, into ./node-content
//   node scripts/populate-node.mjs --test          # also write a small synthetic object (for testing)
//   OH_NODE_CONTENT_DIR=/data/node node scripts/populate-node.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.resolve(process.env.OH_NODE_CONTENT_DIR || path.join(ROOT, "node-content"));
const TEST = process.argv.includes("--test");

mkdirSync(CONTENT_DIR, { recursive: true });

const sha256File = (file) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
};

const mapAssets = JSON.parse(readFileSync(path.join(ROOT, "scripts", "map-assets.json"), "utf8"));
let copied = 0;
let missing = 0;
let mismatched = 0;

for (const entry of mapAssets.assets ?? []) {
  const source = path.join(ROOT, entry.path);
  if (!existsSync(source)) {
    missing += 1;
    continue;
  }
  const actual = sha256File(source);
  if (actual !== entry.sha256) {
    console.warn(`SKIP ${entry.asset}: sha256 mismatch (have ${actual.slice(0, 12)}…, want ${entry.sha256.slice(0, 12)}…)`);
    mismatched += 1;
    continue;
  }
  const target = path.join(CONTENT_DIR, actual);
  if (!existsSync(target) || statSync(target).size !== statSync(source).size) {
    copyFileSync(source, target);
  }
  copied += 1;
  console.log(`OK   ${entry.asset} → ${actual.slice(0, 16)}…`);
}

if (TEST) {
  const body = Buffer.from("open-historia content node self-test object\n", "utf8");
  const hash = createHash("sha256").update(body).digest("hex");
  writeFileSync(path.join(CONTENT_DIR, hash), body);
  console.log(`TEST synthetic object → ${hash}`);
}

console.log(`\nnode content dir: ${CONTENT_DIR}`);
console.log(`copied ${copied}, missing ${missing}, mismatched ${mismatched}`);
