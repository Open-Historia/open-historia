/*! Open Historia — events written but not put on the timeline © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/filedEvents.test.js
//
// A time skip shows its events as the model writes them, and then the engine's
// checks keep some of them off the timeline: routine patrols, small steps on a
// thread that already has several, restatements of the record. Those cards used
// to vanish when the turn landed — five on screen, three in the record — which
// reads as a bug. This is what the player is told instead: the card stays,
// greyed, with what happened to it in plain words.
//
// Two fates, because they are different facts:
//   off-timeline  it happened but is too small to show (the Board still reads it)
//   not-recorded  it did not happen: a restatement, or impossible in this world
//
// Import-free: gameplay.js fills it, gameState.js bounds it on every save, and
// the Events panel (GameUI/time.jsx) renders it, all under bare node for tests.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clip = (value, max) => {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export const FILED_EVENTS_MAX = 24;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 600;

export const FILED_FATES = Object.freeze({
  offTimeline: "off-timeline",
  notRecorded: "not-recorded",
});

const ROUTINE_MILITARY = "Routine military activity that changed nothing";
const UNFINISHED = "Work going on, with nothing finished yet";
const SMALL_STEP = "A small step on a thread that already has several";
const REPEAT = "Repeats an event already on the record";

// Route (the screen's and the curator's names) → what the player reads.
const ROUTES = Object.freeze({
  ROUTINE_MILITARY_PRECURATION: [FILED_FATES.offTimeline, ROUTINE_MILITARY],
  ROUTINE_MILITARY_NO_DELTA: [FILED_FATES.offTimeline, ROUTINE_MILITARY],
  SATURATED_ROUTINE_MILITARY_CHURN: [FILED_FATES.offTimeline, ROUTINE_MILITARY],
  ROUTINE_ADMINISTRATIVE_PROCESS: [FILED_FATES.offTimeline, UNFINISHED],
  NATIVE_PROCESS_FILLER: [FILED_FATES.offTimeline, UNFINISHED],
  LOW_VALUE_INCREMENTAL_CHURN: [FILED_FATES.offTimeline, SMALL_STEP],
  SATURATED_INCREMENTAL_REDUNDANCY: [FILED_FATES.offTimeline, SMALL_STEP],
  LOW_TRAJECTORY_FEED_SATURATION: [FILED_FATES.offTimeline, SMALL_STEP],
  EVIDENCED_REDUNDANCY: [FILED_FATES.offTimeline, REPEAT],
  RETRIEVAL_ASSISTED_REDUNDANCY: [FILED_FATES.offTimeline, REPEAT],
  EXACT_DUPLICATE: [FILED_FATES.notRecorded, REPEAT],
  NON_BELLIGERENT_WARTIME_CAUSALITY: [FILED_FATES.notRecorded, "Couldn't have happened: it assumes a war this country is not in"],
  UNSUPPORTED_REVERSAL: [FILED_FATES.notRecorded, "Contradicts what is already on the record"],
});

// A route added later falls back to the safe reading: not on the record.
export const describeFiledRoute = (route) => {
  const [fate, note] = ROUTES[clean(route)] || [FILED_FATES.notRecorded, "Kept off the timeline by the engine's checks"];
  return { fate, note };
};

// The short heading a card carries, before the note.
export const filedFateLabel = (fate) => (fate === FILED_FATES.offTimeline ? "Off the timeline" : "Not recorded");

// One removed event, from a screen or curator row ({ id, title, route, reason,
// event? }) and the event it came from when the row has only the title.
export const toFiledEvent = (row, event = null) => {
  const source = row?.event && typeof row.event === "object" ? row.event : event;
  const title = clip(row?.title || source?.title, TITLE_MAX);
  if (!title) return null;
  const route = clean(row?.route);
  const { fate, note } = describeFiledRoute(route);
  return {
    title,
    description: clip(source?.description, DESCRIPTION_MAX),
    date: clean(source?.date),
    route,
    fate,
    note,
  };
};

// Bounded and shape-checked, for persistence and for rendering. One card per
// title: a row can be noted by more than one pass.
export const normalizeFiledEvents = (value) => {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const title = clip(entry.title, TITLE_MAX);
    if (!title || seen.has(title.toLowerCase())) continue;
    const route = clean(entry.route);
    const described = describeFiledRoute(route);
    const fate = Object.values(FILED_FATES).includes(entry.fate) ? entry.fate : described.fate;
    seen.add(title.toLowerCase());
    out.push({
      title,
      description: clip(entry.description, DESCRIPTION_MAX),
      date: clean(entry.date),
      route,
      fate,
      note: clip(entry.note, 160) || described.note,
    });
    if (out.length >= FILED_EVENTS_MAX) break;
  }
  return out;
};

// The live preview's mark on a streamed card, from the screen's verdict
// ({ fate: "hide" | "reject", route }) — null when the card will be kept.
export const previewFiledMark = (verdict) => {
  if (!verdict || typeof verdict !== "object") return null;
  const route = clean(verdict.route);
  if (!route) return null;
  const { fate, note } = describeFiledRoute(route);
  return { route, fate: verdict.fate === "reject" ? FILED_FATES.notRecorded : fate, note };
};
