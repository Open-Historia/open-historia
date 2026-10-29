import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertAvif, imageCodecSwiftArgs, IMAGE_CODEC_SWIFT, stopImageCodec } from "../handlers/imagecodec.mjs";
import { gridDistance, pngGrid, readPng } from "./png-grid.mjs";
import { orientationOf } from "./orientation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "avif");
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, "expected.json"), "utf8"));
const mac = process.platform === "darwin";
const skip = mac ? false : "the Swift AVIF helper runs only on macOS";
const GRID_TOLERANCE = 40;

let work = "";
let helper = null;
let lines = null;
const waiting = [];

const cells = (grid) => grid.map((cell) => (typeof cell === "string" ? cell.split(" ").map(Number) : cell));

const ask = (source, target) => new Promise((resolve) => {
  waiting.push(resolve);
  helper.stdin.write(`${source}\t${target}\n`);
});

const build = () => new Promise((resolve, reject) => {
  const prebuilt = process.env.OH_IMAGECODEC_BIN;
  if (prebuilt) {
    resolve(prebuilt);
    return;
  }
  const target = path.join(work, "oh-imagecodec");
  execFile("/usr/bin/xcrun", imageCodecSwiftArgs(target, process.arch), { timeout: 600_000 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`swiftc failed:\n${stderr || stdout || error.message}`));
    else resolve(target);
  });
});

before(async () => {
  if (!mac) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-imagecodec-mac-"));
  const binary = await build();
  helper = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  lines = readline.createInterface({ input: helper.stdout });
  await new Promise((resolve, reject) => {
    helper.once("error", reject);
    lines.once("line", (line) => (line === "ready" ? resolve() : reject(new Error(`The helper said ${line} instead of ready.`))));
  });
  lines.on("line", (line) => waiting.shift()?.(line));
});

after(async () => {
  stopImageCodec();
  if (helper && helper.exitCode === null) {
    const exited = new Promise((resolve) => helper.once("exit", resolve));
    helper.stdin.end();
    await exited;
  }
  if (work) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
});

const decode = async (name) => {
  const target = path.join(work, "out", `${name}.png`);
  const reply = await ask(path.join(fixtures, name), target);
  const [status, width, height, alpha, count, loops, timings = ""] = reply.split("\t");
  const frames = Array.from({ length: Number(count) || 0 }, (_, index) => (index === 0 ? target : target.replace(/\.png$/, `.${index}.png`)));
  return { reply, status, width: Number(width), height: Number(height), alpha, frames, loops: Number(loops), durations: timings.split(",").filter(Boolean).map(Number) };
};

for (const [name, want] of Object.entries(expected)) {
  test(`${name}: ${want.note}`, { skip }, async (t) => {
    const got = await decode(name);
    t.diagnostic(got.reply);
    assert.equal(got.status, "ok", got.reply);
    assert.deepEqual([got.width, got.height], [want.width, want.height], "size");
    assert.equal(got.frames.length, want.frames, "frame count");
    assert.equal(got.loops, want.loops, "loop count");
    assert.equal(got.durations.length, want.durations.length, "one duration per animated frame");
    got.durations.forEach((value, index) => assert.ok(Math.abs(value - want.durations[index]) < 0.002, `frame ${index} lasts ${value} s, Windows says ${want.durations[index]} s`));
    for (const frame of got.frames) assert.ok(fs.existsSync(frame), `${path.basename(frame)} was written`);
    const first = pngGrid(got.frames[0]);
    const last = pngGrid(got.frames[got.frames.length - 1]);
    assert.deepEqual([first.width, first.height], [want.width, want.height], "PNG size");
    assert.equal(first.translucent > 0, want.translucent, want.translucent ? "keeps its transparency" : "stays opaque");
    const distances = [gridDistance(first.cells, cells(want.grids[0])), gridDistance(last.cells, cells(want.grids[1]))];
    t.diagnostic(`grid distance to the Windows decode: first ${distances[0]}, last ${distances[1]}`);
    assert.ok(Math.max(...distances) <= GRID_TOLERANCE, `the pictures differ from the Windows decode by ${distances.join(" and ")}`);
  });
}

test("rotated and mirrored stills turn the way the Windows helper turns them", { skip }, async (t) => {
  const plain = await decode("still-alpha.avif");
  const base = readPng(plain.frames[0]);
  for (const [name, want] of Object.entries(expected).filter(([, value]) => value.orientation)) {
    const got = await decode(name);
    const found = orientationOf(base, readPng(got.frames[0]));
    t.diagnostic(`${name}: ${JSON.stringify(found)}`);
    assert.equal(found.best, want.orientation, `${name} came out ${found.best}, Windows gives ${want.orientation}`);
  }
});

test("malformed requests and unreadable files answer instead of crashing", { skip }, async () => {
  assert.equal(await new Promise((resolve) => {
    waiting.push(resolve);
    helper.stdin.write("no tab here\n");
  }), "failed\tThe request was malformed.");
  assert.match(await ask(path.join(work, "absent.avif"), path.join(work, "absent.png")), /^failed\t/);
  const text = path.join(work, "text.avif");
  fs.writeFileSync(text, "not an image at all");
  assert.match(await ask(text, path.join(work, "text.png")), /^(failed|missing)\t/);
  const truncated = path.join(work, "truncated.avif");
  fs.writeFileSync(truncated, fs.readFileSync(path.join(fixtures, "anim-alpha-loop2.avif")).subarray(0, 900));
  assert.match(await ask(truncated, path.join(work, "truncated.png")), /^(failed|missing|ok)\t/);
  assert.equal(helper.exitCode, null, "the helper is still running");
});

test("the sidecar handler builds the helper itself and writes the manifest", { skip, timeout: 900_000 }, async () => {
  assert.ok(fs.existsSync(IMAGE_CODEC_SWIFT));
  const cacheDir = path.join(work, "cache");
  const result = await convertAvif({ file: path.join(fixtures, "anim-alpha-loop2.avif"), cacheDir });
  assert.deepEqual([result.width, result.height, result.frames.length, result.loops], [1628, 837, 3, 2]);
  assert.deepEqual(result.durations, [0.3, 0.3, 0.3]);
  const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, "avif", `${result.sha}.json`), "utf8"));
  assert.equal(manifest.frames.length, 3);
  const cached = await convertAvif({ file: path.join(fixtures, "anim-alpha-loop2.avif"), cacheDir });
  assert.equal(cached.cached, true);
});
