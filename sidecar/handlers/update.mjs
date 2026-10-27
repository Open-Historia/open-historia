import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const NATIVE_UPDATE_TAG = "native-experimental";
export const NATIVE_SETUP_NAME = "Open-Historia-Native-Setup.exe";
export const NATIVE_MANIFEST_NAME = "native-latest.json";
export const NATIVE_RELEASE_BASE = `https://github.com/Open-Historia/open-historia/releases/download/${NATIVE_UPDATE_TAG}`;
export const NATIVE_UPDATE_MANIFEST = `${NATIVE_RELEASE_BASE}/${NATIVE_MANIFEST_NAME}`;
export const NATIVE_SETUP_URL = `${NATIVE_RELEASE_BASE}/${NATIVE_SETUP_NAME}`;
export const INSTALL_MARKER = ".oh-native-install";
export const LAUNCH_CHECK_TIMEOUT_MS = 6000;
export const LAUNCH_FAILURE_LIMIT = 2;
export const CHECK_TIMEOUT_MS = 6000;
export const STALL_TIMEOUT_MS = 60000;
export const FRESH_CHECK_MS = 60000;
export const DISMISS_KEY = "oh-update-dismissed-build";

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i;
const BUILD = /^\d{8,20}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const text = (value) => String(value ?? "").trim();
const reasonOf = (error) => text(error?.name === "TimeoutError" ? "The update feed did not answer in time" : error?.message ?? error).replace(/[.\s]+$/, "");

export const isLoopbackUrl = (value) => LOOPBACK.test(text(value));

export const manifestUrlFor = (env = process.env) => {
  const override = text(env.OH_NATIVE_UPDATE_URL);
  if (override) return isLoopbackUrl(override) ? override : "";
  if (env.OH_STANDIN_MODEL === "1") return "";
  return NATIVE_UPDATE_MANIFEST;
};

export const readVersionFile = (file) => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const build = text(raw?.build);
    if (!BUILD.test(build)) return null;
    return { version: text(raw.version), build, commit: text(raw.commit) };
  } catch {
    return null;
  }
};

export const buildLabel = (current) => (current?.build ? `native ${current.version || "?"} #${current.build}` : "native");

export const describeVersion = (current) => {
  const build = text(current?.build);
  if (!BUILD.test(build) || build.length < 12) return "Open Historia Native · super experimental · a development copy";
  const built = `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6, 8)} ${build.slice(8, 10)}:${build.slice(10, 12)} UTC`;
  return `Open Historia Native ${text(current.version) || "?"} · super experimental · built ${built}`;
};

export const parseManifest = (raw, { allowLoopback = false } = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const build = text(raw.build);
  const sha256 = text(raw.sha256).toLowerCase();
  const url = text(raw.url);
  if (!BUILD.test(build) || !SHA256.test(sha256)) return null;
  if (!url.startsWith("https://") && !(allowLoopback && isLoopbackUrl(url))) return null;
  const size = Number(raw.size);
  return {
    version: text(raw.version),
    build,
    commit: text(raw.commit),
    sha256,
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
    url,
    notes: text(raw.notes),
    published: text(raw.published),
  };
};

export const isNewerBuild = (current, latest) => {
  const mine = text(current?.build);
  const theirs = text(latest?.build);
  if (!BUILD.test(mine) || !BUILD.test(theirs)) return false;
  return BigInt(theirs) > BigInt(mine);
};

export const sha256File = async (file) => {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

const readRecord = (file) => {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record && typeof record === "object" ? record : {};
  } catch {
    return {};
  }
};

const writeRecord = (file, record) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record));
  } catch {
    return;
  }
};

export const createUpdater = ({
  current,
  manifestUrl,
  downloadDir,
  recordFile,
  installRoot = "",
  storage = null,
  emit = () => {},
  log = () => {},
  fetchImpl = (...args) => fetch(...args),
  spawnImpl = spawn,
  platform = process.platform,
  now = () => Date.now(),
  stallMs = STALL_TIMEOUT_MS,
}) => {
  const allowLoopback = isLoopbackUrl(manifestUrl);
  const supported = Boolean(current?.build && manifestUrl && downloadDir);
  let status = { state: supported ? "idle" : "unsupported", percent: 0, version: "", build: "", error: "" };
  let latest = null;
  let checkedAt = 0;
  let running = null;
  let launchBuild = "";
  let ready = { build: "", file: "" };
  let early = null;

  const canInstall = () => {
    if (!supported || platform !== "win32" || !installRoot) return false;
    try {
      return fs.existsSync(path.join(installRoot, INSTALL_MARKER));
    } catch {
      return false;
    }
  };
  const dismissed = () => {
    try {
      return text(storage?.getItem?.(DISMISS_KEY));
    } catch {
      return "";
    }
  };
  const available = () => Boolean(latest && isNewerBuild(current, latest));
  const snapshot = (extra = {}) => ({
    supported,
    canInstall: canInstall(),
    ...status,
    current: current ?? null,
    versionText: describeVersion(current),
    latest,
    available: available(),
    dismissed: dismissed(),
    downloadUrl: latest?.url || NATIVE_SETUP_URL,
    ...extra,
  });
  const publish = (extra = {}) => emit("update.state", snapshot(extra));
  const set = (patch, extra = {}) => {
    status = { ...status, ...patch };
    if (patch.state === "error") log("warn", `update failed: ${status.error}`);
    publish(extra);
  };

  const failuresFor = (build) => {
    const record = readRecord(recordFile);
    return text(record.build) === text(build) ? Math.max(0, Number(record.failures) || 0) : 0;
  };
  const countFailure = (target) => {
    writeRecord(recordFile, { version: target.version, build: target.build, failures: failuresFor(target.build) + 1, at: new Date(now()).toISOString() });
  };

  const check = async ({ manual = false, timeoutMs = CHECK_TIMEOUT_MS } = {}) => {
    if (!supported) return { status: "unsupported", current: current ?? null };
    try {
      const response = await fetchImpl(manifestUrl, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`The update feed answered ${response.status}`);
      const parsed = parseManifest(await response.json(), { allowLoopback });
      if (!parsed) throw new Error("The update feed could not be read");
      latest = parsed;
      checkedAt = now();
      const newer = available();
      if (manual && newer) {
        try {
          storage?.removeItem?.(DISMISS_KEY);
        } catch {
          log("warn", "update: the dismissed build could not be cleared");
        }
      }
      publish({ checked: true, manual });
      return { status: newer ? "available" : "current", build: newer ? parsed.build : current.build, version: newer ? parsed.version : current.version, current, latest: parsed };
    } catch (error) {
      const message = reasonOf(error);
      log("warn", `update check failed: ${message}`);
      if (manual) publish({ checked: true, manual, checkError: message });
      return { status: "error", message: `Could not check for updates: ${message}.`, current };
    }
  };

  const prefetch = () => {
    if (!supported || early) return early;
    early = { started: now(), promise: check() };
    return early;
  };

  const launch = async ({ timeoutMs = LAUNCH_CHECK_TIMEOUT_MS } = {}) => {
    if (!supported) return { update: false, reason: "unsupported" };
    const pending = early ?? { started: now(), promise: check() };
    early = null;
    const remaining = Math.max(0, timeoutMs - (now() - pending.started));
    let timer = null;
    const result = await Promise.race([
      pending.promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (result === "timeout") return { update: false, reason: "timeout" };
    if (result.status === "error") return { update: false, reason: "check-failed" };
    if (result.status !== "available") return { update: false, reason: "current" };
    const failuresBefore = failuresFor(latest.build);
    if (failuresBefore >= LAUNCH_FAILURE_LIMIT) {
      log("warn", `update ${latest.build} failed at launch ${failuresBefore} times; the banner offers it instead.`);
      return { update: false, reason: "failed-before", version: latest.version, build: latest.build };
    }
    return { update: true, version: latest.version, build: latest.build, current };
  };

  const verified = async (file, target) => {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || (target.size && stat.size !== target.size)) return false;
      return (await sha256File(file)) === target.sha256;
    } catch {
      return false;
    }
  };

  const clearOtherDownloads = (keep) => {
    let names = [];
    try {
      names = fs.readdirSync(downloadDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === keep) continue;
      try {
        fs.rmSync(path.join(downloadDir, name), { recursive: true, force: true });
      } catch {
        log("warn", `update: ${name} could not be removed from the download folder`);
      }
    }
  };

  const fetchSetup = async (target) => {
    const folder = path.join(downloadDir, target.build);
    const file = path.join(folder, NATIVE_SETUP_NAME);
    if (await verified(file, target)) return file;
    clearOtherDownloads(target.build);
    fs.mkdirSync(folder, { recursive: true });
    const part = `${file}.part`;
    const controller = new AbortController();
    let stall = setTimeout(() => controller.abort(new Error("The download stalled")), stallMs);
    const out = fs.createWriteStream(part);
    let writeError = null;
    out.on("error", (error) => {
      writeError = error;
    });
    let finished = false;
    try {
      const response = await fetchImpl(target.url, { cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`The download answered ${response.status}`);
      const landed = text(response.url) || target.url;
      if (!landed.startsWith("https://") && !(allowLoopback && isLoopbackUrl(landed))) throw new Error("The download was redirected somewhere unsafe");
      const total = target.size || Number(response.headers.get("content-length")) || 0;
      const hash = crypto.createHash("sha256");
      let received = 0;
      let shown = -1;
      for await (const chunk of response.body) {
        clearTimeout(stall);
        stall = setTimeout(() => controller.abort(new Error("The download stalled")), stallMs);
        received += chunk.length;
        if (target.size && received > target.size) throw new Error("The download is larger than the update feed said");
        hash.update(chunk);
        if (writeError) throw writeError;
        if (!out.write(chunk)) await once(out, "drain");
        const percent = total > 0 ? Math.max(0, Math.min(99, Math.floor((received / total) * 100))) : 0;
        if (percent !== shown) {
          shown = percent;
          set({ state: "downloading", percent });
        }
      }
      if (writeError) throw writeError;
      out.end();
      await once(out, "finish");
      finished = true;
      if (target.size && received !== target.size) throw new Error("The download is smaller than the update feed said");
      if (hash.digest("hex") !== target.sha256) throw new Error("The download did not match its checksum, so it was thrown away");
      fs.renameSync(part, file);
      return file;
    } catch (error) {
      if (!finished) out.destroy();
      throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
    } finally {
      clearTimeout(stall);
      try {
        fs.rmSync(part, { force: true });
      } catch {
        log("warn", "update: the partial download could not be removed");
      }
    }
  };

  const run = async (atLaunch) => {
    set({ state: "checking", percent: 0, error: "" });
    let target = atLaunch && latest && now() - checkedAt < FRESH_CHECK_MS && available() ? latest : null;
    if (!target) {
      const answer = await check();
      if (answer.status !== "available") {
        launchBuild = "";
        set({ state: "error", error: answer.status === "current" ? "No newer version in the update feed." : answer.message || "The update feed could not be read." });
        return;
      }
      target = latest;
    }
    if (launchBuild) launchBuild = target.build;
    set({ state: "available", percent: 0, version: target.version, build: target.build, error: "" });
    try {
      const file = await fetchSetup(target);
      ready = { build: target.build, file, target };
      launchBuild = "";
      set({ state: "ready", percent: 100, version: target.version, build: target.build });
    } catch (error) {
      if (launchBuild === target.build) countFailure(target);
      launchBuild = "";
      ready = { build: "", file: "" };
      set({ state: "error", error: `${reasonOf(error)}.` });
    }
  };

  const download = ({ launch: atLaunch = false } = {}) => {
    if (!supported) {
      set({ state: "error", error: "This build cannot replace itself in place." });
      return { started: false };
    }
    if (atLaunch) launchBuild = status.build || latest?.build || "pending";
    if (running) return { started: true, already: true };
    if (status.state === "ready" && ready.file && ready.build === latest?.build) {
      launchBuild = "";
      publish();
      return { started: true, already: true };
    }
    running = run(atLaunch).finally(() => {
      running = null;
    });
    return { started: true };
  };

  const later = () => {
    launchBuild = "";
    return true;
  };

  const install = async ({ launch: atLaunch = false, relaunch = true } = {}) => {
    if (status.state !== "ready" || !ready.file || ready.build !== status.build) throw new Error("No downloaded update is ready to install.");
    if (!canInstall()) throw new Error("This copy of the game was not installed by its installer, so it cannot replace itself.");
    const target = ready.target && ready.target.build === ready.build ? ready.target : null;
    if (!target || !(await verified(ready.file, target))) {
      ready = { build: "", file: "" };
      set({ state: "error", error: "The downloaded update was changed after it was checked, so it was not run." });
      throw new Error(status.error);
    }
    if (atLaunch) countFailure(target);
    const args = ["--update", installRoot];
    if (!relaunch) args.push("--no-relaunch");
    const child = spawnImpl(ready.file, args, { cwd: path.dirname(ready.file), detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch((error) => {
      set({ state: "error", error: `The downloaded update could not be started: ${reasonOf(error)}.` });
      throw new Error(status.error);
    });
    child.unref();
    log("info", `update ${target.build} is installing into ${installRoot}`);
    return { installing: true, version: target.version, build: target.build, pid: child.pid ?? 0 };
  };

  const dismiss = (build) => {
    try {
      storage?.setItem?.(DISMISS_KEY, text(build));
    } catch {
      log("warn", "update: the dismissed build could not be saved");
    }
    publish();
    return true;
  };

  return { supported, snapshot, check, prefetch, launch, download, later, install, dismiss, canInstall, idle: () => running ?? Promise.resolve() };
};

export const register = (ctx) => {
  const versionFile = text(process.env.OH_NATIVE_VERSION_FILE) || path.resolve(here, "..", "..", "godot", "version.json");
  const current = readVersionFile(versionFile);
  const installRoot = path.resolve(text(process.env.OH_NATIVE_INSTALL_DIR) || path.resolve(here, "..", "..", ".."));
  const log = (level, message) => process.stderr.write(`[update] ${level}: ${message}\n`);
  const updater = createUpdater({
    current,
    manifestUrl: manifestUrlFor(process.env),
    downloadDir: path.join(ctx.cacheDir, "updates"),
    recordFile: path.join(ctx.dataRoot, "launch-update.json"),
    installRoot,
    storage: ctx.storage,
    emit: ctx.emit,
    log,
  });
  if (current) ctx.engine?.debugLog?.setDebugLogContext?.({ build: buildLabel(current) });
  updater.prefetch();
  return {
    "update.state": async () => updater.snapshot(),
    "update.launch": async () => updater.launch(),
    "update.check": async ({ manual = false } = {}) => updater.check({ manual: manual === true }),
    "update.download": async ({ launch = false } = {}) => updater.download({ launch: launch === true }),
    "update.later": async () => updater.later(),
    "update.install": async ({ launch = false, relaunch = true } = {}) => updater.install({ launch: launch === true, relaunch: relaunch !== false }),
    "update.dismiss": async ({ build = "" } = {}) => updater.dismiss(build),
  };
};
