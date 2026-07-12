/*! Open Historia — downloads the large world-map assets from the GitHub Release © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The big map binaries (pmtiles, geojson, city seeds) used to live in Git LFS.
// GitHub's free LFS *bandwidth* is only 1 GB/month shared across the whole org,
// and a full checkout pulls ~200 MB — so a handful of installs exhausted it and
// every download then 403'd. Release-asset bandwidth is free and unmetered, so
// these files now ship as assets on a GitHub Release instead (see scripts/
// map-assets.json). This script makes the local tree match that manifest:
// anything missing or the wrong content is downloaded from the release and
// checksum-verified. The launcher and the updater both call it in place of
// `git lfs pull` / the old LFS media-host fetch.
//
// Usage:
//   node scripts/fetch-map-assets.mjs            # verify sha256, re-fetch anything that differs
//   node scripts/fetch-map-assets.mjs --ensure   # faster: only fetch files that are missing / wrong size
//
// Best-effort: it never exits non-zero, so it can never block a launch or an
// update. On any problem it warns and leaves the existing file in place.
import { createHash } from "node:crypto";
import { readFile, writeFile, stat, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENSURE_ONLY = process.argv.includes("--ensure");
const ROOT = process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(here, "map-assets.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let manifest;
try {
  manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
} catch (error) {
  console.error(`fetch-map-assets: cannot read ${path.basename(MANIFEST)} (${error.message}); skipping map-data download.`);
  process.exit(0);
}
if (typeof fetch !== "function") {
  console.error("fetch-map-assets: this Node is too old for fetch (need Node 18+); skipping map-data download.");
  process.exit(0);
}

const { owner, repo, release, assets = [] } = manifest;
if (!owner || !repo || !release || !assets.length) {
  console.error("fetch-map-assets: manifest is missing owner/repo/release/assets; skipping.");
  process.exit(0);
}
const base = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release)}`;

let present = 0;
let downloaded = 0;
let failed = 0;

for (const asset of assets) {
  const dst = path.join(ROOT, asset.path);

  // Already have the right bytes? --ensure trusts the size; a full run also
  // verifies the SHA-256 so a changed map (uploaded to the same release) is
  // picked up and a truncated/corrupt file is repaired.
  try {
    const info = await stat(dst);
    if (info.size === asset.bytes) {
      if (ENSURE_ONLY) { present += 1; continue; }
      if (sha256(await readFile(dst)) === asset.sha256) { present += 1; continue; }
    }
  } catch {
    /* missing — fall through and download */
  }

  const url = `${base}/${asset.asset}`;
  const mb = (asset.bytes / 1e6).toFixed(asset.bytes >= 1e7 ? 0 : 1);
  console.log(`  downloading ${asset.asset} (${mb} MB)...`);
  const tmp = `${dst}.download`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== asset.sha256) throw new Error("checksum mismatch");
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(tmp, buf);
    await rename(tmp, dst);
    downloaded += 1;
  } catch (error) {
    console.error(`  [warn] could not download ${asset.asset} (${error.message}); the map may not display.`);
    await unlink(tmp).catch(() => {});
    failed += 1;
  }
}

if (downloaded || failed) {
  console.log(`fetch-map-assets: ${downloaded} downloaded, ${present} already current, ${failed} failed.`);
}
process.exit(0);
