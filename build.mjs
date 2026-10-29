import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cargoCommand, webviewLoader, windowsBuildEnv } from "./webview2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";

const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, [path.join(here, "sidecar", "build.mjs")], here);

const packages = process.platform === "linux" ? ["-p", "oh_gdext", "-p", "ohweb"] : ["-p", "oh_gdext"];
const env = process.platform === "win32" ? windowsBuildEnv() : process.env;
run(cargoCommand(), ["build", ...packages, ...(release ? ["--release"] : [])], path.join(here, "engine"), env);

const library = { win32: "oh_gdext.dll", darwin: "liboh_gdext.dylib" }[process.platform] ?? "liboh_gdext.so";
const built = path.join(here, "engine", "target", profile, library);
const bin = path.join(here, "godot", "bin");
fs.mkdirSync(bin, { recursive: true });
fs.copyFileSync(built, path.join(bin, library));
console.log(`copied ${profile} ${library} into native/godot/bin`);
if (process.platform === "linux") {
  fs.copyFileSync(path.join(here, "engine", "target", profile, "libohweb.so"), path.join(bin, "libohweb.so"));
  console.log(`copied ${profile} libohweb.so into native/godot/bin`);
}
if (process.platform === "win32") {
  fs.copyFileSync(webviewLoader(), path.join(bin, "WebView2Loader.dll"));
  console.log("copied WebView2Loader.dll into native/godot/bin");
}
