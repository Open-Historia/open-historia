// Builds the programs the desktop app hears the player through with the
// system's own speech recognition (electron/speechSystem.cjs):
//
//   Windows  electron/speech/oh-speech-windows.exe from windows.cs, with the C#
//            compiler of the .NET Framework that every Windows 10 and 11 has,
//            against the Windows Runtime's metadata in System32\WinMetadata.
//   macOS    electron/speech/oh-speech-macos from macos.swift, with swiftc
//            (Xcode or its command line tools), for arm64 and x86_64 in one file,
//            its Info.plist (the reasons macOS shows) linked into the binary.
//
//   node scripts/build-speech-helpers.mjs [--win|--mac] [--required]
//
// scripts/package-desktop.mjs runs it before every Windows and macOS package.
// Without a compiler it says so and builds nothing, and the app then uses
// Whisper on the device, as it does on Linux; --required (set by the release
// workflows, through CI) makes that a failed build instead.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "electron", "speech");

export const HELPERS = Object.freeze({
  win32: "oh-speech-windows.exe",
  darwin: "oh-speech-macos",
});

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error) return { ok: false, output: String(result.error.message || result.error) };
  return { ok: result.status === 0, output };
};

// The program's version block, as SignPath Foundation requires of everything it
// signs (docs/code-signing.md): the product name is the project's, and the
// product version is the app's own (package.json's, which the release workflows
// stamp before building this), the same as the app and its installer carry.
// AssemblyVersion must be four numbers; the product version is the string.
export const speechAssemblyInfo = (version) => {
  const text = String(version || "0.0.0").trim();
  const numbers = (text.match(/^\d+(?:\.\d+){0,3}/)?.[0] ?? "0").split(".");
  while (numbers.length < 4) numbers.push("0");
  const quoted = JSON.stringify(text);
  return [
    "using System.Reflection;",
    '[assembly: AssemblyTitle("Open Historia speech recognition")]',
    '[assembly: AssemblyProduct("Open Historia")]',
    `[assembly: AssemblyInformationalVersion(${quoted})]`,
    `[assembly: AssemblyVersion("${numbers.join(".")}")]`,
    `[assembly: AssemblyFileVersion("${numbers.join(".")}")]`,
    "",
  ].join("\n");
};

const appVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const buildWindows = () => {
  const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const framework = ["Framework64", "Framework"]
    .map((bits) => path.join(windir, "Microsoft.NET", bits, "v4.0.30319"))
    .find((dir) => fs.existsSync(path.join(dir, "csc.exe")));
  const metadata = path.join(windir, "System32", "WinMetadata");
  if (!framework || !fs.existsSync(path.join(metadata, "Windows.Media.winmd"))) {
    return { ok: false, output: "No .NET Framework C# compiler or Windows Runtime metadata on this machine." };
  }
  const out = path.join(DIR, HELPERS.win32);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-speech-"));
  const info = path.join(work, "AssemblyInfo.cs");
  fs.writeFileSync(info, speechAssemblyInfo(appVersion()));
  try {
  return run(path.join(framework, "csc.exe"), [
    "/nologo",
    "/target:exe",
    "/optimize+",
    "/platform:anycpu",
    `/out:${out}`,
    // Not System.Runtime.WindowsRuntime.dll: it wants the SDK's Windows.winmd
    // (windows.cs waits for operations itself instead).
    `/r:${path.join(framework, "System.Runtime.dll")}`,
    `/r:${path.join(framework, "System.Runtime.InteropServices.WindowsRuntime.dll")}`,
    `/r:${path.join(metadata, "Windows.Foundation.winmd")}`,
    `/r:${path.join(metadata, "Windows.Media.winmd")}`,
    `/r:${path.join(metadata, "Windows.Globalization.winmd")}`,
    path.join(DIR, "windows.cs"),
    info,
  ]);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

const buildMac = () => {
  const out = path.join(DIR, HELPERS.darwin);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-speech-"));
  try {
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const slice = path.join(work, arch);
      const built = run("xcrun", [
        "swiftc", "-O", "-swift-version", "5",
        "-target", `${arch}-apple-macos11`,
        "-framework", "Speech", "-framework", "AVFoundation",
        // A command-line program has no bundle: macOS reads its usage
        // descriptions from this section, and ends a program that asks for
        // speech recognition without one.
        "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
        "-Xlinker", path.join(DIR, "macos-Info.plist"),
        "-o", slice,
        path.join(DIR, "macos.swift"),
      ]);
      if (!built.ok) return built;
      slices.push(slice);
    }
    const joined = run("lipo", ["-create", "-output", out, ...slices]);
    if (joined.ok) fs.chmodSync(out, 0o755);
    return joined;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

export const buildSpeechHelper = (platform) => {
  if (platform === "win32") return process.platform === "win32" ? buildWindows() : { ok: false, output: "The Windows helper is built on Windows." };
  if (platform === "darwin") return process.platform === "darwin" ? buildMac() : { ok: false, output: "The macOS helper is built on macOS." };
  return { ok: true, output: "No system recogniser on this platform: Whisper on the device." };
};

const main = () => {
  const args = process.argv.slice(2);
  const required = args.includes("--required");
  const platform = args.includes("--win") ? "win32" : args.includes("--mac") ? "darwin" : args.includes("--linux") ? "linux" : process.platform;
  const result = buildSpeechHelper(platform);
  if (result.ok) {
    if (HELPERS[platform]) console.log(`[speech-helpers] built electron/speech/${HELPERS[platform]}`);
    else console.log(`[speech-helpers] ${result.output}`);
    return;
  }
  const message = `[speech-helpers] the system speech helper was not built; the app will use Whisper on the device.\n${result.output}`;
  if (required) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
};

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) main();
