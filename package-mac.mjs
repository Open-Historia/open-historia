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
const out = path.resolve(positional[0] || path.join(here, "out-mac"));
const skipBuild = cli.includes("--no-build");
const withProbe = cli.includes("--probe");
const appName = "Open Historia Native";
const exeName = "Open Historia";
const nativeUpdate = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "update.mjs")).href);
const chunkKit = await import(pathToFileURL(path.join(here, "sidecar", "updateChunks.mjs")).href);
const imageCodec = await import(pathToFileURL(path.join(here, "sidecar", "handlers", "imagecodec.mjs")).href);
const notes = String(process.env.OH_NATIVE_NOTES || "A new super-experimental build of Open Historia Native.");

if (process.platform !== "darwin") throw new Error("The macOS app is built on macOS.");
const godotEditor = process.env.OH_GODOT_EDITOR || "";
const template = process.env.OH_GODOT_TEMPLATE || "";
const library = path.resolve(process.env.OH_GDEXT_DYLIB || path.join(here, "engine", "target", "universal-apple-darwin", "release", "liboh_gdext.dylib"));
const nodeBinary = path.resolve(process.env.OH_NODE_BIN || process.execPath);
if (!fs.existsSync(godotEditor)) throw new Error("Set OH_GODOT_EDITOR to the Godot 4.7.2 editor binary (Godot.app/Contents/MacOS/Godot).");
if (!fs.existsSync(template)) throw new Error("Set OH_GODOT_TEMPLATE to Godot 4.7.2's macos.zip export template.");
if (!fs.existsSync(library)) throw new Error(`The universal library ${library} is missing: build both targets and join them with lipo.`);

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
console.log(`stamping ${appName} for macOS ${stamp.version} build ${stamp.build} (${stamp.commit || "no commit"})`);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})`);
};
const capture = (command, args) => spawnSync(command, args, { encoding: "utf8" });

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

const MACHO = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);
const isMachO = (file) => {
  const handle = fs.openSync(file, "r");
  try {
    const headBytes = Buffer.alloc(4);
    return fs.readSync(handle, headBytes, 0, 4, 0) === 4 && MACHO.has(headBytes.toString("hex"));
  } finally {
    fs.closeSync(handle);
  }
};
const walk = (root, found = []) => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
};

if (skipBuild) {
  if (!fs.existsSync(path.join(here, "sidecar", "dist"))) throw new Error("--no-build needs an existing native/sidecar/dist.");
  console.log("--no-build: using the existing sidecar build");
} else {
  run(process.execPath, [path.join(here, "sidecar", "build.mjs")]);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const godotSource = path.join(here, "godot");
const project = path.join(out, "project");
copy(godotSource, project, (file, isDir) => {
  const relative = path.relative(godotSource, file).split(path.sep).join("/");
  if (isDir) return ![".godot", "tests", "bin"].includes(relative);
  return true;
});
copy(library, path.join(project, "bin", "liboh_gdext.dylib"));

const iconset = path.join(out, "icon.iconset");
fs.mkdirSync(iconset, { recursive: true });
const iconSource = path.join(repo, "public", "icon-512.png");
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
    run("/usr/bin/sips", ["-z", String(pixels), String(pixels), iconSource, "--out", path.join(iconset, name)], { stdio: "ignore" });
  }
}
run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(project, "mac_icon.icns")]);

const projectFile = path.join(project, "project.godot");
let projectText = fs.readFileSync(projectFile, "utf8");
if (!/import_etc2_astc/.test(projectText)) {
  projectText = /^\[rendering\]$/m.test(projectText)
    ? projectText.replace(/^\[rendering\]$/m, "[rendering]\n\ntextures/vram_compression/import_etc2_astc=true")
    : `${projectText}\n[rendering]\n\ntextures/vram_compression/import_etc2_astc=true\n`;
}
fs.writeFileSync(projectFile, projectText);

const presetsFile = path.join(project, "export_presets.cfg");
const presetsText = fs.readFileSync(presetsFile, "utf8");
const macAt = presetsText.indexOf("platform=\"macOS\"");
if (macAt < 0) throw new Error("export_presets.cfg has no macOS preset.");
const setOption = (text, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key.replace(/[/.]/g, "\\$&")}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : text.replace(/\[preset\.\d+\.options\]\n/, (match) => `${match}${line}\n`);
};
let macPart = presetsText.slice(macAt);
macPart = setOption(macPart, "custom_template/release", JSON.stringify(template));
macPart = setOption(macPart, "custom_template/debug", JSON.stringify(template));
macPart = setOption(macPart, "application/icon", JSON.stringify("res://mac_icon.icns"));
macPart = setOption(macPart, "application/short_version", JSON.stringify(stamp.version));
macPart = setOption(macPart, "application/version", JSON.stringify(stamp.build));
macPart = setOption(macPart, "codesign/codesign", "0");
fs.writeFileSync(presetsFile, presetsText.slice(0, macAt) + macPart);

run(godotEditor, ["--headless", "--path", project, "--import"]);
const app = path.join(out, `${appName}.app`);
run(godotEditor, ["--headless", "--path", project, "--export-release", "macOS", app]);
const contents = path.join(app, "Contents");
const exe = path.join(contents, "MacOS", exeName);
const exportedPack = path.join(contents, "Resources", `${exeName}.pck`);
const exportedLibrary = path.join(contents, "Frameworks", "liboh_gdext.dylib");
for (const file of [exe, exportedPack, exportedLibrary]) if (!fs.existsSync(file)) throw new Error(`The macOS export did not write ${path.relative(out, file)}.`);

const stage = path.join(contents, "Resources", "app");
fs.mkdirSync(path.join(stage, "runtime"), { recursive: true });
fs.renameSync(exportedPack, path.join(stage, "runtime", `${exeName}.pck`));
fs.symlinkSync(`app/runtime/${exeName}.pck`, exportedPack);
fs.renameSync(exportedLibrary, path.join(stage, "runtime", "liboh_gdext.dylib"));
fs.symlinkSync("../Resources/app/runtime/liboh_gdext.dylib", exportedLibrary);
fs.copyFileSync(nodeBinary, path.join(stage, "runtime", "node"));
fs.chmodSync(path.join(stage, "runtime", "node"), 0o755);
fs.mkdirSync(path.join(stage, "native", "godot"), { recursive: true });
fs.writeFileSync(path.join(stage, "native", "godot", "version.json"), `${JSON.stringify(stamp, null, 2)}\n`);

const sidecar = path.join(here, "sidecar");
const sidecarTools = new Set(["build.mjs", "smoke.mjs", "engine.js"]);
for (const name of fs.readdirSync(sidecar).filter((entry) => /\.(?:mjs|cjs|js)$/.test(entry) && !sidecarTools.has(entry))) copy(path.join(sidecar, name), path.join(stage, "native", "sidecar", name));
copy(path.join(sidecar, "dist"), path.join(stage, "native", "sidecar", "dist"), (file, isDir) => isDir || !file.endsWith(".map"));
copy(path.join(sidecar, "handlers"), path.join(stage, "native", "sidecar", "handlers"), (file, isDir) => isDir || file.endsWith(".mjs") || file.endsWith(".cjs"));
if (fs.existsSync(path.join(sidecar, "node_modules"))) copy(path.join(sidecar, "node_modules"), path.join(stage, "native", "sidecar", "node_modules"));
for (const arch of ["arm64", "x64"]) {
  const prebuild = path.join(stage, "native", "sidecar", "node_modules", "@node-datachannel", `darwin-${arch}`, "node_datachannel.node");
  if (fs.existsSync(path.join(sidecar, "node_modules", "node-datachannel")) && !fs.existsSync(prebuild)) throw new Error(`The darwin-${arch} node-datachannel prebuild is missing from native/sidecar/node_modules.`);
}

const codecDir = path.join(stage, "native", "sidecar", "imagecodec");
fs.mkdirSync(codecDir, { recursive: true });
const slices = [];
for (const arch of ["arm64", "x86_64"]) {
  const slice = path.join(out, `oh-imagecodec-${arch}`);
  run("/usr/bin/xcrun", imageCodec.imageCodecSwiftArgs(slice, arch));
  slices.push(slice);
}
run("/usr/bin/lipo", ["-create", ...slices, "-output", path.join(codecDir, imageCodec.IMAGE_CODEC_MAC)]);
fs.chmodSync(path.join(codecDir, imageCodec.IMAGE_CODEC_MAC), 0o755);

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

const fmgDist = path.join(repo, "fmg", "dist");
if (fs.existsSync(fmgDist)) {
  copy(fmgDist, path.join(stage, "fmg", "dist"));
  if (fs.existsSync(path.join(repo, "fmg", ".version"))) copy(path.join(repo, "fmg", ".version"), path.join(stage, "fmg", ".version"));
} else {
  console.log("fmg/dist is not here, so the map generator is left out of this build");
}

const publicDir = path.join(repo, "public");
copy(path.join(repo, "scripts", "map-assets.json"), path.join(stage, "scripts", "map-assets.json"));
for (const name of ["logo.png", "icon-192.png", "icon-512.png", "scenario-placeholder.webp", "flags", "lang", "fonts", "offline-relief", "audio", "assets"]) {
  if (fs.existsSync(path.join(publicDir, name))) copy(path.join(publicDir, name), path.join(stage, "public", name));
}
for (const name of fs.readdirSync(publicDir).filter((entry) => entry.startsWith("loading_screen"))) copy(path.join(publicDir, name), path.join(stage, "public", name));
fs.writeFileSync(path.join(stage, nativeUpdate.INSTALL_MARKER), `${stampedAt.toISOString()}\n`);

const plist = path.join(contents, "Info.plist");
for (const [key, value] of [["CFBundleName", appName], ["CFBundleDisplayName", appName], ["CFBundleShortVersionString", stamp.version], ["CFBundleVersion", stamp.build]]) {
  const set = capture("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  if (set.status !== 0) run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist]);
}

const signed = [];
for (const file of walk(stage)) {
  if (!isMachO(file)) continue;
  if (capture("/usr/bin/codesign", ["--verify", file]).status === 0) continue;
  run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
  signed.push(path.relative(stage, file));
}
console.log(`ad-hoc signed ${signed.length} unsigned binaries in the app folder${signed.length ? `: ${signed.join(", ")}` : ""}`);
for (const file of walk(path.join(contents, "Frameworks"))) {
  if (fs.lstatSync(file).isSymbolicLink() || !isMachO(file)) continue;
  run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
}

const smoke = await new Promise((resolve) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-native-package-"));
  const child = spawn(path.join(stage, "runtime", "node"), [path.join(stage, "native", "sidecar", "main.mjs")], { cwd: stage, env: { ...process.env, OH_NATIVE_ROOT: root, OH_STANDIN_MODEL: "1" }, stdio: ["pipe", "pipe", "pipe"] });
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
if (smoke.failed.length) throw new Error("Every handler must load in the macOS package.");

const chunkOut = path.join(out, "chunks");
const chunkRelease = chunkKit.writeRelease({ stage, out: chunkOut, details: { build: stamp.build, version: stamp.version, commit: stamp.commit, platform: "macos" } });
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
console.log(`chunks: ${chunkRelease.manifest.files.length} files, ${megabytes(chunkRelease.manifest.bytes)}, in ${chunkRelease.chunkCount} chunks (${megabytes(chunkRelease.assetBytes)} as published); file list ${chunkRelease.manifestName} ${megabytes(chunkRelease.manifestSize)}`);

run("/usr/bin/codesign", ["--force", "--sign", "-", app]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
const assessment = capture("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
console.log(`spctl (an unnotarized ad-hoc app is expected to be rejected): ${String(assessment.stderr || assessment.stdout).trim()}`);

const zip = path.join(out, nativeUpdate.NATIVE_MAC_ZIP_NAME);
run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
console.log(`${path.basename(zip)} ${megabytes(fs.statSync(zip).size)}`);

if (!cli.includes("--no-dmg")) {
  const dmgRoot = path.join(out, "dmg-root");
  fs.mkdirSync(dmgRoot, { recursive: true });
  run("/usr/bin/ditto", [app, path.join(dmgRoot, `${appName}.app`)]);
  fs.symlinkSync("/Applications", path.join(dmgRoot, "Applications"));
  const dmg = path.join(out, "Open-Historia-Native-macOS.dmg");
  run("/usr/bin/hdiutil", ["create", "-volname", appName, "-srcfolder", dmgRoot, "-ov", "-format", "UDZO", "-fs", "HFS+", dmg]);
  fs.rmSync(dmgRoot, { recursive: true, force: true });
  console.log(`${path.basename(dmg)} ${megabytes(fs.statSync(dmg).size)}`);
}

const manifest = {
  ...stamp,
  platform: "macos",
  sha256: await nativeUpdate.sha256File(zip),
  size: fs.statSync(zip).size,
  url: nativeUpdate.NATIVE_MAC_ZIP_URL,
  notes,
  published: stampedAt.toISOString(),
  mandatory: process.env.OH_NATIVE_MANDATORY === "1",
  chunks: chunkKit.feedChunks(chunkRelease, process.env.OH_NATIVE_CHUNKS_BASE || nativeUpdate.NATIVE_CHUNKS_BASE),
};
if (!nativeUpdate.parseManifest(manifest)) throw new Error("The macOS update feed could not be read back.");
const manifestFile = path.join(out, nativeUpdate.NATIVE_MAC_MANIFEST_NAME);
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
  run(godotEditor, ["--headless", "--path", probeProject, "--export-pack", "macOS", probePack]);
  console.log(`probe pack ${probePack} ${megabytes(fs.statSync(probePack).size)}`);
}

console.log(`app ${app}`);
