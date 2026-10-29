import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const cli = process.argv.slice(2);
const positional = cli.filter((arg) => !arg.startsWith("--"));
const out = path.resolve(positional[0] || path.join(here, "out-linux"));
const skipBuild = cli.includes("--no-build");
const withProbe = cli.includes("--probe");
const appName = "Open Historia Native";
const exeName = "Open Historia";
const gameFile = `${exeName}.x86_64`;
const nativeUpdate = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "update.mjs")).href);
const chunkKit = await import(pathToFileURL(path.join(here, "sidecar", "updateChunks.mjs")).href);
const imageCodec = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "imagecodec.mjs")).href);
const fmgKit = await import(pathToFileURL(path.join(here, "fmg.mjs")).href);
const notes = String(process.env.OH_NATIVE_NOTES || "A new super-experimental build of Open Historia Native.");

if (process.platform !== "linux") throw new Error("The Linux app is built on Linux.");
const godotEditor = process.env.OH_GODOT_EDITOR || "";
const template = process.env.OH_GODOT_TEMPLATE || "";
const library = path.resolve(process.env.OH_GDEXT_SO || path.join(here, "engine", "target", "release", "liboh_gdext.so"));
const webLibrary = path.resolve(process.env.OH_OHWEB_SO || path.join(path.dirname(library), "libohweb.so"));
const nodeBinary = path.resolve(process.env.OH_NODE_BIN || process.execPath);
const codecBinary = path.resolve(process.env.OH_IMAGECODEC_BIN || path.join(here, "sidecar", "imagecodec", imageCodec.IMAGE_CODEC_MAC));
if (!fs.existsSync(godotEditor)) throw new Error("Set OH_GODOT_EDITOR to the Godot 4.7.2 Linux editor (Godot_v4.7.2-stable_linux.x86_64).");
if (!fs.existsSync(template)) throw new Error("Set OH_GODOT_TEMPLATE to Godot 4.7.2's linux_release.x86_64 export template.");
if (!fs.existsSync(library)) throw new Error(`The engine library ${library} is missing: cargo build -p oh_gdext --release (in native/engine).`);
if (!fs.existsSync(webLibrary)) throw new Error(`The web view library ${webLibrary} is missing: cargo build -p ohweb --release (in native/engine).`);
if (!fs.existsSync(codecBinary)) throw new Error("Set OH_IMAGECODEC_BIN to the AVIF reader built by native/linux/build-imagecodec.sh.");

const version = fs.readFileSync(path.join(here, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("native/VERSION must hold a version such as 0.1.0.");
const stampedAt = new Date();
const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
const stamp = {
  version,
  build: process.env.OH_NATIVE_BUILD || stampedAt.toISOString().replace(/\D/g, "").slice(0, 14),
  commit: head.status === 0 ? head.stdout.trim() : "",
  notes,
};
console.log(`stamping ${appName} for Linux ${stamp.version} build ${stamp.build} (${stamp.commit || "no commit"})`);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})`);
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
    fs.chmodSync(to, stat.mode & 0o777);
  }
};
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

if (skipBuild) {
  if (!fs.existsSync(path.join(here, "sidecar", "dist"))) throw new Error("--no-build needs an existing native/sidecar/dist.");
  console.log("--no-build: using the existing sidecar build");
} else {
  run(process.execPath, [path.join(here, "sidecar", "build.mjs")]);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const stage = path.join(out, appName);
const runtime = path.join(stage, "runtime");

const godotSource = path.join(here, "godot");
const project = path.join(out, "project");
copy(godotSource, project, (file, isDir) => {
  const relative = path.relative(godotSource, file).split(path.sep).join("/");
  if (isDir) return ![".godot", "tests", "bin"].includes(relative);
  return true;
});
copy(library, path.join(project, "bin", "liboh_gdext.so"));
copy(webLibrary, path.join(project, "bin", "libohweb.so"));

const presetsFile = path.join(project, "export_presets.cfg");
const presetsText = fs.readFileSync(presetsFile, "utf8");
const linuxAt = presetsText.indexOf("platform=\"Linux\"");
if (linuxAt < 0) throw new Error("export_presets.cfg has no Linux preset.");
const nextPreset = presetsText.indexOf("\n[preset.", presetsText.indexOf("options]", linuxAt));
const linuxEnd = nextPreset < 0 ? presetsText.length : nextPreset;
const setOption = (text, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key.replace(/[/.]/g, "\\$&")}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : text.replace(/\[preset\.\d+\.options\]\n/, (match) => `${match}${line}\n`);
};
let linuxPart = presetsText.slice(linuxAt, linuxEnd);
linuxPart = setOption(linuxPart, "custom_template/release", JSON.stringify(template));
linuxPart = setOption(linuxPart, "custom_template/debug", JSON.stringify(template));
fs.writeFileSync(presetsFile, presetsText.slice(0, linuxAt) + linuxPart + presetsText.slice(linuxEnd));

run(godotEditor, ["--headless", "--path", project, "--import"]);
fs.mkdirSync(runtime, { recursive: true });
run(godotEditor, ["--headless", "--path", project, "--export-release", "Linux", path.join(runtime, gameFile)]);
for (const name of [gameFile, `${exeName}.pck`, "liboh_gdext.so", "libohweb.so"]) {
  if (!fs.existsSync(path.join(runtime, name))) throw new Error(`The Linux export did not write runtime/${name}.`);
}
fs.chmodSync(path.join(runtime, gameFile), 0o755);
fs.copyFileSync(nodeBinary, path.join(runtime, "node"));
fs.chmodSync(path.join(runtime, "node"), 0o755);
fs.copyFileSync(path.join(repo, "public", "icon-512.png"), path.join(runtime, "open-historia.png"));
fs.mkdirSync(path.join(stage, "native", "godot"), { recursive: true });
fs.writeFileSync(path.join(stage, "native", "godot", "version.json"), `${JSON.stringify(stamp, null, 2)}\n`);

const sidecar = path.join(here, "sidecar");
const sidecarTools = new Set(["build.mjs", "smoke.mjs", "engine.js"]);
for (const name of fs.readdirSync(sidecar).filter((entry) => /\.(?:mjs|cjs|js)$/.test(entry) && !sidecarTools.has(entry))) copy(path.join(sidecar, name), path.join(stage, "native", "sidecar", name));
copy(path.join(sidecar, "dist"), path.join(stage, "native", "sidecar", "dist"), (file, isDir) => isDir || !file.endsWith(".map"));
copy(path.join(sidecar, "handlers"), path.join(stage, "native", "sidecar", "handlers"), (file, isDir) => isDir || file.endsWith(".mjs") || file.endsWith(".cjs"));
if (fs.existsSync(path.join(sidecar, "node_modules"))) copy(path.join(sidecar, "node_modules"), path.join(stage, "native", "sidecar", "node_modules"));
const prebuild = path.join(stage, "native", "sidecar", "node_modules", "@node-datachannel", "linux-x64-gnu", "node_datachannel.node");
if (fs.existsSync(path.join(sidecar, "node_modules", "node-datachannel")) && !fs.existsSync(prebuild)) throw new Error("The linux-x64-gnu node-datachannel prebuild is missing from native/sidecar/node_modules.");

const codecTarget = path.join(stage, "native", "sidecar", "imagecodec", imageCodec.IMAGE_CODEC_MAC);
fs.mkdirSync(path.dirname(codecTarget), { recursive: true });
fs.copyFileSync(codecBinary, codecTarget);
fs.chmodSync(codecTarget, 0o755);

copy(path.join(repo, "server"), path.join(stage, "server"), (file, isDir) => {
  if (isDir) return path.basename(file) !== "data";
  return !file.endsWith(".test.js");
});
fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify({ name: "open-historia-native", private: true, type: "module" }, null, 2)}\n`);

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

const fmgStaged = await fmgKit.stageFmg(repo, stage);
console.log(`map generator: ${fmgStaged?.files ?? "?"} files, ${megabytes(fmgStaged?.bytes ?? 0)}`);

const publicDir = path.join(repo, "public");
copy(path.join(repo, "scripts", "map-assets.json"), path.join(stage, "scripts", "map-assets.json"));
for (const name of ["logo.png", "icon-192.png", "icon-512.png", "scenario-placeholder.webp", "flags", "lang", "fonts", "offline-relief", "audio", "assets"]) {
  if (fs.existsSync(path.join(publicDir, name))) copy(path.join(publicDir, name), path.join(stage, "public", name));
}
for (const name of fs.readdirSync(publicDir).filter((entry) => entry.startsWith("loading_screen"))) copy(path.join(publicDir, name), path.join(stage, "public", name));

const unix = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
fs.writeFileSync(path.join(stage, "open-historia-native"), unix(path.join(here, "linux", "open-historia-native")), { mode: 0o755 });
fs.chmodSync(path.join(stage, "open-historia-native"), 0o755);
fs.writeFileSync(path.join(stage, "open-historia-native.desktop"), unix(path.join(here, "linux", "open-historia-native.desktop")));
fs.writeFileSync(path.join(stage, nativeUpdate.INSTALL_MARKER), `${stampedAt.toISOString()}\n`);

const smoke = await new Promise((resolve) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-native-package-"));
  const child = spawn(path.join(runtime, "node"), [path.join(stage, "native", "sidecar", "main.mjs")], { cwd: stage, env: { ...process.env, OH_NATIVE_ROOT: root, OH_STANDIN_MODEL: "1", XDG_CONFIG_HOME: path.join(root, "config") }, stdio: ["pipe", "pipe", "pipe"] });
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
fs.writeFileSync(path.join(out, "sidecar-smoke.json"), `${JSON.stringify({ ready: smoke.ready, failed: smoke.failed }, null, 2)}\n`);
if (smoke.failed.length) throw new Error("Every handler must load in the Linux package.");

const chunkOut = path.join(out, "chunks");
const chunkRelease = chunkKit.writeRelease({ stage, out: chunkOut, details: { build: stamp.build, version: stamp.version, commit: stamp.commit, platform: "linux" } });
console.log(`chunks: ${chunkRelease.manifest.files.length} files, ${megabytes(chunkRelease.manifest.bytes)}, in ${chunkRelease.chunkCount} chunks (${megabytes(chunkRelease.assetBytes)} as published); file list ${chunkRelease.manifestName} ${megabytes(chunkRelease.manifestSize)}`);

const archive = path.join(out, nativeUpdate.NATIVE_LINUX_ARCHIVE_NAME);
run("tar", ["--owner=0", "--group=0", "--numeric-owner", "--sort=name", "-czf", archive, "-C", out, appName]);
console.log(`${path.basename(archive)} ${megabytes(fs.statSync(archive).size)}`);

const manifest = {
  ...stamp,
  platform: "linux",
  sha256: await nativeUpdate.sha256File(archive),
  size: fs.statSync(archive).size,
  url: nativeUpdate.NATIVE_LINUX_ARCHIVE_URL,
  notes,
  published: stampedAt.toISOString(),
  mandatory: process.env.OH_NATIVE_MANDATORY === "1",
  chunks: chunkKit.feedChunks(chunkRelease, process.env.OH_NATIVE_CHUNKS_BASE || nativeUpdate.NATIVE_CHUNKS_BASE),
};
if (!nativeUpdate.parseManifest(manifest, { platform: "linux" })) throw new Error("The Linux update feed could not be read back.");
if (nativeUpdate.parseManifest(manifest, { platform: "windows" }) || nativeUpdate.parseManifest(manifest, { platform: "macos" })) throw new Error("The Linux update feed must not be readable by Windows or macOS.");
const manifestFile = path.join(out, nativeUpdate.NATIVE_LINUX_MANIFEST_NAME);
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`update feed ${manifestFile} (build ${manifest.build}, sha256 ${manifest.sha256})`);

if (withProbe) {
  const probeProject = path.join(out, "probe-project");
  copy(project, probeProject, (file, isDir) => !(isDir && path.basename(file) === ".godot"));
  copy(path.join(here, "macos", "probe"), path.join(probeProject, "probes"));
  let probeSettings = fs.readFileSync(path.join(probeProject, "project.godot"), "utf8");
  probeSettings = probeSettings.replace(/^run\/main_scene=.*$/m, "run/main_scene=\"res://probes/empty.tscn\"\nrun/main_loop_type=\"OhProbe\"");
  fs.writeFileSync(path.join(probeProject, "project.godot"), probeSettings);
  run(godotEditor, ["--headless", "--path", probeProject, "--import"]);
  const probePack = path.join(out, "probe", `${exeName}.pck`);
  fs.mkdirSync(path.dirname(probePack), { recursive: true });
  run(godotEditor, ["--headless", "--path", probeProject, "--export-pack", "Linux", probePack]);
  console.log(`probe pack ${probePack} ${megabytes(fs.statSync(probePack).size)}`);
}

console.log(`app ${stage}`);
