import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const cli = process.argv.slice(2);
const positional = cli.filter((arg) => !arg.startsWith("--"));
const out = path.resolve(positional[0] || path.join(here, "out"));
const skipBuild = cli.includes("--no-build");
const godotExe = process.env.OH_GODOT_EXE || "";
const stage = path.join(out, "stage");
const appName = "Open Historia Native";
const nativeUpdate = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "update.mjs")).href);
const chunkKit = await import(pathToFileURL(path.join(here, "sidecar", "updateChunks.mjs")).href);
const notes = String(process.env.OH_NATIVE_NOTES || "A new super-experimental build of Open Historia Native.");

if (process.platform !== "win32") throw new Error("The installer is built on Windows.");
if (!fs.existsSync(godotExe)) throw new Error("Set OH_GODOT_EXE to the Godot 4.7 windowed executable (Godot_v4.7.2-stable_win64.exe).");

const version = fs.readFileSync(path.join(here, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("native/VERSION must hold a version such as 0.1.0.");
const stampedAt = new Date();
const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
const stamp = {
  version,
  build: stampedAt.toISOString().replace(/\D/g, "").slice(0, 14),
  commit: head.status === 0 ? head.stdout.trim() : "",
  notes,
};
console.log(`stamping ${appName} ${stamp.version} build ${stamp.build} (${stamp.commit || "no commit"})`);

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
const template = process.env.OH_GODOT_TEMPLATE || path.join(path.dirname(godotExe), "templates", "windows_release_x86_64.exe");
if (!fs.existsSync(template)) throw new Error("Set OH_GODOT_TEMPLATE to Godot 4.7.2's official release export template (windows_release_x86_64.exe from the export templates).");
if (skipBuild) {
  if (!fs.existsSync(path.join(here, "sidecar", "dist"))) throw new Error("--no-build needs an existing native/sidecar/dist.");
  console.log("--no-build: using the existing sidecar build");
} else {
  run(process.execPath, [path.join(here, "sidecar", "build.mjs")]);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const godotSource = path.join(here, "godot");
const project = path.join(out, "project");
copy(godotSource, project, (file, isDir) => {
  const relative = path.relative(godotSource, file).split(path.sep).join("/");
  if (isDir) return ![".godot", "tests", "bin"].includes(relative);
  return true;
});
copy(release, path.join(project, "bin", "oh_gdext.dll"));
const presets = path.join(project, "export_presets.cfg");
fs.writeFileSync(presets, fs.readFileSync(presets, "utf8").replace(/^custom_template\/release=.*$/m, `custom_template/release=${JSON.stringify(template.split(path.sep).join("/"))}`));
run(godotExe, ["--headless", "--path", project, "--import"]);
fs.mkdirSync(path.join(stage, "runtime"), { recursive: true });
run(godotExe, ["--headless", "--path", project, "--export-release", "Windows Desktop", path.join(stage, "runtime", "Open Historia.exe")]);
for (const name of ["Open Historia.exe", "Open Historia.pck", "oh_gdext.dll"]) {
  if (!fs.existsSync(path.join(stage, "runtime", name))) throw new Error(`The release export did not write runtime/${name}.`);
}
copy(process.execPath, path.join(stage, "runtime", "node.exe"));
fs.mkdirSync(path.join(stage, "native", "godot"), { recursive: true });
fs.writeFileSync(path.join(stage, "native", "godot", "version.json"), `${JSON.stringify(stamp, null, 2)}\n`);

const sidecar = path.join(here, "sidecar");
for (const name of ["main.mjs", "shims.js", "standin.js", "serverWorker.mjs", "workers.js", "workerHost.mjs", "updateChunks.mjs"]) copy(path.join(sidecar, name), path.join(stage, "native", "sidecar", name));
copy(path.join(sidecar, "dist"), path.join(stage, "native", "sidecar", "dist"), (file, isDir) => isDir || !file.endsWith(".map"));
copy(path.join(sidecar, "handlers"), path.join(stage, "native", "sidecar", "handlers"), (file, isDir) => isDir || file.endsWith(".mjs") || file.endsWith(".cjs"));
if (fs.existsSync(path.join(sidecar, "node_modules"))) copy(path.join(sidecar, "node_modules"), path.join(stage, "native", "sidecar", "node_modules"));

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

const fmgDist = path.join(repo, "fmg", "dist");
if (fs.existsSync(fmgDist)) {
  copy(fmgDist, path.join(stage, "fmg", "dist"));
  if (fs.existsSync(path.join(repo, "fmg", ".version"))) copy(path.join(repo, "fmg", ".version"), path.join(stage, "fmg", ".version"));
}

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
const framework = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
const brand = path.join(out, "brand.exe");
run(path.join(framework, "csc.exe"), ["/nologo", "/target:exe", "/optimize+", `/out:${brand}`, path.join(here, "installer", "Brand.cs")]);
run(brand, [path.join(stage, "runtime", "Open Historia.exe"), path.join(stage, "runtime", "open-historia.ico"), "Open Historia"]);
const imageCodec = await import(pathToFileURL(path.join(sidecar, "handlers", "imagecodec.mjs")).href);
const imageCodecTarget = path.join(stage, "native", "sidecar", "imagecodec", imageCodec.IMAGE_CODEC_EXE);
fs.mkdirSync(path.dirname(imageCodecTarget), { recursive: true });
run(path.join(framework, "csc.exe"), imageCodec.imageCodecCompileArgs(imageCodecTarget));
fs.writeFileSync(path.join(stage, ".oh-native-install"), `${new Date().toISOString()}\n`);
const compileSetup = (target, resource = "") => run(path.join(framework, "csc.exe"), [
  "/nologo",
  "/target:winexe",
  "/optimize+",
  `/out:${target}`,
  `/win32icon:${path.join(stage, "runtime", "open-historia.ico")}`,
  ...(resource ? [`/resource:${resource},app.zip`] : []),
  "/reference:System.IO.Compression.dll",
  "/reference:System.IO.Compression.FileSystem.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  path.join(here, "installer", "Setup.cs"),
]);
compileSetup(path.join(stage, ...chunkKit.UPDATER_EXE.split("/")));

const launcher = [
  "@echo off",
  "start \"\" \"%~dp0runtime\\Open Historia.exe\"",
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

const chunkOut = path.join(out, "chunks");
const chunkRelease = chunkKit.writeRelease({ stage, out: chunkOut, details: { build: stamp.build, version: stamp.version, commit: stamp.commit } });
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
console.log(`chunks: ${chunkRelease.manifest.files.length} files, ${megabytes(chunkRelease.manifest.bytes)}, in ${chunkRelease.chunkCount} chunks (${megabytes(chunkRelease.assetBytes)} as published); file list ${chunkRelease.manifestName} ${megabytes(chunkRelease.manifestSize)}`);

const zip = path.join(out, "app.zip");
run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", stage, "."]);
console.log(`app.zip ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);

const target = path.join(out, nativeUpdate.NATIVE_SETUP_NAME);
compileSetup(target, zip);
console.log(`installer ${target} ${(fs.statSync(target).size / 1048576).toFixed(1)} MB`);
const manifest = {
  ...stamp,
  sha256: await nativeUpdate.sha256File(target),
  size: fs.statSync(target).size,
  url: nativeUpdate.NATIVE_SETUP_URL,
  notes,
  published: stampedAt.toISOString(),
  mandatory: process.env.OH_NATIVE_MANDATORY === "1",
  chunks: chunkKit.feedChunks(chunkRelease, process.env.OH_NATIVE_CHUNKS_BASE || nativeUpdate.NATIVE_CHUNKS_BASE),
};
const manifestFile = path.join(out, nativeUpdate.NATIVE_MANIFEST_NAME);
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`update feed ${manifestFile} (build ${manifest.build}, sha256 ${manifest.sha256})`);
console.log(`update chunks ${chunkOut} (${chunkRelease.chunkCount} chunks, file list ${chunkRelease.manifestName})`);
console.log(`unpacked app ${path.join(stage, `${appName}.cmd`)}`);
