/*! Open Historia — related past events, found on this device © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Related past events: always on, on this device (the model ships with the game).
//
// A long campaign's old events leave the prompt: they are folded into the
// story so far, or fall out of the window of recent events. The war the
// player restarts three years later, the treaty an order now breaks, the
// rebellion a storyline grew out of, are then known to the model only as a
// line of summary. So each event is turned into a vector on the
// device (runtime/embeddingModels.js, embeddingWorker.js), and a time skip is
// given the six past events nearest to what this turn is about: the player's
// orders, the live wars, the storylines and the powers in focus. They go
// beside the history as "RELATED PAST EVENTS", in about 2,000 characters,
// never one the prompt already shows. No AI request is made for any of it.
//
// Pure: the search (relatedEventsSearch.js), the prompt (promptContext.js) and
// the tests call it.

import { cosine, eventEmbeddingText } from "../../runtime/embeddingModels.js";
import { compareGameDates } from "../../runtime/gameDates.js";

export const RELATED_EVENTS_LIMIT = 6;
export const RELATED_EVENTS_MAX_CHARS = 2000;
// Each event's line: its digest (a one-line summary a newer skip writes), or
// the start of its description.
export const RELATED_LINE_CHARS = 200;
// How many candidates the search hands the prompt, best first: the prompt
// drops those it shows and keeps the first six of the rest.
export const RELATED_CANDIDATES = 30;
// Below this the nearest event is not related, only nearest.
export const RELATED_MIN_SCORE = 0.25;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

// The save's events, oldest first, as kept (an array, or keyed by round).
export const eventList = (events) => {
  if (Array.isArray(events)) return events.filter((event) => event && typeof event === "object");
  if (events && typeof events === "object") {
    if (Array.isArray(events.events)) return eventList(events.events);
    return Object.values(events).filter((event) => event && typeof event === "object");
  }
  return [];
};

// The events a vector can be kept for: with an id of their own (a scenario's
// bare string event gets a new one each time it is read) and some text.
export const embeddableEvents = (events) => eventList(events)
  .map((event) => ({ id: clean(event.id), text: eventEmbeddingText(event) }))
  .filter((entry) => entry.id && entry.text);

// ---------------------------------------------------------------------------
// The query: what this turn is about.

const LIVE_WAR = new Set(["active", "ceasefire"]);
const LIVE_STORY = new Set(["active", "dormant"]);
const PENDING = (action) => (clean(action?.status) || "planned") === "planned";
export const RELATED_QUERY_LIMIT = 12;

// One text per thing the turn is about, each embedded on its own: an event
// near any of them is related (relatedScores takes the best match), where one
// long text of everything would be near nothing in particular.
//   bundle        { game, world, actions }
//   focusPowers   the powers the prompt lists in full (promptContext.js
//                 rankFocusPowers), most relevant first
export const buildRelatedQueries = (bundle, { focusPowers = [] } = {}) => {
  const world = bundle?.world ?? {};
  const player = clean(bundle?.game?.country);
  const queries = [];
  const add = (text, max = 400) => {
    const value = cut(clean(text), max);
    if (value && !queries.includes(value)) queries.push(value);
  };
  for (const action of eventList(bundle?.actions).filter(PENDING).slice(-6)) {
    add([action.title, action.description || action.rawInput || action.text].map(clean).filter(Boolean).join(". "));
  }
  for (const war of list(world.wars).filter((entry) => LIVE_WAR.has(clean(entry?.status).toLowerCase())).slice(0, 4)) {
    const sides = [list(war.sideA).map(clean).filter(Boolean).join(", "), list(war.sideB).map(clean).filter(Boolean).join(", ")].filter(Boolean);
    add([clean(war.title || war.name), sides.length === 2 ? `${sides[0]} against ${sides[1]}` : sides.join(""), clean(war.note || war.summary)].filter(Boolean).join(". "));
  }
  for (const story of list(world.storylines).filter((entry) => LIVE_STORY.has(clean(entry?.status).toLowerCase())).slice(0, 4)) {
    add([clean(story.title), clean(story.state || story.summary || story.note)].filter(Boolean).join(". "));
  }
  const powers = [player, ...list(focusPowers).map(clean)].filter((name, at, all) => name && all.indexOf(name) === at).slice(0, 6);
  if (powers.length) add(powers.join(", "));
  return queries.slice(0, RELATED_QUERY_LIMIT);
};

// ---------------------------------------------------------------------------
// Ranking.

// The events nearest the queries, taken in turns: each query's best, then each
// one's second best, and so on (the query with the closest match first), so
// one war with many battles does not fill the list and leave the treaty an
// order is about out. `score` is an event's best cosine against any query.
//   queryVectors  Float32Array[]
//   vectors       Map(eventId → { vector })
export const relatedScores = (queryVectors, vectors, { limit = RELATED_CANDIDATES, minScore = RELATED_MIN_SCORE } = {}) => {
  if (!queryVectors?.length) return [];
  const best = new Map();
  const perQuery = queryVectors.map(() => []);
  for (const [id, entry] of vectors ?? []) {
    queryVectors.forEach((query, at) => {
      const score = cosine(query, entry?.vector);
      if (score < minScore) return;
      perQuery[at].push({ id, score });
      if (score > (best.get(id) ?? -1)) best.set(id, score);
    });
  }
  const byScore = (a, b) => b.score - a.score || (a.id < b.id ? -1 : 1);
  for (const rows of perQuery) rows.sort(byScore);
  const lists = perQuery.filter((rows) => rows.length).sort((a, b) => byScore(a[0], b[0]));
  const ranked = [];
  const taken = new Set();
  for (let round = 0; ranked.length < limit && lists.some((rows) => rows.length > round); round += 1) {
    for (const rows of lists) {
      const row = rows[round];
      if (!row || taken.has(row.id)) continue;
      taken.add(row.id);
      ranked.push({ id: row.id, score: best.get(row.id) });
      if (ranked.length >= limit) break;
    }
  }
  return ranked;
};

// The events that may be shown as related: folded into the history already,
// or older than the oldest event in the window of recent events; never one
// the window shows.
//   events    the save's events
//   unfolded  the events not yet folded into the history (promptContext.js getUnconsolidatedEvents)
//   shown     the events the window shows (selectRankedEvents of `unfolded`)
export const relatedEligibility = (events, { unfolded = [], shown = [] } = {}) => {
  const shownIds = new Set(list(shown).map((event) => clean(event?.id)).filter(Boolean));
  const unfoldedIds = new Set(list(unfolded).map((event) => clean(event?.id)).filter(Boolean));
  const shownDates = list(shown).map((event) => clean(event?.date)).filter(Boolean);
  const oldestShown = shownDates.reduce((oldest, date) => (!oldest || compareGameDates(date, oldest) < 0 ? date : oldest), "");
  return (event) => {
    const id = clean(event?.id);
    if (!id || shownIds.has(id)) return false;
    if (!unfoldedIds.has(id)) return true;
    const date = clean(event?.date);
    return Boolean(oldestShown && date && compareGameDates(date, oldestShown) < 0);
  };
};

// One line of an event: its date, title and digest (or the start of its
// description).
export const relatedLine = (event, { lineChars = RELATED_LINE_CHARS } = {}) => {
  const title = clean(event?.title) || "Untitled event";
  const digest = clean(event?.digest) || cut(clean(event?.description), lineChars);
  return `- ${clean(event?.date) || "undated"}: ${title}${digest ? ` — ${cut(digest, lineChars)}` : ""}`;
};

export const RELATED_EVENTS_HEADER = "RELATED PAST EVENTS (older events found nearest to this turn's orders, wars and storylines, for continuity; the ledgers and newer events above outrank them):";

// The block for the prompt: the best `limit` eligible candidates, in date
// order, within `maxChars`. "" when none is eligible.
//   candidates  [{ id, score }], best first (relatedScores)
export const renderRelatedPastEvents = (candidates, {
  events = [],
  unfolded = [],
  shown = [],
  limit = RELATED_EVENTS_LIMIT,
  maxChars = RELATED_EVENTS_MAX_CHARS,
} = {}) => {
  if (!list(candidates).length) return "";
  const byId = new Map(eventList(events).map((event) => [clean(event.id), event]));
  const eligible = relatedEligibility(events, { unfolded, shown });
  const picked = [];
  for (const { id } of candidates) {
    const event = byId.get(clean(id));
    if (!event || !eligible(event) || picked.includes(event)) continue;
    picked.push(event);
    if (picked.length >= limit) break;
  }
  if (!picked.length) return "";
  picked.sort((a, b) => compareGameDates(clean(a.date), clean(b.date)));
  const lines = [RELATED_EVENTS_HEADER];
  let length = RELATED_EVENTS_HEADER.length;
  for (const event of picked) {
    const line = relatedLine(event);
    if (length + 1 + line.length > maxChars) continue;
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

// ---------------------------------------------------------------------------
// The similar_events lookup's answer (lookupTools.js SIMILAR_EVENTS_TOOL).

export const SIMILAR_EVENTS_DEFAULT = 6;
export const SIMILAR_EVENTS_MAX = 12;

export const similarEventsAnswer = (ranked, events, { limit = SIMILAR_EVENTS_DEFAULT } = {}) => {
  const byId = new Map(eventList(events).map((event) => [clean(event.id), event]));
  const found = [];
  for (const { id, score } of list(ranked)) {
    const event = byId.get(clean(id));
    if (!event) continue;
    const summary = clean(event.digest) || cut(clean(event.description), RELATED_LINE_CHARS);
    found.push({ date: clean(event.date) || "undated", title: clean(event.title), ...(summary ? { summary } : {}), similarity: Math.round(score * 100) / 100 });
    if (found.length >= limit) break;
  }
  return found.length ? { events: found } : { events: [], note: "No past event is close to that." };
};
