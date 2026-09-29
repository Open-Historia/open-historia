/*! Open Historia — AI generation telemetry and human ratings. Ported from Abdulrahman Azmy's fork. */
// Import-free on purpose: runs under node --test without a build.
//
// One record per AI call: which model ran, what it cost (tokens, cache reads),
// how long it took (and how long before the first byte), what it was asked
// (the full prompt), what it answered (raw), how validation treated it, and —
// optionally — a human 1-10 satisfaction rating. The debug console
// (GameUI/debugConsole.jsx) reads these; the rating toast writes the rating.
//
// Storage: an in-memory buffer holds the session; every finished record is
// also mirrored into a small dedicated IndexedDB store (oh-debug-telemetry) so
// the console can review and export history across sessions. Without
// IndexedDB the buffer alone still works — telemetry must never break a turn,
// so every persistence call is best-effort.
//
// Recording is on by default and almost nobody opens the console, so the
// buffer must not hold every prompt of the session: the prompts and answers
// are the largest strings in the game, and on a phone they add up. Only the
// newest FULL_TEXT_RECORDS keep their text in memory. An older one, once its
// stored copy is safely written, keeps its counts and summaries and drops the
// text, which the console reads back from IndexedDB when it is opened.

const DB_NAME = "oh-debug-telemetry";
const DB_VERSION = 1;
const STORE = "generations";
const MAX_PERSISTED_RECORDS = 200;
const MAX_SESSION_RECORDS = 500;
const FULL_TEXT_RECORDS = 20;
// Prompts, user messages and answers are kept WHOLE. They used to be clipped
// (80k / 20k / 60k characters), which cut the system prompt of any real turn
// short in the console — a jump's prompt is well past 80k — and read as the
// game sending a truncated prompt. It never did: the provider always got the
// full text; only this record was cut. Storage is bounded by record COUNT
// (MAX_SESSION_RECORDS / MAX_PERSISTED_RECORDS), never by trimming their text.

// Settings (localStorage, same pattern as mapSettings/providerConfig).
// Recording ships ON: only an explicit "0" turns it off. Rating ships OFF: the
// 1-10 bar after every skip is opt-in, so only an explicit "1" turns it on.
const TELEMETRY_SETTING_KEY = "ai_debug_telemetry";
const RATING_SETTING_KEY = "ai_rate_generations";
export const TELEMETRY_SETTINGS_EVENT = "oh:telemetry-settings";

const readFlag = (key, { defaultOn = true } = {}) => {
  try {
    const stored = localStorage.getItem(key);
    return defaultOn ? stored !== "0" : stored === "1";
  } catch {
    return defaultOn;
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
export const isRatingEnabled = () => readFlag(RATING_SETTING_KEY, { defaultOn: false });
export const setRatingEnabled = (enabled) => writeFlag(RATING_SETTING_KEY, enabled);

// Tasks whose completion is worth an immediate "rate this" prompt — the
// narrative-shaping calls. Everything else stays rateable from the console; a
// tiny mechanical/classification calls would be pure noise.
export const RATING_ELIGIBLE_TASKS = Object.freeze(new Set([
  "jumpForward",
  "autoJumpForward",
  "gameMaster",
  "interactiveExecutor",
  "interactiveSummary",
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
// Ids only, oldest first, from the startedAt index: trimming needs nothing else,
// and reading every whole record to find them is what it used to do.
const idbKeysOldestFirst = async () => {
  const result = await withStore("readonly", (store) => store.index("startedAt").getAllKeys());
  return Array.isArray(result) ? result : [];
};
// Merges fields into the stored copy of a record, if there is one; resolves
// whether there was.
const idbUpdate = (id, fields) => withStore("readwrite", (store) => {
  const outcome = { result: false };
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    store.put({ ...request.result, ...fields });
    outcome.result = true;
  };
  return outcome;
});
const idbClear = () => withStore("readwrite", (store) => { store.clear(); });
const idbDeleteMany = (ids) => withStore("readwrite", (store) => { for (const id of ids) store.delete(id); });

// --- Record lifecycle ----------------------------------------------------------

const sessionRecords = []; // newest last
let putCounter = 0;
let recordCounter = 0;
// Per record: how many writes were asked for and whether the latest landed.
const writes = new WeakMap();
// Records whose text now lives only in the stored copy.
const lightRecords = new WeakSet();

const lighten = (record) => {
  lightRecords.add(record);
  record.systemPrompt = "";
  record.userMessage = "";
  record.rawResponse = "";
  // Replaced, not edited: a write still waiting holds the old object.
  if (record.lookups?.entries?.length) {
    record.lookups = { ...record.lookups, entries: record.lookups.entries.map((entry) => ({ ...entry, response: "" })) };
  }
};

// Every record past the newest few that is final and safely stored.
const lightenOlderRecords = () => {
  for (let index = 0; index < sessionRecords.length - FULL_TEXT_RECORDS; index += 1) {
    const record = sessionRecords[index];
    if (lightRecords.has(record) || !record.finished || record.awaitingOutcome || !writes.get(record)?.stored) continue;
    lighten(record);
  }
};

const clip = (text, max) => {
  const value = typeof text === "string" ? text : "";
  return value.length > max ? value.slice(0, max) : value;
};

const persist = (record) => {
  if (!isTelemetryEnabled()) return;
  // Its text is only in the stored copy: merge the rest in, keep the text.
  if (lightRecords.has(record)) {
    const { systemPrompt, userMessage, rawResponse, lookups, ...rest } = record;
    idbUpdate(record.id, rest).catch(() => { /* best-effort persistence */ });
    return;
  }
  const state = writes.get(record) ?? { asked: 0, stored: false };
  state.asked += 1;
  state.stored = false;
  writes.set(record, state);
  const asked = state.asked;
  putCounter += 1;
  // A copy: the write waits for the database to open, and by then the record
  // may be one of the older ones and have dropped its text.
  idbPut({ ...record })
    .then(() => {
      if (state.asked !== asked) return;
      state.stored = true;
      lightenOlderRecords();
    })
    .catch(() => { /* best-effort persistence */ });
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
    // what the model asked for on the way (lookupTools.js): every function call
    // it made and what it was told, round by round — see attachLookupRound
    lookups: null,
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
  lightenOlderRecords();
  return record;
};

// The call-level measurements callAI has once the provider answered.
export const attachCallMetrics = (record, { model, usage, firstByteMs } = {}) => {
  if (!record) return;
  if (model) record.model = String(model);
  if (usage && typeof usage === "object") record.usage = usage;
  if (Number.isFinite(firstByteMs)) record.firstByteMs = firstByteMs;
};

// One lookup round: the calls the model made in one turn and what each was
// answered. Kept whole, like the prompt — a dropped transfer is diagnosed from
// exactly these answers ("it asked for Russia and was told there is none").
// `calls` is [{ name, args, label?, response, ms?, error? }]; `usage` is the
// request that produced the calls, so the rounds add up to the record's usage.
export const attachLookupRound = (record, { round, calls = [], elapsedMs = null, usage = null } = {}) => {
  if (!record) return;
  const ledger = record.lookups && typeof record.lookups === "object"
    ? record.lookups
    : { rounds: 0, calls: 0, chars: 0, entries: [], roundUsage: [] };
  const roundNumber = Number.isInteger(round) ? round : ledger.rounds + 1;
  ledger.rounds += 1;
  for (const call of Array.isArray(calls) ? calls : []) {
    const response = typeof call?.response === "string" ? call.response : JSON.stringify(call?.response ?? null);
    const entry = {
      round: roundNumber,
      name: String(call?.name ?? ""),
      args: call?.args && typeof call.args === "object" ? call.args : {},
      label: String(call?.label ?? call?.name ?? ""),
      response,
      responseChars: response.length,
      ms: Number.isFinite(call?.ms) ? call.ms : null,
      error: Boolean(call?.error),
    };
    ledger.entries.push(entry);
    ledger.calls += 1;
    ledger.chars += entry.responseChars;
  }
  ledger.roundUsage.push({ round: roundNumber, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null, ...(usage && typeof usage === "object" ? usage : {}) });
  record.lookups = ledger;
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
  const ids = await idbKeysOldestFirst();
  if (ids.length <= MAX_PERSISTED_RECORDS) return;
  await idbDeleteMany(ids.slice(0, ids.length - MAX_PERSISTED_RECORDS));
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
    politicalActorOpCount: sum("politicalActorOps"),
    unitOpCount: sum("unitOps"),
    chatCount: count("createdChats") + count("diplomaticOutreach"),
    warUpdateCount: count("warUpdates"),
    relationUpdateCount: count("relationUpdates"),
    storylineUpdateCount: count("storylineUpdates"),
    stopDate: typeof parsed.stopDate === "string" ? parsed.stopDate : "",
  };
};

// --- Reading --------------------------------------------------------------------

// Read afresh on every call rather than kept: the history is for the console
// while it is open, not for the rest of the session. A session record that has
// dropped its text is shown from its stored copy.
export const getAiRecords = async () => {
  let stored = [];
  try {
    stored = await idbGetAll();
  } catch { /* memory-only mode */ }
  const merged = new Map();
  for (const record of stored) merged.set(record.id, record);
  for (const record of sessionRecords) {
    const full = lightRecords.has(record) ? merged.get(record.id) : null;
    merged.set(record.id, full ? { ...full, rating: record.rating, ratedAt: record.ratedAt } : record);
  }
  return [...merged.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
};

export const setGenerationRating = async (recordId, rating) => {
  const value = Math.round(Number(rating));
  if (!Number.isFinite(value)) return false;
  const clamped = Math.max(1, Math.min(10, value));
  const fields = { rating: clamped, ratedAt: Date.now() };
  const inSession = sessionRecords.find((record) => record.id === recordId) ?? null;
  if (inSession) Object.assign(inSession, fields);
  if (!isTelemetryEnabled()) return Boolean(inSession);
  try {
    // A whole record is written whole; one that has dropped its text, or one
    // from an earlier session, only has the rating merged into its stored copy.
    if (inSession && !lightRecords.has(inSession)) {
      await idbPut({ ...inSession });
      return true;
    }
    return (await idbUpdate(recordId, fields)) || Boolean(inSession);
  } catch {
    return Boolean(inSession);
  }
};

export const clearAiRecords = async () => {
  sessionRecords.length = 0;
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
  "eventCount", "stopDate", "lookupRounds", "lookupCalls", "lookupNames",
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
      record.lookups?.rounds ?? "",
      record.lookups?.calls ?? "",
      (record.lookups?.entries ?? []).map((entry) => entry.name).join(" "),
    ].map(csvCell).join(","));
  }
  return rows.join("\n");
};

// runtime/saveFile.js: a download in a browser, Downloads/Open Historia in the
// Android app. Loaded on demand so this module stays importable under `node --test`.
export const downloadFile = async (filename, content, mimeType = "application/json") => {
  if (typeof document === "undefined") return;
  const { saveTextToDisk } = await import("../../runtime/saveFile.js");
  await saveTextToDisk(content, filename, mimeType);
};
