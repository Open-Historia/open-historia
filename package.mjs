import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const out = path.resolve(process.argv[2] || path.join(here, "out"));
const godotExe = process.env.OH_GODOT_EXE || "";
const stage = path.join(out, "stage");
const appName = "Open Historia Native";

if (process.platform !== "win32") throw new Error("The installer is built on Windows.");
if (!fs.existsSync(godotExe)) throw new Error("Set OH_GODOT_EXE to the Godot 4.7 windowed executable (Godot_v4.7.2-stable_win64.exe).");

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

const release = path.join(here, "engine", "target", "release", "oh_gdext.dll");
if (!fs.existsSync(release)) throw new Error("Build the release library first: cargo build -p oh_gdext --release (in native/engine).");
run(process.execPath, [path.join(here, "sidecar", "build.mjs")]);
run(godotExe, ["--headless", "--path", path.join(here, "godot"), "--import"]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

copy(godotExe, path.join(stage, "runtime", "godot.exe"));
copy(process.execPath, path.join(stage, "runtime", "node.exe"));

const godotSource = path.join(here, "godot");
copy(godotSource, path.join(stage, "native", "godot"), (file, isDir) => {
  const relative = path.relative(godotSource, file).split(path.sep).join("/");
  if (isDir) return !["tests", ".godot/editor", ".godot/shader_cache", ".godot/imported"].includes(relative);
  if (relative.startsWith("bin/")) return false;
  return !relative.startsWith("tests/");
});
copy(release, path.join(stage, "native", "godot", "bin", "oh_gdext.dll"));

const sidecar = path.join(here, "sidecar");
for (const name of ["main.mjs", "shims.js", "standin.js", "serverWorker.mjs"]) copy(path.join(sidecar, name), path.join(stage, "native", "sidecar", name));
copy(path.join(sidecar, "dist", "engine.mjs"), path.join(stage, "native", "sidecar", "dist", "engine.mjs"));
copy(path.join(sidecar, "handlers"), path.join(stage, "native", "sidecar", "handlers"), (file, isDir) => isDir || file.endsWith(".mjs"));

copy(path.join(repo, "server"), path.join(stage, "server"), (file, isDir) => {
  if (isDir) return path.basename(file) !== "data";
  return !file.endsWith(".test.js");
});
fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify({ name: "open-historia-native", private: true, type: "module" }, null, 2)}\n`);

const modules = path.join(repo, "node_modules");
const wanted = ["express", "jszip", "pmtiles"];
const builtins = new Set((await import("node:module")).builtinModules);
for (const name of fs.readdirSync(path.join(sidecar, "handlers")).filter((entry) => entry.endsWith(".mjs"))) {
  const source = fs.readFileSync(path.join(sidecar, "handlers", name), "utf8");
  for (const match of source.matchAll(/(?:from|import\()\s*["']([^"'./][^"']*)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith("node:") || builtins.has(specifier)) continue;
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
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
  for (const dependency of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) visit(dependency, dir);
};
for (const name of wanted) visit(name, repo);
for (const dir of seen) copy(dir, path.join(stage, path.relative(repo, dir)));
console.log(`bundled ${seen.size} server packages`);

const publicDir = path.join(repo, "public");
copy(path.join(repo, "scripts", "map-assets.json"), path.join(stage, "scripts", "map-assets.json"));
for (const name of ["logo.png", "icon-192.png", "icon-512.png", "scenario-placeholder.webp", "flags", "lang", "fonts", "offline-relief", "audio", "assets"]) {
  if (fs.existsSync(path.join(publicDir, name))) copy(path.join(publicDir, name), path.join(stage, "public", name));
}
for (const name of fs.readdirSync(publicDir).filter((entry) => entry.startsWith("loading_screen"))) copy(path.join(publicDir, name), path.join(stage, "public", name));

const png = fs.readFileSync(path.join(publicDir, "icon-192.png"));
const icon = Buffer.alloc(22);
icon.writeUInt16LE(0, 0);
icon.writeUInt16LE(1, 2);
icon.writeUInt16LE(1, 4);
icon.writeUInt8(192, 6);
icon.writeUInt8(192, 7);
icon.writeUInt8(0, 8);
icon.writeUInt8(0, 9);
icon.writeUInt16LE(1, 10);
icon.writeUInt16LE(32, 12);
icon.writeUInt32LE(png.length, 14);
icon.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(stage, "runtime", "open-historia.ico"), Buffer.concat([icon, png]));
fs.writeFileSync(path.join(stage, ".oh-native-install"), `${new Date().toISOString()}\n`);

const launcher = [
  "@echo off",
  "start \"\" \"%~dp0runtime\\godot.exe\" --path \"%~dp0native\\godot\"",
  "",
].join("\r\n");
fs.writeFileSync(path.join(stage, `${appName}.cmd`), launcher);

const smoke = await new Promise((resolve) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-native-package-"));
  const child = spawn(path.join(stage, "runtime", "node.exe"), [path.join(stage, "native", "sidecar", "main.mjs")], { cwd: stage, env: { ...process.env, OH_NATIVE_ROOT: root, OH_STANDIN_MODEL: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const failed = [];
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const timer = setTimeout(() => { child.kill(); resolve({ ready: false, failed, errors }); }, 120000);
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message = null;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.event === "sidecar.handlerFailed") failed.push(message.data);
    if (message?.event === "ready") {
      clearTimeout(timer);
      child.stdin.end();
      resolve({ ready: true, failed, errors });
    }
  });
  child.on("exit", () => { clearTimeout(timer); resolve({ ready: false, failed, errors }); });
});
if (!smoke.ready) throw new Error(`The staged engine did not start:
${smoke.errors.slice(-3000)}`);
for (const entry of smoke.failed) console.log(`WARNING handler not loaded in the package: ${entry.file}: ${entry.message}`);
console.log(`staged engine started; ${smoke.failed.length} handler(s) failed to load`);

const zip = path.join(out, "app.zip");
run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", stage, "."]);
console.log(`app.zip ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);

const target = path.join(out, `${appName} Setup.exe`);
const framework = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
run(path.join(framework, "csc.exe"), [
  "/nologo",
  "/target:winexe",
  "/optimize+",
  `/out:${target}`,
  `/win32icon:${path.join(stage, "runtime", "open-historia.ico")}`,
  `/resource:${zip},app.zip`,
  "/reference:System.IO.Compression.dll",
  "/reference:System.IO.Compression.FileSystem.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  path.join(here, "installer", "Setup.cs"),
]);
console.log(`installer ${target} ${(fs.statSync(target).size / 1048576).toFixed(1)} MB`);
console.log(`unpacked app ${path.join(stage, `${appName}.cmd`)}`);
