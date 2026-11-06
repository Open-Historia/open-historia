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

if (godotExe) {
  const presets = path.join(godot, "export_presets.cfg");
  const original = fs.readFileSync(presets, "utf8");
  const builds = together ? [abis] : abis.map((abi) => [abi]);
  const made = [];
  try {
    fs.mkdirSync(outDir, { recursive: true });
    run(godotExe, ["--headless", "--path", godot, "--import"]);
    for (const group of builds) {
      let edited = original;
      for (const abi of Object.keys(ABIS)) edited = edited.replace(new RegExp(`^architectures/${abi}=.*$`, "m"), `architectures/${abi}=${group.includes(abi)}`);
      fs.writeFileSync(presets, edited);
      const apk = path.join(outDir, `open-historia-native-${group.join("+")}-${kind}.apk`);
      fs.rmSync(apk, { force: true });
      run(godotExe, ["--headless", "--path", godot, kind === "release" ? "--export-release" : "--export-debug", "Android", apk]);
      made.push(apk);
    }
  } finally {
    fs.writeFileSync(presets, original);
  }
  for (const apk of made) console.log(`apk ${apk} ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);
} else {
  console.log("Pass --godot <Godot 4.7.2 console exe> (with ANDROID_HOME and JAVA_HOME set) to export the APK.");
}
