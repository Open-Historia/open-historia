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
import {
  HISTORY_TIERS,
  eraCharCount,
  hasHistoryTiers,
  judgeHistoryTiers,
  mergeHistoryTiers,
  normalizeCanonFacts,
  renderCanonFacts,
  renderHistoryTiers,
  yearOfDate,
} from "../../runtime/historyTiers.js";

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
  // the next skip, however many events pile up: the request of its own it was
  // once asked as went on 2026-11-07 (gameplay.js applySkipHistoryFold).
  // What a skip's answer has to give for its fold to be taken at all
  // (judgeSkipHistoryAnswer): a document of at least this many characters,
  // and at least half of what the campaign has (up to half the budget's
  // characters), or failing that a summary of this many, which is then
  // appended. Counted in characters, the prompt's measure, in every script:
  // words split on spaces made a whole Chinese or Japanese document one word,
  // and every fold of such a campaign was refused (runtime/historyTiers.js went
  // the same way). The floors are set where a summary in a script that says
  // much in few characters still passes.
  documentCharBudget: 9000,
  minDocumentChars: 240,
  minSummaryChars: 120,
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

// Whether a pass that comes back later (a batch job) still has something to
// fold in the campaign as it stands now. A pass that folded the same events —
// or, for a chats-only pass, the same closed chats — in the meantime
// supersedes it: two summaries of the same weeks would double the campaign's
// memory of them.
export const deferredConsolidationStillDue = ({ throughEvent = null, closedChats = [] } = {}, currentBundle) => {
  const world = normalizeWorldState(currentBundle?.world);
  if (throughEvent) {
    return getUnconsolidatedEvents(currentBundle?.events, world).some((event) => event.id === throughEvent.id);
  }
  const foldedChatIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.chatIds));
  return (Array.isArray(closedChats) ? closedChats : []).some((chat) => !foldedChatIds.has(chat?.id));
};

// The document as the consolidator should see it before a pass: the live one,
// or — for a campaign consolidated before the document existed — its ledger
// of pass summaries, which the first document pass rewrites into one text.
export const seedHistoryDocumentText = (worldLike) => {
  const world = normalizeWorldState(worldLike);
  // In tiers (runtime/historyTiers.js): the eras and years, every one, and any
  // note appended since the last fold that wrote them.
  if (hasHistoryTiers(world.historyDocument)) {
    return [renderHistoryTiers(world.historyDocument, { scale: 100 }), normalizeString(world.historyDocument.text)]
      .filter(Boolean).join("\n\n");
  }
  const live = normalizeString(world.historyDocument?.text);
  if (live) return live;
  return world.consolidatedHistory
    .map((entry) => `Through ${entry.throughDate || "an earlier date"}: ${entry.summary}`)
    .join("\n\n");
};

// The call-time instruction for the eventConsolidator task. Every campaign
// carries frozen prompt templates, so the document and the rules for revising
// it cannot live in the template; runJsonTask appends this to the prompt.
// The years a pass's material covers, [first, last], from the dates of its
// events (an event without a year is not counted); null when none has one.
export const yearSpanOf = (events) => {
  const years = (Array.isArray(events) ? events : []).map((event) => yearOfDate(event?.date)).filter(Number.isFinite);
  return years.length ? [Math.min(...years), Math.max(...years)] : null;
};

// The history in tiers (runtime/historyTiers.js): what a pass returns besides
// its summary. `span` is the years its material covers (yearSpanOf).
export const HISTORY_TIERS_OUTPUT = "{\"summary\": \"<this period's compressed history>\", \"years\": [{\"year\": 1936, \"text\": \"<the whole paragraph for that year>\"}], \"canon\": [{\"date\": \"YYYY-MM-DD\", \"kind\": \"treaty\", \"text\": \"<the fact>\", \"key\": \"<an office, or empty>\"}]}";
export const buildHistoryDocumentDirective = (worldLike, { span = null } = {}) => {
  const world = normalizeWorldState(worldLike);
  // Counted in characters, the prompt's measure: words split on spaces made a
  // paragraph in Chinese or Japanese one word long (runtime/historyTiers.js).
  const eraChars = eraCharCount(world.historyDocument);
  const condense = eraChars > HISTORY_TIERS.eraChars;
  const yearsCovered = Array.isArray(span) ? (span[0] === span[1] ? `${span[0]}` : `${span[0]} to ${span[1]}`) : "";
  const canon = renderCanonFacts(world.canonFacts, { maxChars: 3000 });
  const current = seedHistoryDocumentText(world);
  return [
    "[History Document]",
    "The campaign keeps its history in parts, and this call maintains them. The events, conversations and orders below are never sent to the simulation again, so whatever these parts leave out is gone for good. Return:",
    "- \"summary\": this period's compressed history on its own, a few paragraphs covering the material below.",
    `- "years": a paragraph for each game year the material below covers${yearsCovered ? ` (${yearsCovered})` : ""}, {"year": 1936, "text": "..."}: the WHOLE paragraph as that year should read from now on, keeping what its current paragraph below already says and folding the new material in. Standing facts rather than narration, at most 250 words a year.`,
    "- \"canon\": the facts in the material below that must never fade, one each, {\"date\": \"YYYY-MM-DD\", \"kind\": \"treaty | death | regime | border | office | war | other\", \"text\": \"...\", \"key\": \"...\"}: a treaty signed or broken, the death of a ruler or leader, a regime that fell or rose, a border or an annexation, who now holds an office (key: the office, such as \"Chancellor of Germany\", so that a later holder replaces this one), a war begun or ended. Only what is new here: the canon the campaign has is listed below and kept as it is. An empty list when nothing in the material is of that weight.",
    ...(condense
      ? [`- "eras": the earlier years below run to ${eraChars} characters, over the ${HISTORY_TIERS.eraChars} they are kept within: return them condensed, the whole list, {"from": 1900, "to": 1920, "text": "..."}, an era a paragraph. Condense the least important first (minor incidents, interim states that later ones superseded, the detail of episodes that changed nothing lasting) and keep every divergence from real history, the cause and state of every war and crisis still running, and every commitment still in force.`]
      : []),
    "Never drop, however old: how this world has diverged from real history; the causes and current state of every war and crisis still running; borders, regimes and polities that changed; treaties, alliances, occupations, debts and grievances still in force; and the lasting consequences of the player's own orders. Refer to polities by their full names and never to \"the player\".",
    ...(canon ? [canon] : ["The campaign has no canon yet."]),
    current ? `The history as it stands (fold the new material into its years):\n${current}` : "There is no history yet: write the years of the material below.",
  ].join("\n");
};

// What a finished pass does to the document. The consolidator's revised text
// replaces the document when it was written against the current revision. A
// pass that came back without one (an older prompt, the deterministic
// fallback), or against a document edited by hand in the meantime, appends
// its own summary under a dated heading instead, so nothing is lost.
//
// `tiers` ({ years, eras, canon }, a pass's answer as it came) are taken entry
// by entry (judgeHistoryTiers, with `span`, the years its material covers):
// years and eras written in (mergeHistoryTiers; a document from before them
// becomes the first era, from `startYear`), and the canon added to the
// campaign's. The answer's `canonFacts` is the campaign's canon after it,
// which the caller writes to world.canonFacts.
export const applyHistoryDocumentUpdate = (worldLike, {
  document = "",
  summary = "",
  source = "ai",
  throughDate = "",
  throughEventId = "",
  throughRound = 0,
  baseRevision = null,
  tiers = null,
  span = null,
  startYear = NaN,
} = {}) => {
  const world = normalizeWorldState(worldLike);
  const current = world.historyDocument;
  const judged = tiers ? judgeHistoryTiers(tiers, { span, eraChars: eraCharCount(current) }) : null;
  const canonFacts = judged?.canon.length ? normalizeCanonFacts([...world.canonFacts, ...judged.canon]) : world.canonFacts;
  if (judged && (judged.years.length || judged.eras)) {
    const merged = mergeHistoryTiers(current, judged, { startYear });
    return {
      mode: "tiered",
      canonFacts,
      notes: judged.notes,
      historyDocument: {
        // A note appended since the last fold that wrote years was shown to
        // this one, which folded it in.
        text: "",
        years: merged.years,
        eras: merged.eras,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        source,
        throughDate: throughDate || current?.throughDate || "",
        throughEventId: throughEventId || current?.throughEventId || "",
        throughRound: throughRound || current?.throughRound || 0,
      },
    };
  }
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
    return { historyDocument: current, mode: "unchanged", canonFacts };
  }
  return {
    mode: rewrite ? "rewritten" : "appended",
    canonFacts,
    historyDocument: {
      ...(current?.years ? { years: current.years } : {}),
      ...(current?.eras ? { eras: current.eras } : {}),
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
// The job's two fences, for what reads the assembled prompt (promptDedupe.js collapseRepeatsInsideJob).
export const HISTORY_JOB_FENCES = Object.freeze({ begin: historyJobFence("BEGINNING"), end: historyJobFence("END") });

// `brief`: the system prompt the consolidator's own request would have carried.
export const buildSkipHistoryJob = (brief) => {
  const text = normalizeString(brief);
  if (!text) return "";
  return [
    historyJobFence("BEGINNING"),
    "One more job rides on this answer, and it is separate from the period you are simulating: the campaign's older history is due to be folded into its history document. Everything between these two fence lines is that job's own brief. The role it gives you, its inputs and its rules belong to it alone, and nothing in it changes how you write the events.",
    `Do it LAST, after the events and everything else, and put its answer in the "${HISTORY_FIELD}" field: ${HISTORY_TIERS_OUTPUT}, with "eras" too where the brief asks for them. Where the brief tells you to return JSON, to use a tool, or shows an output format, that describes the content of this one field.`,
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
//
// An answer in tiers (years, eras, canon: runtime/historyTiers.js) is judged
// entry by entry against `span`, the years the fold covers, and `eraChars`, the
// characters the campaign's eras have; it is taken when any of its tiers is,
// and its parts come back as `tiers` for applyHistoryDocumentUpdate.
export const judgeSkipHistoryAnswer = (answer, { currentText = "", span = null, eraChars = 0 } = {}) => {
  const source = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : null;
  const summary = normalizeString(source?.summary);
  if (!summary) {
    return { ok: false, summary: "", document: "", reason: source ? "its history had no summary" : "it carried no history" };
  }
  const judged = judgeHistoryTiers(source, { span, eraChars });
  if (judged.years.length || judged.eras) {
    return {
      ok: true,
      summary,
      document: "",
      tiers: { years: judged.years, eras: judged.eras, canon: judged.canon },
      reason: judged.notes.length ? `parts of its history were left out: ${judged.notes.join("; ")}` : "",
    };
  }
  // Canon with a document or a summary: the canon is kept with whichever is.
  const canonOnly = judged.canon.length ? { tiers: { years: [], eras: null, canon: judged.canon } } : {};
  const { documentCharBudget, minDocumentChars, minSummaryChars } = HISTORY_CONSOLIDATION;
  const document = normalizeString(source?.document);
  const before = normalizeString(currentText).length;
  const written = document.length;
  // Half of what the campaign has, or of the budget when it has more than that:
  // a document condensed to its budget is still a document.
  const floor = Math.max(minDocumentChars, Math.min(before, documentCharBudget) * 0.5);
  if (document && written >= floor) return { ok: true, summary, document, reason: "", ...canonOnly };
  const why = document
    ? `its document came back at ${written} character${written === 1 ? "" : "s"} against the ${before} the campaign has`
    : "it gave no document";
  if (summary.length < minSummaryChars) {
    return { ok: false, summary: "", document: "", reason: `${why}, and its summary is too short to stand for what it would replace` };
  }
  return { ok: true, summary, document: "", reason: `${why}; its summary is appended instead`, ...canonOnly };
};

// The plain-words state the Cheats tool shows above the document.
export const describeHistoryConsolidation = (bundle) => {
  const plan = planHistoryConsolidation(bundle);
  const world = normalizeWorldState(bundle?.world);
  const passes = world.consolidatedHistory.length;
  const since = plan.unconsolidatedEvents.length;
  const { sizeThreshold, intervalRounds, retainEvents, documentWordBudget } = HISTORY_CONSOLIDATION;
  const documentWords = countWords(seedHistoryDocumentText(world));
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
