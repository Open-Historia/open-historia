/*! Open Historia — downloads the large world-map assets from the GitHub Release © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
// Manifest paths are relative to the current directory, except that the server
// reads its folders from OH_ASSETS_DIR and OH_DATA_DIR when they are set, and so
// does this script: "public/assets/…" lands in OH_ASSETS_DIR and
// "server/data/…" in OH_DATA_DIR. The desktop app sets both (a packaged beta
// shares the stable app's assets folder), and electron/main.cjs checks for
// missing files with the same rule.
//
// Best-effort: it never exits non-zero, so it can never block a launch or an
// update. On any problem it warns and leaves the existing file in place.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, writeFile, stat, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(here, "map-assets.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const PREFIXES = [
  ["public/assets/", "assetsDir"],
  ["server/data/", "dataDir"],
];

// Where a manifest path lands on disk; null when it would escape its folder.
export const resolveAssetTarget = (assetPath, { root, assetsDir = "", dataDir = "" }) => {
  const rel = String(assetPath ?? "").replace(/\\/g, "/");
  const dirs = { assetsDir, dataDir };
  for (const [prefix, key] of PREFIXES) {
    if (dirs[key] && rel.startsWith(prefix)) {
      const base = path.resolve(dirs[key]);
      const target = path.resolve(base, rel.slice(prefix.length));
      return target.startsWith(base + path.sep) ? target : null;
    }
  }
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  return target.startsWith(base + path.sep) ? target : null;
};

// Makes the files on disk match `manifest`. Resolves with the counts; never
// throws for a single file.
export const syncMapAssets = async ({
  manifest,
  root = process.cwd(),
  assetsDir = "",
  dataDir = "",
  ensure = false,
  fetchImpl = globalThis.fetch,
  log = console.log,
  warn = console.error,
}) => {
  const { owner, repo, release, assets = [] } = manifest;
  const base = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release)}`;

  let present = 0;
  let downloaded = 0;
  let failed = 0;

  for (const asset of assets) {
    const dst = resolveAssetTarget(asset.path, { root, assetsDir, dataDir });
    if (!dst) {
      warn(`  [warn] ${asset.asset} wants to write outside its folder (${asset.path}); skipped.`);
      failed += 1;
      continue;
    }

    // Already have the right bytes? --ensure trusts the size; a full run also
    // verifies the SHA-256 so a changed map (uploaded to the same release) is
    // picked up and a truncated/corrupt file is repaired.
    try {
      const info = await stat(dst);
      if (info.size === asset.bytes) {
        if (ensure) { present += 1; continue; }
        if (sha256(await readFile(dst)) === asset.sha256) { present += 1; continue; }
      }
    } catch {
      /* missing — fall through and download */
    }

    const url = `${base}/${asset.asset}`;
    const mb = (asset.bytes / 1e6).toFixed(asset.bytes >= 1e7 ? 0 : 1);
    log(`  downloading ${asset.asset} (${mb} MB)...`);
    const tmp = `${dst}.download`;
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha256(buf) !== asset.sha256) throw new Error("checksum mismatch");
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(tmp, buf);
      await rename(tmp, dst);
      downloaded += 1;
    } catch (error) {
      warn(`  [warn] could not download ${asset.asset} (${error.message}); the map may not display.`);
      await unlink(tmp).catch(() => {});
      failed += 1;
    }
  }

  if (downloaded || failed) {
    log(`fetch-map-assets: ${downloaded} downloaded, ${present} already current, ${failed} failed.`);
  }
  return { present, downloaded, failed };
};

const main = async () => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (error) {
    console.error(`fetch-map-assets: cannot read ${path.basename(MANIFEST)} (${error.message}); skipping map-data download.`);
    return;
  }
  if (typeof fetch !== "function") {
    console.error("fetch-map-assets: this Node is too old for fetch (need Node 18+); skipping map-data download.");
    return;
  }
  const { owner, repo, release, assets = [] } = manifest;
  if (!owner || !repo || !release || !assets.length) {
    console.error("fetch-map-assets: manifest is missing owner/repo/release/assets; skipping.");
    return;
  }
  await syncMapAssets({
    manifest,
    root: process.cwd(),
    assetsDir: process.env.OH_ASSETS_DIR || "",
    dataDir: process.env.OH_DATA_DIR || "",
    ensure: process.argv.includes("--ensure"),
  });
};

// Run unless imported (by the tests). Compared through realpath as well, so a
// junction or a short 8.3 name in the launch path cannot quietly turn every
// launch's download into a no-op.
const isMain = (() => {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(process.argv[1]) === self) return true;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(self);
  } catch {
    return false;
  }
})();
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`fetch-map-assets: ${error.message}`);
  }
  process.exit(0);
}
