/*! Open Historia — stage the Android build into the Capacitor shell © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Android app is the web bundle built with `--mode android`
// (npm run build:android → dist-android/), plus the world map inside the APK.
// It used to be the website's bundle verbatim, which connected to a community
// content node for every tile; now everything the game needs is on the phone,
// and the only network use is the community hub and the player's own AI
// provider.
//
// This copies dist-android/ into mobile/www/ (Capacitor's webDir), drops the
// website-only files that ride along in the output (marketing pages, the
// sitemap, the signed node directory nobody consults here), and lays the
// verified map data from map-cache/ under www/assets/. Nothing in mobile/www is
// committed except its .gitignore.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_CACHE_DIR, readAndroidMapManifest } from "./stage-map-assets.mjs";

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(mobileDir);
const source = path.join(repoRoot, "dist-android");
const target = path.join(mobileDir, "www");

// Website-only: served by openhistoria.com, meaningless inside the app, and
// some of them large (the screenshots alone are 8 MB).
const SITE_ONLY = [
  "screenshots", "screenshot.png",
  "guides", "get-started", "how-to-play", "self-hosting", "pax-historia-alternative",
  "sitemap.xml", "sitemap.txt", "robots.txt",
  "sw.js", "version.json",
  "content-manifest.json", "content-manifest.json.sig",
  "node-directory.json", "node-directory.json.sig",
];

if (!existsSync(path.join(source, "index.html"))) {
  console.error(
    "dist-android/ is missing — build the Android bundle first:\n"
    + "  npm run build:android\n"
    + "(from the repo root; the APK workflow does this for you).",
  );
  process.exit(1);
}

const manifest = readAndroidMapManifest();
const missing = manifest.assets.filter((entry) => !existsSync(path.join(MAP_CACHE_DIR, entry.asset)));
if (missing.length) {
  console.error(
    `map-cache/ is missing ${missing.map((entry) => entry.asset).join(", ")} — fetch the map data first:\n`
    + "  npm run map\n"
    + "(in mobile/; it downloads and verifies the files from the map-data release).",
  );
  process.exit(1);
}

// Keep .gitignore: it is the only committed thing in here, and losing it would
// put a whole build output into the next commit.
for (const entry of existsSync(target) ? readdirSync(target) : []) {
  if (entry === ".gitignore") continue;
  rmSync(path.join(target, entry), { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

let pruned = 0;
for (const name of SITE_ONLY) {
  const candidate = path.join(target, name);
  if (existsSync(candidate)) { rmSync(candidate, { recursive: true, force: true }); pruned += 1; }
}

const assetsDir = path.join(target, "assets");
mkdirSync(assetsDir, { recursive: true });
let shipped = 0;
for (const entry of manifest.assets) {
  const from = path.join(MAP_CACHE_DIR, entry.asset);
  const to = path.join(target, entry.path);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
  shipped += statSync(to).size;
}

console.log(
  `Staged the Android build into mobile/www/ (${readdirSync(target).length} entries, `
  + `${pruned} website-only files dropped, ${(shipped / 1048576).toFixed(1)} MB of map data under assets/).`,
);
