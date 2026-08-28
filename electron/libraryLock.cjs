/*! Open Historia — shared save-library lock © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Two desktop builds, ONE save library.
//
// The fork's beta installs alongside the official app and deliberately shares its
// saves, scenarios and settings (see USER_ROOT in main.cjs), so a player can play a
// campaign in the beta and carry on in the stable app. The cost of that is that the
// two must never write it at once: both run an embedded server over the same JSON
// files, and the loser of a race silently loses a turn.
//
// Electron's own requestSingleInstanceLock is keyed on the app's userData, which is
// exactly what the beta renames apart — so it cannot see the other install at all.
// Hence this file lock.
//
// Lives here rather than inline in main.cjs so it can be tested: main.cjs requires
// electron and cannot be loaded by `node --test`. `ask` is injected for the same
// reason — main.cjs passes the real dialog.
const fs = require("node:fs");
const path = require("node:path");

// Who currently holds the library, or null if nobody does.
//
// A lock file whose process is gone is not a holder: a crash or a force-kill never
// runs the release, and refusing to start after one would be worse than the race
// this guards against.
const lockHolder = (lockFile, { pid: selfPid = process.pid, isRunning = defaultIsRunning } = {}) => {
  let held;
  try {
    held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch {
    return null; // no lock, or an unreadable one: not evidence of anything
  }
  const pid = Number(held && held.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!isRunning(pid)) return null;
  if (pid === selfPid) return null;
  return String(held.label || "Another copy of Open Historia");
};

// Signal 0 tests for the process without touching it. EPERM means it exists and
// belongs to someone else, which still counts as running.
function defaultIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Claim the library for this build.
//
// `ask(holder)` is called only when someone else holds it, and returns true if the
// player chose to start anyway. Returns false when they chose to quit instead.
const claimSharedLibrary = (lockFile, { label, ask, pid = process.pid, isRunning } = {}) => {
  const holder = lockHolder(lockFile, { pid, isRunning });
  if (holder) {
    if (!ask(holder)) return false;

    // "Start anyway": the other build KEEPS the lock.
    //
    // This used to fall through and write the file unconditionally, overwriting the
    // holder's pid with ours — and releaseSharedLibrary would then delete it on our
    // quit while that build was still running, so the next launch got no warning at
    // all with two copies still sharing one library. The record names whoever
    // claimed it first, which is exactly who a third launch needs to be told about.
    return true;
  }

  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify({ pid, label, at: Date.now() }));
  } catch {
    /* an unwritable lock is not a reason to keep a player out of the game */
  }
  return true;
};

// Drop the lock, but only if it is still ours: after a "start anyway" it belongs to
// the other build, and stealing its release would leave a third launch unwarned.
const releaseSharedLibrary = (lockFile, { pid = process.pid } = {}) => {
  try {
    if (JSON.parse(fs.readFileSync(lockFile, "utf8")).pid === pid) fs.rmSync(lockFile);
  } catch {
    /* already gone, or never written */
  }
};

module.exports = { claimSharedLibrary, lockHolder, releaseSharedLibrary };
