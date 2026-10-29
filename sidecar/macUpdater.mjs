import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Open Historia Native";
export const MARKER = ".oh-native-install";
export const WATCH_SECONDS = 180;
export const CLOSE_WAIT_MS = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

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
  const match = /^(.*\.app)\/Contents\/Resources\/app\/?$/.exec(path.resolve(root).split(path.sep).join("/"));
  return match ? match[1].split("/").join(path.sep) : "";
};

export const executableOf = (app) => {
  const plist = path.join(app, "Contents", "Info.plist");
  if (process.platform === "darwin" && exists(plist)) {
    try {
      const name = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", plist], { encoding: "utf8" }).trim();
      if (name && exists(path.join(app, "Contents", "MacOS", name))) return path.join(app, "Contents", "MacOS", name);
    } catch {
      void 0;
    }
  }
  try {
    const names = fs.readdirSync(path.join(app, "Contents", "MacOS")).filter((name) => !name.startsWith("."));
    if (names.length) return path.join(app, "Contents", "MacOS", names.sort()[0]);
  } catch {
    void 0;
  }
  return "";
};

const MACHO = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);

export const looksExecutable = (file) => {
  try {
    const handle = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    try {
      fs.readSync(handle, head, 0, 4, 0);
    } finally {
      fs.closeSync(handle);
    }
    return MACHO.has(head.toString("hex")) || head.subarray(0, 2).toString("latin1") === "#!";
  } catch {
    return false;
  }
};

export const createMacUpdater = ({ log = () => {}, alert = () => {}, platform = process.platform } = {}) => {
  const listProcesses = () => {
    if (platform === "win32") return [];
    const result = spawnSync("/bin/ps", ["-axww", "-o", "pid=,args="], { encoding: "utf8" });
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

  const running = (folder, pids) => {
    const prefix = `${folder}${path.sep}`;
    const found = new Set(pids.filter((pid) => pid !== process.pid && alive(pid)));
    if (folder) for (const entry of listProcesses()) if (entry.pid !== process.pid && entry.args.startsWith(prefix)) found.add(entry.pid);
    return [...found];
  };

  const waitForClose = async (folder, pids, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!running(folder, pids).length) return true;
      if (Date.now() >= deadline) return false;
      await sleep(250);
    }
  };

  const stopRunning = async (folder, pids) => {
    const found = running(folder, pids);
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

  const persist = async (step, folder, pids) => {
    let last = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        step();
        return;
      } catch (error) {
        last = error;
      }
      await stopRunning(folder, pids);
      await sleep(500);
    }
    throw last;
  };

  const rename = (from, to) => {
    try {
      fs.renameSync(from, to);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  };

  const moveOver = async (from, to, folder, pids) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await persist(() => {
      if (exists(to)) fs.rmSync(to, { force: true });
      rename(from, to);
    }, folder, pids);
  };

  const undo = async (stage, root, folder, pids) => {
    const journal = path.join(stage, "journal.txt");
    if (!exists(journal)) return;
    const previous = path.join(stage, "previous");
    const lines = fs.readFileSync(journal, "utf8").split("\n").filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const tab = lines[index].indexOf("\t");
      if (tab <= 0) continue;
      const verb = lines[index].slice(0, tab);
      const relative = lines[index].slice(tab + 1);
      const installed = inside(root, relative);
      const kept = inside(previous, relative);
      if (verb === "moved" || verb === "removed") {
        if (exists(kept)) await moveOver(kept, installed, folder, pids);
      } else if (verb === "added" && exists(installed)) {
        await persist(() => fs.rmSync(installed, { force: true }), folder, pids);
      }
    }
    fs.rmSync(journal, { force: true });
  };

  const mark = (stage, name) => path.join(stage, name);

  const rolledBack = (stage, build) => {
    fs.writeFileSync(mark(stage, "rolled-back"), build);
    fs.rmSync(mark(stage, "applied"), { force: true });
  };

  const reseal = (root) => {
    const app = appBundleOf(root);
    if (!app || platform !== "darwin") return;
    const plist = path.join(app, "Contents", "Info.plist");
    try {
      const stamp = JSON.parse(fs.readFileSync(path.join(root, "native", "godot", "version.json"), "utf8"));
      if (stamp?.version) spawnSync("/usr/bin/plutil", ["-replace", "CFBundleShortVersionString", "-string", String(stamp.version), plist]);
      if (stamp?.build) spawnSync("/usr/bin/plutil", ["-replace", "CFBundleVersion", "-string", String(stamp.build), plist]);
    } catch (error) {
      log(`the app's version could not be stamped: ${error?.message ?? error}`);
    }
    const signed = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", app], { encoding: "utf8" });
    if (signed.status !== 0) log(`the app could not be signed again: ${String(signed.stderr || signed.error?.message || "").trim()}`);
  };

  const launch = (root) => {
    const app = appBundleOf(root);
    const exe = app ? executableOf(app) : "";
    if (!exe) throw new Error(`No ${APP_NAME} app was found around ${root}`);
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
    child.on("error", (error) => log(`the game could not be started: ${error?.message ?? error}`));
    return child;
  };

  const exited = (child) => new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 0)));
  });

  const watch = async (stage, root, child, folder, pids, build) => {
    const ended = exited(child);
    let code = null;
    ended.then((value) => {
      code = value;
    });
    const deadline = Date.now() + WATCH_SECONDS * 1000;
    while (Date.now() < deadline) {
      if (exists(mark(stage, "confirmed")) || !exists(mark(stage, "applied"))) break;
      if (code !== null) {
        if (code === 0) break;
        log(`the new version stopped with code ${code}, so the version you had is being put back`);
        if (!(await waitForClose(folder, pids, 5000))) await stopRunning(folder, pids);
        await undo(stage, root, folder, pids);
        rolledBack(stage, build);
        reseal(root);
        launch(root).unref();
        break;
      }
      await sleep(250);
    }
    child.unref();
  };

  const failUpdate = (root, message, reopen) => {
    log(message);
    alert(message);
    if (!reopen) return 1;
    try {
      launch(root).unref();
    } catch (error) {
      log(`the game could not be reopened: ${error?.message ?? error}`);
    }
    return 1;
  };

  const folderOf = (root) => appBundleOf(root) || root;

  const restoreMode = (installed, kept) => {
    let mode = 0o644;
    try {
      if (kept && exists(kept)) mode = fs.statSync(kept).mode & 0o777;
      else if (looksExecutable(installed)) mode = 0o755;
    } catch {
      mode = 0o644;
    }
    if (looksExecutable(installed)) mode |= 0o111;
    fs.chmodSync(installed, mode);
  };

  const apply = async ({ stage, relaunch, wait }) => {
    const plan = readPlan(stage);
    const root = planValue(plan, "install");
    const build = planValue(plan, "build");
    if (!root) throw new Error("The update names no installation.");
    const folder = folderOf(root);
    if (!exists(path.join(root, MARKER))) return failUpdate(root, `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    if (!exists(mark(stage, "ready")) || exists(mark(stage, "applied"))) return failUpdate(root, "The downloaded update is not complete, or was applied already.", relaunch);
    if (!(await waitForClose(folder, wait, CLOSE_WAIT_MS))) await stopRunning(folder, wait);
    await undo(stage, root, folder, wait);
    const previous = path.join(stage, "previous");
    const files = path.join(stage, "files");
    try {
      const journal = fs.openSync(path.join(stage, "journal.txt"), "w");
      try {
        for (const [verb, relative] of plan) {
          if (verb !== "put" && verb !== "remove") continue;
          const installed = inside(root, relative);
          const kept = inside(previous, relative);
          if (verb === "put") {
            const source = inside(files, relative);
            if (!exists(source)) throw new Error(`The update is missing ${relative}`);
            let had = false;
            if (exists(installed)) {
              fs.writeSync(journal, `moved\t${relative}\n`);
              await moveOver(installed, kept, folder, wait);
              had = true;
            } else {
              fs.writeSync(journal, `added\t${relative}\n`);
            }
            fs.mkdirSync(path.dirname(installed), { recursive: true });
            await persist(() => fs.copyFileSync(source, installed), folder, wait);
            restoreMode(installed, had ? kept : "");
          } else if (exists(installed)) {
            fs.writeSync(journal, `removed\t${relative}\n`);
            await moveOver(installed, kept, folder, wait);
          }
        }
      } finally {
        fs.closeSync(journal);
      }
    } catch (error) {
      await undo(stage, root, folder, wait);
      rolledBack(stage, build);
      reseal(root);
      return failUpdate(root, `The update could not be applied (${error?.message ?? error}), so the version you had was kept.`, relaunch);
    }
    fs.writeFileSync(mark(stage, "applied"), build);
    reseal(root);
    log(`update ${build} applied`);
    if (relaunch) await watch(stage, root, launch(root), folder, wait, build);
    return 0;
  };

  const rollback = async ({ stage, relaunch, wait }) => {
    const plan = readPlan(stage);
    const root = planValue(plan, "install");
    const build = planValue(plan, "build");
    const folder = folderOf(root);
    if (!exists(path.join(root, MARKER))) return failUpdate(root, `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    if (!(await waitForClose(folder, wait, CLOSE_WAIT_MS))) await stopRunning(folder, wait);
    await undo(stage, root, folder, wait);
    rolledBack(stage, build);
    reseal(root);
    log(`update ${build} was rolled back`);
    if (relaunch) launch(root).unref();
    return 0;
  };

  const removeLeftovers = (app) => {
    const parent = path.dirname(app);
    const name = path.basename(app);
    let entries = [];
    try {
      entries = fs.readdirSync(parent);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(`${name}.update-`) || entry.startsWith(`${name}.previous-`)) {
        try {
          fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
        } catch {
          void 0;
        }
      }
    }
  };

  const unpack = (zip, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    const result = platform === "darwin"
      ? spawnSync("/usr/bin/ditto", ["-x", "-k", zip, destination], { encoding: "utf8" })
      : spawnSync("unzip", ["-q", zip, "-d", destination], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`the update could not be unpacked (${String(result.stderr || result.error?.message || "").trim()})`);
    const found = fs.readdirSync(destination).find((entry) => entry.endsWith(".app"));
    if (!found) throw new Error("the update holds no app");
    const app = path.join(destination, found);
    if (!exists(path.join(app, "Contents", "Resources", "app", MARKER))) throw new Error("the update is not an Open Historia Native app");
    return app;
  };

  const update = async ({ install, zip, relaunch, wait }) => {
    const root = path.resolve(install);
    const app = appBundleOf(root);
    if (!app || !exists(path.join(root, MARKER))) return failUpdate(root, `The folder ${root} is not an installation of ${APP_NAME}, so it was left alone.`, false);
    const stamp = String(process.pid);
    const staging = `${app}.update-${stamp}`;
    const previous = `${app}.previous-${stamp}`;
    try {
      removeLeftovers(app);
      const fresh = unpack(zip, staging);
      if (!(await waitForClose(app, wait, CLOSE_WAIT_MS))) await stopRunning(app, wait);
      await persist(() => fs.renameSync(app, previous), app, wait);
      try {
        fs.renameSync(fresh, app);
      } catch (error) {
        fs.renameSync(previous, app);
        throw error;
      }
      log(`the app at ${app} was replaced`);
      if (relaunch) launch(root).unref();
      try {
        fs.rmSync(previous, { recursive: true, force: true });
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {
        void 0;
      }
      return 0;
    } catch (error) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch {
        void 0;
      }
      return failUpdate(root, `The update could not be installed: ${error?.message ?? error}`, relaunch);
    }
  };

  return { apply, rollback, update, waitForClose, stopRunning, launch };
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
    alert(String(error?.message ?? error));
    return 1;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
