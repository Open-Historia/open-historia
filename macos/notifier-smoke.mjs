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

const until = async (check, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) await new Promise((resolve) => setTimeout(resolve, 100));
  return check();
};

const session = async (label, { provisional = false, post = true, wait = 45_000 } = {}) => {
  const child = spawn(helper, ["--serve"], { stdio: ["pipe", "pipe", "pipe"] });
  const waiters = new Map();
  let ready = null;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    log(`${label} helper: ${line}`);
    let message = null;
    try { message = JSON.parse(line); } catch { return; }
    if (message.ready) ready = message;
    if (message.seq) waiters.get(message.seq)?.(message);
  });
  const request = (body, ms) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    waiters.set(body.seq, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(`${JSON.stringify(provisional ? { ...body, provisional } : body)}\n`);
  });
  need(await until(() => ready, 15_000), `${label}: the notifier starts and says it is ready`);
  need(ready?.bundle === notifyKit.MAC_NOTIFIER_ID, `${label}: it runs under its own bundle id`);
  const setting = await request({ op: "setting", seq: 1 }, wait);
  log(`${label} permission: ${setting ? JSON.stringify(setting) : `no answer in ${wait / 1000} s (the permission prompt is waiting for a person)`}`);
  need(setting === null || ["Enabled", "Disabled", "Unknown"].includes(setting.setting), `${label}: the permission answer is one the game reads`);
  need(!setting?.unavailable, `${label}: the system lets the notifier ask (it registers itself with Launch Services)`);
  let shown = null;
  if (post) {
    shown = await request({ op: "show", seq: 2, title: "Open Historia — CI", body: "A notification from the macOS build check.", tag: "oh-ci-smoke", notice: 1, chatId: "ci", gameId: "" }, wait);
    log(`${label} post: ${shown ? JSON.stringify(shown) : `no answer in ${wait / 1000} s`}`);
    need(shown === null || typeof shown.shown === "boolean", `${label}: the post is answered in the game's terms`);
    if (shown?.setting === "Enabled") need(shown.shown === true && !shown.error, `${label}: with permission, the notification is posted without an error`);
  }
  const cleared = await request({ op: "clear", seq: 3 }, 15_000);
  need(cleared?.cleared === true, `${label}: the notifier keeps answering while a permission prompt may be open`);
  child.stdin.end();
  const ending = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 15_000))]);
  if (!ending) child.kill("SIGKILL");
  need(ending && ending.code === 0 && !ending.signal, `${label}: the notifier quits cleanly when the game goes (${JSON.stringify(ending)})`);
  if (stderr.trim()) log(`${label} helper stderr: ${stderr.trim()}`);
  return { setting, shown };
};

const usernotedSince = (minutes) => {
  const found = tool("/usr/bin/log", ["show", "--last", `${minutes}m`, "--style", "compact", "--predicate", `subsystem == "com.apple.UserNotifications" OR process == "usernoted"`], { timeout: 90_000 });
  return found.text.split("\n").filter((line) => line.includes(notifyKit.MAC_NOTIFIER_ID) && /permission|Delivering|Presenting|not allowed|authoriz|Adding|request/i.test(line));
};

const asked = await session("first run", { post: false, wait: 20_000 });
const prompt = usernotedSince(2);
log(`usernoted:\n${prompt.slice(-12).join("\n")}`);
need(asked.setting?.setting === "Enabled" || prompt.some((line) => /Sending request for permission/.test(line)), "the first run asks the person for permission (usernoted shows the prompt)");
const quiet = await session("provisional permission", { provisional: true });
need(quiet.setting?.setting === "Enabled" && quiet.shown?.shown === true, "with permission granted (quietly, as a headless runner allows), the notification is posted");
const delivered = usernotedSince(2);
log(`usernoted:\n${delivered.slice(-12).join("\n")}`);
need(delivered.some((line) => /oh-ci-smoke|Delivering|Adding/i.test(line)), "usernoted takes the notification");

const clicked = tool("/usr/bin/open", ["-W", "-n", bundle], { timeout: 40_000 });
need(clicked.ok, `opened the way a click opens it, the notifier quits on its own (${clicked.status}${clicked.text ? `: ${clicked.text}` : ""})`);

const summary = `notifier smoke summary: ${problems.length ? `${problems.length} failed` : "all passed"}; first run ${asked.setting?.setting ?? "prompt shown"}; posted ${quiet.shown?.shown ?? "pending"}${quiet.shown?.error ? ` (${quiet.shown.error})` : ""}`;
log(summary);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, `${lines.join("\n")}\n`);
process.exit(problems.length ? 1 : 0);
