import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const notifyKit = await import(pathToFileURL(path.join(here, "..", "sidecar", "handlers", "notify.mjs")).href);
const app = path.resolve(process.argv[2] || "");
const logFile = path.resolve(process.argv[3] || "notifier-smoke.log");
const stage = path.join(app, "Contents", "Resources", "app");
const bundle = notifyKit.macNotifierBundle(stage);
const helper = notifyKit.macNotifierPath(stage);
const lines = [];
const log = (line) => {
  lines.push(line);
  console.log(line);
};
const problems = [];
const need = (ok, what) => {
  log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};
const tool = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, ...options });
  return { ok: result.status === 0, status: result.status, text: `${result.stdout || ""}${result.stderr || ""}`.trim() };
};

need(fs.existsSync(helper), `the notifier is in the bundle at ${path.relative(app, helper)}`);
const identity = tool("/usr/bin/codesign", ["--display", "--verbose=2", bundle]);
log(identity.text);
need(identity.text.includes(`Identifier=${notifyKit.MAC_NOTIFIER_ID}`), `the notifier is signed as ${notifyKit.MAC_NOTIFIER_ID}`);
need(tool("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", bundle]).ok, "the notifier's own signature checks out");
const archs = tool("/usr/bin/lipo", ["-archs", helper]);
need(archs.ok && archs.text.includes("arm64") && archs.text.includes("x86_64"), `the notifier runs on both Macs (${archs.text})`);
const plist = JSON.parse(tool("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(bundle, "Contents", "Info.plist")]).text || "{}");
need(plist.CFBundleIdentifier === notifyKit.MAC_NOTIFIER_ID && plist.LSUIElement === true && plist.CFBundleDisplayName === "Open Historia Native", "the notifier posts under the game's name and keeps out of the Dock");

const located = tool(helper, ["--locate"]);
log(`locate: ${located.text}`);
let where = {};
try { where = JSON.parse(located.text.split("\n").pop()); } catch { where = {}; }
need(located.ok && path.resolve(where.game || "") === path.resolve(app) && where.identifier === "io.github.arkniem.openhistoria.native", "a click finds the game's own bundle three folders up");

const child = spawn(helper, ["--serve"], { stdio: ["pipe", "pipe", "pipe"] });
const replies = new Map();
const waiters = new Map();
let ready = null;
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  log(`helper: ${line}`);
  let message = null;
  try { message = JSON.parse(line); } catch { return; }
  if (message.ready) ready = message;
  if (message.seq) {
    replies.set(message.seq, message);
    waiters.get(message.seq)?.(message);
  }
});
const request = (body, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), ms);
  waiters.set(body.seq, (reply) => {
    clearTimeout(timer);
    resolve(reply);
  });
  child.stdin.write(`${JSON.stringify(body)}\n`);
});
const until = async (check, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) await new Promise((resolve) => setTimeout(resolve, 100));
  return check();
};

need(await until(() => ready, 15_000), "the notifier starts and says it is ready");
need(ready?.bundle === notifyKit.MAC_NOTIFIER_ID, "it runs under its own bundle id");
const setting = await request({ op: "setting", seq: 1 }, 45_000);
log(`permission: ${setting ? JSON.stringify(setting) : "no answer in 45 s (the permission prompt is waiting for a person)"}`);
need(setting === null || ["Enabled", "Disabled", "Unknown"].includes(setting.setting), "the permission answer is one the game reads");
const shown = await request({ op: "show", seq: 2, title: "Open Historia — CI", body: "A notification from the macOS build check.", tag: "oh-ci-smoke", notice: 1, chatId: "ci", gameId: "" }, 45_000);
log(`post: ${shown ? JSON.stringify(shown) : "no answer in 45 s"}`);
need(shown === null || typeof shown.shown === "boolean", "the post is answered in the game's terms");
if (shown?.setting === "Enabled") need(shown.shown === true && !shown.error, "with permission, the notification is posted without an error");
const cleared = await request({ op: "clear", seq: 3 }, 15_000);
need(cleared?.cleared === true, "the notifier keeps answering while a permission prompt may be open");
child.stdin.end();
const ending = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 15_000))]);
if (!ending) child.kill("SIGKILL");
need(ending && ending.code === 0 && !ending.signal, `the notifier quits cleanly when the game goes (${JSON.stringify(ending)})`);
if (stderr.trim()) log(`helper stderr: ${stderr.trim()}`);

const clicked = tool("/usr/bin/open", ["-W", "-n", bundle], { timeout: 40_000 });
need(clicked.ok, `opened the way a click opens it, the notifier quits on its own (${clicked.status}${clicked.text ? `: ${clicked.text}` : ""})`);

const summary = `notifier smoke summary: ${problems.length ? `${problems.length} failed` : "all passed"}; permission ${setting?.setting ?? "pending"}${setting?.error ? ` (${setting.error})` : ""}; posted ${shown?.shown ?? "pending"}${shown?.error ? ` (${shown.error})` : ""}`;
log(summary);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, `${lines.join("\n")}\n`);
process.exit(problems.length ? 1 : 0);
