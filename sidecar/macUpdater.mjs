import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Open Historia Native";
export const MARKER = ".oh-native-install";
export const WATCH_SECONDS = 180;
export const CLOSE_WAIT_MS = 15000;
export const FIND_MS = 20000;
export const QUARANTINE = "com.apple.quarantine";

export const TOOLS = Object.freeze({
  codesign: "/usr/bin/codesign",
  xattr: "/usr/bin/xattr",
  plutil: "/usr/bin/plutil",
  ditto: "/usr/bin/ditto",
  cp: "/bin/cp",
  open: "/usr/bin/open",
  ps: "/bin/ps",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
};
const messageOf = (error) => String(error?.message ?? error);

export const parseArgs = (argv) => {
  const options = { mode: "", stage: "", install: "", zip: "", relaunch: true, wait: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--apply-staged" || arg === "--rollback") && index + 1 < argv.length) {
      options.mode = arg === "--rollback" ? "rollback" : "apply";
      options.stage = argv[++index];
    } else if (arg === "--update" && index + 1 < argv.length) {
      options.mode = "update";
      options.install = argv[++index];
    } else if (arg === "--zip" && index + 1 < argv.length) {
      options.zip = argv[++index];
    } else if (arg === "--wait" && index + 1 < argv.length) {
      options.wait = argv[++index].split(",").map((value) => Number.parseInt(value, 10)).filter((value) => Number.isSafeInteger(value) && value > 0);
    } else if (arg === "--no-relaunch") {
      options.relaunch = false;
    }
  }
  return options;
};

export const readPlan = (stage) => fs.readFileSync(path.join(stage, "apply.txt"), "utf8").split(/\r?\n/).map((line) => {
  const tab = line.indexOf("\t");
  return tab > 0 ? [line.slice(0, tab), line.slice(tab + 1)] : null;
}).filter(Boolean);

export const planValue = (plan, key) => plan.find((row) => row[0] === key)?.[1] ?? "";

export const inside = (root, relative) => {
  const clean = String(relative);
  if (!clean || path.isAbsolute(clean) || clean.includes("\\") || clean.includes(":")) throw new Error(`The update names a file outside the game's folder: ${relative}`);
  for (const part of clean.split("/")) {
    if (!part || part === "." || part === "..") throw new Error(`The update names a file outside the game's folder: ${relative}`);
  }
  return path.join(root, ...clean.split("/"));
};

export const appBundleOf = (root) => {
  const match = /^(.*\.app)\/Contents\/Resources\/app\/?$/.exec(path.resolve(String(root ?? "")).split(path.sep).join("/"));
  return match ? match[1].split("/").join(path.sep) : "";
};

export const appRootOf = (app) => path.join(app, "Contents", "Resources", "app");

export const holderOf = (app, kind, tag) => path.join(path.dirname(app), `.oh-${kind}-${String(tag).replace(/[^\w-]/g, "")}`);

export const isHolderName = (name) => /^\.oh-(?:previous|update|failed)-[\w-]+$/.test(name);

const MACHO = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);

const headOf = (file) => {
  try {
    const handle = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    try {
      fs.readSync(handle, head, 0, 4, 0);
    } finally {
      fs.closeSync(handle);
    }
    return head;
  } catch {
    return Buffer.alloc(0);
  }
};

export const isMachO = (file) => MACHO.has(headOf(file).toString("hex"));

export const looksExecutable = (file) => isMachO(file) || headOf(file).subarray(0, 2).toString("latin1") === "#!";

const buildOf = (root) => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, "native", "godot", "version.json"), "utf8")).build ?? "");
  } catch {
    return "";
  }
};

export const createMacUpdater = ({ log = () => {}, alert = () => {}, platform = process.platform, tools = TOOLS, launchApp = null, watchSeconds = WATCH_SECONDS, findMs = FIND_MS } = {}) => {
  const tool = (name, args) => {
    const result = spawnSync(tools[name], args, { encoding: "utf8" });
    return { ok: result.status === 0, text: String(result.stderr || result.stdout || result.error?.message || "").trim() };
  };

  const listProcesses = () => {
    if (platform === "win32") return [];
    const result = spawnSync(tools.ps, ["-axww", "-o", "pid=,args="], { encoding: "utf8" });
    if (result.status !== 0) return [];
    return result.stdout.split("\n").map((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      return match ? { pid: Number(match[1]), args: match[2] } : null;
    }).filter(Boolean);
  };

  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  };

  const real = (file) => {
    try {
      return fs.realpathSync(file);
    } catch {
      return path.resolve(file);
    }
  };

  const running = (app, pids) => {
    const prefixes = [...new Set([path.resolve(app), real(app)])].map((folder) => `${folder}${path.sep}`);
    const found = new Set(pids.filter((pid) => pid !== process.pid && alive(pid)));
    for (const entry of listProcesses()) if (entry.pid !== process.pid && prefixes.some((prefix) => entry.args.startsWith(prefix))) found.add(entry.pid);
    return [...found];
  };

  const waitForClose = async (app, pids, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!running(app, pids).length) return true;
      if (Date.now() >= deadline) return false;
      await sleep(250);
    }
  };

  const stopRunning = async (app, pids) => {
    const found = running(app, pids);
    for (const pid of found) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        void 0;
      }
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && found.some(alive)) await sleep(100);
    for (const pid of found.filter(alive)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        void 0;
      }
    }
  };

  const closeApp = async (app, pids) => {
    if (!(await waitForClose(app, pids, CLOSE_WAIT_MS))) await stopRunning(app, pids);
  };

  const findPid = async (app, ms) => {
    const exe = `${path.join(real(app), "Contents", "MacOS")}${path.sep}`;
    const loose = `/${path.basename(app)}/Contents/MacOS/`;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = listProcesses().find((entry) => entry.pid !== process.pid && (entry.args.startsWith(exe) || entry.args.includes(loose)));
      if (found) return found.pid;
      await sleep(250);
    }
    return 0;
  };

  const openApp = async (app, { find = true } = {}) => {
    const opened = tool("open", ["-n", app]);
    if (!opened.ok) throw new Error(`the app could not be opened (${opened.text})`);
    return find ? findPid(app, findMs) : 0;
  };

  const start = (app, options) => (launchApp ? launchApp(app, options) : openApp(app, options));

  const reopen = async (app) => {
    try {
      await start(app, { find: false });
    } catch (error) {
      log(`the game could not be reopened: ${messageOf(error)}`);
    }
  };

  const mark = (stage, name) => path.join(stage, name);

  const rolledBack = (stage, build) => {
    fs.writeFileSync(mark(stage, "rolled-back"), build);
    fs.rmSync(mark(stage, "applied"), { force: true });
  };

  const failUpdate = async (app, message, reopenApp) => {
    log(message);
    alert(message);
    if (reopenApp && app && exists(app)) await reopen(app);
    return 1;
  };

  const removeHolders = (app, kinds, keep = "") => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.dirname(app));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!isHolderName(entry) || !kinds.some((kind) => entry.startsWith(`.oh-${kind}-`))) continue;
      const holder = path.join(path.dirname(app), entry);
      if (holder === keep) continue;
      try {
        fs.rmSync(holder, { recursive: true, force: true });
      } catch {
        void 0;
      }
    }
  };

  const cloneApp = (app, holder) => {
    fs.rmSync(holder, { recursive: true, force: true });
    fs.mkdirSync(holder, { recursive: true });
    const copy = path.join(holder, path.basename(app));
    const cloned = tool("cp", ["-cRp", app, copy]);
    if (cloned.ok) return copy;
    log(`the app could not be cloned (${cloned.text}); copying it instead`);
    fs.rmSync(copy, { recursive: true, force: true });
    const copied = tool("ditto", [app, copy]);
    if (!copied.ok) throw new Error(`the app could not be copied (${copied.text})`);
    return copy;
  };

  const putFiles = (plan, stage, root) => {
    const files = path.join(stage, "files");
    const put = [];
    for (const [verb, relative] of plan) {
      if (verb !== "put" && verb !== "remove") continue;
      const installed = inside(root, relative);
      if (verb === "remove") {
        fs.rmSync(installed, { force: true });
        continue;
      }
      const source = inside(files, relative);
      if (!exists(source)) throw new Error(`The update is missing ${relative}`);
      let mode = 0o644;
      try {
        mode = fs.statSync(installed).mode & 0o777;
        fs.rmSync(installed, { force: true });
      } catch {
        mode = 0o644;
      }
      fs.mkdirSync(path.dirname(installed), { recursive: true });
      fs.copyFileSync(source, installed);
      fs.chmodSync(installed, looksExecutable(installed) ? mode | 0o755 : mode);
      put.push(installed);
    }
    return put;
  };

  const stamp = (app) => {
    const plist = path.join(app, "Contents", "Info.plist");
    try {
      const version = JSON.parse(fs.readFileSync(path.join(appRootOf(app), "native", "godot", "version.json"), "utf8"));
      if (version?.version) tool("plutil", ["-replace", "CFBundleShortVersionString", "-string", String(version.version), plist]);
      if (version?.build) tool("plutil", ["-replace", "CFBundleVersion", "-string", String(version.build), plist]);
    } catch (error) {
      log(`the app's version could not be stamped: ${messageOf(error)}`);
    }
  };

  const seal = (app, changed = []) => {
    for (const file of changed) {
      if (!isMachO(file) || tool("codesign", ["--verify", file]).ok) continue;
      const signed = tool("codesign", ["--force", "--sign", "-", file]);
      if (!signed.ok) throw new Error(`${path.basename(file)} could not be signed (${signed.text})`);
    }
    const signed = tool("codesign", ["--force", "--sign", "-", app]);
    if (!signed.ok) throw new Error(`the app could not be signed (${signed.text})`);
    const verified = tool("codesign", ["--verify", "--deep", "--strict", app]);
    if (!verified.ok) throw new Error(`the app's signature does not check out (${verified.text})`);
  };

  const unquarantine = (app) => {
    tool("xattr", ["-dr", QUARANTINE, app]);
    if (tool("xattr", ["-p", QUARANTINE, app]).ok) throw new Error("the app is still marked as downloaded from the internet");
  };

  const swap = (app, fresh, holder) => {
    fs.mkdirSync(holder, { recursive: true });
    const kept = path.join(holder, path.basename(app));
    fs.renameSync(app, kept);
    try {
      fs.renameSync(fresh, app);
    } catch (error) {
      fs.renameSync(kept, app);
      throw error;
    }
    const now = new Date();
    try {
      fs.utimesSync(app, now, now);
    } catch {
      void 0;
    }
    return kept;
  };

  const previousOf = (stage) => {
    try {
      const holder = fs.readFileSync(mark(stage, "previous-app"), "utf8").trim();
      return holder && isHolderName(path.basename(holder)) ? holder : "";
    } catch {
      return "";
    }
  };

  const revert = (stage, app, build) => {
    const holder = previousOf(stage);
    const kept = holder ? path.join(holder, path.basename(app)) : "";
    if (!kept || !exists(kept)) throw new Error("the version you had is no longer kept beside the app");
    const failed = holderOf(app, "failed", build);
    fs.rmSync(failed, { recursive: true, force: true });
    if (exists(app)) {
      fs.mkdirSync(failed, { recursive: true });
      fs.renameSync(app, path.join(failed, path.basename(app)));
    }
    fs.renameSync(kept, app);
    for (const folder of [failed, holder]) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        void 0;
      }
    }
    fs.rmSync(mark(stage, "previous-app"), { force: true });
    rolledBack(stage, build);
  };

  const watch = async (stage, app, build) => {
    let pid = 0;
    try {
      pid = await start(app, { find: true });
    } catch (error) {
      log(`the new version could not be opened: ${messageOf(error)}`);
    }
    const deadline = Date.now() + watchSeconds * 1000;
    let failed = !pid && !exists(mark(stage, "confirmed"));
    while (!failed && Date.now() < deadline) {
      if (exists(mark(stage, "confirmed")) || !exists(mark(stage, "applied"))) return 0;
      if (!alive(pid)) {
        await sleep(500);
        if (exists(mark(stage, "confirmed")) || !exists(mark(stage, "applied"))) return 0;
        failed = true;
        break;
      }
      await sleep(250);
    }
    if (!failed) return 0;
    log("the new version closed before it finished starting, so the version you had is being put back");
    await closeApp(app, []);
    revert(stage, app, build);
    await reopen(app);
    return 1;
  };

  const recover = (stage, app, build) => {
    const holder = previousOf(stage);
    if (!holder) return "";
    const kept = path.join(holder, path.basename(app));
    if (!exists(kept)) {
      fs.rmSync(mark(stage, "previous-app"), { force: true });
      return "";
    }
    if (!exists(app)) {
      fs.renameSync(kept, app);
      fs.rmSync(holder, { recursive: true, force: true });
      fs.rmSync(mark(stage, "previous-app"), { force: true });
      return "";
    }
    if (buildOf(appRootOf(app)) === build) return "swapped";
    fs.rmSync(holder, { recursive: true, force: true });
    fs.rmSync(mark(stage, "previous-app"), { force: true });
    return "";
  };

  const apply = async ({ stage, relaunch = true, wait = [] }) => {
    const plan = readPlan(stage);
    const root = planValue(plan, "install");
    const build = planValue(plan, "build");
    if (!root) throw new Error("The update names no installation.");
    const app = appBundleOf(root);
    if (!app) return failUpdate("", `The folder ${root} is not inside an app, so it was left alone.`, false);
    if (!exists(path.join(root, MARKER)) && !previousOf(stage)) return failUpdate("", `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    if (!exists(mark(stage, "ready")) || exists(mark(stage, "applied"))) return failUpdate(app, "The downloaded update is not complete, or was applied already.", relaunch);
    await closeApp(app, wait);
    if (recover(stage, app, build) !== "swapped") {
      removeHolders(app, ["update", "failed"]);
      const work = holderOf(app, "update", build);
      try {
        const fresh = cloneApp(app, work);
        const changed = putFiles(plan, stage, appRootOf(fresh));
        stamp(fresh);
        seal(fresh, changed);
        unquarantine(fresh);
        await closeApp(app, wait);
        const holder = holderOf(app, "previous", build);
        fs.rmSync(holder, { recursive: true, force: true });
        fs.writeFileSync(mark(stage, "previous-app"), holder);
        swap(app, fresh, holder);
      } catch (error) {
        const left = previousOf(stage);
        try {
          if (left && !exists(app) && exists(path.join(left, path.basename(app)))) fs.renameSync(path.join(left, path.basename(app)), app);
          if (left && exists(app)) fs.rmSync(left, { recursive: true, force: true });
          fs.rmSync(mark(stage, "previous-app"), { force: true });
          fs.rmSync(work, { recursive: true, force: true });
        } catch {
          void 0;
        }
        rolledBack(stage, build);
        return failUpdate(app, `The update could not be applied (${messageOf(error)}), so the version you had was kept.`, relaunch);
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
    fs.writeFileSync(mark(stage, "applied"), build);
    log(`update ${build} applied to ${app}; the version it replaced is kept until the new one starts`);
    if (relaunch) return watch(stage, app, build);
    return 0;
  };

  const rollback = async ({ stage, relaunch = true, wait = [] }) => {
    const plan = readPlan(stage);
    const root = planValue(plan, "install");
    const build = planValue(plan, "build");
    const app = appBundleOf(root);
    if (!app) return failUpdate("", `The folder ${root} is not inside an app, so it was left alone.`, false);
    await closeApp(app, wait);
    try {
      revert(stage, app, build);
    } catch (error) {
      return failUpdate(app, `The previous version could not be put back: ${messageOf(error)}`, false);
    }
    log(`update ${build} was rolled back`);
    if (relaunch) await reopen(app);
    return 0;
  };

  const unpack = (zip, destination) => {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    const result = tool("ditto", ["-x", "-k", zip, destination]);
    if (!result.ok) throw new Error(`the update could not be unpacked (${result.text})`);
    const found = fs.readdirSync(destination).find((entry) => entry.endsWith(".app"));
    if (!found) throw new Error("the update holds no app");
    const app = path.join(destination, found);
    if (!exists(path.join(appRootOf(app), MARKER))) throw new Error(`the update is not an ${APP_NAME} app`);
    return app;
  };

  const update = async ({ install, zip, relaunch = true, wait = [] }) => {
    const root = path.resolve(install);
    const app = appBundleOf(root);
    if (!app || !exists(path.join(root, MARKER))) return failUpdate("", `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    const tag = `${Date.now()}-${process.pid}`;
    const work = holderOf(app, "update", tag);
    const holder = holderOf(app, "previous", tag);
    try {
      removeHolders(app, ["update", "failed"]);
      const fresh = unpack(zip, work);
      unquarantine(fresh);
      const verified = tool("codesign", ["--verify", "--deep", "--strict", fresh]);
      if (!verified.ok) throw new Error(`the downloaded app's signature does not check out (${verified.text})`);
      await closeApp(app, wait);
      swap(app, fresh, holder);
    } catch (error) {
      try {
        fs.rmSync(work, { recursive: true, force: true });
      } catch {
        void 0;
      }
      return failUpdate(app, `The update could not be installed: ${messageOf(error)}`, relaunch);
    }
    log(`the app at ${app} was replaced`);
    for (const folder of [work, holder]) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        void 0;
      }
    }
    if (relaunch) await reopen(app);
    return 0;
  };

  return { apply, rollback, update, waitForClose, stopRunning, openApp, running };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const logFile = options.stage ? path.join(options.stage, "updater.log") : options.zip ? path.join(path.dirname(options.zip), "updater.log") : "";
  const log = (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    process.stderr.write(line);
    if (logFile) {
      try {
        fs.appendFileSync(logFile, line);
      } catch {
        void 0;
      }
    }
  };
  const alert = (message) => {
    if (process.platform !== "darwin" || process.env.OH_MAC_UPDATER_QUIET === "1") return;
    const child = spawn("/usr/bin/osascript", ["-e", "on run argv", "-e", "display alert (item 1 of argv) message (item 2 of argv) as warning", "-e", "end run", `${APP_NAME} could not be updated`, message], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  };
  const updater = createMacUpdater({ log, alert });
  try {
    if (options.mode === "apply") return await updater.apply(options);
    if (options.mode === "rollback") return await updater.rollback(options);
    if (options.mode === "update") return await updater.update(options);
    log("usage: macUpdater.mjs --apply-staged <dir> | --rollback <dir> | --update <app folder> --zip <file> [--wait pid,pid] [--no-relaunch]");
    return 2;
  } catch (error) {
    log(`${APP_NAME} could not be updated: ${error?.stack ?? error}`);
    alert(messageOf(error));
    return 1;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
