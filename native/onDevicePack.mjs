import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const speechSources = path.join(repo, "electron", "speech");

export const SPEECH_HELPERS = Object.freeze({ win32: "oh-speech-windows.exe", darwin: "oh-speech-macos" });

const WEB_KEEP = new Set(["ort.node.min.js", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]);
const TRANSFORMERS_KEEP = new Set(["transformers.node.mjs", "transformers.node.cjs"]);

const remove = (target) => fs.rmSync(target, { recursive: true, force: true });

const sizeOf = (target) => {
  let total = 0;
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  for (const entry of fs.readdirSync(target)) total += sizeOf(path.join(target, entry));
  return total;
};

export const pruneOnDeviceRuntime = (modules, { platform, arches }) => {
  if (!fs.existsSync(path.join(modules, "@huggingface", "transformers"))) return { bytes: 0 };
  for (const name of ["sharp", "@img", "@types", "undici-types"]) remove(path.join(modules, name));
  const bin = path.join(modules, "onnxruntime-node", "bin", "napi-v6");
  for (const os of fs.existsSync(bin) ? fs.readdirSync(bin) : []) {
    if (os !== platform) {
      remove(path.join(bin, os));
      continue;
    }
    for (const arch of fs.readdirSync(path.join(bin, os))) {
      if (!arches.includes(arch)) {
        remove(path.join(bin, os, arch));
        continue;
      }
      for (const file of fs.readdirSync(path.join(bin, os, arch))) {
        if (file.startsWith("libonnxruntime_providers_")) remove(path.join(bin, os, arch, file));
      }
    }
  }
  const nativeFor = (arch) => fs.existsSync(path.join(bin, platform, arch, "onnxruntime_binding.node"));
  const web = path.join(modules, "onnxruntime-web");
  if (arches.every(nativeFor)) remove(web);
  else if (fs.existsSync(web)) {
    for (const entry of fs.readdirSync(web)) {
      if (entry !== "dist" && entry !== "package.json") remove(path.join(web, entry));
    }
    for (const entry of fs.readdirSync(path.join(web, "dist"))) {
      if (!WEB_KEEP.has(entry)) remove(path.join(web, "dist", entry));
    }
  }
  const dist = path.join(modules, "@huggingface", "transformers", "dist");
  for (const entry of fs.readdirSync(dist)) {
    if (!TRANSFORMERS_KEEP.has(entry)) remove(path.join(dist, entry));
  }
  remove(path.join(modules, "@huggingface", "transformers", "types"));
  remove(path.join(modules, "@huggingface", "transformers", "src"));
  const missing = arches.filter((arch) => !nativeFor(arch) && !fs.existsSync(path.join(web, "dist", "ort-wasm-simd-threaded.wasm")));
  if (missing.length) throw new Error(`No ONNX runtime for ${platform} ${missing.join(", ")} in the sidecar packages.`);
  const bytes = ["@huggingface", "onnxruntime-node", "onnxruntime-web", "onnxruntime-common", "protobufjs", "@protobufjs", "flatbuffers", "long", "guid-typescript", "platform", "adm-zip", "global-agent"]
    .reduce((sum, name) => sum + sizeOf(path.join(modules, name)), 0);
  return { bytes, native: arches.filter(nativeFor), wasm: arches.filter((arch) => !nativeFor(arch)) };
};

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error) return { ok: false, output: String(result.error.message || result.error) };
  return { ok: result.status === 0, output };
};

const buildWindowsHelper = (out) => {
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const framework = ["Framework64", "Framework"]
    .map((bits) => path.join(windir, "Microsoft.NET", bits, "v4.0.30319"))
    .find((dir) => fs.existsSync(path.join(dir, "csc.exe")));
  const metadata = path.join(windir, "System32", "WinMetadata");
  if (!framework || !fs.existsSync(path.join(metadata, "Windows.Media.winmd"))) return { ok: false, output: "No .NET Framework C# compiler or Windows Runtime metadata on this machine." };
  return run(path.join(framework, "csc.exe"), [
    "/nologo",
    "/target:exe",
    "/optimize+",
    "/platform:anycpu",
    `/out:${out}`,
    `/r:${path.join(framework, "System.Runtime.dll")}`,
    `/r:${path.join(framework, "System.Runtime.InteropServices.WindowsRuntime.dll")}`,
    `/r:${path.join(metadata, "Windows.Foundation.winmd")}`,
    `/r:${path.join(metadata, "Windows.Media.winmd")}`,
    `/r:${path.join(metadata, "Windows.Globalization.winmd")}`,
    path.join(speechSources, "windows.cs"),
  ]);
};

const buildMacHelper = (out) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-speech-"));
  try {
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const slice = path.join(work, arch);
      const built = run("xcrun", [
        "swiftc", "-O", "-swift-version", "5",
        "-target", `${arch}-apple-macos11`,
        "-framework", "Speech", "-framework", "AVFoundation",
        "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
        "-Xlinker", path.join(speechSources, "macos-Info.plist"),
        "-o", slice,
        path.join(speechSources, "macos.swift"),
      ]);
      if (!built.ok) return built;
      slices.push(slice);
    }
    const joined = run("lipo", ["-create", "-output", out, ...slices]);
    if (joined.ok) fs.chmodSync(out, 0o755);
    return joined;
  } finally {
    remove(work);
  }
};

export const buildSpeechHelper = (platform, sidecarDir, { required = Boolean(process.env.CI) } = {}) => {
  const name = SPEECH_HELPERS[platform];
  if (!name) return { ok: true, file: "", bytes: 0 };
  const out = path.join(sidecarDir, "speech", name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = platform === "win32" ? buildWindowsHelper(out) : buildMacHelper(out);
  if (!result.ok || !fs.existsSync(out)) {
    const message = `the system speech program was not built; the Advisor's microphone will use Whisper on the device.\n${result.output}`;
    if (required) throw new Error(message);
    console.warn(message);
    return { ok: false, file: "", bytes: 0 };
  }
  return { ok: true, file: out, bytes: fs.statSync(out).size };
};
