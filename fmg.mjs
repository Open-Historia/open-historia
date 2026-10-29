import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const fmgDistOf = (repo) => path.join(repo, "fmg", "dist");

const vendor = async (repo) => import(pathToFileURL(path.join(repo, "scripts", "fmg-vendor.mjs")).href);
const bridge = async (repo) => import(pathToFileURL(path.join(repo, "native", "sidecar", "handlers", "fmg_bridge.mjs")).href);

export const ensureFmg = (repo, { node = process.execPath } = {}) => {
  const dist = fmgDistOf(repo);
  if (fs.existsSync(path.join(dist, "index.html"))) return dist;
  console.log("fmg/dist is not here: fetching the pinned Fantasy Map Generator with scripts/fetch-fmg.mjs --required");
  const fetched = spawnSync(node, [path.join(repo, "scripts", "fetch-fmg.mjs"), "--required"], { cwd: repo, stdio: "inherit" });
  if (fetched.status !== 0 || !fs.existsSync(path.join(dist, "index.html"))) throw new Error(`The Fantasy Map Generator could not be fetched (node scripts/fetch-fmg.mjs --required exited ${fetched.status ?? fetched.error?.message}).`);
  return dist;
};

export const stageFmg = async (repo, stage, { node = process.execPath } = {}) => {
  const dist = ensureFmg(repo, { node });
  const { PREPARED_MARK } = await vendor(repo);
  if (!fs.readFileSync(path.join(dist, "index.html"), "utf8").includes(PREPARED_MARK)) throw new Error(`${dist} is not the game's prepared copy: delete it and run node scripts/fetch-fmg.mjs --required.`);
  const target = fmgDistOf(stage);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dist, target, { recursive: true });
  const stamp = path.join(repo, "fmg", ".version");
  if (fs.existsSync(stamp)) fs.copyFileSync(stamp, path.join(stage, "fmg", ".version"));
  const { FMG_BRIDGE_FILE, FMG_BRIDGE_PAGE } = await bridge(repo);
  fs.writeFileSync(path.join(target, FMG_BRIDGE_FILE), FMG_BRIDGE_PAGE);
  let files = 0;
  let bytes = 0;
  const count = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) count(full);
      else {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  count(target);
  console.log(`map generator: ${files} files, ${(bytes / 1048576).toFixed(1)} MB${fs.existsSync(stamp) ? ` (${fs.readFileSync(stamp, "utf8").trim()})` : ""}`);
  return { dist: target, files, bytes };
};
