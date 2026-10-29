import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const chunkKit = await import(pathToFileURL(path.resolve(here, "..", "updateChunks.mjs")).href);
const { INSTALLED_MANIFEST, UPDATER_EXE, chunkAssetName, confirmLocalParts, indexInstalled, isHash, macBundleOf, manifestAssetName, planUpdate, readMacShell, readManifest, readSlice, unpackChunk, wireSize } = chunkKit;

export const NATIVE_UPDATE_TAG = "native-experimental";
export const NATIVE_CHUNKS_TAG = "native-experimental-chunks";
export const NATIVE_SETUP_NAME = "Open-Historia-Native-Setup.exe";
export const NATIVE_MANIFEST_NAME = "native-latest.json";
export const NATIVE_RELEASE_BASE = `https://github.com/Open-Historia/open-historia/releases/download/${NATIVE_UPDATE_TAG}`;
export const NATIVE_CHUNKS_BASE = `https://github.com/Open-Historia/open-historia/releases/download/${NATIVE_CHUNKS_TAG}/`;
export const NATIVE_UPDATE_MANIFEST = `${NATIVE_RELEASE_BASE}/${NATIVE_MANIFEST_NAME}`;
export const NATIVE_SETUP_URL = `${NATIVE_RELEASE_BASE}/${NATIVE_SETUP_NAME}`;
export const NATIVE_MAC_ZIP_NAME = "Open-Historia-Native-macOS.zip";
export const NATIVE_MAC_MANIFEST_NAME = "native-latest-mac.json";
export const NATIVE_MAC_UPDATE_MANIFEST = `${NATIVE_RELEASE_BASE}/${NATIVE_MAC_MANIFEST_NAME}`;
export const NATIVE_MAC_ZIP_URL = `${NATIVE_RELEASE_BASE}/${NATIVE_MAC_ZIP_NAME}`;
export const MAC_UPDATER = "native/sidecar/macUpdater.mjs";
export const NATIVE_LINUX_ARCHIVE_NAME = "Open-Historia-Native-Linux-x86_64.tar.gz";
export const NATIVE_LINUX_MANIFEST_NAME = "native-latest-linux.json";
export const NATIVE_LINUX_UPDATE_MANIFEST = `${NATIVE_RELEASE_BASE}/${NATIVE_LINUX_MANIFEST_NAME}`;
export const NATIVE_LINUX_ARCHIVE_URL = `${NATIVE_RELEASE_BASE}/${NATIVE_LINUX_ARCHIVE_NAME}`;
export const LINUX_UPDATER = "native/sidecar/linuxUpdater.mjs";
export const INSTALL_MARKER = ".oh-native-install";
export const LAUNCH_CHECK_TIMEOUT_MS = 6000;
export const LAUNCH_FAILURE_LIMIT = 2;
export const CHECK_TIMEOUT_MS = 6000;
export const STALL_TIMEOUT_MS = 60000;
export const FRESH_CHECK_MS = 60000;
export const DISMISS_KEY = "oh-update-dismissed-build";
export const CHUNK_ATTEMPTS = 3;
export const CHUNKS_AT_ONCE = 4;
export const BOOT_LIMIT = 2;
export const MANIFEST_BYTES_LIMIT = 16 * 1024 * 1024;

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i;
const BUILD = /^\d{8,20}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const text = (value) => String(value ?? "").trim();
const reasonOf = (error) => text(error?.name === "TimeoutError" ? "The update feed did not answer in time" : error?.message ?? error).replace(/[.\s]+$/, "");
const exists = (file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
};
const remove = (target) => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
};

export const isLoopbackUrl = (value) => LOOPBACK.test(text(value));

export const feedPlatformFor = (platform = process.platform) => (platform === "darwin" ? "macos" : platform === "linux" ? "linux" : "windows");

export const feedPlatformOf = (raw) => text(raw?.platform).toLowerCase() || "windows";

export const manifestUrlFor = (env = process.env, platform = process.platform) => {
  const override = text(env.OH_NATIVE_UPDATE_URL);
  if (override) return isLoopbackUrl(override) ? override : "";
  if (env.OH_STANDIN_MODEL === "1") return "";
  if (platform === "darwin") return NATIVE_MAC_UPDATE_MANIFEST;
  if (platform === "linux") return NATIVE_LINUX_UPDATE_MANIFEST;
  return NATIVE_UPDATE_MANIFEST;
};

export const readVersionFile = (file) => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const build = text(raw?.build);
    if (!BUILD.test(build)) return null;
    return { version: text(raw.version), build, commit: text(raw.commit), notes: text(raw.notes) };
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

export const parseChunks = (raw, { allowLoopback = false, platform = "windows" } = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.format !== chunkKit.FORMAT) return null;
  const base = text(raw.base);
  if (!base.endsWith("/") || !(base.startsWith("https://") || (allowLoopback && isLoopbackUrl(base)))) return null;
  const named = raw.manifest;
  if (!named || !isHash(named.sha256) || !Number.isSafeInteger(named.size) || named.size <= 0 || named.size > MANIFEST_BYTES_LIMIT || named.name !== manifestAssetName(named.sha256, platform)) return null;
  const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  return { format: raw.format, base, manifest: { name: named.name, size: named.size, sha256: named.sha256 }, bytes: count(raw.bytes), files: count(raw.files), count: count(raw.count) };
};

export const parseManifest = (raw, { allowLoopback = false, platform = "" } = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const feedPlatform = feedPlatformOf(raw);
  if (platform && feedPlatform !== platform) return null;
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
    mandatory: raw.mandatory === true,
    platform: feedPlatform,
    chunks: parseChunks(raw.chunks, { allowLoopback, platform: feedPlatform }),
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

const sha256Of = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const readRecord = (file) => {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record && typeof record === "object" && !Array.isArray(record) ? record : {};
  } catch {
    return {};
  }
};

const writeRecord = (file, record) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.part`, JSON.stringify(record));
    fs.renameSync(`${file}.part`, file);
  } catch {
    return;
  }
};

const readCount = (file) => {
  try {
    return Math.max(0, Number.parseInt(fs.readFileSync(file, "utf8"), 10) || 0);
  } catch {
    return 0;
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
  retryDelayMs = 800,
  nodePath = process.execPath,
  waitPids = [process.pid, process.ppid],
}) => {
  const mac = platform === "darwin";
  const linux = platform === "linux";
  const scripted = mac || linux;
  const feedPlatform = feedPlatformFor(platform);
  const updaterName = scripted ? "updater.mjs" : "updater.exe";
  const bundle = mac ? macBundleOf(installRoot) : linux && installRoot ? path.resolve(installRoot) : "";
  const macWritable = () => {
    if (!bundle || bundle.split(path.sep).join("/").includes("/AppTranslocation/")) return false;
    try {
      for (const folder of [installRoot, bundle, path.dirname(bundle)]) fs.accessSync(folder, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  const holderOk = (holder) => Boolean(bundle) && path.dirname(holder) === path.dirname(bundle) && /^\.oh-(?:previous|update|failed)-[\w-]+$/.test(path.basename(holder));
  const dropPrevious = (dir) => {
    if (!scripted) return;
    let holder = "";
    try {
      holder = text(fs.readFileSync(path.join(dir, "previous-app"), "utf8"));
    } catch {
      return;
    }
    if (holder && holderOk(holder) && remove(holder)) log("info", `update: the previous app at ${holder} was removed`);
  };
  const allowLoopback = isLoopbackUrl(manifestUrl);
  const supported = Boolean(current?.build && manifestUrl && downloadDir);
  const dataDir = recordFile ? path.dirname(recordFile) : downloadDir;
  const setupDir = path.join(downloadDir || "", "setup");
  const chunkDir = path.join(downloadDir || "", "chunks");
  const stagedRoot = path.join(downloadDir || "", "staged");
  const chunkRecordFile = path.join(dataDir || "", "update-chunks.json");
  const installedRecordFile = path.join(dataDir || "", "update-installed.json");
  let status = { state: supported ? "idle" : "unsupported", percent: 0, version: "", build: "", error: "", kind: "", phase: "", receivedBytes: 0, downloadBytes: 0, fullBytes: 0, note: "" };
  let latest = null;
  let checkedAt = 0;
  let running = null;
  let launchBuild = "";
  let ready = { build: "", file: "", kind: "" };
  let early = null;
  let planned = null;
  let applied = null;
  let pendingRollback = null;
  let justUpdated = null;
  let rolledBack = "";

  const canInstall = () => {
    if (!supported || !installRoot || (platform !== "win32" && !(scripted && macWritable()))) return false;
    return exists(path.join(installRoot, INSTALL_MARKER));
  };
  const dismissed = () => {
    try {
      return text(storage?.getItem?.(DISMISS_KEY));
    } catch {
      return "";
    }
  };
  const badBuilds = () => {
    const record = readRecord(chunkRecordFile);
    return Array.isArray(record.bad) ? record.bad.map(String) : [];
  };
  const markBad = (build) => {
    const bad = badBuilds();
    if (!bad.includes(String(build))) bad.push(String(build));
    writeRecord(chunkRecordFile, { bad: bad.slice(-20) });
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
    staged: ready.kind === "staged" ? ready.build : "",
    dismissed: dismissed(),
    downloadUrl: latest?.url || (mac ? NATIVE_MAC_ZIP_URL : linux ? NATIVE_LINUX_ARCHIVE_URL : NATIVE_SETUP_URL),
    justUpdated,
    rolledBack,
    pendingRollback: pendingRollback ? pendingRollback.build : "",
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
  const countFailure = (target, by = 1) => {
    writeRecord(recordFile, { version: target.version, build: target.build, failures: failuresFor(target.build) + by, at: new Date(now()).toISOString() });
  };

  const scan = () => {
    if (!supported) return;
    try {
      for (const name of fs.readdirSync(downloadDir)) if (BUILD.test(name)) remove(path.join(downloadDir, name));
    } catch {
      log("info", "update: no earlier downloads to tidy");
    }
    const told = readRecord(installedRecordFile);
    if (text(told.build) && text(told.build) === current.build) justUpdated = { version: current.version || text(told.version), build: current.build, notes: current.notes || text(told.notes) };
    else if (text(told.build)) remove(installedRecordFile);
    let names = [];
    try {
      names = fs.readdirSync(stagedRoot);
    } catch {
      names = [];
    }
    for (const name of names) {
      const dir = path.join(stagedRoot, name);
      if (!BUILD.test(name)) {
        remove(dir);
        continue;
      }
      const meta = readRecord(path.join(dir, "meta.json"));
      if (exists(path.join(dir, "rolled-back"))) {
        markBad(name);
        countFailure({ version: text(meta.version), build: name }, LAUNCH_FAILURE_LIMIT);
        rolledBack = name;
        log("warn", `update ${name} was rolled back; it will come by the installer instead`);
        remove(dir);
        continue;
      }
      if (exists(path.join(dir, "applied"))) {
        if (name === current.build && !exists(path.join(dir, "confirmed"))) {
          const boots = readCount(path.join(dir, "boots")) + 1;
          try {
            fs.writeFileSync(path.join(dir, "boots"), String(boots));
          } catch {
            log("warn", "update: the start count could not be written");
          }
          applied = { dir, build: name, boots };
          if (boots > BOOT_LIMIT && exists(path.join(dir, updaterName))) pendingRollback = applied;
        } else {
          dropPrevious(dir);
          remove(dir);
        }
        continue;
      }
      if (exists(path.join(dir, "ready")) && isNewerBuild(current, { build: name }) && !badBuilds().includes(name)) {
        if (ready.kind === "staged" && BigInt(ready.build) > BigInt(name)) {
          remove(dir);
          continue;
        }
        if (ready.kind === "staged") remove(ready.dir);
        ready = { kind: "staged", build: name, dir, target: { version: text(meta.version), build: name, notes: text(meta.notes) } };
        status = { ...status, state: "ready", percent: 100, version: text(meta.version), build: name, kind: "chunks", phase: "", downloadBytes: Number(meta.fetchBytes) || 0, receivedBytes: Number(meta.fetchBytes) || 0, fullBytes: Number(meta.fullBytes) || 0 };
        continue;
      }
      remove(dir);
    }
  };

  const check = async ({ manual = false, timeoutMs = CHECK_TIMEOUT_MS } = {}) => {
    if (!supported) return { status: "unsupported", current: current ?? null };
    try {
      const response = await fetchImpl(manifestUrl, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`The update feed answered ${response.status}`);
      const parsed = parseManifest(await response.json(), { allowLoopback, platform: feedPlatform });
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
      let sizes = { downloadBytes: parsed.size, fullBytes: parsed.size, kind: "full" };
      if (manual && newer) {
        if (ready.build === parsed.build) sizes = { downloadBytes: 0, fullBytes: parsed.size, kind: ready.kind === "staged" ? "chunks" : "full" };
        else if (useChunks(parsed)) {
          try {
            const plan = await planFor(parsed);
            sizes = { downloadBytes: plan.fetchBytes, fullBytes: parsed.size, kind: "chunks" };
          } catch (error) {
            log("warn", `update: the chunk plan could not be made: ${reasonOf(error)}`);
          }
        }
      }
      publish({ checked: true, manual });
      return {
        status: newer ? "available" : "current",
        build: newer ? parsed.build : current.build,
        version: newer ? parsed.version : current.version,
        notes: newer ? parsed.notes : "",
        ready: newer && ready.build === parsed.build,
        ...(newer ? sizes : {}),
        current,
        latest: parsed,
      };
    } catch (error) {
      const message = reasonOf(error);
      log("warn", `update check failed: ${message}`);
      if (manual) publish({ checked: true, manual, checkError: message });
      return { status: "error", message: `Could not check for updates: ${message}.`, reason: message, current };
    }
  };

  const prefetch = () => {
    if (!supported || early) return early;
    early = { started: now(), promise: check() };
    return early;
  };

  const launch = async ({ timeoutMs = LAUNCH_CHECK_TIMEOUT_MS } = {}) => {
    if (!supported) return { update: false, reason: "unsupported" };
    if (pendingRollback) return { update: false, rollback: true, build: pendingRollback.build, current };
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
    const stagedNow = ready.kind === "staged" && canInstall() && (!latest || ready.build === latest.build);
    if (stagedNow && failuresFor(ready.build) < LAUNCH_FAILURE_LIMIT) {
      return { update: true, staged: true, version: ready.target?.version ?? "", build: ready.build, current, mandatory: Boolean(latest?.mandatory) };
    }
    if (result === "timeout") return { update: false, reason: "timeout" };
    if (result.status === "error") return { update: false, reason: "check-failed" };
    if (result.status !== "available") return { update: false, reason: "current" };
    const failuresBefore = failuresFor(latest.build);
    if (failuresBefore >= LAUNCH_FAILURE_LIMIT) {
      log("warn", `update ${latest.build} failed at launch ${failuresBefore} times; the banner offers it instead.`);
      return { update: false, reason: "failed-before", version: latest.version, build: latest.build };
    }
    return { update: true, version: latest.version, build: latest.build, current, mandatory: latest.mandatory };
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

  const landedSafely = (response, asked) => {
    const landed = text(response.url) || asked;
    return landed.startsWith("https://") || (allowLoopback && isLoopbackUrl(landed));
  };

  const fetchSetup = async (target) => {
    const folder = path.join(setupDir, target.build);
    const file = path.join(folder, mac ? NATIVE_MAC_ZIP_NAME : linux ? NATIVE_LINUX_ARCHIVE_NAME : NATIVE_SETUP_NAME);
    if (await verified(file, target)) return file;
    try {
      for (const name of fs.readdirSync(setupDir)) if (name !== target.build) remove(path.join(setupDir, name));
    } catch {
      fs.mkdirSync(setupDir, { recursive: true });
    }
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
      if (!landedSafely(response, target.url)) throw new Error("The download was redirected somewhere unsafe");
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
          set({ state: "downloading", kind: "full", phase: "downloading", percent, receivedBytes: received, downloadBytes: total, fullBytes: total });
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

  const useChunks = (target) => Boolean(target?.chunks && canInstall() && !badBuilds().includes(target.build));

  const getBytes = async (url, limit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("The update server did not answer in time")), stallMs);
    try {
      const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`${path.basename(new URL(url).pathname)}: the server answered ${response.status}`);
      if (!landedSafely(response, url)) throw new Error("The download was redirected somewhere unsafe");
      const pieces = [];
      let total = 0;
      for await (const piece of response.body) {
        total += piece.length;
        if (total > limit) throw new Error("The download is larger than the update feed said");
        pieces.push(Buffer.from(piece));
      }
      return Buffer.concat(pieces, total);
    } catch (error) {
      throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
    } finally {
      clearTimeout(timer);
    }
  };

  const planFor = async (target) => {
    if (planned?.build === target.build && planned.sha256 === target.chunks.manifest.sha256) return planned.plan;
    const named = target.chunks.manifest;
    const bytes = await getBytes(target.chunks.base + named.name, named.size);
    if (bytes.length !== named.size || sha256Of(bytes) !== named.sha256) throw new Error("the update's file list is not the one its feed names");
    const { manifest, error } = readManifest(JSON.parse(bytes.toString("utf8")));
    if (!manifest) throw new Error(`the update's file list cannot be used: ${error}`);
    if (text(manifest.build) !== target.build) throw new Error("the update's file list describes another build than its feed");
    if (feedPlatformOf(manifest) !== feedPlatform) throw new Error("the update's file list is for another system");
    if (mac && text(manifest.shell) && readMacShell(bundle) !== text(manifest.shell)) throw new Error("the app around the game's files changed in this update");
    const installed = await indexInstalled(installRoot);
    const plan = confirmLocalParts(planUpdate(manifest, installed), manifest);
    planned = { build: target.build, sha256: named.sha256, plan, manifest, manifestText: bytes.toString("utf8"), installedBuild: text(installed.manifest?.build) };
    log("info", `update ${target.build}: ${plan.keep.length} file(s) kept, ${plan.build.length} to put together, ${plan.remove.length} to remove, ${plan.fetch.length} chunk(s) to fetch (${plan.fetchBytes} of ${plan.totalBytes} bytes; the installer is ${target.size})`);
    return plan;
  };

  const chunkFile = (id) => path.join(chunkDir, id);
  const haveChunk = (id, size) => {
    try {
      const data = fs.readFileSync(chunkFile(id));
      return data.length === size && sha256Of(data) === id;
    } catch {
      return false;
    }
  };
  const partSize = (id) => {
    try {
      return fs.statSync(`${chunkFile(id)}.part`).size;
    } catch {
      return 0;
    }
  };

  const fetchChunk = async (base, id, manifest, onBytes) => {
    const size = wireSize(manifest, id);
    const file = chunkFile(id);
    const part = `${file}.part`;
    let last = null;
    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
      try {
        let have = partSize(id);
        if (have > size) {
          onBytes(-have);
          remove(part);
          have = 0;
        }
        if (have < size) {
          const controller = new AbortController();
          let stall = setTimeout(() => controller.abort(new Error("the download stopped arriving")), stallMs);
          const url = base + chunkAssetName(id);
          try {
            const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal, headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
            if (!response.ok) {
              const failure = new Error(`${chunkAssetName(id)}: the server answered ${response.status}`);
              failure.status = response.status;
              throw failure;
            }
            if (!landedSafely(response, url)) throw new Error("The download was redirected somewhere unsafe");
            const append = have > 0 && response.status === 206;
            if (!append && have > 0) {
              onBytes(-have);
              have = 0;
            }
            const handle = fs.openSync(part, append ? "a" : "w");
            try {
              for await (const piece of response.body) {
                clearTimeout(stall);
                stall = setTimeout(() => controller.abort(new Error("the download stopped arriving")), stallMs);
                if (have + piece.length > size) throw new Error(`${chunkAssetName(id)} is larger than the file list says`);
                fs.writeSync(handle, piece);
                have += piece.length;
                onBytes(piece.length);
              }
            } finally {
              fs.closeSync(handle);
            }
          } catch (error) {
            throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
          } finally {
            clearTimeout(stall);
          }
          if (have !== size) throw new Error(`${chunkAssetName(id)} stopped short`);
        }
        const data = fs.readFileSync(part);
        let raw = null;
        try {
          raw = data.length === size ? unpackChunk(data, manifest, id) : null;
        } catch {
          raw = null;
        }
        if (!raw || raw.length !== manifest.chunks[id] || sha256Of(raw) !== id) {
          onBytes(-data.length);
          remove(part);
          throw new Error(`${chunkAssetName(id)} is not the piece the file list names`);
        }
        fs.writeFileSync(`${file}.raw`, raw);
        fs.renameSync(`${file}.raw`, file);
        remove(part);
        return;
      } catch (error) {
        last = error;
        log("warn", `chunk ${chunkAssetName(id)} attempt ${attempt} of ${CHUNK_ATTEMPTS} failed: ${reasonOf(error)}`);
        if (error?.status === 404) break;
        if (attempt < CHUNK_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw new Error(`a piece of the update could not be downloaded (${reasonOf(last) || "it kept failing"})`);
  };

  const stageChunks = async (target) => {
    set({ state: "downloading", kind: "chunks", phase: "reading", percent: 0, receivedBytes: 0, downloadBytes: 0, fullBytes: target.size, note: "" });
    const plan = await planFor(target);
    const { manifest, manifestText, installedBuild } = planned;
    fs.mkdirSync(chunkDir, { recursive: true });
    const wanted = plan.fetch.filter((id) => !haveChunk(id, manifest.chunks[id]));
    let received = plan.fetchBytes - wanted.reduce((sum, id) => sum + wireSize(manifest, id), 0) + wanted.reduce((sum, id) => sum + Math.min(partSize(id), wireSize(manifest, id)), 0);
    let shown = -1;
    const report = (force = false) => {
      const percent = plan.fetchBytes ? Math.max(0, Math.min(99, Math.floor((received / plan.fetchBytes) * 100))) : 99;
      if (!force && percent === shown) return;
      shown = percent;
      set({ state: "downloading", kind: "chunks", phase: "downloading", percent, receivedBytes: Math.max(0, received), downloadBytes: plan.fetchBytes, fullBytes: target.size });
    };
    report(true);
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (next < wanted.length && !failure) {
        const id = wanted[next];
        next += 1;
        try {
          await fetchChunk(target.chunks.base, id, manifest, (bytes) => {
            received += bytes;
            report();
          });
        } catch (error) {
          failure = failure ?? error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNKS_AT_ONCE, wanted.length) }, worker));
    if (failure) throw failure;
    set({ state: "downloading", kind: "chunks", phase: "building", percent: 99, receivedBytes: plan.fetchBytes, downloadBytes: plan.fetchBytes, fullBytes: target.size });
    fs.mkdirSync(stagedRoot, { recursive: true });
    const dir = path.join(stagedRoot, target.build);
    const work = `${dir}.part`;
    remove(work);
    const files = path.join(work, "files");
    fs.mkdirSync(files, { recursive: true });
    const loaded = new Map();
    const chunkData = (id) => {
      if (!loaded.has(id)) loaded.set(id, fs.readFileSync(chunkFile(id)));
      return loaded.get(id);
    };
    const puts = [];
    try {
      for (const file of plan.build) {
        const parts = file.parts.map((part) => (part.local ? readSlice(part.local.file, part.local.offset, part.local.size) : chunkData(part.chunk).subarray(part.at, part.at + part.size)));
        const data = Buffer.concat(parts, file.size);
        if (sha256Of(data) !== file.sha256) throw new Error(`${file.path} could not be put together as the release published it`);
        const destination = path.join(files, ...file.path.split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, data);
        puts.push(file.path);
        if (file.parts.length > 1) for (const part of file.parts) loaded.delete(part.chunk);
      }
      fs.writeFileSync(path.join(files, INSTALLED_MANIFEST), manifestText);
      puts.push(INSTALLED_MANIFEST);
      const lines = [`install\t${installRoot}`, `build\t${target.build}`, `from\t${installedBuild || current.build}`, ...puts.map((name) => `put\t${name}`), ...plan.remove.map((name) => `remove\t${name}`), ""];
      fs.writeFileSync(path.join(work, "apply.txt"), lines.join("\r\n"), "utf8");
      fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ build: target.build, version: target.version, notes: target.notes, from: current.build, fetchBytes: plan.fetchBytes, totalBytes: plan.totalBytes, fullBytes: target.size, files: puts.length, removed: plan.remove.length }));
      if (ready.kind === "staged" && ready.dir !== dir) remove(ready.dir);
      remove(dir);
      fs.renameSync(work, dir);
      fs.writeFileSync(path.join(dir, "ready"), target.build);
    } catch (error) {
      remove(work);
      throw error;
    }
    remove(chunkDir);
    log("info", `update ${target.build}: ${puts.length} file(s) staged in ${dir}, ${plan.fetchBytes} bytes fetched`);
    return { dir, plan };
  };

  const run = async (atLaunch) => {
    set({ state: "checking", percent: 0, error: "", note: "" });
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
    set({ state: "available", percent: 0, version: target.version, build: target.build, error: "", kind: useChunks(target) ? "chunks" : "full", phase: "", receivedBytes: 0, downloadBytes: 0, fullBytes: target.size });
    try {
      if (useChunks(target)) {
        try {
          const { dir, plan } = await stageChunks(target);
          ready = { kind: "staged", build: target.build, dir, target };
          launchBuild = "";
          set({ state: "ready", percent: 100, version: target.version, build: target.build, kind: "chunks", phase: "", receivedBytes: plan.fetchBytes, downloadBytes: plan.fetchBytes, fullBytes: target.size });
          return;
        } catch (error) {
          log("warn", `update ${target.build}: the changed files could not be fetched (${reasonOf(error)}); downloading the full installer instead`);
          set({ state: "downloading", kind: "full", phase: "downloading", percent: 0, receivedBytes: 0, downloadBytes: target.size, fullBytes: target.size, note: `Only the changed files could not be downloaded (${reasonOf(error)}), so the whole installer is downloading instead.` });
        }
      }
      const file = await fetchSetup(target);
      ready = { kind: "full", build: target.build, file, target };
      launchBuild = "";
      set({ state: "ready", percent: 100, version: target.version, build: target.build, kind: "full", phase: "" });
    } catch (error) {
      if (launchBuild === target.build) countFailure(target);
      launchBuild = "";
      ready = { build: "", file: "", kind: "" };
      set({ state: "error", error: `${reasonOf(error)}.`, phase: "" });
    }
  };

  const download = ({ launch: atLaunch = false } = {}) => {
    if (!supported) {
      set({ state: "error", error: "This build cannot replace itself in place." });
      return { started: false };
    }
    if (atLaunch) launchBuild = status.build || latest?.build || "pending";
    if (running) return { started: true, already: true };
    if (status.state === "ready" && ready.build && (!latest || ready.build === latest.build)) {
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

  const rememberInstall = (target) => writeRecord(installedRecordFile, { build: target.build, version: text(target.version), notes: text(target.notes), at: new Date(now()).toISOString() });

  const start = async (file, args, cwd) => {
    const child = scripted
      ? spawnImpl(nodePath, [file, ...args, "--wait", waitPids.filter((pid) => Number.isSafeInteger(pid) && pid > 1).join(",")], { cwd, detached: true, stdio: "ignore" })
      : spawnImpl(file, args, { cwd, detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child;
  };

  const install = async ({ launch: atLaunch = false, relaunch = true } = {}) => {
    if (status.state !== "ready" || !ready.build || ready.build !== status.build) throw new Error("No downloaded update is ready to install.");
    if (!canInstall()) throw new Error("This copy of the game was not installed by its installer, so it cannot replace itself.");
    const target = ready.target && ready.target.build === ready.build ? ready.target : null;
    if (scripted && applied && !pendingRollback) {
      try {
        fs.writeFileSync(path.join(applied.dir, "confirmed"), current.build);
      } catch {
        log("warn", "update: the start could not be confirmed before the next update");
      }
    }
    if (ready.kind === "staged") {
      const dir = ready.dir;
      if (!target || !exists(path.join(dir, "ready")) || !exists(path.join(dir, "apply.txt"))) {
        ready = { build: "", file: "", kind: "" };
        set({ state: "error", error: "The downloaded update is no longer complete, so it was not applied." });
        throw new Error(status.error);
      }
      const updaterFile = mac ? MAC_UPDATER : linux ? LINUX_UPDATER : UPDATER_EXE;
      const staged = path.join(dir, "files", ...updaterFile.split("/"));
      const source = exists(staged) ? staged : path.join(installRoot, ...updaterFile.split("/"));
      const updater = path.join(dir, updaterName);
      try {
        fs.copyFileSync(source, updater);
      } catch (error) {
        set({ state: "error", error: `The updater could not be prepared: ${reasonOf(error)}.` });
        throw new Error(status.error);
      }
      if (atLaunch) countFailure(target);
      rememberInstall(target);
      const args = ["--apply-staged", dir];
      if (!relaunch) args.push("--no-relaunch");
      try {
        const child = await start(updater, args, dir);
        log("info", `update ${target.build} is being applied from ${dir}`);
        return { installing: true, kind: "staged", version: target.version, build: target.build, pid: child.pid ?? 0 };
      } catch (error) {
        set({ state: "error", error: `The updater could not be started: ${reasonOf(error)}.` });
        throw new Error(status.error);
      }
    }
    if (!target || !(await verified(ready.file, target))) {
      ready = { build: "", file: "", kind: "" };
      set({ state: "error", error: "The downloaded update was changed after it was checked, so it was not run." });
      throw new Error(status.error);
    }
    if (atLaunch) countFailure(target);
    rememberInstall(target);
    const args = ["--update", installRoot];
    let program = ready.file;
    if (scripted) {
      program = path.join(path.dirname(ready.file), updaterName);
      try {
        fs.copyFileSync(path.join(installRoot, ...(mac ? MAC_UPDATER : LINUX_UPDATER).split("/")), program);
      } catch (error) {
        set({ state: "error", error: `The updater could not be prepared: ${reasonOf(error)}.` });
        throw new Error(status.error);
      }
      args.push(mac ? "--zip" : "--archive", ready.file);
    }
    if (!relaunch) args.push("--no-relaunch");
    try {
      const child = await start(program, args, path.dirname(ready.file));
      log("info", `update ${target.build} is installing into ${installRoot}`);
      return { installing: true, kind: "full", version: target.version, build: target.build, pid: child.pid ?? 0 };
    } catch (error) {
      set({ state: "error", error: `The downloaded update could not be started: ${reasonOf(error)}.` });
      throw new Error(status.error);
    }
  };

  const confirm = () => {
    if (!applied || pendingRollback) return { confirmed: false };
    try {
      fs.writeFileSync(path.join(applied.dir, "confirmed"), current.build);
    } catch {
      log("warn", "update: the start could not be confirmed");
    }
    const dir = applied.dir;
    dropPrevious(dir);
    let tries = 0;
    const sweep = () => {
      tries += 1;
      if (remove(dir) && !exists(dir)) {
        log("info", `update ${current.build} started properly; the files it replaced were removed`);
        return;
      }
      if (tries < 60) setTimeout(sweep, 1000).unref?.();
      else log("warn", `update: ${dir} could not be removed yet; the next start removes it`);
    };
    sweep();
    const build = applied.build;
    applied = null;
    return { confirmed: true, build };
  };

  const rollback = async ({ relaunch = true } = {}) => {
    const target = pendingRollback ?? applied;
    if (!target) throw new Error("There is no update to undo.");
    const updater = path.join(target.dir, updaterName);
    if (!exists(updater)) throw new Error("The updater that applied this update is gone, so it cannot be undone.");
    const args = ["--rollback", target.dir];
    if (!relaunch) args.push("--no-relaunch");
    const child = await start(updater, args, target.dir);
    log("warn", `update ${target.build} did not start ${target.boots} time(s); the previous files are being put back`);
    return { rollingBack: true, build: target.build, pid: child.pid ?? 0 };
  };

  const seen = () => {
    justUpdated = null;
    rolledBack = "";
    remove(installedRecordFile);
    publish();
    return true;
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

  scan();

  return { supported, snapshot, check, prefetch, launch, download, later, install, confirm, rollback, seen, dismiss, canInstall, idle: () => running ?? Promise.resolve() };
};

export const register = (ctx) => {
  const versionFile = text(process.env.OH_NATIVE_VERSION_FILE) || path.resolve(here, "..", "..", "godot", "version.json");
  const current = readVersionFile(versionFile);
  const installRoot = path.resolve(text(process.env.OH_NATIVE_INSTALL_DIR) || path.resolve(here, "..", "..", ".."));
  const log = (level, message) => process.stderr.write(`[update] ${level}: ${message}\n`);
  const retry = Number(process.env.OH_NATIVE_UPDATE_RETRY_MS);
  const updater = createUpdater({
    current,
    manifestUrl: manifestUrlFor(process.env),
    downloadDir: path.join(ctx.cacheDir, "updates"),
    recordFile: path.join(ctx.dataRoot, "launch-update.json"),
    installRoot,
    storage: ctx.storage,
    emit: ctx.emit,
    log,
    ...(Number.isFinite(retry) && retry >= 0 ? { retryDelayMs: retry } : {}),
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
    "update.confirm": async () => updater.confirm(),
    "update.rollback": async ({ relaunch = true } = {}) => updater.rollback({ relaunch: relaunch !== false }),
    "update.seen": async () => updater.seen(),
    "update.dismiss": async ({ build = "" } = {}) => updater.dismiss(build),
  };
};
