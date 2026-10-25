import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, [path.join(here, "sidecar", "build.mjs")], here);

const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");
const cargo = [path.join(cargoHome, "bin", process.platform === "win32" ? "cargo.exe" : "cargo"), "cargo"].find((candidate) => candidate === "cargo" || fs.existsSync(candidate));
run(cargo, ["build", "-p", "oh_gdext", ...(release ? ["--release"] : [])], path.join(here, "engine"));

const library = { win32: "oh_gdext.dll", darwin: "liboh_gdext.dylib" }[process.platform] ?? "liboh_gdext.so";
const built = path.join(here, "engine", "target", profile, library);
const bin = path.join(here, "godot", "bin");
fs.mkdirSync(bin, { recursive: true });
fs.copyFileSync(built, path.join(bin, library));
console.log(`copied ${profile} ${library} into native/godot/bin`);
