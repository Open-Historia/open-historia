import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const [appArg, outArg] = process.argv.slice(2);
if (!appArg || !outArg) {
  console.error("usage: node native/linux/mp-guest.mjs <Open Historia Native folder> <out folder>");
  process.exit(2);
}
const token = String(process.env.OH_MP_TOKEN || "").trim();
if (!token.startsWith("oh1-")) {
  console.error("OH_MP_TOKEN must hold the host's invite code.");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(appArg);
const out = path.resolve(outArg);
const minutes = Number(process.env.OH_MP_MINUTES || "30");
fs.mkdirSync(out, { recursive: true });
const work = path.join(path.dirname(out), `${path.basename(out)}-work`);
fs.rmSync(work, { recursive: true, force: true });
const root = path.join(work, "root");
const home = path.join(work, "home");
for (const folder of [path.join(root, "native"), path.join(home, "config"), path.join(home, "share"), path.join(home, "cache")]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(root, "native", "local-storage.json"), "{}");

const redact = (text) => String(text)
  .split(token).join("<invite>")
  .replace(/oh1-[A-Za-z0-9_-]{16,}/g, "<invite>")
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ipv4>")
  .replace(/[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*/g, (found) => (/[0-9A-Fa-f]/.test(found) && (found.includes("::") || found.split(":").length >= 4) ? "<ipv6>" : found));

const probeLog = path.join(work, "net.jsonl");
const env = {
  ...process.env,
  OH_NATIVE_ROOT: root,
  OH_STANDIN_MODEL: "1",
  OH_DISCORD_PRESENCE: "0",
  OH_MP_MODE: "duo-guest",
  OH_MP_REMOTE: "1",
  OH_MP_NAME: process.env.OH_MP_NAME || "Cloud guest",
  OH_MP_DIR: "",
  OH_SHOTS: "",
  OH_NATIVE_DOWNLOADS: path.join(work, "dl"),
  NODE_OPTIONS: `--import=${pathToFileURL(path.join(here, "mp-netprobe.mjs")).href}`,
  OH_PROBE_LOG: probeLog,
  OH_PROBE_ROLE: "guest",
  OH_PROBE_SIDECAR: path.join(app, "native", "sidecar"),
  XDG_CONFIG_HOME: path.join(home, "config"),
  XDG_DATA_HOME: path.join(home, "share"),
  XDG_CACHE_HOME: path.join(home, "cache"),
};
for (const key of Object.keys(env)) if (/API_KEY|GEMINI|OPENAI|ANTHROPIC|OPENROUTER|GH_TOKEN|GITHUB_TOKEN/i.test(key)) delete env[key];

const exe = path.join(app, "runtime", "Open Historia.x86_64");
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const marks = [];
const log = fs.createWriteStream(path.join(out, "guest.log"));
const child = spawn(exe, ["--headless"], { cwd: path.dirname(exe), env, stdio: ["ignore", "pipe", "pipe"] });
let tail = "";
const take = (chunk) => {
  tail += String(chunk);
  const parts = tail.split(/\r?\n/);
  tail = parts.pop();
  for (const raw of parts) {
    const line = redact(raw);
    log.write(`${line}\n`);
    const mark = /\[multiplayer_check +(\d+) ms\] (.*)$/.exec(line);
    if (mark) {
      marks.push({ ms: Number(mark[1]), line: mark[2] });
      console.log(`[${stamp()}] ${line}`);
    } else if (/SCRIPT ERROR|ERROR:|shared game/i.test(line)) console.log(`[${stamp()}] ! ${line.slice(0, 300)}`);
  }
};
child.stdout.on("data", take);
child.stderr.on("data", take);
const timer = setTimeout(() => {
  console.log(`[${stamp()}] time limit reached`);
  child.kill("SIGKILL");
}, minutes * 60_000);
const code = await new Promise((resolve) => child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 128 : 1))));
clearTimeout(timer);
if (tail) take("\n");
await new Promise((resolve) => log.end(resolve));

for (const name of fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
  let target = "";
  try {
    target = fs.readlinkSync(path.join("/proc", name, "exe"));
  } catch {
    continue;
  }
  if (Number(name) !== process.pid && target.startsWith(`${app}/`)) {
    try {
      process.kill(Number(name), "SIGKILL");
    } catch {}
  }
}

const net = fs.existsSync(probeLog) ? fs.readFileSync(probeLog, "utf8").trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(redact(line))) : [];
fs.writeFileSync(path.join(out, "net.jsonl"), net.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
const at = (text) => marks.find((mark) => mark.line.includes(text))?.ms;
const span = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / 100) / 10 : null);
const relays = {};
for (const entry of net.filter((item) => item.what.startsWith("ws."))) {
  const key = `${entry.kind} ${entry.url}`;
  const row = (relays[key] ??= { connects: 0, opens: 0, errors: 0, refused: 0, firstOkMs: null, firstEventMs: null });
  if (entry.what === "ws.connect") row.connects += 1;
  if (entry.what === "ws.open") row.opens += 1;
  if (entry.what === "ws.error") row.errors += 1;
  if (entry.what === "ws.refused") row.refused += 1;
  if (entry.what === "ws.firstOk") row.firstOkMs ??= entry.ms;
  if (entry.what === "ws.firstEvent") row.firstEventMs ??= entry.ms;
}
const summary = {
  exitCode: code,
  seconds: Math.round((Date.now() - t0) / 100) / 10,
  checks: marks.filter((mark) => /^(ok  |FAIL)/.test(mark.line)).map((mark) => mark.line),
  failures: marks.filter((mark) => mark.line.startsWith("FAIL")).map((mark) => mark.line),
  timings: {
    joinToLobbySeconds: span(at("guest: join pressed"), at("guest: the lobby arrives")),
    joinToInGameSeconds: span(at("guest: join pressed"), at("guest: the game opens by itself")),
    roundLandedAtSeconds: span(0, at("guest: the host's round lands")),
  },
  relays,
  rtc: net.filter((entry) => entry.what.startsWith("rtc.")),
};
fs.writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`mp guest summary ${JSON.stringify(summary, null, 2)}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(code === 0 && !summary.failures.length && summary.checks.length ? 0 : 1);
