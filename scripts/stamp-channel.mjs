/*! Open Historia — release-channel stamp © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Writes electron/channel.json, which is how the packaged desktop app knows
// whether it is the stable build or the beta one. Same pattern as the build id
// the release workflow stamps into electron/build-id.json: a generated file the
// app reads at startup, never committed.
//
// This exists instead of electron-builder's `extraMetadata` because that option
// rewrites the project's own package.json while it packages — and a build that is
// interrupted at the wrong moment leaves the repo's package.json stripped of its
// scripts. Not a risk worth running to pass one string.
//
//   node scripts/stamp-channel.mjs beta     -> the beta build
//   node scripts/stamp-channel.mjs stable   -> removes the stamp (the default)
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const target = path.join(here, "..", "electron", "channel.json");
const channel = process.argv[2] === "beta" ? "beta" : "stable";

if (channel === "stable") {
  // Deleting rather than writing {"channel":"stable"} keeps the stable build
  // byte-identical to one made from a clean checkout, and it is what clears a
  // beta stamp left behind in a working tree by an earlier `dist:*:beta`.
  fs.rmSync(target, { force: true });
  console.log("channel: stable (no stamp)");
} else {
  fs.writeFileSync(target, `${JSON.stringify({ channel }, null, 2)}\n`);
  console.log(`channel: ${channel} -> ${target}`);
}
