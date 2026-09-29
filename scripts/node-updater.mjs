/*! Open Historia — node auto-updater (TUF-style) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Keeps a content node's software up to date and tamper-proof. It polls a signed
// update manifest + a short-lived signed timestamp, verifies both against the
// pinned root key, and only applies an update that is: validly signed, for this
// channel, MONOTONICALLY newer than what's installed (no rollback), at least as
// new as the timestamp says (no freeze), and not expired. Artifacts are
// downloaded and hash-verified into a staging folder, and the operator's apply
// hook (OH_NODE_APPLY) swaps them in and restarts the service. The new version
// is recorded only once that hook has exited 0, so a failed or missing apply
// leaves the node on its old version and the update is offered again.
//
//   OH_UPDATE_BASE_URL=https://updates.example/stable OH_NODE_APPLY=./apply.sh node scripts/node-updater.mjs
//   OH_UPDATE_ONCE=1 ... node scripts/node-updater.mjs   # single check, then exit
//
// The hook runs through the shell in the install folder, with OH_NODE_STAGED_DIR
// (the verified files), OH_NODE_VERSION and OH_NODE_INSTALL_DIR in its env.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import url from "node:url";
import { verifySignedManifest } from "../server/trust.js";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.OH_UPDATE_BASE_URL || "").replace(/\/$/, "");
const CHANNEL = process.env.OH_UPDATE_CHANNEL || "stable";
const INSTALL_DIR = path.resolve(process.env.OH_NODE_INSTALL_DIR || ROOT);
const APPLY_COMMAND = process.env.OH_NODE_APPLY || "";
const POLL_MS = Number(process.env.OH_UPDATE_POLL_MS) || 3600000; // hourly

// The APPLIED version: written only after the apply hook succeeded.
const statePath = (installDir) => path.join(installDir, ".node-version.json");

export const readInstalledVersion = (installDir = INSTALL_DIR) => {
  try {
    return Number(JSON.parse(readFileSync(statePath(installDir), "utf8")).version) || 0;
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

// Every artifact must carry a sha256: the signed manifest vouches for the bytes
// only through it, so one without is refused rather than installed unchecked.
// Nothing is staged unless every artifact passes.
const downloadArtifacts = async (manifest, stageDir, fetchImpl) => {
  const artifacts = manifest.artifacts ?? [];
  for (const artifact of artifacts) {
    if (typeof artifact?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      throw new Error(`artifact ${artifact?.path ?? "(unnamed)"} has no sha256 in the signed manifest`);
    }
    if (!path.resolve(stageDir, String(artifact.path ?? "")).startsWith(stageDir + path.sep)) {
      throw new Error(`artifact ${artifact.path} would be written outside the staging folder`);
    }
  }
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  for (const artifact of artifacts) {
    const bytes = await fetchImpl(artifact.url);
    if (sha256(bytes) !== artifact.sha256.toLowerCase()) {
      throw new Error(`artifact ${artifact.path} failed hash check`);
    }
    const dest = path.resolve(stageDir, artifact.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
};

// Runs the operator's apply hook and resolves with its exit code (-1 when it
// could not start).
const runApplyHook = (command, { stageDir, version, installDir }) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: installDir,
      stdio: "inherit",
      env: {
        ...process.env,
        OH_NODE_STAGED_DIR: stageDir,
        OH_NODE_VERSION: String(version),
        OH_NODE_INSTALL_DIR: installDir,
      },
    });
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? -1));
  });

// Stage a verified update and apply it; resolves with { applied, reason,
// stageDir }. The version is recorded only when the hook exited 0. Any failure
// leaves the state file alone, so the same update is offered, downloaded and
// applied again on the next check. (The swap, and any backup and rollback of
// the running install, belong to the hook: it is the part that knows how the
// service is run.) Exported, with fetch and the hook injectable, for tests.
export const stageAndApply = async ({
  version,
  updateManifest,
  installDir = INSTALL_DIR,
  applyCommand = APPLY_COMMAND,
  fetchImpl = fetchBytes,
  runApply = runApplyHook,
}) => {
  const stageDir = path.join(installDir, `.staged-${version}`);
  await downloadArtifacts(updateManifest, stageDir, fetchImpl);
  if (!applyCommand) {
    console.log(`Staged v${version} at ${stageDir}. Set OH_NODE_APPLY to a command that swaps it in and restarts the node; it is not recorded as installed until that runs.`);
    return { applied: false, reason: "no-apply-hook", stageDir };
  }
  const code = await runApply(applyCommand, { stageDir, version, installDir });
  if (code !== 0) {
    console.error(`OH_NODE_APPLY exited ${code}; staying on v${readInstalledVersion(installDir)} and retrying v${version} on the next check.`);
    return { applied: false, reason: "apply-failed", stageDir };
  }
  writeFileSync(statePath(installDir), `${JSON.stringify({ version, appliedAt: new Date().toISOString() }, null, 2)}\n`);
  rmSync(stageDir, { recursive: true, force: true });
  console.log(`Applied v${version}.`);
  return { applied: true, reason: "applied", stageDir };
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

  const { applied } = await stageAndApply({ version: decision.version, updateManifest });
  return applied;
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
