import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const [appArg, packArg, logArg, ...rest] = process.argv.slice(2);
if (!appArg || !packArg || !logArg) {
  console.error("usage: node native/macos/smoke-mac.mjs <Open Historia Native.app> <probe pck> <log file> [--arch x86_64] [--windowed] [--seconds N]");
  process.exit(2);
}
const option = (name, fallback) => {
  const at = rest.indexOf(name);
  return at >= 0 && at + 1 < rest.length ? rest[at + 1] : fallback;
};
const arch = option("--arch", "");
const windowed = rest.includes("--windowed");
const seconds = Number(option("--seconds", "420"));
const exeName = "Open Historia";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-mac-smoke-"));
const app = path.join(work, "Open Historia Native.app");
const copied = spawnSync("/usr/bin/ditto", [path.resolve(appArg), app], { stdio: "inherit" });
if (copied.status !== 0) throw new Error("the app could not be copied for the smoke test");
const pack = path.join(app, "Contents", "Resources", "app", "runtime", `${exeName}.pck`);
fs.rmSync(pack, { force: true });
fs.copyFileSync(path.resolve(packArg), pack);
const exe = path.join(app, "Contents", "MacOS", exeName);
const data = path.join(work, "data");
fs.mkdirSync(data, { recursive: true });

const args = windowed ? [] : ["--headless"];
const command = arch ? "/usr/bin/arch" : exe;
const commandArgs = arch ? [`-${arch}`, exe, ...args] : args;
const log = fs.createWriteStream(path.resolve(logArg));
const started = Date.now();
log.write(`smoke: ${command} ${commandArgs.join(" ")}\nsmoke: data ${data}\n`);
const child = spawn(command, commandArgs, {
  cwd: path.dirname(exe),
  env: { ...process.env, OH_STANDIN_MODEL: "1", OH_NATIVE_ROOT: data, OH_DISCORD_PRESENCE: "0", OH_PROBE_HOLD: process.env.OH_PROBE_HOLD || "8" },
  stdio: ["ignore", "pipe", "pipe"],
});
let text = "";
const take = (chunk) => {
  const piece = String(chunk);
  text += piece;
  log.write(piece);
  for (const line of piece.split("\n")) if (line.includes("[probe")) console.log(line.trim());
};
child.stdout.on("data", take);
child.stderr.on("data", take);
const timer = setTimeout(() => {
  log.write(`\nsmoke: timed out after ${seconds} s\n`);
  child.kill("SIGKILL");
}, seconds * 1000);
const code = await new Promise((resolve) => child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 128 : 1))));
clearTimeout(timer);

const leftovers = spawnSync("/bin/ps", ["-axww", "-o", "pid=,args="], { encoding: "utf8" }).stdout.split("\n")
  .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
  .filter((match) => match && match[2].startsWith(`${app}/`));
for (const match of leftovers) {
  log.write(`smoke: stopping leftover ${match[1]} ${match[2]}\n`);
  try {
    process.kill(Number(match[1]), "SIGKILL");
  } catch {
    void 0;
  }
}

const result = /RESULT (\w+) menu_ms=(-?\d+) enter_ms=(-?\d+) sidecar_ready_ms=(-?\d+) failed_handlers=(\d+) in_game=(\w+)/.exec(text);
const summary = {
  mode: windowed ? "windowed" : "headless",
  arch: arch || process.arch,
  exitCode: code,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  ok: Boolean(result && result[1] === "ok" && code === 0),
  menuMs: result ? Number(result[2]) : null,
  enterMs: result ? Number(result[3]) : null,
  sidecarReadyMs: result ? Number(result[4]) : null,
  failedHandlers: result ? Number(result[5]) : null,
  inGame: result ? result[6] === "true" : false,
  leftovers: leftovers.length,
};
log.write(`\nsmoke summary ${JSON.stringify(summary)}\n`);
await new Promise((resolve) => log.end(resolve));
console.log(`smoke summary ${JSON.stringify(summary)}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(summary.ok ? 0 : 1);
