import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fixtures = path.join(here, "../tests/golden");
const CASES_MOST = 300;
const BYTES_MOST = 150000;
const BLOB_FROM = 2000;

const MODULES = {
  "src/runtime/unitMotion.js": { name: "unitMotion", keep: ["hashSeed"] },
  "src/runtime/gameDates.js": { name: "gameDates" },
  "src/runtime/fronts/constants.js": { name: "constants" },
  "src/runtime/fronts/codec.js": { name: "codec" },
  "src/runtime/fronts/frame.js": { name: "frame", factories: ["projectorOf"] },
  "src/runtime/fronts/worldGrid.js": { name: "worldGrid", factories: ["buildWorldGrid"] },
  "src/runtime/fronts/mechanics.js": { name: "mechanics" },
  "src/runtime/fronts/military.js": { name: "military" },
  "src/runtime/fronts/heldRegions.js": { name: "heldRegions" },
  "src/runtime/fronts/handicap.js": { name: "handicap" },
  "src/runtime/fronts/invade.js": { name: "invade" },
};

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
const parts = fs.readdirSync(out).map((name) => JSON.parse(fs.readFileSync(path.join(out, name), "utf8")));
parts.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
for (const part of parts) {
  for (const [key, list] of Object.entries(part.cases)) {
    if (!gathered.has(key)) gathered.set(key, { seen: new Set(), cases: [] });
    const entry = gathered.get(key);
    for (const item of list) {
      const text = JSON.stringify(item);
      if (entry.seen.has(text)) continue;
      entry.seen.add(text);
      entry.cases.push({ item, size: text.length });
    }
  }
}
fs.rmSync(out, { recursive: true, force: true });

const spread = (list, most) => {
  if (list.length <= most) return list;
  const picked = [];
  for (let at = 0; at < most; at += 1) picked.push(list[Math.floor((at * list.length) / most)]);
  return picked;
};

fs.mkdirSync(fixtures, { recursive: true });
for (const value of Object.values(chosen)) {
  const cases = {};
  for (const [key, entry] of [...gathered].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [moduleName, fn] = key.split(".");
    if (moduleName !== value.name || (value.keep && !value.keep.includes(fn))) continue;
    let list = spread(entry.cases.filter((item) => item.size <= BYTES_MOST / 3), CASES_MOST);
    while (list.length > 1 && list.reduce((sum, item) => sum + item.size, 0) > BYTES_MOST) list = spread(list, Math.floor(list.length * 0.8));
    if (list.length < 12) list = [...new Set([...list, ...[...entry.cases].sort((a, b) => a.size - b.size).slice(0, 12 - list.length)])];
    cases[fn] = list.map((item) => item.item);
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
