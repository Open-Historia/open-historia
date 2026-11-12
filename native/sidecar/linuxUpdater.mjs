import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Open Historia Native";
export const MARKER = ".oh-native-install";
export const GAME_EXE = "runtime/Open Historia.x86_64";
export const WATCH_SECONDS = 180;
export const CLOSE_WAIT_MS = 15000;

export const TOOLS = Object.freeze({
  cp: "/bin/cp",
  tar: "tar",
  notifySend: "notify-send",
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
  const options = { mode: "", stage: "", install: "", archive: "", relaunch: true, wait: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--apply-staged" || arg === "--rollback") && index + 1 < argv.length) {
      options.mode = arg === "--rollback" ? "rollback" : "apply";
      options.stage = argv[++index];
    } else if (arg === "--update" && index + 1 < argv.length) {
      options.mode = "update";
      options.install = argv[++index];
    } else if (arg === "--archive" && index + 1 < argv.length) {
      options.archive = argv[++index];
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

export const holderOf = (app, kind, tag) => path.join(path.dirname(app), `.oh-${kind}-${String(tag).replace(/[^\w-]/g, "")}`);

export const isHolderName = (name) => /^\.oh-(?:previous|update|failed)-[\w-]+$/.test(name);

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

export const isElf = (file) => headOf(file).toString("hex") === "7f454c46";

export const looksExecutable = (file) => isElf(file) || headOf(file).subarray(0, 2).toString("latin1") === "#!";

export const gameOf = (app) => path.join(app, ...GAME_EXE.split("/"));

const buildOf = (root) => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, "native", "godot", "version.json"), "utf8")).build ?? "");
  } catch {
    return "";
  }
};

const procState = (pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
  } catch {
    return "";
  }
};

export const createLinuxUpdater = ({ log = () => {}, alert = () => {}, tools = TOOLS, launchApp = null, watchSeconds = WATCH_SECONDS, procRoot = "/proc" } = {}) => {
  const tool = (name, args) => {
    const result = spawnSync(tools[name], args, { encoding: "utf8" });
    return { ok: result.status === 0, text: String(result.stderr || result.stdout || result.error?.message || "").trim() };
  };

  const alive = (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code !== "EPERM") return false;
    }
    return procState(pid) !== "Z";
  };

  const real = (file) => {
    try {
      return fs.realpathSync(file);
    } catch {
      return path.resolve(file);
    }
  };

  const listProcesses = () => {
    let names = [];
    try {
      names = fs.readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
    } catch {
      return [];
    }
    const found = [];
    for (const name of names) {
      const pid = Number(name);
      if (pid === process.pid) continue;
      let exe = "";
      let args = [];
      try {
        exe = fs.readlinkSync(path.join(procRoot, name, "exe")).replace(/ \(deleted\)$/, "");
      } catch {
        exe = "";
      }
      try {
        args = fs.readFileSync(path.join(procRoot, name, "cmdline"), "utf8").split("\0").slice(0, 2).filter(Boolean);
      } catch {
        args = [];
      }
      if (exe || args.length) found.push({ pid, exe, args });
    }
    return found;
  };

  const running = (app, pids) => {
    const prefixes = [...new Set([path.resolve(app), real(app)])].map((folder) => `${folder}${path.sep}`);
    const found = new Set(pids.filter((pid) => pid !== process.pid && alive(pid)));
    for (const entry of listProcesses()) {
      if (prefixes.some((prefix) => entry.exe.startsWith(prefix) || entry.args.some((arg) => arg.startsWith(prefix))) && alive(entry.pid)) found.add(entry.pid);
    }
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

  const openApp = async (app) => {
    const exe = gameOf(app);
    if (!exists(exe)) throw new Error(`${GAME_EXE} is missing from the game's folder`);
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child.pid ?? 0;
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
    const cloned = tool("cp", ["-a", "--reflink=auto", app, copy]);
    if (cloned.ok) return copy;
    log(`the game's folder could not be copied with cp (${cloned.text}); copying it file by file instead`);
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(app, copy, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
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

  const checkCopy = (app) => {
    const exe = gameOf(app);
    if (!exists(exe)) throw new Error(`the updated copy has no ${GAME_EXE}`);
    if (!looksExecutable(exe)) throw new Error(`${GAME_EXE} in the updated copy is not a Linux program`);
    fs.chmodSync(exe, (fs.statSync(exe).mode & 0o777) | 0o755);
    if (!exists(path.join(app, MARKER))) throw new Error("the updated copy lost its installation marker");
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
    if (!kept || !exists(kept)) throw new Error("the version you had is no longer kept beside the game's folder");
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
    if (buildOf(app) === build) return "swapped";
    fs.rmSync(holder, { recursive: true, force: true });
    fs.rmSync(mark(stage, "previous-app"), { force: true });
    return "";
  };

  const apply = async ({ stage, relaunch = true, wait = [] }) => {
    const plan = readPlan(stage);
    const root = planValue(plan, "install");
    const build = planValue(plan, "build");
    if (!root) throw new Error("The update names no installation.");
    const app = path.resolve(root);
    if (!exists(path.join(app, MARKER)) && !previousOf(stage)) return failUpdate("", `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    if (!exists(mark(stage, "ready")) || exists(mark(stage, "applied"))) return failUpdate(app, "The downloaded update is not complete, or was applied already.", relaunch);
    await closeApp(app, wait);
    if (recover(stage, app, build) !== "swapped") {
      removeHolders(app, ["update", "failed"]);
      const work = holderOf(app, "update", build);
      try {
        const fresh = cloneApp(app, work);
        putFiles(plan, stage, fresh);
        checkCopy(fresh);
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
    if (!root) throw new Error("The update names no installation.");
    const app = path.resolve(root);
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

  const unpack = (archive, destination) => {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    const result = tool("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"]);
    if (!result.ok) throw new Error(`the update could not be unpacked (${result.text})`);
    const found = fs.readdirSync(destination, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(destination, entry.name)).find((folder) => exists(path.join(folder, MARKER)));
    if (!found) throw new Error(`the update is not an ${APP_NAME} folder`);
    checkCopy(found);
    return found;
  };

  const update = async ({ install, archive, relaunch = true, wait = [] }) => {
    const app = path.resolve(install);
    if (!exists(path.join(app, MARKER))) return failUpdate("", `The folder ${app} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    const tag = `${Date.now()}-${process.pid}`;
    const work = holderOf(app, "update", tag);
    const holder = holderOf(app, "previous", tag);
    let fresh = "";
    try {
      removeHolders(app, ["update", "failed"]);
      fresh = unpack(archive, work);
      const target = path.join(work, path.basename(app));
      if (fresh !== target) {
        fs.renameSync(fresh, target);
        fresh = target;
      }
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
    log(`the game at ${app} was replaced`);
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

  return { apply, rollback, update, waitForClose, stopRunning, openApp, running, alive };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const logFile = options.stage ? path.join(options.stage, "updater.log") : options.archive ? path.join(path.dirname(options.archive), "updater.log") : "";
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
    if (process.env.OH_LINUX_UPDATER_QUIET === "1") return;
    const child = spawn(TOOLS.notifySend, ["--app-name=Open Historia", "--urgency=critical", "--", `${APP_NAME} could not be updated`, message], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  };
  const updater = createLinuxUpdater({ log, alert });
  try {
    if (options.mode === "apply") return await updater.apply(options);
    if (options.mode === "rollback") return await updater.rollback(options);
    if (options.mode === "update") return await updater.update(options);
    log("usage: linuxUpdater.mjs --apply-staged <dir> | --rollback <dir> | --update <game folder> --archive <file> [--wait pid,pid] [--no-relaunch]");
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
