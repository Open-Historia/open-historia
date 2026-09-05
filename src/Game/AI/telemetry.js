/*! Open Historia — AI generation telemetry and human ratings. Ported from Abdulrahman Azmy's fork. */
// Import-free on purpose: runs under node --test without a build.
//
// One record per AI call: which model ran, what it cost (tokens, cache reads),
// how long it took (and how long before the first byte), what it was asked
// (the full prompt), what it answered (raw), how validation treated it, and —
// optionally — a human 1-10 satisfaction rating. The debug console
// (GameUI/debugConsole.jsx) reads these; the rating toast writes the rating.
//
// Storage: an in-memory buffer holds the session at full fidelity; every
// finished record is also mirrored into a small dedicated IndexedDB store
// (oh-debug-telemetry) so the console can review and export history across
// sessions. Without IndexedDB the buffer alone still works — telemetry must
// never break a turn, so every persistence call is best-effort.

const DB_NAME = "oh-debug-telemetry";
const DB_VERSION = 1;
const STORE = "generations";
const MAX_PERSISTED_RECORDS = 200;
const MAX_SESSION_RECORDS = 500;
// Prompts, user messages and answers are kept WHOLE. They used to be clipped
// (80k / 20k / 60k characters), which cut the system prompt of any real turn
// short in the console — a jump's prompt is well past 80k — and read as the
// game sending a truncated prompt. It never did: the provider always got the
// full text; only this record was cut. Storage is bounded by record COUNT
// (MAX_SESSION_RECORDS / MAX_PERSISTED_RECORDS), never by trimming their text.

// Settings (localStorage, same pattern as mapSettings/providerConfig). Both
// default ON: only an explicit "0" turns them off.
const TELEMETRY_SETTING_KEY = "ai_debug_telemetry";
const RATING_SETTING_KEY = "ai_rate_generations";
export const TELEMETRY_SETTINGS_EVENT = "oh:telemetry-settings";

const readFlag = (key) => {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
};

const writeFlag = (key, enabled) => {
  try {
    localStorage.setItem(key, enabled ? "1" : "0");
  } catch {
    // Private mode: the choice lasts for the session only.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TELEMETRY_SETTINGS_EVENT));
};

export const isTelemetryEnabled = () => readFlag(TELEMETRY_SETTING_KEY);
export const setTelemetryEnabled = (enabled) => writeFlag(TELEMETRY_SETTING_KEY, enabled);
export const isRatingEnabled = () => readFlag(RATING_SETTING_KEY);
export const setRatingEnabled = (enabled) => writeFlag(RATING_SETTING_KEY, enabled);

// Tasks whose completion is worth an immediate "rate this" prompt — the
// narrative-shaping calls. Everything else stays rateable from the console; a
// rating toast after every nextSpeaker classification would be pure noise.
export const RATING_ELIGIBLE_TASKS = Object.freeze(new Set([
  "jumpForward",
  "autoJumpForward",
  "gameMaster",
  "catalystExecutor",
  "catalystSummary",
]));

export const GENERATION_COMPLETE_EVENT = "oh:ai-generation-complete";

// --- IndexedDB (self-contained, best-effort) ----------------------------------

let dbPromise = null;
const openDb = () => {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no indexeddb"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("startedAt", "startedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

const withStore = async (mode, work) => {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const outcome = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(outcome && "result" in outcome ? outcome.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
};

const idbPut = (record) => withStore("readwrite", (store) => { store.put(record); });
const idbGetAll = async () => {
  const result = await withStore("readonly", (store) => store.getAll());
  return Array.isArray(result) ? result : [];
};
const idbClear = () => withStore("readwrite", (store) => { store.clear(); });
const idbDeleteMany = (ids) => withStore("readwrite", (store) => { for (const id of ids) store.delete(id); });

// --- Record lifecycle ----------------------------------------------------------

const sessionRecords = []; // newest last
let idbHistory = null; // loaded once per session, merged into getAiRecords()
let idbHistoryFailed = false;
let putCounter = 0;
let recordCounter = 0;

const clip = (text, max) => {
  const value = typeof text === "string" ? text : "";
  return value.length > max ? value.slice(0, max) : value;
};

const persist = (record) => {
  if (!isTelemetryEnabled()) return;
  putCounter += 1;
  idbPut(record).catch(() => { /* best-effort persistence */ });
  if (putCounter % 25 === 0) trimPersistedRecords().catch(() => {});
};

const announceComplete = (record) => {
  if (record.announced || typeof window === "undefined") return;
  record.announced = true;
  window.dispatchEvent(new CustomEvent(GENERATION_COMPLETE_EVENT, {
    detail: { recordId: record.id, taskKey: record.taskKey, ok: record.ok },
  }));
};

export const startAiRecord = (meta = {}) => {
  recordCounter += 1;
  const systemPrompt = String(meta.systemPrompt ?? "");
  const userMessage = String(meta.userMessage ?? "");
  const record = {
    id: `gen-${Date.now().toString(36)}-${recordCounter}`,
    startedAt: Date.now(),
    endedAt: null,
    latencyMs: null,
    firstByteMs: null,
    // identity
    provider: String(meta.provider ?? ""),
    model: String(meta.model ?? ""),
    taskKey: String(meta.taskKey ?? "direct") || "direct",
    attempt: Number(meta.attempt) || 1,
    maxAttempts: Number(meta.maxAttempts) || 1,
    simulatedDays: Number.isFinite(meta.simulatedDays) ? meta.simulatedDays : null,
    staticPrefixEnd: Number.isFinite(meta.staticPrefixEnd) ? meta.staticPrefixEnd : null,
    batch: Boolean(meta.batch),
    // what was asked
    systemPromptChars: systemPrompt.length,
    userMessageChars: userMessage.length,
    systemPrompt,
    userMessage,
    // what came back
    responseChars: 0,
    rawResponse: "",
    usage: null, // usageStats.js shape: { promptTokens, outputTokens, totalTokens, cachedTokens, thinkingTokens }
    ok: null,
    error: "",
    validationError: "",
    parsedSummary: null,
    // human feedback
    rating: null,
    ratedAt: null,
    finished: false,
    // A task-runner call reports its validation outcome after the call
    // returns; the record is not "complete" (no rating toast, no persisted
    // ok) until that lands.
    awaitingOutcome: Boolean(meta.awaitingOutcome),
    announced: false,
  };
  sessionRecords.push(record);
  if (sessionRecords.length > MAX_SESSION_RECORDS) sessionRecords.shift();
  return record;
};

// The call-level measurements callAI has once the provider answered.
export const attachCallMetrics = (record, { model, usage, firstByteMs } = {}) => {
  if (!record) return;
  if (model) record.model = String(model);
  if (usage && typeof usage === "object") record.usage = usage;
  if (Number.isFinite(firstByteMs)) record.firstByteMs = firstByteMs;
};

export const finishAiRecord = (record, { ok = true, error = "", rawResponse = "" } = {}) => {
  if (!record || record.finished) return;
  record.finished = true;
  record.endedAt = Date.now();
  record.latencyMs = Math.max(0, record.endedAt - record.startedAt);
  record.error = String(error ?? "").slice(0, 2000);
  if (rawResponse) {
    record.responseChars = rawResponse.length;
    record.rawResponse = rawResponse;
  }
  // A failed call is final whatever the caller planned to attach.
  if (!ok) record.awaitingOutcome = false;
  if (!record.awaitingOutcome) {
    record.ok = Boolean(ok);
    persist(record);
    announceComplete(record);
  }
};

// The task runner's verdict on an answer, after schema and world validation.
// Persisted again when the call already finished, so history keeps the
// outcome and not only the transport result.
export const attachAttemptOutcome = (record, { ok, validationError = "", parsedSummary = null } = {}) => {
  if (!record) return;
  record.ok = Boolean(ok);
  record.validationError = String(validationError ?? "").slice(0, 4000);
  record.parsedSummary = parsedSummary && typeof parsedSummary === "object" ? parsedSummary : null;
  record.awaitingOutcome = false;
  if (record.finished) {
    persist(record);
    if (record.ok) announceComplete(record);
  }
};

const trimPersistedRecords = async () => {
  const all = await idbGetAll();
  if (all.length <= MAX_PERSISTED_RECORDS) return;
  all.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  await idbDeleteMany(all.slice(0, all.length - MAX_PERSISTED_RECORDS).map((record) => record.id));
};

// A compact, schema-agnostic shape summary of a validated payload — enough for
// the console's tables (events, transfers, control ops, wars, chats) without
// storing the payload twice. Counts follow beta's jump payload: impacts on
// each event, and the top-level ledgers beside the events.
export const normalizeParsedSummary = (taskKey, parsed) => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const impactsList = events
    .map((event) => (event?.impacts && typeof event.impacts === "object" ? event.impacts : null))
    .filter(Boolean);
  if (parsed.impacts && typeof parsed.impacts === "object") impactsList.push(parsed.impacts);
  const sum = (field) => impactsList.reduce(
    (total, impacts) => total + (Array.isArray(impacts[field]) ? impacts[field].length : 0),
    0,
  );
  const count = (field) => (Array.isArray(parsed[field]) ? parsed[field].length : 0);
  const hasContent = events.length > 0
    || impactsList.length > 0
    || typeof parsed.summary === "string"
    || count("storylineUpdates") + count("warUpdates") + count("relationUpdates") + count("createdChats") > 0;
  if (!hasContent) return null;
  return {
    eventCount: events.length,
    regionTransferCount: sum("regionTransfers"),
    controlOpCount: sum("regionControlOps"),
    polityChangeCount: sum("polityChanges"),
    unitOpCount: sum("unitOps"),
    chatCount: count("createdChats") + count("diplomaticOutreach"),
    warUpdateCount: count("warUpdates"),
    relationUpdateCount: count("relationUpdates"),
    storylineUpdateCount: count("storylineUpdates"),
    stopDate: typeof parsed.stopDate === "string" ? parsed.stopDate : "",
  };
};

// --- Reading --------------------------------------------------------------------

export const getAiRecords = async () => {
  if (idbHistory === null && !idbHistoryFailed) {
    try {
      const all = await idbGetAll();
      all.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      idbHistory = all;
    } catch {
      idbHistoryFailed = true;
      idbHistory = [];
    }
  }
  const merged = new Map();
  for (const record of idbHistory ?? []) merged.set(record.id, record);
  for (const record of sessionRecords) merged.set(record.id, record);
  return [...merged.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
};

export const setGenerationRating = async (recordId, rating) => {
  const value = Math.round(Number(rating));
  if (!Number.isFinite(value)) return false;
  const clamped = Math.max(1, Math.min(10, value));
  const update = (record) => {
    if (record && record.id === recordId) {
      record.rating = clamped;
      record.ratedAt = Date.now();
      return true;
    }
    return false;
  };
  let updated = sessionRecords.some(update);
  if (!updated && idbHistory) updated = idbHistory.some(update);
  if (updated && isTelemetryEnabled()) {
    try {
      const record = (await getAiRecords()).find((entry) => entry.id === recordId);
      if (record) await idbPut(record);
    } catch { /* best-effort */ }
  }
  return updated;
};

export const clearAiRecords = async () => {
  sessionRecords.length = 0;
  idbHistory = [];
  try {
    await idbClear();
  } catch { /* memory-only mode */ }
};

// --- Export ---------------------------------------------------------------------

const CSV_COLUMNS = [
  "id", "startedAt", "provider", "model", "taskKey", "attempt", "maxAttempts",
  "batch", "simulatedDays", "promptTokens", "outputTokens", "cachedTokens",
  "thinkingTokens", "latencyMs", "firstByteMs", "systemPromptChars",
  "responseChars", "staticPrefixEnd", "ok", "validationError", "rating",
  "eventCount", "stopDate",
];

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const exportTelemetryCsv = (records) => {
  const rows = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    rows.push([
      record.id,
      new Date(record.startedAt ?? 0).toISOString(),
      record.provider,
      record.model,
      record.taskKey,
      record.attempt,
      record.maxAttempts,
      record.batch ? "batch" : "",
      record.simulatedDays,
      record.usage?.promptTokens ?? "",
      record.usage?.outputTokens ?? "",
      record.usage?.cachedTokens ?? "",
      record.usage?.thinkingTokens ?? "",
      record.latencyMs,
      record.firstByteMs,
      record.systemPromptChars,
      record.responseChars,
      record.staticPrefixEnd,
      record.ok === true ? "ok" : record.ok === false ? "failed" : "",
      clip(record.validationError, 200).replace(/\s+/g, " "),
      record.rating ?? "",
      record.parsedSummary?.eventCount ?? "",
      record.parsedSummary?.stopDate ?? "",
    ].map(csvCell).join(","));
  }
  return rows.join("\n");
};

export const downloadFile = (filename, content, mimeType = "application/json") => {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
