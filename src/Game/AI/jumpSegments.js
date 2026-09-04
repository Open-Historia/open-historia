/*! Open Historia — segmented timeline jumps © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Splitting one long time skip into several shorter model calls, and putting the
// answers back together as the SINGLE round the player asked for.
//
// Why: a nine-month skip asks one request for 30-odd events, each carrying its
// own impacts — territory, units, markers, projects, diplomacy. That is tens of
// minutes of generation on a hosted provider, sent as one HTTP request with no
// bytes crossing the wire until it finishes, and a gateway closes it long before
// it does. The field report behind this was a 502 at exactly 301.7s on an
// endpoint that was answering every other task fine, which cost the player a turn
// with fourteen queued orders in it. A quarter-sized call finishes well inside
// any proxy window.
//
// The segments are a TRANSPORT detail and must never leak into the fiction. They
// are merged and applied once, so the round advances exactly once (see
// applySimulationResult), and the model is told explicitly that it is mid-round —
// otherwise segment two treats segment one's events as things the player saw and
// failed to answer, and punishes them for a silence they had no chance to break.
//
// Kept import-free and separate from gameplay.js (which pulls in the whole
// browser runtime and cannot be unit-tested) for the same reason as
// jsonSalvage.js, providerErrors.js and geminiSchema.js — the arithmetic and the
// merge rules are exactly what wants direct tests.

const normalizeString = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Below this, one request is comfortably fast enough and splitting would only add
// round trips and re-send the prompt for nothing.
export const SEGMENTED_JUMP_MIN_DAYS = 120;
// A quarter. Chosen to line up with eventCountRangeForDays' [10, 13] band, so
// three segments of a nine-month jump ask for 30-39 events against the 29-37 a
// single call would have — the same story, in thirds.
export const SEGMENT_TARGET_DAYS = 92;

// Whole days per segment, as near equal as they divide. The remainder is spread
// one day at a time from the front rather than dumped on the last segment, which
// would leave a stub segment asking for a quarter's worth of events from a week.
export const planJumpSegments = (dateStep) => {
  const total = Math.max(0, Math.round(Number(dateStep) || 0));
  if (total <= 0) return [total];
  const count = Math.max(1, Math.round(total / SEGMENT_TARGET_DAYS));
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const spans = [];
  for (let index = 0; index < count; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    spans.push(base + extra);
  }
  return spans;
};

// How many events a span of days should produce. Moved here from gameplay.js so
// the segment planner and the counts it drives can be tested together.
export const eventCountRangeForDays = (days) => {
  if (days < 1) return [1, 1];   // sub-day skip (e.g. 6 hours)
  if (days <= 7) return [1, 2];
  if (days <= 31) return [5, 7];
  if (days <= 92) return [10, 13];
  if (days <= 184) return [19, 27];
  return [29, 37];
};

// Human-readable label for the skipped span, used in the AI prompt. Collapses
// whole-day counts into weeks/months/years where they divide evenly.
export const formatDurationLabel = (days) => {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const whole = Math.round(days);
  const pluralize = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (whole % 365 === 0) return pluralize(whole / 365, "year");
  if (whole % 30 === 0) return pluralize(whole / 30, "month");
  if (whole % 7 === 0) return pluralize(whole / 7, "week");
  return pluralize(whole, "day");
};

// The per-segment event floor. The whole-jump rule guarantees a slot for every
// queued order to resolve into; split across segments it becomes each segment's
// share, so fourteen queued orders raise the floor once across the jump instead
// of demanding fourteen events three times over.
export const segmentEventRange = (spanDays, plannedActionShare) => {
  let [minEvents, maxEvents] = eventCountRangeForDays(spanDays);
  if (plannedActionShare > minEvents) {
    minEvents = Math.min(plannedActionShare, 37);
    maxEvents = Math.max(maxEvents, minEvents + 3);
  }
  return [minEvents, maxEvents];
};

const MAX_BRIEFING_EVENTS = 40;
const MAX_BRIEFING_DESCRIPTION = 200;

// What the earlier segments already wrote, compact enough to re-send each time.
// The world is NOT advanced between segments (that would mint extra rounds), so
// this text is the only continuity the next call gets.
export const buildSegmentBriefing = (priorEvents) => {
  const events = asArray(priorEvents).slice(-MAX_BRIEFING_EVENTS);
  if (events.length === 0) return "";
  return events
    .map((event) => {
      const date = normalizeString(event?.date) || "undated";
      const title = normalizeString(event?.title) || "(untitled)";
      const description = normalizeString(event?.description);
      const trimmed = description.length > MAX_BRIEFING_DESCRIPTION
        ? `${description.slice(0, MAX_BRIEFING_DESCRIPTION).trimEnd()}…`
        : description;
      return `- ${date}: ${title}${trimmed ? ` — ${trimmed}` : ""}`;
    })
    .join("\n");
};

// The instruction for one segment.
//
// A single-segment jump returns EXACTLY the wording it always had: a jump that
// does not need splitting must not be told anything about segments, and the
// prompt it sends should be byte-identical to the one before this existed.
export const buildSegmentInstruction = ({
  mode = "jump",
  segmentIndex = 0,
  segmentCount = 1,
  minEvents,
  maxEvents,
  durationLabel,
  segmentDurationLabel,
  originDate,
  targetDate,
  segmentTargetDate,
  priorEvents = [],
} = {}) => {
  const autoMessage =
    "Simulate an auto-jump and stop at the next notable or player-relevant event. Return JSON only. " +
    "Scale the events array to the time actually covered before your stop point: roughly 1-2 events per week, " +
    "5-7 per month, 10-13 per quarter, up to 29-37 for a full year — spread their dates across the covered period.";
  const jumpMessage =
    `Simulate a standard jump forward to the requested target date. Return JSON only. The "events" array must ` +
    `contain between ${minEvents} and ${maxEvents} events (this jump covers ${durationLabel}), with their dates ` +
    `spread across the skipped period.`;

  if (segmentCount <= 1) return mode === "auto" ? autoMessage : jumpMessage;

  const position = `segment ${segmentIndex + 1} of ${segmentCount}`;
  const lines = [
    `[One Round, Simulated In Segments] This is ${position} of a SINGLE round covering `
    + `${originDate} to ${targetDate}. The segments exist only so the simulation can be generated in `
    + `pieces — in the game's fiction this is one continuous stretch of time, not ${segmentCount} turns.`,
    "",
    `Simulate ONLY ${segmentIndex === 0 ? originDate : "the period after the last segment"} up to `
    + `${segmentTargetDate}, and set "stopDate" to ${segmentTargetDate}. The "events" array must contain `
    + `between ${minEvents} and ${maxEvents} events (this segment covers ${segmentDurationLabel}), with their `
    + "dates spread across that span. Return JSON only.",
  ];

  if (segmentIndex > 0) {
    const briefing = buildSegmentBriefing(priorEvents);
    lines.push(
      "",
      "[What Has Already Happened This Round]",
      briefing || "(nothing yet)",
      "",
      // The requirement this whole mechanism has to protect. Without it the model
      // reads the briefing as history the player lived through and stayed silent
      // on, and writes the consequences of an inaction that never happened.
      "CRITICAL: the events above happened DURING this same round, while the simulation was still "
      + "running. The player has issued no new orders since the round began and COULD NOT have "
      + "reacted to any of them — there was no point at which they were asked to. Do NOT portray "
      + "them as passive, negligent, hesitant, caught off guard, or silent; do NOT let other powers "
      + "exploit, punish, or remark upon a failure to respond; and do NOT open events with the "
      + "player's lack of an answer. Their queued orders for this round cover this whole period and "
      + "may keep developing across it. Continue the story forward from where the last segment "
      + "ended, and do not restate, rephrase or re-narrate any event listed above.",
    );
  }

  return lines.join("\n");
};

// One turn's worth of result out of every segment's payload.
//
// Merge rules, and why each is what it is:
//   events              concatenated in order — the round's story, start to end.
//   stopDate            the last segment's own, falling back to the requested
//                       target — the same precedence the single-call path has
//                       always had, which auto-jumps depend on because they stop
//                       early ON PURPOSE at the next notable moment.
//   summary             the segment summaries in order; each covers its own span,
//                       so joining them describes the whole period without asking
//                       any one call to summarise time it never saw.
//   catalyst            the LAST one offered. A catalyst is a scene the player
//                       answers AFTER the jump, so it has to hang off the end of
//                       the period, not the middle of it.
//   diplomaticOutreach  concatenated — every approach made during the round.
//   clearActions        the final segment's word, keeping the `!== false` default
//                       (absent means resolved) the single-call path has always had.
const asLedgerRecords = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
};

export const mergeSegmentPayloads = (payloads, { targetDate = "" } = {}) => {
  const segments = asArray(payloads).filter(Boolean);
  const events = [];
  const diplomaticOutreach = [];
  // Ledger records (warUpdates / relationUpdates / agreementUpdates). By the
  // time a segment is accepted its records are bound to that segment's own
  // event ids (gameplay.js validateSegmentLedgers), so they simply concatenate;
  // a record still in its raw line form is split into lines, which the ledger
  // decoders accept too.
  const warUpdates = [];
  const relationUpdates = [];
  const agreementUpdates = [];
  const summaries = [];
  let catalyst = null;
  let clearActions = true;
  let stopDate = "";

  for (const payload of segments) {
    events.push(...asArray(payload.events));
    diplomaticOutreach.push(...asArray(payload.diplomaticOutreach));
    warUpdates.push(...asLedgerRecords(payload.warUpdates));
    relationUpdates.push(...asLedgerRecords(payload.relationUpdates));
    agreementUpdates.push(...asLedgerRecords(payload.agreementUpdates));
    const summary = normalizeString(payload.summary);
    if (summary) summaries.push(summary);
    if (payload.catalyst) catalyst = payload.catalyst;
    clearActions = payload.clearActions !== false;
    const segmentStop = normalizeString(payload.stopDate);
    if (segmentStop) stopDate = segmentStop;
  }

  return {
    catalyst,
    clearActions,
    agreementUpdates,
    diplomaticOutreach,
    events,
    relationUpdates,
    stopDate: stopDate || normalizeString(targetDate),
    warUpdates,
    summary: summaries.join("\n\n"),
  };
};
