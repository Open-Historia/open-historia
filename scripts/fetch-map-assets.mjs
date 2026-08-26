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

// Records which bytes were actually checked, so --ensure can be fast WITHOUT
// trusting file size alone. See the note on ENSURE_ONLY below.
const VERIFIED_STATE = path.join(ROOT, ".map-assets-verified.json");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const readVerified = async () => {
  try {
    const parsed = JSON.parse(await readFile(VERIFIED_STATE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

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
// Fixed https URL built from the manifest that ships inside the app — there is no
// env override on purpose. The bytes are pinned by the sha256 below, so the
// download source only decides whether a fetch SUCCEEDS, never what lands on disk.
const base = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release)}`;

const verified = await readVerified();
const nextVerified = {};

let present = 0;
let downloaded = 0;
let failed = 0;

for (const asset of assets) {
  // A manifest entry with no checksum has nothing to verify the download
  // against, so refuse it outright rather than writing unverified bytes. (The
  // old code technically failed closed here too — `sha256(buf) !== undefined` is
  // always true — but by accident, reported as "checksum mismatch", and one
  // refactor away from silently becoming a hole.)
  if (typeof asset?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    console.error(`  [warn] ${asset?.asset ?? "(unnamed asset)"} has no usable sha256 in the manifest; refusing to download it.`);
    failed += 1;
    continue;
  }

  // The manifest ships inside the app, so this is defence in depth rather than a
  // live threat — but a path is a path, and one that escapes the install root
  // should never be written just because a JSON file asked for it.
  const dst = path.resolve(ROOT, asset.path);
  if (dst !== path.join(ROOT, asset.path) || !dst.startsWith(ROOT + path.sep)) {
    console.error(`  [warn] ${asset.asset} wants to write outside the install directory (${asset.path}); skipped.`);
    failed += 1;
    continue;
  }

  // Already have the right bytes?
  //
  // --ensure used to trust the SIZE alone, and the desktop shell's own
  // missing-asset check still does — which meant a file of the right length was
  // never looked at again, however its contents got there. Now the hash a file
  // passed is remembered along with its size and mtime: --ensure re-hashes only
  // when one of those changed (so a second launch is still just a stat), and a
  // file that was never verified gets hashed once. A full run always re-hashes.
  const stamp = verified[asset.path];
  try {
    const info = await stat(dst);
    if (info.size === asset.bytes) {
      const stampMatches = stamp
        && stamp.sha256 === asset.sha256
        && stamp.size === info.size
        && stamp.mtimeMs === info.mtimeMs;
      if (ENSURE_ONLY && stampMatches) {
        present += 1;
        nextVerified[asset.path] = stamp;
        continue;
      }
      if (sha256(await readFile(dst)) === asset.sha256) {
        present += 1;
        nextVerified[asset.path] = { sha256: asset.sha256, size: info.size, mtimeMs: info.mtimeMs };
        continue;
      }
      console.error(`  [warn] ${asset.asset} is the right size but the wrong bytes — re-downloading.`);
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
    // Remember what we just proved, so --ensure doesn't have to re-hash 100 MB
    // on every launch to know this file is still the file we verified.
    try {
      const info = await stat(dst);
      nextVerified[asset.path] = { sha256: asset.sha256, size: info.size, mtimeMs: info.mtimeMs };
    } catch { /* the stamp is an optimisation; losing it only costs a re-hash */ }
  } catch (error) {
    console.error(`  [warn] could not download ${asset.asset} (${error.message}); the map may not display.`);
    await unlink(tmp).catch(() => {});
    failed += 1;
  }
}

// Best-effort: a missing or unwritable stamp file just means the next --ensure
// re-hashes, which is correct, only slower.
try {
  await writeFile(VERIFIED_STATE, `${JSON.stringify(nextVerified, null, 2)}\n`);
} catch { /* not worth a warning */ }

if (downloaded || failed) {
  console.log(`fetch-map-assets: ${downloaded} downloaded, ${present} already current, ${failed} failed.`);
}
process.exit(0);
