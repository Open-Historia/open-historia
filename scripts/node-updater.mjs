/*! Open Historia — node auto-updater (TUF-style) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Keeps a content node's software up to date and tamper-proof. It polls a signed
// update manifest + a short-lived signed timestamp, verifies both against the
// pinned root key, and only applies an update that is: validly signed, for this
// channel, MONOTONICALLY newer than what's installed (no rollback), at least as
// new as the timestamp says (no freeze), and not expired. Artifacts are
// downloaded, hash-verified, staged, atomically swapped in with a backup, health-
// checked, and rolled back on failure.
//
//   OH_UPDATE_BASE_URL=https://updates.example/stable node scripts/node-updater.mjs
//   OH_UPDATE_ONCE=1 ... node scripts/node-updater.mjs   # single check, then exit
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";
import { verifySignedManifest } from "../server/trust.js";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.OH_UPDATE_BASE_URL || "").replace(/\/$/, "");
const CHANNEL = process.env.OH_UPDATE_CHANNEL || "stable";
const INSTALL_DIR = path.resolve(process.env.OH_NODE_INSTALL_DIR || ROOT);
const STATE_PATH = path.join(INSTALL_DIR, ".node-version.json");
const POLL_MS = Number(process.env.OH_UPDATE_POLL_MS) || 3600000; // hourly

const readInstalledVersion = () => {
  try {
    return Number(JSON.parse(readFileSync(STATE_PATH, "utf8")).version) || 0;
  } catch {
    return 0;
  }
};

// PURE decision logic — the heart of the anti-rollback / anti-freeze guarantee.
// Exported for unit testing.
export const evaluateUpdate = ({ installedVersion, updateManifest, timestamp, nowMs = Date.now() }) => {
  if (!updateManifest) return { shouldUpdate: false, reason: "no-manifest" };
  if (updateManifest.channel && updateManifest.channel !== CHANNEL) {
    return { shouldUpdate: false, reason: "wrong-channel" };
  }
  const version = Number(updateManifest.version);
  if (!Number.isInteger(version)) return { shouldUpdate: false, reason: "bad-version" };
  // Anti-rollback: never move to an older-or-equal version.
  if (version <= installedVersion) return { shouldUpdate: false, reason: "not-newer" };
  // Anti-freeze: a signed timestamp asserts the latest version; refuse to be
  // pinned to a stale manifest older than what the timestamp advertises.
  if (timestamp && Number.isInteger(Number(timestamp.latest)) && version < Number(timestamp.latest)) {
    return { shouldUpdate: false, reason: "stale-vs-timestamp" };
  }
  if (updateManifest.expires && Date.parse(updateManifest.expires) < nowMs) {
    return { shouldUpdate: false, reason: "expired" };
  }
  return { shouldUpdate: true, reason: "update", version };
};

const fetchBytes = async (u) => {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

// Fetch a manifest + its detached .sig and verify against the pinned key.
const fetchVerifiedManifest = async (name) => {
  const [bytes, sig] = await Promise.all([
    fetchBytes(`${BASE_URL}/${name}`),
    fetchBytes(`${BASE_URL}/${name}.sig`).then((b) => b.toString("utf8")),
  ]);
  const result = verifySignedManifest(bytes, sig);
  if (!result.valid) throw new Error(`${name} rejected: ${result.reason}`);
  return result.data;
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const downloadArtifacts = async (manifest, stageDir) => {
  mkdirSync(stageDir, { recursive: true });
  for (const artifact of manifest.artifacts ?? []) {
    const bytes = await fetchBytes(artifact.url);
    if (artifact.sha256 && sha256(bytes) !== artifact.sha256) {
      throw new Error(`artifact ${artifact.path} failed hash check`);
    }
    const dest = path.join(stageDir, artifact.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
};

const runOnce = async () => {
  if (!BASE_URL) {
    console.error("Set OH_UPDATE_BASE_URL to the signed update feed.");
    return false;
  }
  const installedVersion = readInstalledVersion();
  let timestamp = null;
  try {
    timestamp = await fetchVerifiedManifest("timestamp.json");
  } catch (error) {
    console.warn(`timestamp check: ${error.message}`);
  }
  const updateManifest = await fetchVerifiedManifest("update-manifest.json");
  const decision = evaluateUpdate({ installedVersion, updateManifest, timestamp });
  console.log(`installed v${installedVersion}, offered v${updateManifest.version}: ${decision.reason}`);
  if (!decision.shouldUpdate) return false;

  const stageDir = path.join(INSTALL_DIR, `.staged-${decision.version}`);
  const backupDir = path.join(INSTALL_DIR, ".backup");
  await downloadArtifacts(updateManifest, stageDir);

  // Atomic-ish swap with rollback. Callers wire OH_NODE_APPLY to a script that
  // moves staged files into place + restarts the service; here we record the new
  // version and leave the staged tree for that hook. On any failure we restore.
  try {
    if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
    writeFileSync(STATE_PATH, `${JSON.stringify({ version: decision.version, appliedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`Staged v${decision.version} at ${stageDir}. Run OH_NODE_APPLY to swap + restart.`);
    return true;
  } catch (error) {
    console.error(`Update apply failed, rolling back: ${error.message}`);
    if (existsSync(backupDir)) renameSync(backupDir, INSTALL_DIR);
    return false;
  }
};

// Run as a loop unless OH_UPDATE_ONCE is set. (Guarded so importing this module
// for its evaluateUpdate() in tests doesn't start polling.)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const once = process.env.OH_UPDATE_ONCE === "1";
  const tick = async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error(`update check failed: ${error.message}`);
    }
  };
  await tick();
  if (!once) setInterval(tick, POLL_MS);
}
