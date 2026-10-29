import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fixtures = path.join(here, "../tests/golden");
const CASES_MOST = 300;
const BYTES_MOST = 200000;
const BLOB_FROM = 2000;

const MODULES = {
  "src/runtime/unitMotion.js": { name: "unitMotion", keep: ["hashSeed"] },
  "src/runtime/gameDates.js": { name: "gameDates" },
  "src/runtime/fronts/constants.js": { name: "constants" },
  "src/runtime/fronts/codec.js": { name: "codec" },
  "src/runtime/fronts/frame.js": { name: "frame", factories: ["projectorOf"] },
  "src/runtime/fronts/worldGrid.js": { name: "worldGrid", factories: ["buildWorldGrid"] },
  "src/runtime/regionTypes.js": { name: "regionTypes", keep: ["isWaterType", "waterTypeIds"] },
  "src/runtime/fronts/arena.js": { name: "arena", factories: ["rasterizeArena", "arenaFor"] },
  "src/runtime/fronts/mechanics.js": { name: "mechanics" },
  "src/runtime/fronts/military.js": { name: "military" },
  "src/runtime/fronts/heldRegions.js": { name: "heldRegions" },
  "src/runtime/fronts/handicap.js": { name: "handicap" },
  "src/runtime/fronts/invade.js": { name: "invade" },
  "src/runtime/fronts/manpower.js": { name: "manpower", keep: ["menPerFormation", "shareOf"] },
  "src/runtime/fronts/attrition.js": { name: "attrition" },
  "src/runtime/fronts/muster.js": { name: "muster" },
  "src/runtime/fronts/deploy.js": { name: "deploy" },
  "src/runtime/fronts/field.js": { name: "field", factories: ["createField", "openField", "unpackField", "resampleField"], big: ["takeCapsule", "takeCells", "restoreCells", "rebuildFromHolders", "resampleField", "rebuildDistances"] },
  "src/runtime/fronts/line.js": { name: "line" },
  "src/runtime/fronts/ground.js": { name: "ground", big: ["measure", "awayOf", "cheapestWay"] },
  "src/runtime/fronts/contact.js": { name: "contact" },
  "src/runtime/fronts/sectors.js": { name: "sectors" },
};

const BIG = new Set(Object.values(MODULES).flatMap((value) => (value.big ?? []).map((fn) => `${value.name}.${fn}`)));
const budgetOf = (key) => (BIG.has(key) ? BYTES_MOST * 4 : BYTES_MOST);

const only = process.argv.slice(2);
const chosen = Object.fromEntries(Object.entries(MODULES).filter(([, value]) => only.length === 0 || only.includes(value.name)));

const testFiles = () => {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.js")) found.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(path.join(root, "src/runtime/fronts"));
  for (const extra of ["src/runtime/gameDates.test.js", "src/runtime/unitMotion.test.js", "src/Game/AI/frontTurn.test.js"]) {
    if (fs.existsSync(path.join(root, extra))) found.push(extra);
  }
  return found.sort();
};

const out = fs.mkdtempSync(path.join(os.tmpdir(), "ohfronts-golden-"));
const config = Object.fromEntries(Object.entries(chosen).map(([file, value]) => [path.join(root, file), { name: value.name, factories: value.factories ?? [] }]));
const run = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(here, "hooks.mjs")).href, "--test", ...testFiles()], {
  cwd: root,
  env: { ...process.env, GOLDEN_OUT: out, GOLDEN_MODULES: JSON.stringify(config) },
  stdio: ["ignore", "pipe", "pipe"],
  maxBuffer: 1 << 30,
});
const summary = String(run.stdout).split("\n").filter((line) => /^ℹ (tests|pass|fail)/.test(line));
console.log(summary.join("\n"));

const gathered = new Map();
const names = fs.readdirSync(out).map((name) => [name, JSON.parse(fs.readFileSync(path.join(out, name), "utf8")).source]).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
for (const [name] of names) {
  const part = JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));
  for (const [key, list] of Object.entries(part.cases)) {
    if (!gathered.has(key)) gathered.set(key, { seen: new Set(), cases: [] });
    const entry = gathered.get(key);
    let bytes = 0;
    let kept = 0;
    const stride = Math.max(1, Math.floor(list.length / 40));
    for (let at = 0; at < list.length; at += stride) {
      const item = list[at];
      const text = JSON.stringify(item);
      if (text.length > budgetOf(key) / 3 || bytes > 1000000 || kept >= 40) continue;
      bytes += text.length;
      kept += 1;
      const hash = createHash("sha1").update(text).digest("base64");
      if (entry.seen.has(hash)) continue;
      entry.seen.add(hash);
      entry.cases.push({ item, size: text.length });
    }
  }
}
fs.rmSync(out, { recursive: true, force: true });
if (process.env.GOLDEN_STATS) for (const [key, entry] of gathered) console.log("stat", key, entry.cases.length, Math.min(...entry.cases.map((c) => c.size)), Math.max(...entry.cases.map((c) => c.size)));

const spread = (list, most) => {
  if (list.length <= most) return list;
  const picked = [];
  for (let at = 0; at < most; at += 1) picked.push(list[Math.floor((at * list.length) / most)]);
  return picked;
};

const shapeOf = (value, depth = 0) => {
  if (value === null) return "n";
  if (Array.isArray(value)) return depth < 2 && value.length ? ["A", shapeOf(value[0], depth + 1)] : value.length ? "A" : "A0";
  if (typeof value === "object") {
    if (typeof value.$ === "string") return value.$ === "made" || value.$ === "O" ? shapeOf(value.v, depth) : value.$;
    return depth < 2 ? Object.keys(value).sort().map((key) => [key, shapeOf(value[key], depth + 1)]) : "O";
  }
  return typeof value;
};

const pick = (all, most) => {
  const fitting = all.filter((item) => item.size <= most / 3);
  const groups = new Map();
  for (const item of fitting) {
    const key = JSON.stringify([shapeOf(item.item.a), shapeOf(item.item.r, 1), item.item.cb ? Object.keys(item.item.cb) : 0]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const queues = [...groups.values()].map((list) => spread(list, list.length));
  const order = queues.map((list) => {
    const out = [];
    for (let step = list.length; out.length < list.length; step = Math.max(1, Math.floor(step / 2))) {
      for (let at = 0; at < list.length && out.length < list.length; at += step) if (!out.includes(list[at])) out.push(list[at]);
    }
    return out;
  });
  const picked = [];
  let bytes = 0;
  for (let round = 0; picked.length < CASES_MOST; round += 1) {
    let any = false;
    for (const list of order) {
      if (round >= list.length || picked.length >= CASES_MOST) continue;
      any = true;
      const item = list[round];
      if (bytes + item.size > most && picked.length >= 12) continue;
      picked.push(item);
      bytes += item.size;
    }
    if (!any) break;
  }
  if (picked.length < 12) for (const item of [...all].sort((a, b) => a.size - b.size)) if (picked.length < 12 && !picked.includes(item)) picked.push(item);
  return picked;
};

fs.mkdirSync(fixtures, { recursive: true });
for (const value of Object.values(chosen)) {
  const cases = {};
  for (const [key, entry] of [...gathered].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [moduleName, fn] = key.split(".");
    if (moduleName !== value.name || (value.keep && !value.keep.includes(fn))) continue;
    cases[fn] = pick(entry.cases, budgetOf(key)).map((item) => item.item);
  }
  const blobs = [];
  const blobIndex = new Map();
  const intern = (node) => {
    if (!node || typeof node !== "object") return node;
    const text = JSON.stringify(node);
    if (text.length >= BLOB_FROM) {
      if (!blobIndex.has(text)) {
        blobIndex.set(text, -1);
        const flat = !Array.isArray(node) && typeof node.$ === "string" && node.$ !== "made" && node.$ !== "O" && node.$ !== "Map" && node.$ !== "Set";
        const inner = flat ? node : Array.isArray(node) ? node.map(intern) : Object.fromEntries(Object.entries(node).map(([key, item]) => [key, intern(item)]));
        blobIndex.set(text, blobs.length);
        blobs.push(inner);
      }
      return { $: "ref", k: blobIndex.get(text) };
    }
    return node;
  };
  const shrunk = {};
  for (const [fn, list] of Object.entries(cases)) {
    shrunk[fn] = list.map((item) => Object.fromEntries(Object.entries(item).map(([key, node]) => [key, key === "a" || key === "aa" || key === "r" ? (Array.isArray(node) ? node.map(intern) : intern(node)) : key === "cb" ? Object.fromEntries(Object.entries(node).map(([name, calls]) => [name, calls.map((call) => call.map(intern))])) : node])));
  }
  const file = path.join(fixtures, `${value.name}.json`);
  fs.writeFileSync(file, JSON.stringify({ blobs, cases: shrunk }));
  const counts = Object.entries(shrunk).map(([fn, list]) => `${fn}:${list.length}`).join(" ");
  console.log(`${value.name} ${(fs.statSync(file).size / 1024).toFixed(0)}KB ${counts}`);
}
