/*! Open Historia Continuum — Political World v2 checkpoint persistence
 *
 * Checkpoints are workspace state, never scenario canon. They live in their own
 * IndexedDB store and are mirrored into a JSON backup store. The JSON mirror is
 * deliberate: if a browser rejects structured-cloning one field in the primary
 * object store, we still retain a durable serialized recovery copy instead of
 * silently falling back to volatile memory.
 */

import {
  POLITICAL_WORLD_V2_CHECKPOINT_KIND,
  POLITICAL_WORLD_V2_CHECKPOINT_VERSION,
  isPoliticalWorldV2Checkpoint,
  normalizePoliticalWorldV2Checkpoint,
} from "./checkpoint.js";

const DB_NAME = "oh-political-world-v2";
const DB_VERSION = 2;
const STORE = "checkpoints";
const BACKUP_STORE = "checkpointBackups";
const BACKUP_LATEST = (scenarioId) => `latest:${scenarioId}`;
const BACKUP_PREVIOUS = (scenarioId) => `previous:${scenarioId}`;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const memory = new Map();
let dbPromise = null;

const openDb = () => {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no indexeddb"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "scenarioId" });
        if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE, { keyPath: "backupId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

const withStore = async (storeName, mode, work) => {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request && "result" in request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
};

const coerceCheckpoint = (candidate, expectedScenarioId = "") => {
  if (!candidate || typeof candidate !== "object") return null;
  const expected = clean(expectedScenarioId);
  const actualScenario = clean(candidate.scenarioId);
  if (expected && actualScenario && expected !== actualScenario) return null;

  if (isPoliticalWorldV2Checkpoint(candidate)) return normalizePoliticalWorldV2Checkpoint(candidate);

  // Workspace schema changes must never make expensive generated canon
  // unreachable. We only coerce objects that are unmistakably Political World
  // v2 checkpoints and still contain staged-world state.
  if (clean(candidate.kind) !== POLITICAL_WORLD_V2_CHECKPOINT_KIND) return null;
  if (!actualScenario || !object(candidate.stagedWorld)) return null;

  const migrated = {
    ...clone(candidate),
    version: POLITICAL_WORLD_V2_CHECKPOINT_VERSION,
    jobs: object(candidate.jobs),
    coverage: object(candidate.coverage),
    membership: object(candidate.membership),
    verification: object(candidate.verification),
    attempts: object(candidate.attempts),
    retryContext: object(candidate.retryContext),
    generationEntriesByPolity: object(candidate.generationEntriesByPolity),
    quality: object(candidate.quality),
  };
  return normalizePoliticalWorldV2Checkpoint(migrated);
};

const parseBackupRecord = (record, expectedScenarioId = "") => {
  if (!record) return null;
  try {
    const parsed = typeof record.json === "string" ? JSON.parse(record.json) : record.checkpoint;
    return coerceCheckpoint(parsed, expectedScenarioId);
  } catch {
    return null;
  }
};

const saveJsonBackup = async (checkpoint, backupId) => {
  const record = {
    backupId,
    scenarioId: clean(checkpoint?.scenarioId),
    scenarioDate: clean(checkpoint?.scenarioDate),
    updatedAt: clean(checkpoint?.updatedAt),
    json: JSON.stringify(checkpoint),
  };
  await withStore(BACKUP_STORE, "readwrite", (store) => store.put(record));
};

const findRawCandidateByDate = async (scenarioDate) => {
  const date = clean(scenarioDate);
  if (!date) return null;
  try {
    const stored = await withStore(STORE, "readonly", (store) => store.getAll());
    const candidates = (Array.isArray(stored) ? stored : [])
      .map((candidate) => coerceCheckpoint(candidate))
      .filter((candidate) => candidate && clean(candidate.scenarioDate) === date);
    if (candidates.length === 1) return candidates[0];
  } catch {
    // Try serialized backups below.
  }
  try {
    const records = await withStore(BACKUP_STORE, "readonly", (store) => store.getAll());
    const candidates = (Array.isArray(records) ? records : [])
      .map((record) => parseBackupRecord(record))
      .filter((candidate) => candidate && clean(candidate.scenarioDate) === date);
    const unique = new Map(candidates.map((candidate) => [clean(candidate.scenarioId), candidate]));
    if (unique.size === 1) return [...unique.values()][0];
  } catch {
    // No durable candidate available.
  }
  return null;
};

export const savePoliticalWorldV2Checkpoint = async (checkpoint) => {
  const normalized = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!normalized || !clean(normalized.scenarioId)) throw new Error("Political World v2 checkpoint requires scenarioId before persistence");
  const id = clean(normalized.scenarioId);
  memory.set(id, clone(normalized));

  // Preserve the previous durable snapshot before overwriting primary state.
  try {
    const previousRaw = await withStore(STORE, "readonly", (store) => store.get(id));
    const previous = coerceCheckpoint(previousRaw, id);
    if (previous) await saveJsonBackup(previous, BACKUP_PREVIOUS(id));
  } catch {
    // A missing/blocked primary store must not prevent the new JSON mirror.
  }

  let primarySaved = false;
  try {
    await withStore(STORE, "readwrite", (store) => store.put(normalized));
    primarySaved = true;
  } catch {
    // Continue to the serialized recovery mirror below.
  }

  let backupSaved = false;
  try {
    await saveJsonBackup(normalized, BACKUP_LATEST(id));
    backupSaved = true;
  } catch {
    // Current-session memory still retains the checkpoint, but the caller gets
    // an explicit persistence marker so the UI/diagnostic can surface risk.
  }

  const returned = clone(normalized);
  returned.persistence = {
    primary: primarySaved,
    backup: backupSaved,
    durable: primarySaved || backupSaved,
  };
  memory.set(id, clone(returned));
  return returned;
};

export const loadPoliticalWorldV2Checkpoint = async (scenarioId, { scenarioDate = "" } = {}) => {
  const id = clean(scenarioId);
  if (!id) return null;

  try {
    const stored = await withStore(STORE, "readonly", (store) => store.get(id));
    const recovered = coerceCheckpoint(stored, id);
    if (recovered) {
      memory.set(id, clone(recovered));
      return recovered;
    }
  } catch {
    // Try serialized durable recovery copies next.
  }

  for (const backupId of [BACKUP_LATEST(id), BACKUP_PREVIOUS(id)]) {
    try {
      const record = await withStore(BACKUP_STORE, "readonly", (store) => store.get(backupId));
      const recovered = parseBackupRecord(record, id);
      if (recovered) {
        memory.set(id, clone(recovered));
        return recovered;
      }
    } catch {
      // Keep searching.
    }
  }

  if (memory.has(id)) {
    const candidate = coerceCheckpoint(memory.get(id), id);
    if (candidate) return clone(candidate);
    memory.delete(id);
  }

  // Last-resort recovery for a scenario whose persistent id changed during a
  // save/import operation. Only auto-adopt when the scenario date identifies a
  // single Political World workspace in the whole store.
  const byDate = await findRawCandidateByDate(scenarioDate);
  if (byDate) {
    const adopted = { ...byDate, scenarioId: id };
    memory.set(id, clone(adopted));
    return adopted;
  }

  return null;
};

export const inspectPoliticalWorldV2CheckpointStorage = async (scenarioId, { scenarioDate = "" } = {}) => {
  const id = clean(scenarioId);
  const result = {
    scenarioId: id,
    scenarioDate: clean(scenarioDate),
    primary: false,
    latestBackup: false,
    previousBackup: false,
    memory: memory.has(id),
    recoverableByDate: false,
  };
  try { result.primary = Boolean(await withStore(STORE, "readonly", (store) => store.get(id))); } catch {}
  try { result.latestBackup = Boolean(await withStore(BACKUP_STORE, "readonly", (store) => store.get(BACKUP_LATEST(id)))); } catch {}
  try { result.previousBackup = Boolean(await withStore(BACKUP_STORE, "readonly", (store) => store.get(BACKUP_PREVIOUS(id)))); } catch {}
  if (!result.primary && !result.latestBackup && !result.previousBackup) {
    result.recoverableByDate = Boolean(await findRawCandidateByDate(scenarioDate));
  }
  return result;
};

export const clearPoliticalWorldV2Checkpoint = async (scenarioId) => {
  const id = clean(scenarioId);
  if (!id) return;
  memory.delete(id);
  try { await withStore(STORE, "readwrite", (store) => store.delete(id)); } catch {}
  try { await withStore(BACKUP_STORE, "readwrite", (store) => store.delete(BACKUP_LATEST(id))); } catch {}
  try { await withStore(BACKUP_STORE, "readwrite", (store) => store.delete(BACKUP_PREVIOUS(id))); } catch {}
};

export const clearPoliticalWorldV2CheckpointMemoryForTests = () => memory.clear();
