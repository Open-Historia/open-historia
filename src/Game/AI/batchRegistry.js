/*! Open Historia — background batch tasks that outlive the page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A task sent to a provider's batch endpoint (Settings → Batch background AI
// tasks) is paid for when it is submitted and answered minutes or hours later.
// The poller in gameplay.js keeps its handle in memory, so a reload, or Android
// killing the WebView, used to orphan it: the answer was never collected and
// the same work was sent, and paid for, again on the next skip.
//
// Each submitted batch is therefore also written here, with what is needed to
// collect it again: the provider's batch id, the Connection whose key sent it,
// the campaign it belongs to and a plain-JSON `resume` note from which
// gameplay.js rebuilds the code that applies the answer. It is forgotten once
// the answer is applied or the batch fails. Pure apart from the storage it is
// handed, so node --test can load it.

export const BATCH_REGISTRY_STORAGE_KEY = "oh-pending-batches-v1";
// Anthropic keeps a batch's results for 29 days; after that there is nothing
// left to collect.
export const BATCH_MAX_AGE_MS = 29 * 24 * 60 * 60 * 1000;

const text = (value) => String(value ?? "").trim();

const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const readAll = (storage) => {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(BATCH_REGISTRY_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (storage, all) => {
  if (!storage) return;
  try {
    if (Object.keys(all).length) storage.setItem(BATCH_REGISTRY_STORAGE_KEY, JSON.stringify(all));
    else storage.removeItem(BATCH_REGISTRY_STORAGE_KEY);
  } catch {
    // Storage full or blocked: the batch still runs; only a reload loses it.
  }
};

// A stored record, or null when it cannot be collected again.
export const normalizeStoredBatch = (value, { now = Date.now() } = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const customId = text(value.customId);
  const batchId = text(value.batchId);
  const connectionId = text(value.connectionId);
  const taskKey = text(value.taskKey);
  const submittedAt = Number(value.submittedAt);
  const resume = value.resume && typeof value.resume === "object" && !Array.isArray(value.resume) ? value.resume : null;
  if (!customId || !batchId || !connectionId || !taskKey || !resume) return null;
  if (!Number.isFinite(submittedAt) || now - submittedAt > BATCH_MAX_AGE_MS) return null;
  return { customId, batchId, connectionId, taskKey, campaignId: text(value.campaignId), submittedAt, resume };
};

// Every batch still worth collecting. Expired or malformed records are dropped
// from storage on the way.
export const readStoredBatches = ({ storage = defaultStorage(), now = Date.now() } = {}) => {
  const all = readAll(storage);
  const kept = {};
  const batches = [];
  for (const [customId, value] of Object.entries(all)) {
    const record = normalizeStoredBatch(value, { now });
    if (!record || record.customId !== customId) continue;
    kept[customId] = value;
    batches.push(record);
  }
  if (Object.keys(kept).length !== Object.keys(all).length) writeAll(storage, kept);
  return batches.sort((a, b) => a.submittedAt - b.submittedAt);
};

export const rememberBatch = (value, { storage = defaultStorage(), now = Date.now() } = {}) => {
  const record = normalizeStoredBatch({ submittedAt: now, ...value }, { now });
  if (!record) return false;
  const all = readAll(storage);
  all[record.customId] = record;
  writeAll(storage, all);
  return true;
};

export const forgetBatch = (customId, { storage = defaultStorage() } = {}) => {
  const all = readAll(storage);
  if (!Object.prototype.hasOwnProperty.call(all, customId)) return;
  delete all[customId];
  writeAll(storage, all);
};
