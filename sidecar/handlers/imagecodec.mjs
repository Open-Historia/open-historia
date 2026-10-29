import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const codecDir = path.resolve(here, "..", "imagecodec");
export const IMAGE_CODEC_SOURCES = ["ImageCodec.cs", "Sequence.cs"].map((name) => path.join(codecDir, name));
export const IMAGE_CODEC_EXE = "oh-imagecodec.exe";
export const IMAGE_CODEC_MAC = "oh-imagecodec";
export const IMAGE_CODEC_SWIFT = path.join(codecDir, "ImageCodec.swift");
const SHIPPED = path.join(codecDir, process.platform === "darwin" ? IMAGE_CODEC_MAC : IMAGE_CODEC_EXE);
const REQUEST_MS = 60_000;
const IDLE_MS = 5 * 60_000;
const NO_WINDOWS = "AVIF images are read with Windows imaging, which this system does not have.";
const NO_CODEC = "Windows cannot open AVIF images on this computer. Install the AV1 Video Extension from the Microsoft Store.";
const NO_MAC_READER = "The app's AVIF reader is missing from this copy of the game.";
const NO_MAC_CODEC = "This version of macOS cannot open AVIF images. macOS 13 Ventura or later can.";

export const imageCodecSwiftArgs = (target, arch) => ["swiftc", "-O", "-target", arch === "arm64" ? "arm64-apple-macos11.0" : "x86_64-apple-macos10.15", IMAGE_CODEC_SWIFT, "-o", target];

const compileMac = async (cacheDir) => {
  if (fs.existsSync(SHIPPED)) return SHIPPED;
  if (!fs.existsSync(IMAGE_CODEC_SWIFT) || !fs.existsSync("/usr/bin/xcrun")) throw codecError(NO_MAC_READER, true);
  const tag = crypto.createHash("sha256").update(fs.readFileSync(IMAGE_CODEC_SWIFT)).digest("hex").slice(0, 12);
  const dir = path.join(cacheDir, "imagecodec");
  const target = path.join(dir, `oh-imagecodec-${tag}`);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(dir, { recursive: true });
  const partial = path.join(dir, `oh-imagecodec-${tag}-${process.pid}`);
  await new Promise((resolve, reject) => {
    execFile("/usr/bin/xcrun", imageCodecSwiftArgs(partial, process.arch), { timeout: 300_000 }, (error, stdout, stderr) => {
      if (error) reject(codecError(`The app could not prepare its AVIF reader: ${String(stderr || stdout || error.message).trim().split(/\r?\n/).slice(-2).join(" ")}`, true));
      else resolve();
    });
  });
  try {
    fs.renameSync(partial, target);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    if (!fs.existsSync(target)) throw error;
  }
  return target;
};

export const frameworkDir = () => path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");

export const imageCodecCompileArgs = (target) => {
  const framework = frameworkDir();
  return [
    "/nologo",
    "/target:exe",
    "/optimize+",
    `/out:${target}`,
    `/reference:${path.join(framework, "WPF", "PresentationCore.dll")}`,
    `/reference:${path.join(framework, "WPF", "WindowsBase.dll")}`,
    `/reference:${path.join(framework, "System.Xaml.dll")}`,
    ...IMAGE_CODEC_SOURCES,
  ];
};

const asBuffer = (bytes) => (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

export const isAvif = (bytes) => {
  if (!bytes || bytes.length < 16) return false;
  const buffer = asBuffer(bytes);
  if (buffer.toString("latin1", 4, 8) !== "ftyp") return false;
  const size = buffer.readUInt32BE(0);
  const end = Math.min(buffer.length, size >= 16 ? size : 16, 256);
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue;
    const brand = buffer.toString("latin1", at, at + 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
};

const codecError = (message, codecMissing) => Object.assign(new Error(message), { codecMissing });

let built = null;
let helper = null;
let idle = null;
let missing = "";
const inflight = new Map();
const unreadable = new Map();

const compile = (cacheDir) => {
  if (built) return built;
  built = (async () => {
    if (process.platform === "darwin") return compileMac(cacheDir);
    if (process.platform !== "win32") throw codecError(NO_WINDOWS, true);
    if (fs.existsSync(SHIPPED)) return SHIPPED;
    if (!IMAGE_CODEC_SOURCES.every((file) => fs.existsSync(file))) throw codecError(NO_WINDOWS, true);
    const hash = crypto.createHash("sha256");
    for (const file of IMAGE_CODEC_SOURCES) hash.update(fs.readFileSync(file));
    const tag = hash.digest("hex").slice(0, 12);
    const dir = path.join(cacheDir, "imagecodec");
    const target = path.join(dir, `oh-imagecodec-${tag}.exe`);
    if (fs.existsSync(target)) return target;
    fs.mkdirSync(dir, { recursive: true });
    const partial = path.join(dir, `oh-imagecodec-${tag}-${process.pid}.exe`);
    const compiler = path.join(frameworkDir(), "csc.exe");
    if (!fs.existsSync(compiler)) throw codecError(NO_WINDOWS, true);
    await new Promise((resolve, reject) => {
      execFile(compiler, imageCodecCompileArgs(partial), { windowsHide: true, timeout: 120_000 }, (error, stdout) => {
        if (error) reject(codecError(`The app could not prepare its AVIF reader: ${String(stdout || error.message).trim().split(/\r?\n/).slice(-2).join(" ")}`, true));
        else resolve();
      });
    });
    try {
      fs.renameSync(partial, target);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      if (!fs.existsSync(target)) throw error;
    }
    return target;
  })();
  return built;
};

const settleIdle = (state) => {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (helper !== state || state.waiting.length) return;
    helper = null;
    state.child.stdin.end();
  }, IDLE_MS);
  idle.unref?.();
};

const start = async (cacheDir) => {
  if (helper) return helper;
  const exe = await compile(cacheDir);
  if (helper) return helper;
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  const state = { child, waiting: [] };
  const stop = () => {
    if (helper === state) helper = null;
    for (const resolve of state.waiting.splice(0)) resolve("stopped\tThe AVIF reader stopped.");
  };
  child.on("error", stop);
  child.on("exit", stop);
  child.stdin.on("error", () => {});
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    if (line === "ready") return;
    state.waiting.shift()?.(line);
  });
  helper = state;
  return state;
};

const longPath = (file) => {
  const full = path.resolve(file);
  if (process.platform !== "win32" || full.length < 240 || full.startsWith("\\\\?\\")) return full;
  return full.startsWith("\\\\") ? `\\\\?\\UNC\\${full.slice(2)}` : `\\\\?\\${full}`;
};

const ask = async (cacheDir, source, target) => {
  const state = await start(cacheDir);
  clearTimeout(idle);
  return new Promise((resolve) => {
    const timer = setTimeout(() => state.child.kill(), REQUEST_MS);
    state.waiting.push((line) => {
      clearTimeout(timer);
      if (helper === state && !state.waiting.length) settleIdle(state);
      resolve(line);
    });
    state.child.stdin.write(`${longPath(source)}\t${longPath(target)}\n`);
  });
};

const readManifest = (dir, sha) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, `${sha}.json`), "utf8"));
    const frames = (Array.isArray(manifest.frames) ? manifest.frames : []).map((name) => path.join(dir, path.basename(String(name))));
    if (!frames.length || !frames.every((frame) => fs.existsSync(frame))) return null;
    return {
      png: frames[0],
      frames,
      durations: (Array.isArray(manifest.durations) ? manifest.durations : []).map(Number),
      loops: Number.isFinite(Number(manifest.loops)) ? Number(manifest.loops) : -1,
      width: Number(manifest.width) || 0,
      height: Number(manifest.height) || 0,
    };
  } catch {
    return null;
  }
};

const writeManifest = (dir, sha, manifest) => {
  const file = path.join(dir, `${sha}.json`);
  const partial = `${file}.${process.pid}.part`;
  fs.writeFileSync(partial, JSON.stringify(manifest));
  fs.renameSync(partial, file);
};

export const convertAvif = async ({ bytes = null, file = "", cacheDir }) => {
  const buffer = bytes ? asBuffer(bytes) : fs.readFileSync(file);
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  const dir = path.join(cacheDir, "avif");
  const png = path.join(dir, `${sha}.png`);
  const known = readManifest(dir, sha);
  if (known) return { ...known, sha, cached: true };
  if (missing) throw codecError(missing, true);
  if (unreadable.has(sha)) throw codecError(unreadable.get(sha), false);
  if (inflight.has(sha)) return inflight.get(sha);
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, `${sha}.${process.pid}.avif`);
    fs.writeFileSync(source, buffer);
    try {
      let reply = "";
      try {
        reply = await ask(cacheDir, source, png);
      } catch (error) {
        if (error?.codecMissing) missing = error.message;
        throw error;
      }
      const [status, ...rest] = reply.split("\t");
      if (status === "ok") {
        const width = Number(rest[0]) || 0;
        const height = Number(rest[1]) || 0;
        const count = Math.max(1, Number(rest[3]) || 1);
        const names = Array.from({ length: count }, (_, index) => (index === 0 ? `${sha}.png` : `${sha}.${index}.png`));
        const durations = String(rest[5] ?? "").split(",").filter(Boolean).map(Number);
        const loops = rest[4] !== undefined && Number.isFinite(Number(rest[4])) ? Number(rest[4]) : -1;
        writeManifest(dir, sha, { width, height, frames: names, durations, loops });
        return { png, sha, width, height, frames: names.map((name) => path.join(dir, name)), durations, loops, cached: false };
      }
      if (status === "missing" && isAvif(buffer)) {
        missing = process.platform === "darwin" ? NO_MAC_CODEC : NO_CODEC;
        throw codecError(missing, true);
      }
      const message = rest.join(" ").trim() || "The image could not be read.";
      if (status !== "stopped") unreadable.set(sha, message);
      throw codecError(message, false);
    } finally {
      fs.rmSync(source, { force: true });
      inflight.delete(sha);
    }
  })();
  inflight.set(sha, job);
  return job;
};

export const register = ({ cacheDir, clean }) => ({
  "image.avif": async ({ data = "", path: file = "" } = {}) => {
    try {
      if (!clean(data) && !clean(file)) throw codecError("No image was given.", false);
      const result = await convertAvif({ bytes: clean(data) ? Buffer.from(String(data), "base64") : null, file: clean(file), cacheDir });
      return { ok: true, png: result.png, width: result.width, height: result.height, frames: result.frames, durations: result.durations, loops: result.loops, cached: result.cached };
    } catch (error) {
      return { ok: false, missing: error?.codecMissing === true, error: clean(error?.message) || "The image could not be read." };
    }
  },
});
