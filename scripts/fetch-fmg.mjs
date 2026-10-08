/*! Open Historia — vendor Azgaar's Fantasy Map Generator © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Puts the game's copy of Azgaar's Fantasy Map Generator (MIT) into ./fmg/dist.
// The local server serves it same-origin at /fmg/, where the map editor's
// Generate drawer runs it in a hidden frame and reads the world it makes, and
// the desktop installers pack it (package.json build.files), so a player's
// editor has it too.
//
// What is downloaded (a pinned commit) and what the game keeps of it (a
// prepared copy that reaches no outside host) are scripts/fmg-vendor.mjs's to
// say.
//
//   node scripts/fetch-fmg.mjs             best effort: a failure prints why and
//                                          exits 0, so a source checkout still runs
//                                          (its editor hides the Generate drawer)
//   node scripts/fetch-fmg.mjs --required  for a release build: a failure exits 1,
//                                          so an installer is never built without it

import fs from "fs";
import path from "path";
import url from "url";

import { FMG_STAMP, FMG_TAG, FMG_ZIP_URL, PREPARED_MARK, prepareFmgFile } from "./fmg-vendor.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "fmg", "dist");
const STAMP = path.join(ROOT, "fmg", ".version");
const REQUIRED = process.argv.includes("--required");

const log = (m) => console.log(`[fmg] ${m}`);

// A copy is current when it is stamped with this preparation AND its page
// carries the mark: the stamp alone would trust a folder whose files were
// replaced by hand.
const isCurrent = () => {
  try {
    return fs.readFileSync(STAMP, "utf8").trim() === FMG_STAMP
      && fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf8").includes(PREPARED_MARK);
  } catch {
    return false;
  }
};

async function main() {
  if (isCurrent()) {
    log(`already at ${FMG_STAMP}.`);
    return;
  }

  log(`downloading Fantasy Map Generator ${FMG_TAG}…`);
  const res = await fetch(FMG_ZIP_URL);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());

  log("preparing the game's copy (no outside hosts, only the files a generation uses)…");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const rootPrefix = names[0]?.includes("/") ? `${names[0].split("/")[0]}/` : "";

  // Written into a temp dir, then swapped into place, so a failed run never
  // leaves a half-written /fmg/dist that the server would serve.
  const tmp = path.join(ROOT, "fmg", ".dist-tmp");
  fs.rmSync(tmp, { recursive: true, force: true });
  let kept = 0;
  let keptBytes = 0;
  let dropped = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const rel = entry.name.startsWith(rootPrefix) ? entry.name.slice(rootPrefix.length) : entry.name;
    if (!rel) continue;
    const bytes = prepareFmgFile(rel, await entry.async("nodebuffer"));
    if (!bytes) { dropped += 1; continue; }
    const out = path.join(tmp, rel);
    // The archive names every path; none may leave the folder it is written to.
    if (!path.resolve(out).startsWith(path.resolve(tmp) + path.sep)) throw new Error(`the archive names a path outside the generator's folder: ${rel}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    kept += 1;
    keptBytes += bytes.length;
  }
  for (const file of ["index.html", "main.js", "LICENSE"]) {
    if (!fs.existsSync(path.join(tmp, file))) throw new Error(`the downloaded generator has no ${file}`);
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DIST_DIR), { recursive: true });
  fs.renameSync(tmp, DIST_DIR);
  fs.writeFileSync(STAMP, FMG_STAMP);
  log(`Fantasy Map Generator ${FMG_STAMP} → /fmg/ ✓ (${kept} files, ${(keptBytes / 1024 / 1024).toFixed(1)} MB; ${dropped} left out)`);
}

main().catch((e) => {
  if (REQUIRED) {
    console.error(`[fmg] the generator could not be vendored: ${e?.message || e}`);
    console.error("[fmg] a release is not built without it: the map editor's Generate drawer would be missing from the installer.");
    process.exit(1);
  }
  console.error(`[fmg] vendoring skipped: ${e?.message || e}`);
  console.error("[fmg] the game still runs; the map editor hides its Generate drawer.");
  process.exit(0); // never block a source checkout's launch
});
