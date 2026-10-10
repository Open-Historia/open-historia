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
//   node scripts/fetch-map-assets.mjs --ensure   # faster: hash only files not verified since they last changed
//   ... --progress                               # also print `@progress {"asset","received","total"}` lines while downloading
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
import { createReadStream, realpathSync } from "node:fs";
import { open, readFile, writeFile, stat, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(here, "map-assets.json");

// Which files were hashed and passed, keyed by their path on disk:
// { sha256, size, mtimeMs }. Lives in the current directory, next to the
// install it describes.
const VERIFIED_STATE_NAME = ".map-assets-verified.json";

const readVerified = async (file) => {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

// Hashes a file as a stream, so checking a 100 MB archive does not load it whole.
const sha256File = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

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

// Streams a response body into `file`, hashing as it arrives, so a 100 MB
// archive is never held in memory whole. Resolves with the SHA-256.
const streamToFile = async (body, file, onBytes) => {
  const hash = createHash("sha256");
  const out = await open(file, "w");
  let received = 0;
  try {
    for await (const chunk of body) {
      hash.update(chunk);
      await out.write(chunk);
      received += chunk.byteLength;
      onBytes(received);
    }
  } finally {
    await out.close();
  }
  return hash.digest("hex");
};

// Makes the files on disk match `manifest`. Resolves with the counts; never
// throws for a single file.
export const syncMapAssets = async ({
  manifest,
  root = process.cwd(),
  assetsDir = "",
  dataDir = "",
  ensure = false,
  stateFile = "",
  progress = false,
  progressEveryMs = 250,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  log = console.log,
  warn = console.error,
}) => {
  const { owner, repo, release, assets = [] } = manifest;
  const base = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release)}`;

  const verified = stateFile ? await readVerified(stateFile) : {};
  const nextVerified = {};

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

    // Already have the right bytes?
    //
    // --ensure used to trust the SIZE alone, so a file of the right length that
    // was damaged on disk (a disk error, an antivirus, a hand-copied file) was
    // never looked at again and drew broken tiles forever. Now the hash a file
    // passed is remembered with its size and mtime: --ensure re-hashes only when
    // there is no such stamp or the file changed since (so a normal launch is
    // still a stat per file), and a full run always re-hashes.
    const stamp = verified[dst];
    try {
      const info = await stat(dst);
      if (info.size === asset.bytes) {
        const stampMatches = stamp
          && stamp.sha256 === asset.sha256
          && stamp.size === info.size
          && stamp.mtimeMs === info.mtimeMs;
        if (ensure && stampMatches) {
          present += 1;
          nextVerified[dst] = stamp;
          continue;
        }
        if ((await sha256File(dst)) === asset.sha256) {
          present += 1;
          nextVerified[dst] = { sha256: asset.sha256, size: info.size, mtimeMs: info.mtimeMs };
          continue;
        }
        warn(`  [warn] ${asset.asset} is the right size but not the published bytes; downloading it again.`);
      }
    } catch {
      /* missing — fall through and download */
    }

    const url = `${base}/${asset.asset}`;
    const mb = (asset.bytes / 1e6).toFixed(asset.bytes >= 1e7 ? 0 : 1);
    log(`  downloading ${asset.asset} (${mb} MB)...`);
    const tmp = `${dst}.download`;
    // --progress: the desktop setup window turns these lines into its bar
    // (electron/main.cjs), at most one every progressEveryMs plus the first and
    // the last, so a slow link still moves it and a fast one does not flood it.
    let lastReport = -Infinity;
    const report = (received, force = false) => {
      if (!progress) return;
      const at = now();
      if (!force && at - lastReport < progressEveryMs) return;
      lastReport = at;
      log(`@progress ${JSON.stringify({ asset: asset.asset, received, total: asset.bytes })}`);
    };
    try {
      const res = await fetchImpl(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("empty response");
      await mkdir(path.dirname(dst), { recursive: true });
      report(0, true);
      const got = await streamToFile(res.body, tmp, report);
      if (got !== asset.sha256) throw new Error("checksum mismatch");
      await rename(tmp, dst);
      report(asset.bytes, true);
      downloaded += 1;
      // Remember what was just proved, so --ensure need not re-hash 100 MB on
      // every launch to know this is still the file that was verified.
      try {
        const info = await stat(dst);
        nextVerified[dst] = { sha256: asset.sha256, size: info.size, mtimeMs: info.mtimeMs };
      } catch { /* the stamp only saves a re-hash */ }
    } catch (error) {
      warn(`  [warn] could not download ${asset.asset} (${error.message}); the map may not display.`);
      await unlink(tmp).catch(() => {});
      failed += 1;
    }
  }

  // Best effort: a missing or unwritable stamp file only means the next --ensure
  // hashes again, which is correct, just slower.
  if (stateFile) {
    try {
      await writeFile(stateFile, `${JSON.stringify(nextVerified, null, 2)}\n`);
    } catch { /* not worth a warning */ }
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
    stateFile: path.join(process.cwd(), VERIFIED_STATE_NAME),
    progress: process.argv.includes("--progress"),
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
