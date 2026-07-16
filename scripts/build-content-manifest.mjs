/*! Open Historia — content-manifest builder © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Derives public/content-manifest.json (the asset → SHA-256 map the browser uses
// to verify bytes fetched from a content node) from scripts/map-assets.json, the
// single source of truth for the large map binaries. Run this whenever the map
// assets change. The manifest is small and public — it names hashes, not bytes.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "scripts", "map-assets.json");
const OUT = path.join(ROOT, "public", "content-manifest.json");

const mapAssets = JSON.parse(readFileSync(SRC, "utf8"));
const assets = {};
for (const entry of mapAssets.assets ?? []) {
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
    owner: mapAssets.owner,
    repo: mapAssets.repo,
    release: mapAssets.release,
  },
  assets,
};

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`content-manifest.json: ${Object.keys(assets).length} assets → ${path.relative(ROOT, OUT)}`);
