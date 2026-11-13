import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const native = path.resolve(here, "..");
const engine = path.join(native, "engine");
const godot = path.join(native, "godot");
const cli = process.argv.slice(2);
const flag = (name) => cli.includes(`--${name}`);
const option = (name, fallback = "") => {
  const at = cli.indexOf(`--${name}`);
  return at >= 0 && cli[at + 1] ? cli[at + 1] : fallback;
};

const ABIS = { "arm64-v8a": "aarch64-linux-android", x86_64: "x86_64-linux-android" };
const abis = option("abi", "arm64-v8a,x86_64").split(",").map((abi) => abi.trim()).filter(Boolean);
for (const abi of abis) if (!ABIS[abi]) throw new Error(`Unknown ABI ${abi}; use ${Object.keys(ABIS).join(", ")}.`);
const nodeDir = path.resolve(option("node", path.join(here, "node", "out")));
const godotExe = option("godot", process.env.OH_GODOT_EXE || "");
const outDir = path.resolve(option("out", path.join(here, "out")));
const kind = flag("release") ? "release" : "debug";
const together = flag("one-apk");

const run = (command, args, options = {}) => {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
};

const cargoHome = process.env.CARGO_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".cargo");
const cargo = [path.join(cargoHome, "bin", process.platform === "win32" ? "cargo.exe" : "cargo"), "cargo"].find((candidate) => candidate === "cargo" || fs.existsSync(candidate));

if (!flag("no-rust")) {
  const targets = abis.flatMap((abi) => ["-t", abi]);
  run(cargo, ["ndk", ...targets, "-P", "24", "build", "-p", "oh_gdext", "-p", "ohfronts", "--release"], { cwd: engine });
}

for (const abi of abis) {
  const release = path.join(engine, "target", ABIS[abi], "release");
  const bin = path.join(godot, "bin", "android", abi);
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(path.join(release, "liboh_gdext.so"), path.join(bin, "liboh_gdext.so"));
  fs.copyFileSync(path.join(release, "ohfronts-host"), path.join(bin, "libohfronts.so"));
  const node = [path.join(nodeDir, abi, "node.stripped"), path.join(nodeDir, abi === "arm64-v8a" ? "arm64" : abi, "node.stripped")].find((file) => fs.existsSync(file));
  if (!node) throw new Error(`No Node build for ${abi} in ${nodeDir} (expected ${abi}/node.stripped from native/android/node/build.sh).`);
  fs.copyFileSync(node, path.join(bin, "libohnode.so"));
  for (const name of fs.readdirSync(bin)) console.log(`${abi}/${name} ${(fs.statSync(path.join(bin, name)).size / 1048576).toFixed(1)} MB`);
}

if (!flag("no-stage")) run(process.execPath, [path.join(here, "stage.mjs"), ...(flag("lean") ? ["--lean"] : []), ...(flag("no-build") ? ["--no-build"] : [])]);

const templatesDir = () => {
  const given = option("templates", process.env.OH_GODOT_TEMPLATES || "");
  if (given) return path.resolve(given);
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const base = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Godot")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Godot")
      : path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "godot");
  return path.join(base, "export_templates", "4.7.2.stable");
};

const unzipInto = (zip, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-x", "-f", zip, "-C", dir]);
  else run("unzip", ["-q", "-o", zip, "-d", dir]);
};

const installBuildTemplate = () => {
  const templates = templatesDir();
  const source = path.join(templates, "android_source.zip");
  if (!fs.existsSync(source)) throw new Error(`No Android build template at ${source}: install Godot 4.7.2's export templates (or pass --templates <dir>).`);
  const version = fs.readFileSync(path.join(templates, "version.txt"), "utf8").trim();
  const androidDir = path.join(godot, "android");
  const stampFile = path.join(androidDir, ".build_version");
  const buildDir = path.join(androidDir, "build");
  if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8").trim() === version && fs.existsSync(path.join(buildDir, "build.gradle"))) return buildDir;
  fs.rmSync(buildDir, { recursive: true, force: true });
  unzipInto(source, buildDir);
  fs.writeFileSync(path.join(buildDir, ".gdignore"), "");
  fs.writeFileSync(stampFile, `${version}\n`);
  if (process.platform !== "win32") fs.chmodSync(path.join(buildDir, "gradlew"), 0o755);
  console.log(`android build template ${version} installed`);
  return buildDir;
};

const javaTool = (name) => {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const home = process.env.JAVA_HOME || "";
  const candidate = home ? path.join(home, "bin", exe) : "";
  return candidate && fs.existsSync(candidate) ? candidate : name;
};

const androidJar = () => {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : "");
  const platforms = path.join(sdk, "platforms");
  const found = fs.existsSync(platforms) ? fs.readdirSync(platforms).filter((name) => /^android-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const name of found) {
    const jar = path.join(platforms, name, "android.jar");
    if (fs.existsSync(jar)) return jar;
  }
  throw new Error(`No Android platform (android.jar) under ${platforms}.`);
};

const buildPlugin = (buildDir) => {
  const pluginDir = path.join(here, "plugin");
  const work = path.join(outDir, "plugin-work");
  fs.rmSync(work, { recursive: true, force: true });
  for (const part of ["classes", "godot", "aar"]) fs.mkdirSync(path.join(work, part), { recursive: true });
  run(javaTool("jar"), ["xf", path.join(buildDir, "libs", "release", "godot-lib.template_release.aar"), "classes.jar"], { cwd: path.join(work, "godot") });
  const sources = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith(".java")) sources.push(full);
    }
  };
  collect(path.join(pluginDir, "src"));
  run(javaTool("javac"), ["--release", "17", "-nowarn", "-encoding", "UTF-8", "-cp", [androidJar(), path.join(work, "godot", "classes.jar")].join(path.delimiter), "-d", path.join(work, "classes"), ...sources]);
  run(javaTool("jar"), ["cfM", path.join(work, "aar", "classes.jar"), "-C", path.join(work, "classes"), "."]);
  fs.copyFileSync(path.join(pluginDir, "AndroidManifest.xml"), path.join(work, "aar", "AndroidManifest.xml"));
  fs.writeFileSync(path.join(work, "aar", "R.txt"), "");
  const aar = path.join(outDir, "plugin", "oh-android.aar");
  fs.mkdirSync(path.dirname(aar), { recursive: true });
  fs.rmSync(aar, { force: true });
  run(javaTool("jar"), ["cfM", aar, "-C", path.join(work, "aar"), "."]);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`plugin ${aar} ${(fs.statSync(aar).size / 1024).toFixed(1)} KB`);
};

const storePayloadUncompressed = (buildDir) => {
  const gradle = path.join(buildDir, "build.gradle");
  const source = fs.readFileSync(gradle, "utf8");
  if (source.includes('noCompress "zip"')) return;
  const anchor = /(aaptOptions \{\s*\n)(\s*)(ignoreAssetsPattern [^\n]*\n)/;
  if (!anchor.test(source)) throw new Error(`The Android build template's aaptOptions block was not found in ${gradle}.`);
  fs.writeFileSync(gradle, source.replace(anchor, (_, open, indent, line) => `${open}${indent}${line}${indent}noCompress "zip"\n`));
};

if (godotExe || flag("plugin")) {
  fs.mkdirSync(outDir, { recursive: true });
  const buildDir = installBuildTemplate();
  storePayloadUncompressed(buildDir);
  buildPlugin(buildDir);
}

const releaseSigning = () => {
  const keystore = process.env.OH_ANDROID_KEYSTORE || process.env.GODOT_ANDROID_KEYSTORE_RELEASE_PATH || "";
  const alias = process.env.ANDROID_KEY_ALIAS || process.env.GODOT_ANDROID_KEYSTORE_RELEASE_USER || "";
  const password = process.env.ANDROID_KEYSTORE_PASSWORD || process.env.GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD || "";
  const missing = [["OH_ANDROID_KEYSTORE", keystore], ["ANDROID_KEY_ALIAS", alias], ["ANDROID_KEYSTORE_PASSWORD", password]].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`A release build needs ${missing.join(", ")} in the environment.`);
  if (!fs.existsSync(keystore)) throw new Error(`The release keystore ${keystore} does not exist.`);
  return { GODOT_ANDROID_KEYSTORE_RELEASE_PATH: path.resolve(keystore), GODOT_ANDROID_KEYSTORE_RELEASE_USER: alias, GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD: password };
};

const versionCode = () => {
  const raw = String(process.env.OH_ANDROID_BUILD ?? "").trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 2100000000) throw new Error("OH_ANDROID_BUILD must be a whole number from 1 to 2100000000.");
  return Number(raw);
};

if (godotExe) {
  const signing = kind === "release" ? releaseSigning() : {};
  const code = kind === "release" ? versionCode() : 0;
  const presets = path.join(godot, "export_presets.cfg");
  const original = fs.readFileSync(presets, "utf8");
  const builds = together ? [abis] : abis.map((abi) => [abi]);
  const made = [];
  try {
    run(godotExe, ["--headless", "--path", godot, "--import"]);
    for (const group of builds) {
      let edited = original;
      for (const abi of Object.keys(ABIS)) edited = edited.replace(new RegExp(`^architectures/${abi}=[^\r\n]*`, "m"), `architectures/${abi}=${group.includes(abi)}`);
      if (code) edited = edited.replace(/^version\/code=[^\r\n]*/m, `version/code=${code}`);
      fs.writeFileSync(presets, edited);
      const apk = path.join(outDir, `open-historia-native-${group.join("+")}-${kind}.apk`);
      fs.rmSync(apk, { force: true });
      run(godotExe, ["--headless", "--path", godot, kind === "release" ? "--export-release" : "--export-debug", "Android", apk], { env: { ...process.env, ...signing, GRADLE_OPTS: [process.env.GRADLE_OPTS, "-Dorg.gradle.daemon=false"].filter(Boolean).join(" ") } });
      made.push(apk);
    }
  } finally {
    fs.writeFileSync(presets, original);
  }
  for (const apk of made) console.log(`apk ${apk} ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);
} else {
  console.log("Pass --godot <Godot 4.7.2 console exe> (with ANDROID_HOME and JAVA_HOME set) to export the APK.");
}
