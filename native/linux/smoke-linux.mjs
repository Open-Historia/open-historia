import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const [appArg, packArg, logArg, ...rest] = process.argv.slice(2);
if (!appArg || !packArg || !logArg) {
  console.error("usage: node native/linux/smoke-linux.mjs <Open Historia Native folder> <probe pck> <log file> [--windowed] [--seconds N] [--webpanel ok|unavailable|any]");
  process.exit(2);
}
const option = (name, fallback) => {
  const at = rest.indexOf(name);
  return at >= 0 && at + 1 < rest.length ? rest[at + 1] : fallback;
};
const windowed = rest.includes("--windowed");
const wantWebPanel = option("--webpanel", windowed ? "ok" : "unavailable");
const seconds = Number(option("--seconds", "420"));
const exeName = "Open Historia";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-linux-smoke-"));
const app = path.join(work, "Open Historia Native");
const copied = spawnSync("cp", ["-a", path.resolve(appArg), app], { stdio: "inherit" });
if (copied.status !== 0) throw new Error("the game's folder could not be copied for the smoke test");
const pack = path.join(app, "runtime", `${exeName}.pck`);
fs.rmSync(pack, { force: true });
fs.copyFileSync(path.resolve(packArg), pack);
const exe = path.join(app, "runtime", `${exeName}.x86_64`);
const data = path.join(work, "data");
const home = path.join(work, "home");
for (const folder of [data, home, path.join(home, "config"), path.join(home, "share"), path.join(home, "cache")]) fs.mkdirSync(folder, { recursive: true });

const args = windowed ? ["--rendering-driver", "opengl3"] : ["--headless"];
const log = fs.createWriteStream(path.resolve(logArg));
const started = Date.now();
log.write(`smoke: ${exe} ${args.join(" ")}\nsmoke: data ${data}\nsmoke: display ${process.env.DISPLAY || "none"}\n`);
const child = spawn(exe, args, {
  cwd: path.dirname(exe),
  env: {
    ...process.env,
    OH_STANDIN_MODEL: "1",
    OH_NATIVE_ROOT: data,
    OH_DISCORD_PRESENCE: "0",
    OH_PROBE_HOLD: process.env.OH_PROBE_HOLD || "8",
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "share"),
    XDG_CACHE_HOME: path.join(home, "cache"),
  },
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

const leftovers = [];
for (const name of fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
  let target = "";
  try {
    target = fs.readlinkSync(path.join("/proc", name, "exe"));
  } catch {
    continue;
  }
  if (target.startsWith(`${app}/`)) leftovers.push({ pid: Number(name), target });
}
for (const entry of leftovers) {
  log.write(`smoke: stopping leftover ${entry.pid} ${entry.target}\n`);
  try {
    process.kill(entry.pid, "SIGKILL");
  } catch {
    void 0;
  }
}

const webPanel = /WEBPANEL (\w+) ?(.*)/.exec(text);
const webPanelState = webPanel ? webPanel[1] : "";
const result = /RESULT (\w+) menu_ms=(-?\d+) enter_ms=(-?\d+) sidecar_ready_ms=(-?\d+) failed_handlers=(\d+) in_game=(\w+)/.exec(text);
const renderer = /renderer=(\S+) display=(\S+)/.exec(text);
const summary = {
  mode: windowed ? "windowed" : "headless",
  arch: process.arch,
  exitCode: code,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  ok: Boolean(result && result[1] === "ok" && code === 0 && (wantWebPanel === "any" || webPanelState === wantWebPanel)),
  webPanel: webPanelState,
  webPanelWanted: wantWebPanel,
  webPanelDetail: webPanel ? webPanel[2].trim().slice(0, 400) : "",
  menuMs: result ? Number(result[2]) : null,
  enterMs: result ? Number(result[3]) : null,
  sidecarReadyMs: result ? Number(result[4]) : null,
  failedHandlers: result ? Number(result[5]) : null,
  inGame: result ? result[6] === "true" : false,
  renderer: renderer ? renderer[1] : "",
  display: renderer ? renderer[2] : "",
  leftovers: leftovers.length,
};
log.write(`\nsmoke summary ${JSON.stringify(summary)}\n`);
await new Promise((resolve) => log.end(resolve));
console.log(`smoke summary ${JSON.stringify(summary)}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(summary.ok ? 0 : 1);
