/*! Open Historia — which copy of the app's files a start runs from © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The installer puts the app's files in app.asar. An update made of chunks
// (electron/payloadUpdate.cjs) puts a newer set in the player's data folder,
// under app-payload/<build>, and electron/bootstrap.cjs asks here, at every
// start, which of the two to run.
//
// The newer set is run only when all of this holds:
//   - it was finished and checked (app-payload/current.json names it, and
//     that file is written last);
//   - it is newer than what the installer put down, so an installer run since
//     then wins, whatever is in the data folder;
//   - it was built for this runtime: the same Electron, and the same PROTOCOL;
//   - the app has not already failed to start from it twice. A start counts
//     as failed until the game's window has loaded (confirmBoot).
// Otherwise the installed files run, exactly as they did before any of this.
//
// DELIBERATELY DEPENDENCY-FREE, and it must stay loadable by an old bootstrap:
// the bootstrap that runs is always the installed one, never the newer set's.

const nodeFs = require("node:fs");
const nodePath = require("node:path");

// What a set of files may assume about the app around it, beyond the Electron
// version: how it is started, where it is kept, what the bootstrap gives it.
// Raise it when a release changes any of that (or anything else the installer
// alone can change: packaging, files kept outside the archive), and every app
// below it updates with the installer instead.
const PROTOCOL = 1;

const PAYLOAD_FOLDER = "app-payload";
const CURRENT_FILE = "current.json";
const STATE_FILE = "state.json";
const MANIFEST_FILE = "payload.json";
const ENTRY_FILE = "electron/main.cjs";
const MAX_BOOT_ATTEMPTS = 2;

const readJson = (file, fs = nodeFs) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

// Whole or not at all: a file half written by a crash would read as no file.
const writeJsonAtomically = (file, value, fs = nodeFs) => {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  fs.writeFileSync(partial, JSON.stringify(value));
  fs.renameSync(partial, file);
};

// Build ids are the release workflow's run ids: whole numbers that only grow.
// Anything else (a dev build's empty id) sorts below every number.
const compareBuilds = (left, right) => {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  const numeric = (text) => /^\d+$/.test(text);
  if (numeric(a) && numeric(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (numeric(a) !== numeric(b)) return numeric(a) ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const sameShell = (left, right) => Boolean(left && right)
  && String(left.electron ?? "") !== ""
  && String(left.electron) === String(right.electron)
  && Number(left.protocol) === Number(right.protocol);

const shellOf = (versions = process.versions) => ({ electron: String(versions.electron ?? ""), protocol: PROTOCOL });

const readState = (payloadDir, fs = nodeFs) => {
  const state = readJson(nodePath.join(payloadDir, STATE_FILE), fs) ?? {};
  return { badBuilds: Array.isArray(state.badBuilds) ? state.badBuilds.map(String) : [] };
};

// A set the app could not start from is never run again and never fetched
// again: that release reaches this install through the installer.
const markBad = (payloadDir, build, fs = nodeFs) => {
  try {
    const state = readState(payloadDir, fs);
    if (!state.badBuilds.includes(String(build))) state.badBuilds.push(String(build));
    writeJsonAtomically(nodePath.join(payloadDir, STATE_FILE), { badBuilds: state.badBuilds.slice(-20) }, fs);
    fs.rmSync(nodePath.join(payloadDir, CURRENT_FILE), { force: true });
  } catch {
    /* best effort: the attempts count still stops it */
  }
};

// -> { root, build, reason }: root is the folder to run from, or null for the
// installed files; reason says why, for the log.
const choosePayload = ({ payloadDir, bundledBuild, shell, fs = nodeFs }) => {
  const current = readJson(nodePath.join(payloadDir, CURRENT_FILE), fs);
  if (!current?.build) return { root: null, build: "", reason: "none" };
  const build = String(current.build);
  // A name, never a path: it is joined to the folder below.
  if (!/^[\w.-]+$/.test(build)) return { root: null, build, reason: "unreadable" };
  if (readState(payloadDir, fs).badBuilds.includes(build)) return { root: null, build, reason: "failed-before" };
  if (!sameShell(current.shell, shell)) return { root: null, build, reason: "other-runtime" };
  if (compareBuilds(build, bundledBuild) <= 0) return { root: null, build, reason: "installed-is-newer" };
  const root = nodePath.join(payloadDir, build);
  const manifest = readJson(nodePath.join(root, MANIFEST_FILE), fs);
  if (String(manifest?.build ?? "") !== build || !fs.existsSync(nodePath.join(root, ...ENTRY_FILE.split("/")))) {
    return { root: null, build, reason: "incomplete" };
  }
  if ((Number(current.attempts) || 0) >= MAX_BOOT_ATTEMPTS) {
    markBad(payloadDir, build, fs);
    return { root: null, build, reason: "would-not-start" };
  }
  return { root, build, reason: "newer" };
};

// Counted before the newer set is loaded, and cleared once the game's window
// is up: a set that crashes on the way there is counted and, the second time,
// given up on.
const beginBoot = (payloadDir, fs = nodeFs) => {
  const file = nodePath.join(payloadDir, CURRENT_FILE);
  const current = readJson(file, fs);
  if (current) writeJsonAtomically(file, { ...current, attempts: (Number(current.attempts) || 0) + 1 }, fs);
};
const confirmBoot = (payloadDir, fs = nodeFs) => {
  const file = nodePath.join(payloadDir, CURRENT_FILE);
  const current = readJson(file, fs);
  if (current && Number(current.attempts)) writeJsonAtomically(file, { ...current, attempts: 0 }, fs);
};

// Sets no start will run again: every build's folder but `keep`, and a
// half-built one. The chunks an unfinished download left are kept for it.
const sweep = (payloadDir, keep, fs = nodeFs) => {
  let names = [];
  try {
    names = fs.readdirSync(payloadDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name === "chunks" || entry.name === String(keep ?? "")) continue;
    try {
      fs.rmSync(nodePath.join(payloadDir, entry.name), { recursive: true, force: true });
    } catch {
      /* in use, or not ours to remove: the next start tries again */
    }
  }
};

module.exports = {
  CURRENT_FILE,
  ENTRY_FILE,
  MANIFEST_FILE,
  MAX_BOOT_ATTEMPTS,
  PAYLOAD_FOLDER,
  PROTOCOL,
  STATE_FILE,
  beginBoot,
  choosePayload,
  compareBuilds,
  confirmBoot,
  markBad,
  readJson,
  readState,
  sameShell,
  shellOf,
  sweep,
  writeJsonAtomically,
};
