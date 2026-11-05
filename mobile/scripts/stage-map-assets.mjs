/*! Open Historia — fetch the map data the Android app ships © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Android app carries the world map INSIDE the APK, so a phone plays in
// airplane mode from the first tap. It is the web build, and it carries the
// very files the website does: one list (scripts/map-assets.web.json), one
// stager and one cache (scripts/stage-map-assets.mjs, map-cache/ at the repo
// root). `npm run map` here is that stager; stage-www.mjs lays its files
// under www/assets/.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_CACHE_DIR, readWebMapManifest, stageMapAssets } from "../../scripts/stage-map-assets.mjs";

export { MAP_CACHE_DIR, stageMapAssets };
export const readAndroidMapManifest = readWebMapManifest;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("Staging the Android map data into map-cache/:");
  stageMapAssets().then((staged) => {
    const total = staged.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(`${staged.length} files, ${(total / 1048576).toFixed(1)} MB.`);
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
