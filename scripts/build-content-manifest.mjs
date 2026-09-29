/*! Open Historia — content-manifest builder © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Derives public/content-manifest.json (the asset → SHA-256 map the website uses
// to verify bytes fetched from a content node or from the origin) from
// scripts/map-assets.web.json: the files the WEBSITE fetches, by release-asset
// name. That is not scripts/map-assets.json, which is what the desktop and the
// local server download (other sizes of some files, under their install paths);
// building from it would sign hashes the website never receives. Run this
// whenever a file the website fetches changes. The manifest is small and
// public — it names hashes, not bytes.
//
// When the assets are unchanged the file is left exactly as it is, so its
// signature stays valid. When they changed, keyid/issued/expires are dropped
// and the manifest must be re-signed:
//   node scripts/sign-release.mjs --stamp --days 365 public/content-manifest.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "scripts", "map-assets.web.json");
const DESKTOP_SRC = path.join(ROOT, "scripts", "map-assets.json");
const ANDROID_SRC = path.join(ROOT, "mobile", "map-assets.android.json");
const OUT = path.join(ROOT, "public", "content-manifest.json");

// Release assets named in more than one list with different bytes or hashes:
// one name is one file on the release, so one of the lists is wrong.
export const assetListConflicts = (lists) => {
  const seen = new Map();
  const conflicts = [];
  for (const [listName, list] of Object.entries(lists)) {
    for (const entry of list?.assets ?? []) {
      if (!entry?.asset) continue;
      const before = seen.get(entry.asset);
      if (!before) {
        seen.set(entry.asset, { listName, entry });
      } else if (before.entry.sha256 !== entry.sha256 || before.entry.bytes !== entry.bytes) {
        conflicts.push(`${entry.asset}: ${before.listName} and ${listName} disagree`);
      }
    }
  }
  return conflicts;
};

// The manifest for `web`, keeping `previous`'s signing stamp when its assets
// are the same. Returns { manifest, changed }.
export const buildContentManifest = ({ web, previous = null, owner = "Open-Historia", repo = "open-historia" }) => {
  const assets = {};
  for (const entry of web.assets ?? []) {
    if (!entry?.asset || !entry?.sha256) continue;
    assets[entry.asset] = { sha256: entry.sha256, bytes: entry.bytes ?? 0 };
  }
  const manifest = {
    schema: "oh-content/1",
    version: 1,
    // Where the client falls back if no node has (or can prove) the bytes: the
    // canonical GitHub Release the assets already ship from.
    origin: {
      kind: "github-release",
      owner,
      repo,
      release: web.release,
    },
    assets,
  };
  const same = previous
    && JSON.stringify({ ...previous, keyid: undefined, issued: undefined, expires: undefined }) === JSON.stringify(manifest);
  if (same) {
    for (const key of ["keyid", "issued", "expires"]) if (previous[key] !== undefined) manifest[key] = previous[key];
  }
  return { manifest, changed: !same };
};

const main = () => {
  const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
  const web = readJson(SRC);
  const desktop = readJson(DESKTOP_SRC);
  const conflicts = assetListConflicts({
    "scripts/map-assets.web.json": web,
    "scripts/map-assets.json": desktop,
    ...(existsSync(ANDROID_SRC) ? { "mobile/map-assets.android.json": readJson(ANDROID_SRC) } : {}),
  });
  if (conflicts.length) {
    console.error(`The map asset lists disagree about a release asset:\n  ${conflicts.join("\n  ")}`);
    process.exit(1);
  }
  const previous = existsSync(OUT) ? readJson(OUT) : null;
  const { manifest, changed } = buildContentManifest({ web, previous, owner: desktop.owner, repo: desktop.repo });
  const rel = path.relative(ROOT, OUT);
  if (!changed) {
    console.log(`${rel}: ${Object.keys(manifest.assets).length} assets, unchanged; its signature still holds.`);
    return;
  }
  writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`${rel}: ${Object.keys(manifest.assets).length} assets written.`);
  console.log(`Now sign it: node scripts/sign-release.mjs --stamp --days 365 ${rel.replace(/\\/g, "/")}`);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) main();
