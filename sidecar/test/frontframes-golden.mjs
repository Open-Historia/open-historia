import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecar = path.resolve(here, "..");
const engineDir = path.resolve(sidecar, "..", "engine");
const scratch = process.env.OH_GOLDEN_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "oh-frontframes-"));
const root = process.env.OH_NATIVE_ROOT || path.join(scratch, "root");
const downloads = process.env.OH_NATIVE_DOWNLOADS || path.join(scratch, "dl");
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(downloads, { recursive: true });
const wanted = Number(process.env.OH_GOLDEN_FRAMES) || 240;
const tolerance = 1e-9;
const started = Date.now();

const say = (text) => console.log(`[golden ${String(Date.now() - started).padStart(6)} ms] ${text}`);

const child = spawn(process.execPath, [path.join(sidecar, "main.mjs")], {
  env: { ...process.env, OH_NATIVE_ROOT: root, OH_NATIVE_DOWNLOADS: downloads, OH_STANDIN_MODEL: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
let nextId = 0;
const waiting = new Map();
let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.event) {
    if (message.event === "ready") readyResolve(message.data);
    return;
  }
  const pending = waiting.get(message.id);
  if (!pending) return;
  waiting.delete(message.id);
  if (message.ok) pending.resolve(message.result);
  else pending.reject(new Error(`${pending.method}: ${message.error}`));
});
const call = (method, args = {}) => new Promise((resolve, reject) => {
  nextId += 1;
  waiting.set(nextId, { resolve, reject, method });
  child.stdin.write(`${JSON.stringify({ id: nextId, method, args })}\n`);
});

let seed = 20261029;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const ZOOMS = [2.6, 4, 4.5, 5, 5.2, 5.4, 5.5, 5.6, 6, 6.3, 6.4, 7, 7.2, 7.5, 7.6, 8, 8.6, 9, 10, 11, 12.5];

const requestsFor = (fronts, count) => {
  const out = [];
  const dayIn = (front) => {
    const from = Number(front.start) || 0;
    const to = Math.max(from, Number(front.end) || 0);
    const pick = random();
    if (pick < 0.08) return Math.round(from + (to - from) * random());
    if (pick < 0.12) return front.until;
    if (pick < 0.15) return from - 1 - random() * 2;
    if (pick < 0.18) return to + random() * 3;
    if (pick < 0.21) return from + Math.floor(random() * (to - from + 1) / 3) * 3 + random() * 1.2;
    return from + (to - from) * random();
  };
  for (let at = 0; at < count; at += 1) {
    const zoom = at < ZOOMS.length * 2 ? ZOOMS[at % ZOOMS.length] : random() < 0.5 ? ZOOMS[Math.floor(random() * ZOOMS.length)] : 2.5 + random() * 10;
    const days = fronts.map((front) => [front.name, dayIn(front)]);
    if (at % 17 === 5) days.reverse();
    if (at % 23 === 7 && days.length) days.push([days[0][0], dayIn(fronts[0])]);
    if (at % 29 === 11) days.push(["no such battlefield", 3]);
    if (at % 31 === 13 && days.length) days[0] = [` ${days[0][0]} `, null];
    if (at % 37 === 17 && days.length) days[0] = [days[0][0], "soon"];
    out.push({ days, zoom: at % 41 === 19 ? 0 : zoom });
  }
  return out;
};

const isGeometry = (pathKey) => /(^|\.)(points|line)\.\d+$|^troops\.\d+\.[01]$|^sides\.\d+\.[01]$|\.alpha$/.test(pathKey);

const compare = (want, got, where, stats) => {
  if (typeof want === "number" || typeof got === "number") {
    if (typeof want !== "number" || typeof got !== "number") return `${where}: ${JSON.stringify(want)} vs ${JSON.stringify(got)}`;
    if (Object.is(want, got) || want === got) {
      stats.exact += 1;
      return null;
    }
    if (isGeometry(where)) {
      const deviation = Math.abs(want - got) / Math.max(Math.abs(want), Math.abs(got), 1e-300);
      stats.max = Math.max(stats.max, deviation);
      stats.inexact += 1;
      if (deviation <= tolerance) return null;
      return `${where}: ${want} vs ${got} (relative ${deviation.toExponential(2)})`;
    }
    return `${where}: ${want} vs ${got}`;
  }
  if (Array.isArray(want) || Array.isArray(got)) {
    if (!Array.isArray(want) || !Array.isArray(got)) return `${where}: array vs ${typeof got}`;
    if (want.length !== got.length) return `${where}: ${want.length} entries vs ${got.length}`;
    for (let at = 0; at < want.length; at += 1) {
      const wrong = compare(want[at], got[at], where ? `${where}.${at}` : String(at), stats);
      if (wrong) return wrong;
    }
    return null;
  }
  if (want && typeof want === "object") {
    if (!got || typeof got !== "object") return `${where}: object vs ${JSON.stringify(got)}`;
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    keys.delete("ms");
    for (const key of keys) {
      const wrong = compare(want[key], got[key], where ? `${where}.${key}` : key, stats);
      if (wrong) return wrong;
    }
    return null;
  }
  if (want !== got) return `${where}: ${JSON.stringify(want)} vs ${JSON.stringify(got)}`;
  stats.exact += 1;
  return null;
};

const digestOf = (frame) => {
  const out = { arrows: 0, past: 0, geometry: 0, indices: 0, palette: 0, alpha: 0, troops: 0, sides: 0, counters: 0, words: "", colours: frame.colours ?? [] };
  for (const arrow of frame.arrows ?? []) {
    out.arrows += 1;
    if (arrow.past) out.past += 1;
    for (const value of arrow.past ? arrow.line : arrow.points) out.geometry += value;
    for (const value of arrow.indices ?? []) out.indices += value;
    out.palette += arrow.f + arrow.rgb + (arrow.dark ?? 0);
    out.alpha += arrow.alpha;
  }
  for (const row of frame.troops ?? []) {
    out.troops += 1;
    for (const value of row) {
      if (typeof value === "number") out.counters += value;
      else out.words += `${value}|`;
    }
  }
  for (const row of frame.sides ?? []) {
    out.sides += 1;
    for (const value of row) out.counters += value;
  }
  return out;
};

const quantile = (list, part) => {
  if (!list.length) return 0;
  const sorted = list.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(part * sorted.length))];
};
const mean = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);

const failures = [];
const stages = [];
const jsTimes = [];
const jsInner = [];
const perStage = Math.ceil(wanted / 4);
try {
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("no ready in 120 s")), 120_000))]);
  say("sidecar ready");
  await call("game.create", { scenarioId: "default", name: "Front frames golden", country: "France", difficulty: "medium" });
  await call("warmap.state", {});
  await call("warmap.test.seed", { a: "France", b: "Germany", phase: "war" });
  for (const [id, sideA, sideB] of [["war-golden-east", "Russia", "Ukraine"], ["war-golden-south", "Spain", "Portugal"], ["war-golden-asia", "India", "Pakistan"]]) {
    await call("warmap.test.seed", { a: sideA, b: sideB, phase: "war", id, units: false });
  }
  const capture = async (label, args = {}) => {
    const state = await call("warmap.state", args);
    const fronts = state.fronts ?? [];
    if (!fronts.length || !state.frontFrames) {
      say(`${label}: no battlefield to compare`);
      return;
    }
    const requests = requestsFor(fronts, perStage);
    const expected = [];
    for (const request of requests) {
      const began = process.hrtime.bigint();
      const frame = await call("warmap.frame", request);
      jsTimes.push(Number(process.hrtime.bigint() - began) / 1e6);
      if (Number.isFinite(frame.ms)) jsInner.push(frame.ms);
      expected.push(frame);
    }
    stages.push({ label, frames: state.frontFrames, fronts, requests, expected });
    say(`${label}: ${fronts.length} battlefield(s): ${fronts.map((front) => `${front.title} [${front.start}..${front.end}] until ${front.until}`).join("; ")}; stage data ${state.frontFrames.length} bytes`);
  };
  for (const days of [7, 30, 30]) {
    const began = Date.now();
    await call("skip", { days });
    say(`a ${days}-day skip landed in ${Date.now() - began} ms`);
    await capture(`after ${days}-day skip`);
  }
  await capture("staged through 1", { stage: { through: 1 } });
  await capture("diplomatic", { mode: "diplomatic" });
  if (!stages.length) throw new Error("the skips opened no battlefield");
  const battlefields = new Set(stages.flatMap((stage) => stage.fronts.map((front) => front.name)));
  const fixture = { repeat: 20, stages: stages.map((stage) => ({ label: stage.label, frames: stage.frames, requests: stage.requests })) };
  const fixtureFile = path.join(scratch, "frontframes-fixture.json");
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
  const cargo = process.env.CARGO || (fs.existsSync(path.join(os.homedir(), ".cargo", "bin", process.platform === "win32" ? "cargo.exe" : "cargo")) ? path.join(os.homedir(), ".cargo", "bin", "cargo") : "cargo");
  say("running the Rust port");
  const run = spawnSync(cargo, ["run", "--quiet", "--release", "-p", "ohfronts", "--bin", "frontframes"], { cwd: engineDir, input: fs.readFileSync(fixtureFile), maxBuffer: 1 << 30, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`the Rust port failed: ${run.stderr}`);
  const rust = JSON.parse(run.stdout);
  const stats = { exact: 0, inexact: 0, max: 0 };
  let compared = 0;
  let arrows = 0;
  let troops = 0;
  const rustTimes = [];
  const loads = [];
  stages.forEach((stage, index) => {
    const got = rust.stages[index];
    loads.push(got.loadMs);
    rustTimes.push(...got.ms);
    stage.expected.forEach((want, at) => {
      compared += 1;
      arrows += (want.arrows ?? []).length;
      troops += (want.troops ?? []).length + (want.sides ?? []).length;
      const wrong = compare(want, got.results[at], "", stats);
      if (wrong) failures.push(`${stage.label} frame ${at} (zoom ${fixture.stages[index].requests[at].zoom}): ${wrong}`);
    });
  });
  say(`${compared} frames compared over ${battlefields.size} battlefield(s) in ${stages.length} stages: ${arrows} arrows, ${troops} troop and side counters`);
  say(`${stats.exact} values equal exactly, ${stats.inexact} geometry values within tolerance, largest relative deviation ${stats.max.toExponential(3)}`);
  say(`JS warmap.frame over stdio: mean ${mean(jsTimes).toFixed(3)} ms, median ${quantile(jsTimes, 0.5).toFixed(3)} ms, p95 ${quantile(jsTimes, 0.95).toFixed(3)} ms (inside the sidecar: mean ${mean(jsInner).toFixed(3)} ms)`);
  say(`Rust frame(): mean ${mean(rustTimes).toFixed(3)} ms, median ${quantile(rustTimes, 0.5).toFixed(3)} ms, p95 ${quantile(rustTimes, 0.95).toFixed(3)} ms; stage load mean ${mean(loads).toFixed(2)} ms`);
  if (process.env.OH_GOLDEN_DIGEST) {
    const stage = stages[Math.min(2, stages.length - 1)];
    const count = 16;
    fs.writeFileSync(process.env.OH_GOLDEN_DIGEST, `${JSON.stringify({ frames: stage.frames, requests: stage.requests.slice(0, count), digests: stage.expected.slice(0, count).map(digestOf) })}
`);
    say(`wrote ${count} frame digests to ${process.env.OH_GOLDEN_DIGEST}`);
  }
  if (compared < 200) failures.push(`only ${compared} frames compared`);
  if (battlefields.size < 2) failures.push(`only ${battlefields.size} battlefield opened`);
} catch (error) {
  failures.push(error.message);
} finally {
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
}
for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length) {
  console.log(`${failures.length} failure(s)`);
  console.log(stderr.join("").split("\n").slice(-30).join("\n"));
  process.exit(1);
}
console.log("ok  the Rust front frames match warmap.frame");
