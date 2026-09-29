/*! Open Historia — a scenario's pre-game history © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The events before round one, kept by the scenario (`world.prehistory`) so a
// game opens with its backstory already written instead of asking a model for
// it on the player's key. The scenario designer writes them by hand in the
// Workshop's Pre-history tab (PrehistoryPanel.jsx), or generates them there
// from a prompt (gameplay.js generateScenarioPrehistory) and edits the result.
// A game inherits the record with the rest of its scenario's world
// (TEMPLATE_WORLD_OVERRIDE_KEYS) and applies it the first time it is opened
// (gameplay.js maybeGeneratePregameHistory): the events go on the timeline, and
// the Day-one facts a generation wrote beside them — the wars, relations,
// agreements, subordinations and storylines already true on the start date —
// go into the ledgers the campaign runs on.
//
//   {
//     version, prompt, summary, generatedAt,
//     events: [{ id, date, title, description, importance, kind, tags,
//                warId?, notable?, quote? }],
//     updates: { warUpdates, relationUpdates, agreementUpdates,
//                puppetUpdates, storylineUpdates },
//   }
//
// The updates are kept as the generation's validated answer decoded them and
// are applied by the same code that applies a live answer; nothing here reads
// inside them beyond what the Workshop shows. A war links to its events by the
// event's `warId`, never by position, so events may be edited, reordered and
// removed freely.

import { compareGameDates, parseGameDate } from "./gameDates.js";
import { normalizeEventTags } from "./eventTags.js";

export const PREHISTORY_VERSION = 1;
export const PREHISTORY_UPDATE_FAMILIES = Object.freeze([
  "warUpdates",
  "relationUpdates",
  "agreementUpdates",
  "puppetUpdates",
  "storylineUpdates",
]);
export const PREHISTORY_IMPORTANCE = Object.freeze(["minor", "major"]);
// The Event Editor's kinds (GameUI/cheats.jsx), less "player": a backstory is
// the world's, before the player has done anything.
export const PREHISTORY_KINDS = Object.freeze(["world", "diplomacy", "military", "economic", "domestic"]);
export const MAX_PREHISTORY_EVENTS = 60;
const MAX_UPDATES_PER_FAMILY = 64;
const LIMITS = { id: 80, date: 24, title: 200, description: 4000, kind: 40, prompt: 2000, summary: 2000, quote: 600, speaker: 120 };

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const array = (value) => (Array.isArray(value) ? value : []);
const clean = (value, max = 400) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const clone = (value) => JSON.parse(JSON.stringify(value));

let counter = 0;
export const newPrehistoryEventId = () => `prehistory-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

// One event as the scenario keeps it. `draft` keeps an event whose title is
// still blank, for the editor; a saved record never holds one (the game's own
// event reader drops an event without a title).
export const normalizePrehistoryEvent = (raw, { draft = false } = {}) => {
  if (!isRecord(raw)) return null;
  const title = clean(raw.title, LIMITS.title);
  if (!title && !draft) return null;
  const importance = clean(raw.importance).toLowerCase();
  const quoteText = clean(raw.quote?.text, LIMITS.quote);
  const speaker = clean(raw.quote?.speaker, LIMITS.speaker);
  const role = clean(raw.quote?.role, LIMITS.speaker);
  return {
    id: clean(raw.id, LIMITS.id) || newPrehistoryEventId(),
    date: clean(raw.date, LIMITS.date),
    title,
    description: clean(raw.description, LIMITS.description),
    importance: PREHISTORY_IMPORTANCE.includes(importance) ? importance : "minor",
    kind: clean(raw.kind, LIMITS.kind).toLowerCase() || "world",
    tags: normalizeEventTags(raw.tags),
    ...(clean(raw.warId, LIMITS.id) ? { warId: clean(raw.warId, LIMITS.id) } : {}),
    ...(raw.notable === true ? { notable: true } : {}),
    ...(quoteText ? { quote: { text: quoteText, ...(speaker ? { speaker } : {}), ...(role ? { role } : {}) } } : {}),
  };
};

// Oldest first; an event whose date does not read keeps its place after the
// dated ones, in the order it was written.
export const sortPrehistoryEvents = (events) => array(events)
  .map((event, index) => ({ event, index, dated: parseGameDate(event?.date) !== null }))
  .sort((a, b) => {
    if (a.dated !== b.dated) return a.dated ? -1 : 1;
    return (a.dated ? compareGameDates(a.event.date, b.event.date) : 0) || a.index - b.index;
  })
  .map(({ event }) => event);

// The record, or null when the scenario has none. A record with no events and
// no Day-one facts is still a record: the designer's choice of no backstory,
// which a game respects rather than generating one.
export const normalizeScenarioPrehistory = (value, { draft = false } = {}) => {
  if (!isRecord(value)) return null;
  const seen = new Set();
  const events = [];
  for (const raw of array(value.events)) {
    const event = normalizePrehistoryEvent(raw, { draft });
    if (!event) continue;
    if (seen.has(event.id)) event.id = newPrehistoryEventId();
    seen.add(event.id);
    events.push(event);
    if (events.length >= MAX_PREHISTORY_EVENTS) break;
  }
  const updates = {};
  for (const family of PREHISTORY_UPDATE_FAMILIES) {
    updates[family] = array(value.updates?.[family]).filter(isRecord).slice(0, MAX_UPDATES_PER_FAMILY).map(clone);
  }
  const generatedAt = clean(value.generatedAt, 40);
  return {
    version: PREHISTORY_VERSION,
    prompt: clean(value.prompt, LIMITS.prompt),
    summary: clean(value.summary, LIMITS.summary),
    ...(generatedAt ? { generatedAt } : {}),
    events: draft ? events : sortPrehistoryEvents(events),
    updates,
  };
};

export const emptyScenarioPrehistory = () => normalizeScenarioPrehistory({});

export const countPrehistoryUpdates = (prehistory) => PREHISTORY_UPDATE_FAMILIES
  .reduce((total, family) => total + array(prehistory?.updates?.[family]).length, 0);

// Whether opening a game has anything to apply.
export const prehistoryHasContent = (value) => {
  const prehistory = normalizeScenarioPrehistory(value);
  return Boolean(prehistory && (prehistory.events.length || countPrehistoryUpdates(prehistory)));
};

// What stops a record being saved, one entry an event: its title is blank, its
// date does not read as YYYY-MM-DD (negative years are BC), or it is not
// before the scenario's start date. Codes, not prose: the editor says them.
export const prehistoryProblems = (prehistory, { startDate = "" } = {}) => {
  const start = parseGameDate(startDate) ? startDate : "";
  const problems = [];
  for (const event of array(prehistory?.events)) {
    if (!clean(event?.title)) problems.push({ id: event?.id, problem: "title" });
    if (!parseGameDate(event?.date)) problems.push({ id: event?.id, problem: "date" });
    else if (start && compareGameDates(event.date, start) >= 0) problems.push({ id: event.id, problem: "late" });
  }
  return problems;
};

// The Day-one facts as the Workshop lists them: who, what, and the family and
// place a Remove button needs. Only names and titles, never prose.
export const prehistoryUpdateRows = (prehistory) => {
  const rows = [];
  const names = (value) => array(value).map((name) => clean(name, 120)).filter(Boolean);
  for (const family of PREHISTORY_UPDATE_FAMILIES) {
    array(prehistory?.updates?.[family]).forEach((update, index) => {
      if (!isRecord(update)) return;
      const row = { family, index, title: "", sideA: [], sideB: [], detail: "" };
      if (family === "warUpdates") Object.assign(row, { title: clean(update.id, 120), sideA: names(update.actors), sideB: names(update.opponents), detail: clean(update.op, 40) });
      else if (family === "relationUpdates") Object.assign(row, { sideA: names([update.a]), sideB: names([update.b]), detail: Number.isFinite(Number(update.score)) ? String(Math.round(Number(update.score))) : "" });
      else if (family === "agreementUpdates") Object.assign(row, { title: clean(update.title || update.id, 160), sideA: names(update.parties), detail: clean(update.type, 60) });
      else if (family === "puppetUpdates") Object.assign(row, { sideA: names([update.overlord]), sideB: names([update.puppet]), detail: clean(update.kind, 60) });
      else Object.assign(row, { title: clean(update.title || update.id, 160), sideA: names(update.participants), detail: clean(update.status, 40) });
      rows.push(row);
    });
  }
  return rows;
};

export const withoutPrehistoryUpdate = (prehistory, family, index) => {
  const next = normalizeScenarioPrehistory(prehistory, { draft: true });
  if (!next || !PREHISTORY_UPDATE_FAMILIES.includes(family)) return next;
  next.updates[family] = next.updates[family].filter((_, at) => at !== index);
  return next;
};

// What a game applies (gameplay.js maybeGeneratePregameHistory): the shape of
// a validated pregameHistory answer. Only events dated before the start date,
// oldest first: an event the designer left after it — the start date moved
// since — is not history yet. Null when there is nothing to apply.
export const prehistoryPayload = (value, { startDate = "" } = {}) => {
  const prehistory = normalizeScenarioPrehistory(value);
  if (!prehistory) return null;
  const start = parseGameDate(startDate) ? startDate : "";
  const events = prehistory.events
    .filter((event) => parseGameDate(event.date) && (!start || compareGameDates(event.date, start) < 0))
    .map((event) => clone(event));
  const updates = Object.fromEntries(PREHISTORY_UPDATE_FAMILIES.map((family) => [family, clone(prehistory.updates[family])]));
  if (!events.length && !countPrehistoryUpdates({ updates })) return null;
  return { events, summary: prehistory.summary, ...updates };
};
