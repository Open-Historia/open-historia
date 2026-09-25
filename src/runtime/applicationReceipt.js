/*! Open Historia — the application receipt © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// What the engine actually did with the simulator's last answer, told back to
// the simulator at the start of its next one.
//
// The turn pipeline has always been careful about this WITHIN a turn: a strict
// first attempt returns the validator's complaint with the real vocabulary
// attached, and the one retry usually fixes it. But the final attempt is
// salvage — an operation that names nothing is dropped in place so a finished
// generation is never lost over a stale id — and after that the curator may
// keep an event off the timeline, the integrity screen may hide one, and a
// transfer may be turned into a claim. Every one of those is a place where what
// the model believes it did and what the world now says part ways, and until
// now nothing told it. The next turn it built on a capture that never landed.
//
// A receipt is the difference, in sentences a model can act on. It rides on the
// head of world.simulationHistory, so a rollback restores the receipt that
// belongs to the restored turn and an exported game carries its own; only the
// newest turn keeps its notes (older entries keep the counts), so the polled
// world file never grows by more than one receipt.
//
// Import-free on purpose: gameState.js normalizes it on every read and write,
// gameplay.js fills and renders it, and both are tested under bare node.

export const RECEIPT_VERSION = 1;
export const RECEIPT_MAX_NOTES = 40;
export const RECEIPT_NOTE_MAX_CHARS = 280;

// What a note is about. The order is the order they are rendered in.
//
// "short" is what a strict retry used to say and no longer gets the chance to:
// while requests are being saved (AI/requestBudget.js) an answer that falls short
// of what was asked — too few events for the period — is kept rather than sent
// back, because sending it back is a whole second request. Nothing was lost, so
// it is none of the three kinds above it; the model is simply told, once, here.
export const RECEIPT_NOTE_KINDS = Object.freeze(["redone", "withheld", "dropped", "adjusted", "short"]);

// The impact arrays a turn can carry, in the order a reader cares about.
const APPLIED_KEYS = Object.freeze([
  "events",
  "regionTransfers",
  "regionControlOps",
  "regionClaims",
  "polityChanges",
  "politicalActorOps",
  "unitOps",
  "markerOps",
  "projectOps",
  "createdChats",
  "reports",
]);

const APPLIED_LABELS = Object.freeze({
  events: ["event", "events"],
  regionTransfers: ["region transfer", "region transfers"],
  regionControlOps: ["control operation", "control operations"],
  regionClaims: ["claim", "claims"],
  polityChanges: ["polity change", "polity changes"],
  politicalActorOps: ["political actor operation", "political actor operations"],
  unitOps: ["unit operation", "unit operations"],
  markerOps: ["structure operation", "structure operations"],
  projectOps: ["project operation", "project operations"],
  createdChats: ["new chat", "new chats"],
  reports: ["report", "reports"],
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : 0);
const array = (value) => (Array.isArray(value) ? value : []);

const clip = (text, max = RECEIPT_NOTE_MAX_CHARS) => {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

const emptyApplied = () => Object.fromEntries(APPLIED_KEYS.map((key) => [key, 0]));

export const createApplicationReceipt = () => ({
  version: RECEIPT_VERSION,
  applied: emptyApplied(),
  notes: [],
  // Notes that did not fit. Said out loud in the rendering, because a silent
  // cap is exactly the kind of quiet loss this module exists to end.
  omitted: 0,
});

// Null-safe everywhere: a caller that is not collecting passes null and every
// call below is a no-op, so the validators need no branches of their own.
export const noteReceipt = (receipt, kind, text) => {
  if (!receipt || !RECEIPT_NOTE_KINDS.includes(kind)) return;
  const line = clip(text);
  if (!line) return;
  // The same fact reported twice (a validator that ran again on a late salvage)
  // is one fact.
  if (receipt.notes.some((note) => note.kind === kind && note.text === line)) return;
  if (receipt.notes.length >= RECEIPT_MAX_NOTES) {
    receipt.omitted += 1;
    return;
  }
  receipt.notes.push({ kind, text: line });
};

// Folds a finished draft into the turn's receipt. A segment's validator may run
// several times before its answer is accepted; only the accepted run's draft is
// merged, so a rejected attempt's drops never reach the record.
export const mergeReceipts = (target, source) => {
  if (!target || !source) return target;
  for (const note of array(source.notes)) noteReceipt(target, note?.kind, note?.text);
  target.omitted += count(source.omitted);
  for (const key of APPLIED_KEYS) target.applied[key] += count(source.applied?.[key]);
  return target;
};

// Wraps a payload validator so that every run fills a draft of its own.
//
// A validator can run several times before an answer is taken: the strict first
// attempt, the salvaged retry, a late salvage of the first attempt's payload.
// Each of those may drop or change things, and only ONE of them is the answer
// that lands. So the wrapped validator gets a fresh draft as its third argument
// on every run; a run that returns clean hands its draft to onAccepted, and a run
// that returns a complaint hands the complaint to onRejected and its draft is
// discarded. The caller keeps the last accepted draft and merges it once the
// task has actually returned.
export const withReceiptDraft = (validate, { onAccepted, onRejected } = {}) =>
  async (candidate, options = {}) => {
    const draft = createApplicationReceipt();
    // Returned exactly as the validator wrote it: a complaint is the text of the
    // in-turn retry, line breaks and all, and this wrapper must not touch it.
    const verdict = await validate(candidate, options, draft);
    if (String(verdict ?? "").trim()) onRejected?.(String(verdict), options);
    else onAccepted?.(draft, options);
    return verdict;
  };

// An impact entry that does not survive normalization vanishes into a
// .filter(Boolean) — the event still narrates the change, and nothing happens.
// Compared from outside, by count, so the normalizers themselves stay the pure
// functions every save read depends on.
export const noteMalformedImpacts = (receipt, rawEvent, normalizedEvent) => {
  if (!receipt) return;
  const title = clean(normalizedEvent?.title || rawEvent?.title) || "(untitled)";
  if (!normalizedEvent) {
    noteReceipt(receipt, "withheld", `"${title}" — discarded: an event needs at least a title or a description.`);
    return;
  }
  for (const key of APPLIED_KEYS) {
    if (key === "events") continue;
    const before = array(rawEvent?.impacts?.[key]).length;
    const lost = before - array(normalizedEvent?.impacts?.[key]).length;
    if (lost <= 0) continue;
    noteReceipt(
      receipt,
      "dropped",
      `Event "${title}": ${lost} of ${plural(key, before)} ${lost === 1 ? "was" : "were"} malformed and ignored — a required field was missing or blank.`,
    );
  }
};

// Counts what the applied events carried. Called with the events that actually
// reached applyEventImpactsToWorld, after every screen and curator has run.
export const tallyAppliedEvents = (receipt, events) => {
  if (!receipt) return;
  for (const event of array(events)) {
    receipt.applied.events += 1;
    const impacts = event?.impacts;
    if (!impacts || typeof impacts !== "object") continue;
    for (const key of APPLIED_KEYS) {
      if (key === "events") continue;
      receipt.applied[key] += array(impacts[key]).length;
    }
  }
};

// The first sentence of a strict-attempt complaint. The full text can run to a
// 200-region vocabulary list that was already spent on the in-turn retry; next
// turn only needs to know what kind of mistake it was.
//
// A sentence ends at . ! or ? followed by a space and then a capital or an opening
// bracket. The capital matters: the validators write "(e.g. "Fall of Kassala")"
// and "regionId vs. regionName", and a first live run cut a complaint off at
// "(e.g." — a note that says nothing.
export const firstComplaintLine = (text, max = 220) => {
  const value = clean(text);
  if (!value) return "";
  const stop = value.search(/(?<=[.!?])\s+(?=[A-Z[])/);
  return clip(stop > 40 ? value.slice(0, stop) : value, max);
};

// Bounded and shape-checked, for persistence. keepNotes=false is how every
// entry but the newest is stored.
export const normalizeApplicationReceipt = (value, { keepNotes = true } = {}) => {
  if (!value || typeof value !== "object") return null;
  const applied = emptyApplied();
  for (const key of APPLIED_KEYS) applied[key] = count(value.applied?.[key]);
  const notes = [];
  if (keepNotes) {
    for (const note of array(value.notes)) {
      const kind = clean(note?.kind);
      const text = clip(note?.text);
      if (!RECEIPT_NOTE_KINDS.includes(kind) || !text) continue;
      if (notes.length >= RECEIPT_MAX_NOTES) break;
      notes.push({ kind, text });
    }
  }
  const omitted = count(value.omitted) + (keepNotes ? Math.max(0, array(value.notes).length - notes.length) : 0);
  return { version: RECEIPT_VERSION, applied, notes, omitted: keepNotes ? omitted : 0 };
};

export const receiptHasNotes = (receipt) => array(receipt?.notes).length > 0;

// Which turn record the next jump reports on: the newest one a JUMP wrote.
// world.simulationHistory also records Game Master interventions, resolved
// interactive events and the pregame bootstrap, newest first; none of those is an answer
// the simulator gave, so they are stepped over rather than mistaken for one. A
// last jump that predates receipts has nothing to report, and the search stops
// there — an older turn's receipt is not news.
const JUMP_MODES = new Set(["jump", "auto"]);
export const selectLastJumpRecord = (simulationHistory) => {
  for (const entry of array(simulationHistory)) {
    if (!entry || typeof entry !== "object") continue;
    if (!JUMP_MODES.has(clean(entry.mode).toLowerCase())) continue;
    return entry.receipt || clean(entry.source) === "fallback" ? entry : null;
  }
  return null;
};

const plural = (key, total) => `${total} ${APPLIED_LABELS[key][total === 1 ? 0 : 1]}`;

// "Withheld" covers two different fates — an event rejected as impossible, and a
// canonical one judged too routine to show — and the simulator needs the same
// thing from both: the record it is shown next turn does not contain them. Each
// note says which it was.
const KIND_HEADINGS = Object.freeze({
  redone: "Rejected and regenerated within the turn",
  withheld: "Events you wrote that did NOT reach the timeline — the record you are shown does not contain them",
  dropped: "Operations that were NOT applied — the map and records do not show them",
  adjusted: "Operations the engine changed before applying",
  short: "Kept exactly as you wrote it, but short of what was asked — meet it this turn",
});

// The block the next jump opens with. Empty when there was no previous turn to
// report on, so a fresh campaign's first prompt is byte-for-byte what it was.
export const renderApplicationReceipt = (receipt, {
  fromDate = "",
  toDate = "",
  source = "ai",
  fallbackReason = "",
} = {}) => {
  const normalized = normalizeApplicationReceipt(receipt);
  const span = fromDate && toDate ? ` (${clean(fromDate)} to ${clean(toDate)})` : "";

  // A turn the model did not write. It still needs to know: the period exists
  // on the record, thinly, and nothing it may remember drafting is in it.
  if (clean(source) === "fallback") {
    const why = clip(fallbackReason, 200);
    return [
      "[APPLICATION RESULT FROM YOUR LAST TURN]",
      `Your previous answer${span} could not be used${why ? ` (${why})` : ""}, so the engine advanced time with a minimal placeholder turn of its own.`,
      "Nothing you drafted for that period happened. Treat it as lightly documented and rely on the current map and records above.",
    ].join("\n");
  }

  if (!normalized) return "";
  const appliedParts = APPLIED_KEYS
    .filter((key) => normalized.applied[key] > 0)
    .map((key) => plural(key, normalized.applied[key]));
  if (appliedParts.length === 0 && normalized.notes.length === 0) return "";

  const lines = [
    "[APPLICATION RESULT FROM YOUR LAST TURN]",
    `What the engine actually did with your previous answer${span}. The current map and records above already reflect it, and they are the authority wherever your memory of that answer disagrees.`,
    appliedParts.length > 0 ? `Applied: ${appliedParts.join(", ")}.` : "Applied: nothing.",
  ];

  for (const kind of RECEIPT_NOTE_KINDS) {
    const notes = normalized.notes.filter((note) => note.kind === kind);
    if (notes.length === 0) continue;
    lines.push(`${KIND_HEADINGS[kind]}:`);
    for (const note of notes) lines.push(`- ${note.text}`);
  }
  if (normalized.omitted > 0) {
    lines.push(`(${normalized.omitted} further note${normalized.omitted === 1 ? "" : "s"} omitted for length.)`);
  }
  if (normalized.notes.some((note) => note.kind === "dropped" || note.kind === "withheld")) {
    lines.push(
      "Do not build on anything listed above as though it were established. If one still matters, make it happen again in this turn — "
      + "with a region's exact id or its exact name from the map, a unit id from the current-units list, and a project's exact name from the board.",
    );
  }
  return lines.join("\n");
};

// The whole read side in one call: the block for the newest jump on record, or "".
export const renderLastTurnReceipt = (simulationHistory) => {
  const record = selectLastJumpRecord(simulationHistory);
  if (!record) return "";
  return renderApplicationReceipt(record.receipt, {
    fallbackReason: record.fallbackReason,
    fromDate: record.fromDate,
    source: record.source,
    toDate: record.toDate,
  });
};
