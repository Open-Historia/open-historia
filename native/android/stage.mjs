import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const native = path.resolve(here, "..");
const repo = path.resolve(native, "..");
const cli = process.argv.slice(2);
const skipBuild = cli.includes("--no-build");
const lean = cli.includes("--lean");
const out = path.join(here, "out");
const stage = path.join(out, "stage");
const payloadDir = path.join(native, "godot", "android_payload");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
};

const copy = (from, to, filter = () => true) => {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    if (!filter(from, true)) return;
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name), filter);
  } else if (filter(from, false)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
};

const noMaps = (file, isDir) => isDir || !file.endsWith(".map");

if (!skipBuild) run(process.execPath, [path.join(native, "sidecar", "build.mjs")]);

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const sidecar = path.join(native, "sidecar");
const SIDECAR_SKIP = new Set(["build.mjs", "smoke.mjs"]);
for (const name of fs.readdirSync(sidecar).filter((entry) => /\.(mjs|js|cjs)$/.test(entry) && !SIDECAR_SKIP.has(entry))) copy(path.join(sidecar, name), path.join(stage, "native", "sidecar", name));
copy(path.join(sidecar, "dist"), path.join(stage, "native", "sidecar", "dist"), noMaps);
copy(path.join(sidecar, "handlers"), path.join(stage, "native", "sidecar", "handlers"), (file, isDir) => isDir || file.endsWith(".mjs") || file.endsWith(".cjs"));
copy(path.join(repo, "server"), path.join(stage, "server"), (file, isDir) => {
  if (isDir) return path.basename(file) !== "data";
  return !file.endsWith(".test.js");
});
fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify({ name: "open-historia-native", private: true, type: "module" }, null, 2)}\n`);

const wanted = ["express", "jszip", "pmtiles"];
const ANDROID_SKIP = ["node-datachannel", "@node-datachannel", "@huggingface/transformers", "onnxruntime-node", "onnxruntime-web", "onnxruntime-common", "sharp", "@img"];
const builtins = new Set((await import("node:module")).builtinModules);
for (const name of fs.readdirSync(path.join(sidecar, "handlers")).filter((entry) => entry.endsWith(".mjs"))) {
  const source = fs.readFileSync(path.join(sidecar, "handlers", name), "utf8");
  for (const match of source.matchAll(/(?:from|import\()\s*["']([^"'./][^"']*)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith("node:") || builtins.has(specifier)) continue;
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (ANDROID_SKIP.some((skip) => packageName === skip || packageName.startsWith(`${skip}/`))) continue;
    if (!wanted.includes(packageName)) wanted.push(packageName);
  }
}
const seen = new Set();
const packageDir = (name, from) => {
  let dir = from;
  while (dir.startsWith(repo)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};
const visit = (name, from) => {
  const dir = packageDir(name, from);
  if (!dir || seen.has(dir)) return;
  seen.add(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const dependency of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) {
    if (!ANDROID_SKIP.some((skip) => dependency === skip || dependency.startsWith(`${skip}/`))) visit(dependency, dir);
  }
};
for (const name of wanted) visit(name, repo);
for (const dir of seen) copy(dir, path.join(stage, path.relative(repo, dir)), noMaps);
console.log(`bundled ${seen.size} server packages`);

const publicDir = path.join(repo, "public");
copy(path.join(repo, "scripts", "map-assets.json"), path.join(stage, "scripts", "map-assets.json"));
const publicParts = lean
  ? ["logo.png", "icon-192.png", "icon-512.png", "scenario-placeholder.webp", "flags", "fonts", "assets"]
  : ["logo.png", "icon-192.png", "icon-512.png", "scenario-placeholder.webp", "flags", "lang", "fonts", "offline-relief", "audio", "assets"];
for (const name of publicParts) {
  if (fs.existsSync(path.join(publicDir, name))) copy(path.join(publicDir, name), path.join(stage, "public", name));
}
if (lean) {
  for (const name of ["catalog-en.json", "en.json"]) {
    if (fs.existsSync(path.join(publicDir, "lang", name))) copy(path.join(publicDir, "lang", name), path.join(stage, "public", "lang", name));
  }
}
for (const name of fs.readdirSync(publicDir).filter((entry) => entry.startsWith("loading_screen"))) copy(path.join(publicDir, name), path.join(stage, "public", name));

const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
fs.writeFileSync(path.join(stage, "native", "android-build.json"), `${JSON.stringify({ commit: head.status === 0 ? head.stdout.trim() : "", stagedAt: new Date().toISOString(), lean }, null, 2)}\n`);

let stagedBytes = 0;
let stagedFiles = 0;
const measure = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) measure(full);
    else {
      stagedBytes += fs.statSync(full).size;
      stagedFiles += 1;
    }
  }
};
measure(stage);
console.log(`staged ${stagedFiles} files, ${(stagedBytes / 1048576).toFixed(1)} MB`);

fs.mkdirSync(payloadDir, { recursive: true });
const bootDir = path.join(payloadDir, "boot");
fs.rmSync(bootDir, { recursive: true, force: true });
const bootFiles = ["public/logo.png", "public/icon-192.png", ...fs.readdirSync(path.join(publicDir, "fonts")).filter((name) => name.endsWith(".woff2")).map((name) => `public/fonts/${name}`)];
for (const relative of bootFiles) copy(path.join(repo, relative), path.join(bootDir, `${relative}.bin`));
console.log(`boot files in the pck: ${bootFiles.length}`);
const launcherDir = path.join(payloadDir, "launcher");
fs.rmSync(launcherDir, { recursive: true, force: true });
const mipmaps = path.join(repo, "mobile", "android", "app", "src", "main", "res", "mipmap-xxxhdpi");
for (const name of ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_background.png"]) copy(path.join(mipmaps, name), path.join(launcherDir, name));
const zip = path.join(payloadDir, "app.zip");
fs.rmSync(zip, { force: true });
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "zip";
if (process.platform === "win32") run(tar, ["-a", "-c", "-f", zip, "-C", stage, "."]);
else run("zip", ["-qr", zip, "."], { cwd: stage });
const hash = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex").slice(0, 16);
fs.writeFileSync(path.join(payloadDir, "app.stamp"), `${hash}\n`);
console.log(`payload ${zip} ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB, stamp ${hash}`);
