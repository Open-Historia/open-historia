import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { firstDifference, frontsHostPath } from "../rustFronts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(here, "..", "main.mjs");
const host = frontsHostPath();
const built = fs.existsSync(path.join(here, "..", "dist", "workers", "rustFrontWorker.mjs"));
const DAYS = Number(process.env.OH_RUST_FRONTS_SKIP_DAYS) || 7;

const sidecar = (root, extra = {}) => {
  const downloads = path.join(root, "downloads");
  fs.mkdirSync(downloads, { recursive: true });
  const child = spawn(process.execPath, [main], {
    env: { ...process.env, OH_NATIVE_ROOT: root, OH_NATIVE_DOWNLOADS: downloads, OH_STANDIN_MODEL: "1", OH_DISCORD_PRESENCE: "0", OH_FRONTS_TIMING: "1", ...extra },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const lines = [];
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
    for (const line of String(chunk).split(/\r?\n/)) if (line.includes("[fronts]")) lines.push(line.trim());
  });
  const waiting = new Map();
  let ready;
  const started = new Promise((resolve, reject) => {
    ready = resolve;
    child.on("exit", (code) => reject(new Error(`the sidecar stopped (${code}): ${errors.slice(-2000)}`)));
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.event === "ready") ready();
    if (message?.id && waiting.has(message.id)) {
      const entry = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(`${entry.method}: ${message.error}`));
    }
  });
  let made = 0;
  const call = async (method, args = {}) => {
    await started;
    made += 1;
    const id = made;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, method });
      child.stdin.write(`${JSON.stringify({ id, method, args })}\n`);
    });
  };
  const close = () => new Promise((resolve) => {
    child.once("exit", resolve);
    child.stdin.end();
    setTimeout(() => child.kill(), 20_000).unref();
  });
  return { call, close, lines, started };
};

const worldOf = (root) => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === "world.json" || entry.name === "worldState.json") found.push(file);
    }
  };
  walk(path.join(root, "server", "data"));
  const newest = found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return newest ? { file: path.relative(root, newest), world: JSON.parse(fs.readFileSync(newest, "utf8")) } : null;
};

const FIELDS = ["battlefields", "units", "wars", "transports", "regionOwnershipOverrides", "regionSovereigntyOverrides", "fortifications", "warWeariness", "manpower"];
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const unstamped = (value) => {
  if (Array.isArray(value)) return value.map(unstamped);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !(typeof item === "string" && STAMP.test(item))).map(([key, item]) => [key, unstamped(item)]));
};
const warOf = (world) => Object.fromEntries(FIELDS.map((key) => [key, unstamped(world?.[key] ?? null)]));
const timingOf = (lines, where) => lines.map((line) => new RegExp(`fought in ${where} in (\\d+) ms`).exec(line)).filter(Boolean).map((match) => Number(match[1]));

test("a stand-in time skip with a war is fought by the Rust host with the outcome JavaScript gives", { skip: (!host || !built) && "no ohfronts-host build or no sidecar bundle", timeout: 900_000 }, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oh-rust-fronts-"));
  try {
    const seed = path.join(scratch, "seed");
    const first = sidecar(seed, { OH_RUST_FRONTS: "0" });
    await first.call("game.create", { scenarioId: "default", country: "France", difficulty: "medium" });
    await first.call("warmap.test.seed", { a: "France", b: "Germany", phase: "war" });
    await first.close();
    const outcomes = {};
    const lines = {};
    const broken = path.join(scratch, "not-an-engine.txt");
    fs.writeFileSync(broken, "not an engine");
    for (const [name, mode] of [["js", "0"], ["rust", "1"], ["shadow", "shadow"], ["broken", "1"]]) {
      const root = path.join(scratch, name);
      fs.cpSync(seed, root, { recursive: true });
      const run = sidecar(root, { OH_RUST_FRONTS: mode, ...(name === "broken" ? { OH_RUST_FRONTS_HOST: broken } : {}) });
      const began = performance.now();
      await run.call("skip", { days: DAYS });
      const ms = performance.now() - began;
      await run.close();
      outcomes[name] = worldOf(root);
      lines[name] = run.lines;
      console.log(`${name}: skip of ${DAYS} days in ${ms.toFixed(0)} ms; ${run.lines.join(" | ")}`);
    }
    assert.ok(outcomes.js?.world, "the JavaScript skip left a world");
    assert.ok((outcomes.js.world.battlefields ?? []).length > 0, "the skip opened a battlefield");
    const jsTimes = timingOf(lines.js, "JavaScript");
    const rustTimes = timingOf(lines.rust, "Rust");
    assert.ok(jsTimes.length > 0, `the JavaScript skip fought its fronts: ${lines.js.join(" | ")}`);
    assert.ok(rustTimes.length > 0 && !lines.rust.some((line) => line.includes("fought in JavaScript")), `the Rust skip fought its fronts in Rust: ${lines.rust.join(" | ")}`);
    assert.equal(firstDifference(warOf(outcomes.rust.world), warOf(outcomes.js.world), "world"), "");
    assert.ok(lines.shadow.some((line) => line.includes("agrees")) && !lines.shadow.some((line) => line.includes("differs") || line.includes("failed")), lines.shadow.join(" | "));
    assert.ok(lines.broken.some((line) => line.includes("fought in JavaScript")) && lines.broken.filter((line) => line.includes("could not")).length === 1, lines.broken.join(" | "));
    assert.equal(firstDifference(warOf(outcomes.broken.world), warOf(outcomes.js.world), "world"), "");
    const sum = (list) => list.reduce((total, value) => total + value, 0);
    console.log(`fronts time of the skip: JavaScript ${sum(jsTimes)} ms over ${jsTimes.length} runs (${jsTimes.join(", ")}), Rust ${sum(rustTimes)} ms over ${rustTimes.length} runs (${rustTimes.join(", ")})`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
