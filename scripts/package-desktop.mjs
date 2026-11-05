// electron-builder packs every non-dev package, so it runs against a package.json naming only these.
//   node scripts/package-desktop.mjs --win --config electron-builder.beta.yml --publish never
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { HELPERS, buildSpeechHelper } from "./build-speech-helpers.mjs";

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// What server/ and electron/ import as they run: server/desktopPackaging.test.js keeps this list true.
export const RUNTIME_DEPENDENCIES = ["electron-updater", "express", "jszip", "pmtiles"];

export const packagedManifest = (manifest) => {
  const { dependencies = {}, devDependencies = {}, optionalDependencies = {}, ...rest } = manifest;
  const moved = { ...devDependencies, ...optionalDependencies, ...dependencies };
  const kept = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    if (!dependencies[name]) throw new Error(`${name} runs in the desktop app but is not in dependencies.`);
    kept[name] = dependencies[name];
    delete moved[name];
  }
  return { ...rest, dependencies: kept, devDependencies: moved };
};

// The system speech program the target needs (scripts/build-speech-helpers.mjs),
// unless one at least as new as its source is there already (the release
// workflows build it in a step of their own). Without one the app uses Whisper.
const ensureSpeechHelper = (args) => {
  const platform = args.includes("--win") ? "win32" : args.includes("--mac") ? "darwin" : null;
  if (!platform) return;
  const binary = path.join(ROOT, "electron", "speech", HELPERS[platform]);
  const source = path.join(ROOT, "electron", "speech", platform === "win32" ? "windows.cs" : "macos.swift");
  try {
    if (fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs) return;
  } catch { /* not built yet */ }
  const result = buildSpeechHelper(platform);
  if (result.ok) {
    console.log(`[package-desktop] built electron/speech/${HELPERS[platform]}`);
    return;
  }
  const message = `[package-desktop] no system speech program for this build; it will use Whisper on the device.\n${result.output}`;
  if (process.env.CI) throw new Error(message);
  console.warn(message);
};

const main = () => {
  ensureSpeechHelper(process.argv.slice(2));
  const file = path.join(ROOT, "package.json");
  const original = fs.readFileSync(file, "utf8");
  // Ctrl+C reaches electron-builder as well: this stays alive to put package.json back.
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {});
  let status = 1;
  try {
    fs.writeFileSync(file, `${JSON.stringify(packagedManifest(JSON.parse(original)), null, 2)}\n`);
    const cli = path.join(ROOT, "node_modules", "electron-builder", "cli.js");
    const run = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit" });
    status = run.status ?? 1;
  } finally {
    fs.writeFileSync(file, original);
  }
  process.exit(status);
};

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) main();
