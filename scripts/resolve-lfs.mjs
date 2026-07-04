/*! Open Historia — resolves Git-LFS pointer stubs to real content on ZIP updates © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A codeload.github.com zip ships LFS-tracked files (map geodata, pmtiles) as
// tiny pointer stubs, not real bytes — so a plain file copy would replace the
// real map with a stub. Git installs avoid this via `git lfs pull`; ZIP installs
// have no such step, which is why the updater otherwise never refreshes any
// LFS-backed file. This walks the freshly-downloaded update tree, finds the
// pointer stubs, and for any whose content differs from what's installed,
// downloads the real object from GitHub's media host and verifies its SHA-256.
//
// Usage: node scripts/resolve-lfs.mjs <srcDir> <owner> <repo> <branch>
//   <srcDir>   = extracted update tree (holds the pointer stubs)
//   cwd        = the install being updated
// Best-effort: it never fails the overall update — on any problem it leaves the
// existing file in place and moves on.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import path from "node:path";

const [srcDir, owner, repo, branch] = process.argv.slice(2);
if (!srcDir || !owner || !repo || !branch) {
  console.error("resolve-lfs: missing args (srcDir owner repo branch); skipping map-data update.");
  process.exit(0);
}
if (typeof fetch !== "function") {
  console.error("resolve-lfs: this Node is too old for fetch (need Node 18+); skipping map-data update.");
  process.exit(0);
}

const MAGIC = Buffer.from("version https://git-lfs.github.com/spec/v1");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

let updated = 0;
let current = 0;
let failed = 0;

for await (const srcFile of walk(srcDir)) {
  let info;
  try {
    info = await stat(srcFile);
  } catch {
    continue;
  }
  if (info.size > 1024) continue; // pointer stubs are ~130 bytes; skip real files fast

  const raw = await readFile(srcFile);
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) continue;

  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(raw.toString("utf8"))?.[1];
  if (!oid) continue;

  const rel = path.relative(srcDir, srcFile).split(path.sep).join("/");
  const dst = path.join(process.cwd(), rel);

  // Already have exactly this content? (the pointer's oid IS its sha256)
  try {
    if (sha256(await readFile(dst)) === oid) {
      current += 1;
      continue;
    }
  } catch {
    /* dst missing — fetch it */
  }

  const url = `https://media.githubusercontent.com/media/${owner}/${repo}/${branch}/${rel}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== oid) throw new Error("checksum mismatch");
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(dst, buf);
    console.log(`  updated map data: ${rel}`);
    updated += 1;
  } catch (error) {
    console.error(`  [warn] could not update ${rel} (${error.message}); keeping existing file.`);
    failed += 1;
  }
}

if (updated || failed) {
  console.log(`resolve-lfs: ${updated} updated, ${current} already current, ${failed} skipped.`);
}
process.exit(0);
