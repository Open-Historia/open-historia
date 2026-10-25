import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-native-smoke-"));
const started = Date.now();
const child = spawn(process.execPath, [path.join(here, "main.mjs")], {
  env: { ...process.env, OH_NATIVE_ROOT: root, OH_STANDIN_MODEL: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

let nextId = 0;
const waiting = new Map();
const events = [];
let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.event) {
    events.push(message);
    if (message.event === "ready") readyResolve(message.data);
    return;
  }
  const pending = waiting.get(message.id);
  if (!pending) return;
  waiting.delete(message.id);
  if (message.ok) pending.resolve(message.result);
  else pending.reject(new Error(message.error));
});
const call = (method, args = {}) => new Promise((resolve, reject) => {
  nextId += 1;
  waiting.set(nextId, { resolve, reject });
  child.stdin.write(`${JSON.stringify({ id: nextId, method, args })}\n`);
});

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

try {
  const readyData = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("no ready in 90 s")), 90_000))]);
  check("the sidecar starts", Boolean(readyData?.origin), `${Date.now() - started} ms`);
  const created = await call("game.create", { scenarioId: "default", name: "Native smoke" });
  check("a game is created", Boolean(created?.id));
  const before = await call("game.view");
  check("the game has a country and a date", Boolean(before.country && before.gameDate), `${before.country}, ${before.gameDate}`);
  const regions = await call("map.regions");
  check("the regions file is cached", fs.existsSync(regions.file) && regions.count > 0, `${regions.count} regions`);
  const state = await call("map.state");
  const owned = state.owners.filter((owner) => owner >= 0).length;
  check("regions have owners and colours", owned > 0 && state.ownerColors.length === state.ownerNames.length, `${owned} owned, ${state.ownerNames.length} owners`);
  const skipStarted = Date.now();
  const skipped = await call("skip", { days: 30 });
  check("a 30-day skip lands", skipped.view.gameDate !== before.gameDate, `${before.gameDate} -> ${skipped.view.gameDate} in ${Date.now() - skipStarted} ms`);
  check("the skip's events are on the record", skipped.view.events.some((event) => event.title.includes("regional summit")), `${skipped.view.events.length} events`);
  check("progress was reported", events.some((event) => event.event === "turn.progress"));
  const after = await call("map.state");
  check("the map state reads after the skip", after.owners.length === state.owners.length);
  const memory = await call("hello");
  check("hello answers", Boolean(memory?.dataRoot));
} catch (error) {
  check("the run finished", false, error.message);
} finally {
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
  if (failures.length) {
    console.log("--- sidecar stderr (tail) ---");
    console.log(stderr.join("").split("\n").slice(-40).join("\n"));
  }
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
