import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const [appArg, packArg, outArg, ...rest] = process.argv.slice(2);
if (!appArg || !packArg || !outArg) {
  console.error("usage: node native/macos/tour.mjs <Open Historia Native.app | Open Historia Native folder> <tour pck> <out dir> [--tag x2-] [--scale 2] [--size 1440x900] [--only parts] [--skip parts] [--screens names] [--dbus-log file] [--seconds N]");
  process.exit(2);
}
const option = (name, fallback) => {
  const at = rest.indexOf(name);
  return at >= 0 && at + 1 < rest.length ? rest[at + 1] : fallback;
};
const mac = process.platform === "darwin";
const tag = option("--tag", "");
const seconds = Number(option("--seconds", "1500"));
const dbusLog = option("--dbus-log", "");
const out = path.resolve(outArg);
const shots = path.join(out, "shots");
fs.mkdirSync(shots, { recursive: true });
const exeName = "Open Historia";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "oh-tour-"));
const app = path.join(work, mac ? "Open Historia Native.app" : "Open Historia Native");
const copied = mac ? spawnSync("/usr/bin/ditto", [path.resolve(appArg), app], { stdio: "inherit" }) : spawnSync("cp", ["-a", path.resolve(appArg), app], { stdio: "inherit" });
if (copied.status !== 0) throw new Error("the app could not be copied for the tour");
const runtime = mac ? path.join(app, "Contents", "Resources", "app", "runtime") : path.join(app, "runtime");
const pack = path.join(runtime, `${exeName}.pck`);
fs.rmSync(pack, { force: true });
fs.copyFileSync(path.resolve(packArg), pack);
const exe = mac ? path.join(app, "Contents", "MacOS", exeName) : path.join(runtime, `${exeName}.x86_64`);
const data = path.join(work, "data");
const home = path.join(work, "home");
for (const folder of [data, path.join(work, "downloads"), path.join(home, "config"), path.join(home, "share"), path.join(home, "cache")]) fs.mkdirSync(folder, { recursive: true });

const env = {
  ...process.env,
  OH_STANDIN_MODEL: "1",
  OH_NOTIFY_LIVE: "1",
  OH_NATIVE_ROOT: data,
  OH_NATIVE_DOWNLOADS: path.join(work, "downloads"),
  OH_DISCORD_PRESENCE: "0",
  OH_SHOTS: shots,
  OH_TOUR_TAG: tag,
  OH_TOUR_SCALE: option("--scale", ""),
  OH_TOUR_SIZE: option("--size", "1440x900"),
  OH_CLICK_ONLY: option("--only", ""),
  OH_TOUR_SKIP: option("--skip", ""),
  OH_TOUR_SCREENS: option("--screens", "c-menu-games,c-settings-general,c-ai-setup,c-hud,c-war-room,g-2-shift-tilt"),
};
if (!mac) Object.assign(env, { XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "share"), XDG_CACHE_HOME: path.join(home, "cache") });
const args = mac ? [] : ["--rendering-driver", "opengl3"];
const logFile = path.join(out, `tour-${tag || "1x-"}log.txt`);
const log = fs.createWriteStream(logFile);
const started = Date.now();
log.write(`tour: ${exe} ${args.join(" ")}\ntour: data ${data}\ntour: display ${process.env.DISPLAY || (mac ? "macOS" : "none")}\n`);

const facts = { windowClass: "", windowIcon: "", screens: 0, screenFailures: [] };
const captureScreen = (file) => {
  const result = mac
    ? spawnSync("/usr/sbin/screencapture", ["-x", "-t", "png", file], { encoding: "utf8", timeout: 30_000 })
    : spawnSync("import", ["-window", "root", file], { encoding: "utf8", timeout: 30_000 });
  if (result.status === 0 && fs.existsSync(file)) facts.screens += 1;
  else facts.screenFailures.push(`${path.basename(file)}: ${(result.stderr || result.error?.message || result.status || "").toString().trim().slice(0, 200)}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  if (!mac && !facts.windowClass) {
    const found = spawnSync("xdotool", ["search", "--name", "^Open Historia$"], { encoding: "utf8" });
    const id = String(found.stdout || "").trim().split("\n").filter(Boolean).pop();
    if (id) {
      facts.windowClass = String(spawnSync("xprop", ["-id", id, "WM_CLASS"], { encoding: "utf8" }).stdout || "").trim();
      const icon = String(spawnSync("xprop", ["-id", id, "-notype", "_NET_WM_ICON"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout || "");
      const numbers = icon.split("=")[1]?.split(",").slice(0, 2).map((value) => Number(value.trim())) || [];
      facts.windowIcon = numbers.length === 2 ? `${numbers[0]}x${numbers[1]}` : icon.trim().slice(0, 80);
      log.write(`tour: window ${id} ${facts.windowClass} icon ${facts.windowIcon}\n`);
    }
  }
};

const child = spawn(exe, args, { cwd: path.dirname(exe), env, stdio: ["ignore", "pipe", "pipe"] });
let text = "";
let pending = "";
const take = (chunk) => {
  const piece = String(chunk);
  text += piece;
  log.write(piece);
  pending += piece;
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines) {
    if (line.startsWith("TOUR-SCREEN ")) captureScreen(line.slice("TOUR-SCREEN ".length).trim());
    if (/\[click .*(FAIL|TOUR-DISPLAY|GESTURE|done:|SHOT)/.test(line) || line.startsWith("TOUR-NOTIFY")) console.log(line.trim());
  }
};
child.stdout.on("data", take);
child.stderr.on("data", take);
const timer = setTimeout(() => {
  log.write(`\ntour: timed out after ${seconds} s\n`);
  child.kill("SIGKILL");
}, seconds * 1000);
const code = await new Promise((resolve) => child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 128 : 1))));
clearTimeout(timer);

const leftovers = spawnSync("/bin/ps", ["-A", "-ww", "-o", "pid=,args="], { encoding: "utf8" }).stdout.split("\n")
  .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
  .filter((match) => match && match[2].includes(`${app}/`));
for (const match of leftovers) {
  log.write(`tour: stopping leftover ${match[1]} ${match[2]}\n`);
  try {
    process.kill(Number(match[1]), "SIGKILL");
  } catch {
    void 0;
  }
}

const failures = [...text.matchAll(/\[click\s+\d+ ms\] FAIL\s+(.*)/g)].map((match) => match[1].trim());
const done = /done: (\d+) failure/.exec(text);
const displays = [...text.matchAll(/TOUR-DISPLAY (\w+) (.*)/g)].map((match) => `${match[1]} ${match[2].trim()}`);
const gestures = [...text.matchAll(/GESTURE (.*)/g)].map((match) => match[1].trim());
const scriptErrors = (text.match(/SCRIPT ERROR/g) || []).length;
const notify = /TOUR-NOTIFY title=(.*)\|body=(.*)/.exec(text);
let notification = null;
const notifyWanted = !option("--skip", "").split(",").includes("notify") && (!option("--only", "") || option("--only", "").split(",").includes("game"));
if (dbusLog && notifyWanted) {
  const wanted = notify ? { title: notify[1].trim(), body: notify[2].trim() } : null;
  const bus = fs.existsSync(dbusLog) ? fs.readFileSync(dbusLog, "utf8") : "";
  const calls = bus.split(/\n(?=method call|method return|signal|error)/).filter((block) => /member=Notify\b/.test(block));
  const strings = (block) => [...block.matchAll(/^\s+string "((?:[^"\\]|\\.)*)"/gm)].map((match) => match[1]);
  const ours = calls.map((block) => ({ block, values: strings(block) })).find((call) => wanted && call.values.includes(wanted.title));
  notification = {
    wanted,
    notifyCalls: calls.length,
    appName: ours?.values[0] ?? "",
    icon: ours?.values[1] ?? "",
    title: ours?.values[2] ?? "",
    body: ours?.values[3] ?? "",
    desktopEntry: ours ? /string "desktop-entry"\s+variant\s+string "([^"]*)"/.exec(ours.block)?.[1] ?? "" : "",
  };
  notification.ok = Boolean(wanted && ours && notification.title === wanted.title && notification.body === wanted.body && notification.appName === "Open Historia");
  fs.writeFileSync(path.join(out, `notification-${tag || "1x-"}evidence.txt`), ours ? ours.block.trim() + "\n" : `no Notify call carried "${wanted?.title}"\n\n${calls.join("\n").slice(0, 4000)}`);
}

const summary = {
  platform: process.platform,
  tag,
  exitCode: code,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  failures: done ? Number(done[1]) : null,
  failed: failures,
  scriptErrors,
  shots: fs.readdirSync(shots).filter((name) => name.endsWith(".png") && !name.startsWith("screen-")).length,
  desktopCaptures: facts.screens,
  desktopCaptureProblems: facts.screenFailures,
  windowClass: facts.windowClass,
  windowIcon: facts.windowIcon,
  displays,
  gestures,
  notification,
  leftovers: leftovers.length,
};
summary.ok = code === 0 && summary.failures === 0 && scriptErrors === 0 && (!notification || notification.ok);
log.write(`\ntour summary ${JSON.stringify(summary)}\n`);
await new Promise((resolve) => log.end(resolve));
fs.writeFileSync(path.join(out, `tour-${tag || "1x-"}summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`tour summary ${JSON.stringify(summary)}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(summary.ok ? 0 : 1);
