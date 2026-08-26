/*! Open Historia — vendor Azgaar's Fantasy Map Generator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Vendors Azgaar's Fantasy Map Generator (MIT) into ./fmg/dist, served same-origin
// at /fmg/ so the map editor's "Generate" console can run it headlessly and read
// its data. PINNED to v1.109 — the NEWEST release that still runs as plain static
// files (no build) and keeps its state (pack, grid, biomesData, mapCoordinates…) in
// the classic global scope where the importer can reach it. FMG v1.110+ moved to
// ES modules, where that state is module-scoped and no longer reachable.
//
// To move the pin forward, bump FMG_TAG and re-test the editor's Generate console.
// Run by the updater so a missing/broken copy self-heals. Best-effort: any failure
// prints a clear message and exits 0 so the game still launches.

import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "fmg", "dist");
const STAMP = path.join(ROOT, "fmg", ".version");

const FMG_REPO = "Azgaar/Fantasy-Map-Generator";
const FMG_TAG = "v1.109";
// Pinned by COMMIT, not by tag. What lands here is served same-origin at /fmg/
// and executed by the editor (an iframe plus eval), on the same origin that
// holds the player's AI keys in localStorage — so this download is as
// trust-sensitive as our own code. A git tag is a movable pointer: whoever can
// push to the upstream repo can repoint v1.109 at anything, and every install
// would fetch it on the next update. A commit id addresses the exact tree, and
// GitHub will not serve different bytes for it.
//
// To move the pin: pick the new release, resolve it
//   git ls-remote https://github.com/Azgaar/Fantasy-Map-Generator refs/tags/<tag>
// update BOTH constants, and re-test the editor's Generate console.
const FMG_COMMIT = "50f51bd8380a7fddc27977f96fa9c1db4b7cdd1e";
const ZIP_URL = `https://codeload.github.com/${FMG_REPO}/zip/${FMG_COMMIT}`;
// The stamp records the commit, so an install pinned to the old tag re-fetches.
const PIN = `${FMG_TAG}@${FMG_COMMIT.slice(0, 12)}`;

const log = (m) => console.log(`[fmg] ${m}`);

async function main() {
  // Already at the pinned version? nothing to do (keeps updates fast).
  if (fs.existsSync(path.join(DIST_DIR, "index.html")) && fs.existsSync(STAMP)) {
    if (fs.readFileSync(STAMP, "utf8").trim() === PIN) {
      log(`already at ${PIN}.`);
      return;
    }
  }

  log(`downloading Fantasy Map Generator ${PIN}…`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());

  log("extracting (static — no build needed)…");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const rootPrefix = names[0]?.includes("/") ? `${names[0].split("/")[0]}/` : "";

  // Extract into a temp dir, then swap into place, so a failed extract never
  // leaves a half-written /fmg/dist that the server would serve.
  const tmp = path.join(ROOT, "fmg", ".dist-tmp");
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const rel = entry.name.startsWith(rootPrefix) ? entry.name.slice(rootPrefix.length) : entry.name;
    if (!rel) continue;
    // Zip-slip guard: an archive entry names its own path, so "../../x" would
    // have written wherever it liked. Resolve first, then insist the result is
    // still inside the staging directory.
    const out = path.resolve(tmp, rel);
    if (!out.startsWith(tmp + path.sep)) {
      throw new Error(`archive entry escapes the staging directory: ${entry.name}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await entry.async("nodebuffer")));
  }
  if (!fs.existsSync(path.join(tmp, "index.html"))) throw new Error("downloaded FMG has no index.html");

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DIST_DIR), { recursive: true });
  fs.renameSync(tmp, DIST_DIR);
  fs.writeFileSync(STAMP, PIN);
  log(`Fantasy Map Generator ${PIN} vendored → /fmg/ ✓`);
}

main().catch((e) => {
  console.error(`[fmg] vendoring skipped: ${e?.message || e}`);
  console.error("[fmg] the game still runs; the map editor's Generate console will report FMG isn't ready.");
  process.exit(0); // never block launch/update
});
