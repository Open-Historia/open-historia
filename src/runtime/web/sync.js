/*! Open Historia — web-mode encrypted sync engine © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Reconciles the browser's games + scenarios (and their catalog manifests) with
// the registry Worker's encrypted blob store. Everything is AES-256-GCM encrypted
// client-side (account.js) before it leaves the device, so the blob store holds
// ciphertext — but the key ring does not stay on the device (account.js uploads
// the DEK so other devices can sync), so this is encryption at rest, not
// end-to-end. See the header of account.js.
//
// Uses a full-scan model (compare local SHA-256 vs the last synced version) so no
// write can be missed — no fragile idb write hooks. Web build only.

import { idbGet, idbGetAll, idbGetAllKeys, idbPut, idbDelete, kvGet, kvPut, STORES } from "./idb.js";
import {
  accountConfigured, isSignedIn, getDek, recordFingerprint, encryptRecord, decryptRecord,
  syncManifest, syncGetBlob, syncPutBlob, syncDeleteBlob,
} from "./account.js";

// v1 scope: games + scenarios (the "save my playthrough" need). Map-editor docs
// and basemaps (large) wait for R2. Each record → one blob; catalog manifests too.
const SYNCED_STORES = [
  { store: STORES.games, prefix: "games:" },
  { store: STORES.scenarios, prefix: "scenarios:" },
];
const KV_MANIFESTS = ["game-manifest", "scenario-manifest"];
const VERSIONS_KEY = "sync:versions"; // { blob_id: { version, sha?, deleted? } } — device-local, never synced

const blobIdParts = (blobId) => {
  const i = blobId.indexOf(":");
  return { kind: blobId.slice(0, i), id: blobId.slice(i + 1) };
};

// Fingerprinting a record base64-encodes and SHA-256s its ENTIRE content (world,
// events, snapshots, any embedded assets) on the main thread — expensive. The full
// scan runs every ~20s, so re-hashing records that have NOT changed is the dominant
// sync cost and the "menu lags much more when logged in" symptom. Every content write
// bumps meta.updatedAt (writeGameMeta/writeScenarioMeta in libraryStore), so memoize
// the hash on it: an unchanged record reuses its last hash and skips the re-encode.
const fingerprintCache = new Map(); // blobId -> { updatedAt, sha }
const cachedFingerprint = async (blobId, rec) => {
  const updatedAt = rec?.meta?.updatedAt;
  const hit = fingerprintCache.get(blobId);
  if (hit && updatedAt != null && hit.updatedAt === updatedAt) return hit.sha;
  const sha = await recordFingerprint(rec);
  fingerprintCache.set(blobId, { updatedAt: updatedAt ?? null, sha });
  return sha;
};

// Read every syncable local record as blob_id → { rec, sha }. `versions` (the last-
// synced state) lets us RELEASE the full record for anything that hasn't changed, so a
// store of ~100MB scenario records is never held in memory all at once — the every-20s
// twin of the menu OOM. Every record is still fingerprinted, so no change is missed.
const collectLocal = async (versions = {}) => {
  const local = new Map();
  for (const { store, prefix } of SYNCED_STORES) {
    // Keys-only, then one idbGet at a time (peak = a single record, not the whole store).
    for (const id of await idbGetAllKeys(store)) {
      const blobId = prefix + id;
      // Skip (don't abort the whole sync over) a record that can't be
      // fingerprinted, e.g. one holding a value JSON can't serialize.
      try {
        const rec = await idbGet(store, id);
        if (!rec) continue;
        const sha = await cachedFingerprint(blobId, rec);
        const known = versions[blobId];
        // Retain the full record only when push will actually upload it (new/changed);
        // otherwise drop it now. push skips unchanged via known.sha===sha before it
        // ever reads rec, so null here is safe.
        local.set(blobId, { sha, rec: known && !known.deleted && known.sha === sha ? null : rec });
      } catch (e) { console.warn(`[sync] skip local ${prefix}${id}: ${e.message}`); }
    }
  }
  for (const name of KV_MANIFESTS) {
    const value = await kvGet(name, undefined);
    if (value !== undefined) {
      const rec = { key: name, value };
      try { local.set(`kv:${name}`, { rec, sha: await recordFingerprint(rec) }); }
      catch (e) { console.warn(`[sync] skip local kv:${name}: ${e.message}`); }
    }
  }
  return local;
};

const applyBlob = async (blobId, rec) => {
  const { kind } = blobIdParts(blobId);
  if (kind === "games") await idbPut(STORES.games, rec);
  else if (kind === "scenarios") await idbPut(STORES.scenarios, rec);
  else if (kind === "kv") await kvPut(rec.key, rec.value);
};

const deleteLocal = async (blobId) => {
  const { kind, id } = blobIdParts(blobId);
  if (kind === "games") await idbDelete(STORES.games, id);
  else if (kind === "scenarios") await idbDelete(STORES.scenarios, id);
  // kv manifests are never deleted (they always exist) — ignore.
};

// Pull server changes newer than what we last synced.
const pull = async (versions, onWork) => {
  // syncManifest() is intentionally outside the try — an auth/network failure
  // there is a real, whole-sync error. A single BAD BLOB (e.g. one that won't
  // decrypt) is caught per-item so it can't red-line the whole sync.
  for (const s of await syncManifest()) {
    try {
      const known = versions[s.blob_id];
      if (known && s.version <= known.version) continue;
      // A newer server version to apply — real work, so the widget may show it.
      onWork?.();
      if (s.deleted) {
        await deleteLocal(s.blob_id);
        versions[s.blob_id] = { version: s.version, deleted: true };
        continue;
      }
      const blob = await syncGetBlob(s.blob_id);
      if (!blob || blob.deleted) { versions[s.blob_id] = { version: s.version, deleted: true }; continue; }
      await applyBlob(s.blob_id, await decryptRecord(blob.ciphertext));
      versions[s.blob_id] = { version: s.version, sha: blob.sha256 };
    } catch (e) { console.warn(`[sync] skip incoming ${s.blob_id}: ${e.message}`); }
  }
};

// Push local changes; last-writer-wins on conflict (take the server copy).
const push = async (versions, onWork) => {
  const local = await collectLocal(versions);
  // upserts (new or locally-changed records) — each isolated so one bad record
  // (unserializable, too large, a decrypt conflict) can't fail the whole sync.
  for (const [blobId, { rec, sha }] of local) {
    try {
      const known = versions[blobId];
      if (known && !known.deleted && known.sha === sha) continue;
      // This record's syncable content actually changed — a real upload.
      onWork?.();
      const { ciphertext, sha256 } = await encryptRecord(rec);
      const res = await syncPutBlob(blobId, ciphertext, sha256, known?.version || 0);
      if (res.status === 200) versions[blobId] = { version: res.version, sha: sha256 };
      else if (res.status === 409 && res.current) {
        if (res.current.deleted) { await deleteLocal(blobId); versions[blobId] = { version: res.current.version, deleted: true }; }
        else { await applyBlob(blobId, await decryptRecord(res.current.ciphertext)); versions[blobId] = { version: res.current.version, sha: res.current.sha256 }; }
      } else if (res.status === 413) {
        console.warn(`[sync] ${blobId} is too large to sync right now (large items sync once R2 is enabled).`);
      } else if (res.status !== 200) {
        console.warn(`[sync] ${blobId} push returned ${res.status}${res.error ? ": " + res.error : ""}`);
      }
    } catch (e) { console.warn(`[sync] skip outgoing ${blobId}: ${e.message}`); }
  }
  // tombstones: records we synced before that are gone locally now
  for (const [blobId, known] of Object.entries(versions)) {
    if (known.deleted || local.has(blobId) || blobId.startsWith("kv:")) continue;
    try {
      onWork?.();
      const res = await syncDeleteBlob(blobId, known.version);
      if (res.status === 200) versions[blobId] = { version: res.version, deleted: true };
      else if (res.status === 409 && res.current) {
        if (res.current.deleted) versions[blobId] = { version: res.current.version, deleted: true };
        else { await applyBlob(blobId, await decryptRecord(res.current.ciphertext)); versions[blobId] = { version: res.current.version, sha: res.current.sha256 }; }
      }
    } catch (e) { console.warn(`[sync] skip delete ${blobId}: ${e.message}`); }
  }
};

let running = false;
let rerunRequested = false;
export const syncNow = async () => {
  // A trigger that arrives mid-sync (e.g. a turn completes while a pull is in flight)
  // sets a rerun flag instead of being dropped, so its change isn't stranded until
  // the next trigger — with the poll gone, a dropped trigger would mean a lost backup.
  if (running) { rerunRequested = true; return; }
  if (!accountConfigured() || !(await isSignedIn()) || !(await getDek())) return;
  running = true;
  try {
    do {
      rerunRequested = false;
      // Show "Syncing…" only once a real transfer starts. Sync runs on sign-in, after
      // each turn, and on tab hide — an empty pass with nothing to move must not flash
      // the widget as if it were uploading ("why is it syncing when I did nothing").
      let announcedWork = false;
      const onWork = () => {
        if (announcedWork) return;
        announcedWork = true;
        window.dispatchEvent(new CustomEvent("oh:sync", { detail: { state: "syncing" } }));
      };
      try {
        const versions = await kvGet(VERSIONS_KEY, {});
        await pull(versions, onWork);
        await push(versions, onWork);
        await kvPut(VERSIONS_KEY, versions);
        window.dispatchEvent(new CustomEvent("oh:sync", { detail: { state: "ok", at: Date.now() } }));
      } catch (error) {
        console.warn("[sync]", error.message);
        window.dispatchEvent(new CustomEvent("oh:sync", { detail: { state: "error", error: error.message } }));
      }
    } while (rerunRequested);
  } finally {
    running = false;
  }
};

// Sync is event-driven, not polled: once at sign-in/load, after every turn completes
// (the game dispatches "oh:turn-complete" once its new state is persisted), and when
// the tab is hidden. This replaced a fixed 20s poll that was ~80-90% of this Worker's
// request load; the full-scan model means one pass still catches every change.
const onTurnComplete = () => { syncNow(); };
const onVisibility = () => { if (document.visibilityState === "hidden") syncNow(); };
let wired = false;
export const startSync = async () => {
  if (!accountConfigured()) return;
  await syncNow();
  if (wired) return; // startSync can fire again on re-auth — don't stack listeners
  wired = true;
  window.addEventListener("oh:turn-complete", onTurnComplete);
  document.addEventListener("visibilitychange", onVisibility);
};

export const stopSync = () => {
  if (!wired) return;
  wired = false;
  window.removeEventListener("oh:turn-complete", onTurnComplete);
  document.removeEventListener("visibilitychange", onVisibility);
};
