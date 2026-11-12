import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [stage, samples] = process.argv.slice(2);
if (!stage || !samples) {
  console.error("usage: <bundled node> native/macos/avif-smoke.mjs <App>/Contents/Resources/app <samples folder>");
  process.exit(2);
}
const codec = await import(pathToFileURL(path.join(path.resolve(stage), "native", "sidecar", "handlers", "imagecodec.mjs")).href);
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-avif-smoke-"));
const expected = {
  "kimono.avif": { width: 722, height: 1024, frames: 1 },
  "kimono.rotate90.avif": { width: 722, height: 1024, frames: 1 },
  "bbb_alpha_inverted.avif": { width: 3840, height: 2160, frames: 1 },
  "alpha_video.avif": { width: 640, height: 480, frames: 48, duration: 0.04, loops: -1 },
};
let failures = 0;
for (const [name, want] of Object.entries(expected)) {
  const file = path.join(samples, name);
  try {
    const result = await codec.convertAvif({ file, cacheDir });
    const pngs = result.frames.filter((frame) => fs.existsSync(frame) && fs.readFileSync(frame).subarray(1, 4).toString("latin1") === "PNG");
    const problems = [];
    if (result.width !== want.width || result.height !== want.height) problems.push(`size ${result.width}x${result.height}, wanted ${want.width}x${want.height}`);
    if (result.frames.length !== want.frames) problems.push(`${result.frames.length} frames, wanted ${want.frames}`);
    if (pngs.length !== result.frames.length) problems.push(`${result.frames.length - pngs.length} frames are not PNG files`);
    if (want.duration && !result.durations.every((value) => Math.abs(value - want.duration) < 0.002)) problems.push(`durations ${result.durations.slice(0, 4).join(",")}…, wanted ${want.duration}`);
    if (want.loops !== undefined && result.loops !== want.loops) problems.push(`loops ${result.loops}, wanted ${want.loops}`);
    if (!fs.existsSync(path.join(cacheDir, "avif", `${result.sha}.json`))) problems.push("no manifest was written");
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}: ${result.width}x${result.height}, ${result.frames.length} frame(s), loops ${result.loops}${problems.length ? ` (${problems.join("; ")})` : ""}`);
    if (problems.length) failures += 1;
  } catch (error) {
    console.log(`FAIL ${name}: ${error?.message ?? error}${error?.codecMissing ? " (reader missing)" : ""}`);
    failures += 1;
  }
}
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log(`avif smoke: ${Object.keys(expected).length - failures} of ${Object.keys(expected).length} samples read as on Windows`);
process.exit(failures ? 1 : 0);
