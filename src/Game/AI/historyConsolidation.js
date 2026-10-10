/*! Open Historia — history consolidation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Consolidation keeps ONE living history document (world.historyDocument).
// The first pass writes it from the oldest events; every later pass rewrites
// it — the next period folded in, and once the document is over its word
// budget the least important older material condensed or dropped to make
// room. The event log is never touched: every event stays in the save in
// full, and a pass only moves the boundary the AI reads from
// (getUnconsolidatedEvents, promptContext.js). world.consolidatedHistory is
// the ledger of passes — each one's boundary, the chat and order ids it
// folded, and its own addition — which is also what a campaign consolidated
// before the document existed is shown until the first document pass. This
// module is what the turn, the Cheats panel's History Document tool and the
// tests all agree through.
import { normalizeActions, normalizeChats, normalizeWorldState } from "../../runtime/gameState.js";
import { HISTORY_FIELD } from "./gameplaySchemas.js";
import { getUnconsolidatedEvents } from "./promptContext.js";

const normalizeString = (value) => String(value ?? "").trim();

export const HISTORY_CONSOLIDATION = Object.freeze({
  // A turn consolidates on its own when this many events have piled up since
  // the last pass…
  sizeThreshold: 48,
  // …or on every round that is a multiple of this, once more than the
  // retained tail has piled up.
  intervalRounds: 5,
  // The newest events are always shown in full, never folded.
  retainEvents: 24,
  // One pass folds at most this many events / orders; the rest wait.
  batchSize: 60,
  // The document is kept near the budget; past the ceiling the consolidator
  // must condense or drop older material to make room for the new period.
  documentWordBudget: 1500,
  documentWordCeiling: 1800,
  // A fold a time skip carried and got no usable answer for simply waits for
  // the next skip. Past this many unfolded events it has waited long enough,
  // and is asked for as a request of its own (gameplay.js compactHistoryIfNeeded).
  ownRequestThreshold: 96,
  // What a skip's answer has to give for its fold to be taken at all
  // (judgeSkipHistoryAnswer): a document of at least this many words, or
  // failing that a summary of this many, which is then appended.
  minDocumentWords: 80,
  minSummaryWords: 40,
});

export const countWords = (text) => {
  const normalized = normalizeString(text);
  return normalized ? normalized.split(/\s+/).length : 0;
};

// Returns what this pass would fold and why. `force` (the Cheats tool) skips
// the round/size thresholds but still keeps the retained tail in full. `round`
// stands in for the game's own: a time skip plans its fold before it runs, for
// the round it is about to produce (gameplay.js prepareSkipHistoryFold).
export const planHistoryConsolidation = (bundle, { force = false, round: asRound = null } = {}) => {
  const world = normalizeWorldState(bundle?.world);
  const unconsolidatedEvents = getUnconsolidatedEvents(bundle?.events, world);
  const round = Number.isFinite(Number(asRound)) && asRound !== null ? Number(asRound) : Number(bundle?.game?.round) || 0;
  const { sizeThreshold, intervalRounds, retainEvents, batchSize } = HISTORY_CONSOLIDATION;

  const overSize = unconsolidatedEvents.length > sizeThreshold;
  const intervalDue = round > 0 && round % intervalRounds === 0 && unconsolidatedEvents.length > retainEvents;
  const forced = force && unconsolidatedEvents.length > retainEvents;
  const shouldCompactEvents = overSize || intervalDue || forced;
  const reason = overSize ? "size" : intervalDue ? "interval" : forced ? "forced" : "";

  const priorChatIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.chatIds));
  const closedChats = normalizeChats(bundle?.chats)
    .filter((chat) => chat.status === "closed" && !priorChatIds.has(chat.id));
  const eventsToConsolidate = shouldCompactEvents
    ? unconsolidatedEvents.slice(0, -retainEvents).slice(0, batchSize)
    : [];

  // Resolved orders ride along with the events they caused; ones already folded
  // into an earlier pass are skipped.
  const priorActionIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.actionIds));
  const actionsToConsolidate = eventsToConsolidate.length === 0 && closedChats.length === 0
    ? []
    : normalizeActions(bundle?.actions)
      .filter((action) => action.status !== "planned" && action.id && !priorActionIds.has(action.id))
      .slice(0, batchSize);

  return {
    unconsolidatedEvents,
    eventsToConsolidate,
    closedChats,
    actionsToConsolidate,
    throughEvent: eventsToConsolidate.at(-1) ?? null,
    due: eventsToConsolidate.length > 0 || closedChats.length > 0,
    reason,
  };
};

// The document as the consolidator should see it before a pass: the live one,
// or — for a campaign consolidated before the document existed — its ledger
// of pass summaries, which the first document pass rewrites into one text.
export const seedHistoryDocumentText = (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const live = normalizeString(world.historyDocument?.text);
  if (live) return live;
  return world.consolidatedHistory
    .map((entry) => `Through ${entry.throughDate || "an earlier date"}: ${entry.summary}`)
    .join("\n\n");
};

// The call-time instruction for the eventConsolidator task. Every campaign
// carries frozen prompt templates, so the document and the rules for revising
// it cannot live in the template; runJsonTask appends this to the prompt.
export const buildHistoryDocumentDirective = (worldLike) => {
  const { documentWordBudget, documentWordCeiling } = HISTORY_CONSOLIDATION;
  const current = seedHistoryDocumentText(worldLike);
  const words = countWords(current);
  const lines = [
    "[History Document]",
    "The campaign keeps ONE living history document, and this call maintains it. Return two fields: \"summary\" — this period's compressed history on its own, a few paragraphs covering the material below — and \"document\" — the WHOLE history document as it should read from now on, with this period folded in. The document replaces what it covers: the events, conversations and orders below are never sent to the simulation again, and the previous version of the document is discarded, so whatever the new document leaves out is gone for good.",
    `Keep the document near ${documentWordBudget} words and never above ${documentWordCeiling}. When folding the new period in would take it past that, make room by condensing or removing the LEAST important older material first: minor incidents, routine notes, interim states that later developments superseded, and the detail of concluded episodes that changed nothing lasting. Never remove, however old: how this world has diverged from real history; the causes and current state of every war and crisis still running; borders, regimes and polities that changed; treaties, alliances, occupations, debts and grievances still in force; and the lasting consequences of the player's own orders. When something is condensed, keep its date range and its outcome.`,
    "Keep the document in chronological order under date-range headings, written as standing facts rather than narration; refer to polities by their full names and never to \"the player\".",
  ];
  if (!current) {
    lines.push("There is no history document yet: write the first one from the material below.");
  } else {
    const overBudget = words > documentWordBudget ? ` — over the ${documentWordBudget}-word budget, so condense it` : "";
    lines.push(`The current document (${words} words${overBudget}) follows. Fold the new period into it and return the whole revised text as "document":\n${current}`);
  }
  return lines.join("\n");
};

// What a finished pass does to the document. The consolidator's revised text
// replaces the document when it was written against the current revision. A
// pass that came back without one (an older prompt, the deterministic
// fallback), or against a document edited by hand in the meantime, appends
// its own summary under a dated heading instead, so nothing is lost.
export const applyHistoryDocumentUpdate = (worldLike, {
  document = "",
  summary = "",
  source = "ai",
  throughDate = "",
  throughEventId = "",
  throughRound = 0,
  baseRevision = null,
} = {}) => {
  const current = normalizeWorldState(worldLike).historyDocument;
  const revised = normalizeString(document);
  const addition = normalizeString(summary);
  const currentRevision = current?.revision ?? 0;
  const baseMatches = !current || baseRevision == null || baseRevision === currentRevision;
  const rewrite = Boolean(revised) && (baseMatches || !addition);
  let text = "";
  if (rewrite) {
    text = revised;
  } else if (addition) {
    text = [current?.text, `Through ${throughDate || "the latest pass"}:\n${addition}`].filter(Boolean).join("\n\n");
  } else {
    return { historyDocument: current, mode: "unchanged" };
  }
  return {
    mode: rewrite ? "rewritten" : "appended",
    historyDocument: {
      text,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
      source,
      throughDate: throughDate || current?.throughDate || "",
      throughEventId: throughEventId || current?.throughEventId || "",
      throughRound: throughRound || current?.throughRound || 0,
    },
  };
};

// --- Folded into a time skip ---
//
// A time skip is ONE request (requestBudget.js), so a fold that is due gets no
// request of its own: it rides on the skip as a separate job, fenced off from
// the period being simulated the way the turn review fences its jobs
// (turnReview.js), and its answer comes back in one field of the skip's answer.
// The job's text is the consolidator's own prompt, whole: its template, with
// whatever guidance the scenario's author gave it, the material to fold and the
// document directive above. What it covers is decided BEFORE the skip
// (planHistoryConsolidation with the round the skip is about to produce), so
// the events the skip itself writes are never part of it. The field is
// HISTORY_FIELD (gameplaySchemas.js, beside the contract that declares it).
const historyJobFence = (edge) => `########## ${edge} OF A SEPARATE JOB: THE HISTORY DOCUMENT ##########`;

// `brief`: the system prompt the consolidator's own request would have carried.
export const buildSkipHistoryJob = (brief) => {
  const text = normalizeString(brief);
  if (!text) return "";
  return [
    historyJobFence("BEGINNING"),
    "One more job rides on this answer, and it is separate from the period you are simulating: the campaign's older history is due to be folded into its history document. Everything between these two fence lines is that job's own brief. The role it gives you, its inputs and its rules belong to it alone, and nothing in it changes how you write the events.",
    `Do it LAST, after the events and everything else, and put its answer in the "${HISTORY_FIELD}" field: {"summary": "<this period's compressed history>", "document": "<the whole revised history document>"}. Where the brief tells you to return JSON, to use a tool, or shows an output format, that describes the content of this one field.`,
    "It covers ONLY the events, conversations and orders its brief lists. The events you write in this answer are not part of it: they are folded on a later turn.",
    "",
    text,
    historyJobFence("END"),
  ].join("\n");
};

// What a skip's answer gave for the job, read before anything is folded,
// because a fold is for good: what it covers is never shown to the simulation
// again. `ok` only when there is something to keep those events in.
//
// A document is taken when it reads like a whole one. A model that ran out of
// room writes the summary and a stub of a document: taking the stub would throw
// the campaign's memory away, so then the document is left out and the summary
// is appended to the one the campaign has (applyHistoryDocumentUpdate does that
// for a pass that came back without a document). A summary too short to stand
// for the events it replaces is no fold at all: it waits for the next skip.
export const judgeSkipHistoryAnswer = (answer, { currentText = "" } = {}) => {
  const source = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : null;
  const summary = normalizeString(source?.summary);
  if (!summary) {
    return { ok: false, summary: "", document: "", reason: source ? "its history had no summary" : "it carried no history" };
  }
  const { documentWordBudget, minDocumentWords, minSummaryWords } = HISTORY_CONSOLIDATION;
  const document = normalizeString(source?.document);
  const before = countWords(currentText);
  const written = countWords(document);
  // Half of what the campaign has, or of the budget when it has more than that:
  // a document condensed to its budget is still a document.
  const floor = Math.max(minDocumentWords, Math.min(before, documentWordBudget) * 0.5);
  if (document && written >= floor) return { ok: true, summary, document, reason: "" };
  const why = document
    ? `its document came back at ${written} word${written === 1 ? "" : "s"} against the ${before} the campaign has`
    : "it gave no document";
  if (countWords(summary) < minSummaryWords) {
    return { ok: false, summary: "", document: "", reason: `${why}, and its summary is too short to stand for what it would replace` };
  }
  return { ok: true, summary, document: "", reason: `${why}; its summary is appended instead` };
};

// The plain-words state the Cheats tool shows above the document.
export const describeHistoryConsolidation = (bundle) => {
  const plan = planHistoryConsolidation(bundle);
  const world = normalizeWorldState(bundle?.world);
  const passes = world.consolidatedHistory.length;
  const since = plan.unconsolidatedEvents.length;
  const { sizeThreshold, intervalRounds, retainEvents, documentWordBudget } = HISTORY_CONSOLIDATION;
  const documentWords = countWords(world.historyDocument?.text);
  const documentText = world.historyDocument
    ? `The history document is ${documentWords} words of a ${documentWordBudget}-word budget (revision ${world.historyDocument.revision}, ${world.historyDocument.source === "manual" ? "last edited by hand" : "last written by the AI"}${world.historyDocument.throughDate ? `, through ${world.historyDocument.throughDate}` : ""}).`
    : passes > 0
      ? `No history document yet: the AI is shown the ${passes} pass ${passes === 1 ? "summary" : "summaries"} below until the next pass writes the document.`
      : "No history document yet: nothing has been folded.";
  return {
    passes,
    eventsSinceLastPass: since,
    dueNow: plan.due,
    documentWords,
    documentWordBudget,
    text: `${since} event${since === 1 ? "" : "s"} since the last pass. A turn folds them by itself once more than ${sizeThreshold} have piled up, or on every ${intervalRounds}th round once more than ${retainEvents} have; the newest ${retainEvents} always stay in full. ${documentText}`,
  };
};
