import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = path.join(here, "engine");

export const cargoHome = () => process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");

export const cargoCommand = () => [path.join(cargoHome(), "bin", process.platform === "win32" ? "cargo.exe" : "cargo"), "cargo"].find((candidate) => candidate === "cargo" || fs.existsSync(candidate));

export const webviewLoader = () => {
  const lock = fs.readFileSync(path.join(engine, "Cargo.lock"), "utf8");
  const version = /name = "webview2-com-sys"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (!version) throw new Error("Cargo.lock has no webview2-com-sys; build the engine library first.");
  const registry = path.join(cargoHome(), "registry", "src");
  for (const index of fs.existsSync(registry) ? fs.readdirSync(registry) : []) {
    const file = path.join(registry, index, `webview2-com-sys-${version}`, "x64", "WebView2Loader.dll");
    if (fs.existsSync(file)) return file;
  }
  throw new Error(`WebView2Loader.dll from webview2-com-sys ${version} is not in ${registry}; run cargo fetch in native/engine.`);
};

export const windowsBuildEnv = (env = process.env) => {
  const cargo = cargoCommand();
  const rustc = cargo === "cargo" ? "rustc" : path.join(path.dirname(cargo), "rustc.exe");
  const sysroot = String(spawnSync(rustc, ["--print", "sysroot"], { cwd: engine, encoding: "utf8" }).stdout || "").trim();
  const archiver = path.join(sysroot, "lib", "rustlib", "x86_64-pc-windows-gnu", "bin", "llvm-ar.exe");
  if (!fs.existsSync(archiver)) throw new Error("The web view's Windows libraries need LLVM's import-library tool: run rustup component add llvm-tools in native/engine.");
  const dlltool = path.join(engine, "target", "llvm-dlltool", "dlltool.exe");
  fs.mkdirSync(path.dirname(dlltool), { recursive: true });
  if (!fs.existsSync(dlltool) || fs.statSync(dlltool).size !== fs.statSync(archiver).size) fs.copyFileSync(archiver, dlltool);
  const flags = ["-Clinker-flavor=ld.lld", "-Clink-self-contained=yes", `-Cdlltool=${dlltool}`];
  const out = { ...env, CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER: "rust-lld", CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") };
  delete out.RUSTFLAGS;
  delete out.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS;
  return out;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = windowsBuildEnv();
  const args = process.argv.slice(2);
  const result = spawnSync(cargoCommand(), args.length ? args : ["build", "-p", "oh_gdext", "--release"], { cwd: engine, stdio: "inherit", env });
  process.exit(result.status ?? 1);
}
