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
// Recording is on by default (not in the Android app) and almost nobody opens
// the console, so the buffer must not hold every prompt of the session: the
// prompts and answers are the largest strings in the game, and on a phone they
// add up. Only the newest FULL_TEXT_RECORDS keep their text in memory. An older
// one, once its stored copy is safely written, keeps its counts and summaries
// and drops the text, which the console reads back from IndexedDB when it is
// opened. With recording off there is no stored copy, and an older record drops
// its text all the same.

const DB_NAME = "oh-debug-telemetry";
const DB_VERSION = 1;
const STORE = "generations";
const MAX_PERSISTED_RECORDS = 200;
// The stored history's text, in characters (about a byte each for prompts):
// 200 time skips with a long campaign's prompt are far past this, and the
// console holds the whole history while it is open.
const MAX_PERSISTED_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_RECORDS = 500;
const FULL_TEXT_RECORDS = 20;
// Prompts, user messages and answers are kept WHOLE. They used to be clipped
// (80k / 20k / 60k characters), which cut the system prompt of any real turn
// short in the console — a jump's prompt is well past 80k — and read as the
// game sending a truncated prompt. It never did: the provider always got the
// full text; only this record was cut. Storage is bounded by record COUNT
// (MAX_SESSION_RECORDS / MAX_PERSISTED_RECORDS) and the stored total
// (MAX_PERSISTED_BYTES, oldest records dropped first), never by trimming their
// text.

// Settings (localStorage, same pattern as mapSettings/providerConfig).
// Recording ships ON except in the Android app: there only an explicit "1"
// turns it on, everywhere else only an explicit "0" turns it off. A phone pays
// most for keeping every prompt, and has the least use for the console. Rating
// ships OFF: the 1-10 bar after every skip is opt-in, so only an explicit "1"
// turns it on.
const TELEMETRY_SETTING_KEY = "ai_debug_telemetry";
const RATING_SETTING_KEY = "ai_rate_generations";
// Size of every stored record by id, so trimming to MAX_PERSISTED_BYTES never
// reads the records themselves.
const SIZES_KEY = "ai_debug_telemetry_sizes";
export const TELEMETRY_SETTINGS_EVENT = "oh:telemetry-settings";

// The Android app is the web bundle inside Capacitor, which injects
// window.Capacitor before the bundle runs (runtime/web/nativeBoot.js).
const isAndroidApp = () => typeof window !== "undefined" && Boolean(window.Capacitor);

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

export const isTelemetryEnabled = () => readFlag(TELEMETRY_SETTING_KEY, { defaultOn: !isAndroidApp() });
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

// --- The console's copy of the stored history ------------------------------------
//
// Read once when the console first asks (getAiRecords), then kept in step with
// this tab's own writes rather than read again on every refresh, and let go
// when the console closes (releaseAiRecords). Writes that land while the read
// is still running are replayed onto it; each is idempotent, so one the read
// already saw does no harm.
let history = null; // Map id → stored record
let historyLoading = null;
let historyPending = null;
let historyEpoch = 0;

const followStore = (change) => {
  if (history) change(history);
  else if (historyPending) historyPending.push(change);
};

// --- Stored sizes -----------------------------------------------------------------

// Characters of text a record holds: what dominates its stored size.
const recordBytes = (record) => {
  let total = 1024; // everything else on the record
  for (const field of ["systemPrompt", "userMessage", "rawResponse", "validationError", "error"]) {
    if (typeof record?.[field] === "string") total += record[field].length;
  }
  for (const entry of record?.lookups?.entries ?? []) {
    if (typeof entry?.response === "string") total += entry.response.length;
  }
  return total;
};

// localStorage, read afresh each time so tabs sharing the store do not undo
// each other's entries; kept in memory where there is none (private mode).
let memorySizes = {};
const readSizes = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIZES_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { ...memorySizes };
  }
};
const writeSizes = (sizes) => {
  memorySizes = sizes;
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch { /* memory only */ }
};
const sizesTotal = (sizes) => Object.values(sizes).reduce((total, bytes) => total + (Number(bytes) || 0), 0);

const idbPut = async (record) => {
  await withStore("readwrite", (store) => { store.put(record); });
  followStore((stored) => stored.set(record.id, record));
  const sizes = readSizes();
  sizes[record.id] = recordBytes(record);
  writeSizes(sizes);
  if (sizesTotal(sizes) > MAX_PERSISTED_BYTES) trimPersistedRecords().catch(() => {});
};
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
// whether there was. Never text: the record's size does not move.
const idbUpdate = async (id, fields) => {
  const updated = await withStore("readwrite", (store) => {
    const outcome = { result: false };
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) return;
      store.put({ ...request.result, ...fields });
      outcome.result = true;
    };
    return outcome;
  });
  if (updated) {
    followStore((stored) => {
      if (stored.has(id)) stored.set(id, { ...stored.get(id), ...fields });
    });
  }
  return updated;
};
// One record's size, read on its own: for a record stored before sizes were
// kept, or by a tab whose entry was lost. Only that record is in memory.
const idbSizeOf = (id) => withStore("readonly", (store) => {
  const outcome = { result: null };
  const request = store.get(id);
  request.onsuccess = () => { outcome.result = request.result ? recordBytes(request.result) : null; };
  return outcome;
});
const idbClear = async () => {
  await withStore("readwrite", (store) => { store.clear(); });
  followStore((stored) => stored.clear());
  writeSizes({});
};
const idbDeleteMany = async (ids) => {
  await withStore("readwrite", (store) => { for (const id of ids) store.delete(id); });
  followStore((stored) => { for (const id of ids) stored.delete(id); });
};

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

// Every record past the newest few that is final and not waiting on a write:
// safely stored, or never written because recording was off when it finished
// (the Android app's default), which leaves no stored copy to wait for.
const lightenOlderRecords = () => {
  for (let index = 0; index < sessionRecords.length - FULL_TEXT_RECORDS; index += 1) {
    const record = sessionRecords[index];
    if (lightRecords.has(record) || !record.finished || record.awaitingOutcome) continue;
    const state = writes.get(record);
    if (state && !state.stored) continue;
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
  // The first write of a session sizes whatever the store holds from before
  // (idbPut trims as soon as the known total is over MAX_PERSISTED_BYTES).
  if (putCounter === 1 || putCounter % 25 === 0) trimPersistedRecords().catch(() => {});
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
    // every HTTP request the generation made — lookup rounds, retries, fallback
    // switches — by outcome, as the request budget counts them: see
    // attachRequestOutcome
    requests: null,
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

// One provider response for this generation, classified the way the request
// budget (requestBudget.js) classifies it: 2xx answered, 429 refused, anything
// else failed. One generation can be many requests.
export const attachRequestOutcome = (record, status) => {
  if (!record) return;
  const requests = record.requests && typeof record.requests === "object"
    ? record.requests
    : { ok: 0, refused: 0, failed: 0 };
  const code = Number(status);
  if (code >= 200 && code < 300) requests.ok += 1;
  else if (code === 429) requests.refused += 1;
  else requests.failed += 1;
  record.requests = requests;
};

// All the requests a record made, or null for a record from before they were
// counted.
export const requestCount = (record) => {
  const requests = record?.requests;
  if (!requests || typeof requests !== "object") return null;
  return (Number(requests.ok) || 0) + (Number(requests.refused) || 0) + (Number(requests.failed) || 0);
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

// Newest first, a record is kept while the kept ones stay within both
// MAX_PERSISTED_RECORDS and MAX_PERSISTED_BYTES; the newest is always kept,
// however large. Sizes come from the size list, and a record missing from it
// is read once, on its own, to size it.
let trimming = null;
let trimAgain = false;
const trimOnce = async () => {
  // Read before the ids: a record with an entry here was written before them.
  const sizes = readSizes();
  const ids = await idbKeysOldestFirst();
  const known = {};
  for (const id of ids) {
    const bytes = Number(sizes[id]);
    known[id] = Number.isFinite(bytes) && bytes > 0 ? bytes : await idbSizeOf(id).catch(() => null);
  }
  let kept = 0;
  let total = 0;
  let cut = 0; // ids[0..cut) go
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const bytes = Number(known[ids[index]]) || 0;
    if (kept > 0 && (kept >= MAX_PERSISTED_RECORDS || total + bytes > MAX_PERSISTED_BYTES)) {
      cut = index + 1;
      break;
    }
    kept += 1;
    total += bytes;
  }
  const dropped = ids.slice(0, cut);
  if (dropped.length) await idbDeleteMany(dropped);
  // The ids still stored, sized. An entry for a record that is gone (deleted
  // by another tab, or cleared) goes too; one written while this ran, not in
  // `ids` yet, stays.
  const latest = readSizes();
  const next = {};
  for (const id of ids.slice(cut)) {
    const bytes = known[id] ?? latest[id];
    if (bytes) next[id] = bytes;
  }
  for (const [id, bytes] of Object.entries(latest)) {
    if (!(id in known) && !(id in sizes)) next[id] = bytes;
  }
  writeSizes(next);
};
const trimPersistedRecords = () => {
  if (trimming) {
    trimAgain = true;
    return trimming;
  }
  trimming = (async () => {
    try {
      do {
        trimAgain = false;
        await trimOnce();
      } while (trimAgain);
    } finally {
      trimming = null;
    }
  })();
  return trimming;
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

const loadHistory = () => {
  if (history) return Promise.resolve(history);
  if (!historyLoading) {
    const epoch = historyEpoch;
    historyPending = [];
    historyLoading = idbGetAll()
      .catch(() => []) // memory-only mode
      .then((stored) => {
        const loaded = new Map(stored.map((record) => [record.id, record]));
        for (const change of historyPending ?? []) change(loaded);
        historyPending = null;
        historyLoading = null;
        // Released while it was read: hand it over, keep nothing.
        if (epoch === historyEpoch) history = loaded;
        return loaded;
      });
  }
  return historyLoading;
};

// The stored history is read the first time the console asks and then follows
// this tab's writes (followStore), so a refresh on every finished call costs
// nothing; releaseAiRecords lets it go when the console closes, since the
// history is for the console while it is open, not for the rest of the
// session. A session record that has dropped its text is shown from its
// stored copy.
export const getAiRecords = async () => {
  const stored = await loadHistory();
  const merged = new Map(stored);
  for (const record of sessionRecords) {
    const full = lightRecords.has(record) ? merged.get(record.id) : null;
    merged.set(record.id, full ? { ...full, rating: record.rating, ratedAt: record.ratedAt } : record);
  }
  return [...merged.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
};

// The console closed: drop the stored history it was shown.
export const releaseAiRecords = () => {
  historyEpoch += 1;
  history = null;
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
  "requestsOk", "requestsRefused", "requestsFailed",
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
      record.requests?.ok ?? "",
      record.requests?.refused ?? "",
      record.requests?.failed ?? "",
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
