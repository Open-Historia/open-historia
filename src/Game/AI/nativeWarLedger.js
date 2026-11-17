// Open Historia — native war-state ledger (from kernely's Continuum branch).
//
// What it owns:
// - authoritative persistent belligerency in world.wars, in the one shape
//   runtime/warRecord.js gives every war
// - compact Gemini transport; no large nested tool schema
// - war starts/joins/leaves/ceasefires/resumptions/endings as explicit state
//   transitions, written by the model's records and by the game's own rules,
//   never read from the words of an event
// - one settlement of a time skip's answer that never asks the model again
//   (settleWarLedger)
// - suitable for the Stats -> Current Conflicts panel

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { compareGameDates, parseGameDate } from "../../runtime/gameDates.js";
import {
  LIVE_WAR_STATUSES,
  MAX_WAR_SIDE_MEMBERS,
  contentWarId,
  mintWarId,
  normalizeWarRecord,
  normalizeWarRecords,
  referencedWarIds,
  resolveWarReference,
  warIndex,
  warMembers,
  warPolityKey,
  warPolityName,
  warSideOf,
  warSidesOf,
} from "../../runtime/warRecord.js";

const WAR_UPDATE_SEPARATOR = "~";
// The most war records one answer carries. A world war's coalitions join a
// member a line: at 16 the rest were cut without a word.
const MAX_WAR_UPDATES_PER_PASS = 64;

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const canonicalPolity = warPolityName;
const polityKey = warPolityKey;
const uniquePolities = (value, limit = MAX_WAR_SIDE_MEMBERS) => warMembers(value, limit);

// Any game date, BC included (runtime/gameDates.js).
const parseIsoDate = parseGameDate;

const sortDate = (value) => parseIsoDate(value) ? normalizeString(value) : "";

// A start's note may open with the war's own name — "Title: The Winter War;
// Soviet demands on the Karelian isthmus" — and the rest is its cause. Without
// it every war the model opened was called "A–B War" and the model's own name
// for it was lost. The name ends at a ";", or at a "~" or "|" (the record's own
// separator, or the one a model reaches for): "Title: Franco-Italian War~Dispute
// over…" was kept whole as the war's name (a real-key test, 2026-10-28).
const WAR_TITLE_NOTE_RE = /^title\s*:\s*([^;~|]+?)\s*(?:[;~|]\s*([\s\S]*))?$/i;
export const splitWarStartNote = (note) => {
  const text = normalizeString(note);
  const match = text.match(WAR_TITLE_NOTE_RE);
  return match
    ? { title: normalizeString(match[1]), cause: normalizeString(match[2]) }
    : { title: "", cause: text };
};

// A war kept with both its parties on one side and no name on the other (a start record whose event numbers were
// written where the opponents go: "United Kingdom,Ireland~1,2"): the first is one side and the second the other.
export const splitOneSidedWar = (sideA, sideB) => (sideB.length === 0 && sideA.length === 2 ? [[sideA[0]], [sideA[1]]] : [sideA, sideB]);

// The canonical war record (runtime/warRecord.js): the same for the ledger,
// the world, the fronts and the peace.
const normalizeWar = (entry) => normalizeWarRecord(entry);

// Every war the world holds: none of them cut (the ledger used to read only
// its first 64, the world's own normalizer kept another 64, and which ones
// survived hung on how each had sorted the list).
const normalizedWars = (world) => normalizeArray(normalizeWorldState(world)?.wars).map(normalizeWar).filter(Boolean);

// Round-Zero baseline construction is intentionally separate from normal-turn
// lifecycle verbs. The caller owns identity resolution; this helper owns the
// canonical persisted war shape and its structural invariants. It is pure and
// does not mutate/apply against world.wars.
export const buildPregameWarBaselineRecord = ({
  id = "",
  title = "",
  status = "active",
  sideA = [],
  sideB = [],
  startedDate = "",
  note = "",
  sourceEventIds = [],
  round = 1,
} = {}) => {
  const canonicalId = normalizeString(id);
  const canonicalStatus = normalizeString(status).toLowerCase();
  if (!canonicalId) return { record: null, error: "Round-Zero war baseline requires a native canonical id." };
  if (!["active", "ceasefire"].includes(canonicalStatus)) {
    return { record: null, error: `Round-Zero war ${canonicalId} must be active or ceasefire.` };
  }
  const start = normalizeString(startedDate);
  if (start && !parseIsoDate(start)) {
    return { record: null, error: `Round-Zero war ${canonicalId} has an invalid startedDate.` };
  }
  const normalized = normalizeWar({
    id: canonicalId,
    title: normalizeString(title),
    status: canonicalStatus,
    sideA,
    sideB,
    startedDate: start,
    endedDate: "",
    lastUpdatedDate: start,
    cause: normalizeString(note),
    note: normalizeString(note),
    sourceEventIds: [...new Set(normalizeArray(sourceEventIds).map(normalizeString).filter(Boolean))].slice(-24),
    storylineIds: [],
    createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
    updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
  });
  if (!normalized) {
    return { record: null, error: `Round-Zero war ${canonicalId} requires two non-empty opposing sides.` };
  }
  return { record: normalized, error: "" };
};

// A war's title as it is compared: the letters, marks and digits of every
// script, case, accents and punctuation folded away. Folded to a-z0-9, a title
// in Cyrillic, Arabic or Chinese had no key at all, so two wars between the
// same sides on the same date were one war whatever each was called, and no
// such title could be told from a blank one. An ASCII title keeps its key.
const pregameWarTitleKey = (value) => normalizeString(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const pregameWarSideKey = (values) => uniquePolities(values)
  .map((value) => polityKey(value))
  .sort()
  .join("|");

const pregameWarSidePairKey = (sideA, sideB) =>
  [pregameWarSideKey(sideA), pregameWarSideKey(sideB)].sort().join("<>");

const samePregameSourceSet = (superset, required) => {
  const values = new Set(normalizeArray(superset).map(normalizeString).filter(Boolean));
  return normalizeArray(required).map(normalizeString).filter(Boolean).every((id) => values.has(id));
};

// Resolve Day-One war identity conservatively. Sides and date say which war it
// is; the title is how it is worded.
//
// ONE live war between the same two sides is that war, whatever the fact calls
// it and whatever date it gives: the same belligerents are not fighting each
// other twice at once, and a model that restates canon writes the war's name in
// the game's language. Such a fact used to be "ambiguous", or, with another
// date, a second live war beside the first (a scenario's front war is dated at
// the campaign's start, the history's at the war's real start); it is now the
// match, marked `restated` where the title differs, and the caller keeps the
// canonical title and the earlier date (mergePregameWarBaselineRecord).
//
// MORE than one such war is an error, marked `ambiguous`, and the caller
// leaves that fact out. So is a single one that another fact of the same
// answer already resolved to (`claimedIds`). Neither is permission to fork a
// second live war.
export const resolvePregameWarBaselineMatch = ({ records = [], candidate = null, claimedIds = null } = {}) => {
  if (!candidate) return { match: null, error: "Round-Zero war resolver requires a candidate." };
  const sides = pregameWarSidePairKey(candidate.sideA, candidate.sideB);
  const title = pregameWarTitleKey(candidate.title);
  const date = normalizeString(candidate.startedDate);
  const live = normalizeArray(records)
    .map((entry, index) => normalizeWar(entry, index))
    .filter((entry) => entry && ["active", "ceasefire"].includes(entry.status))
    .filter((entry) => pregameWarSidePairKey(entry.sideA, entry.sideB) === sides);

  const dateCompatible = (entry) => {
    const existing = normalizeString(entry.startedDate);
    return !date || !existing || date === existing;
  };
  const possible = live.filter(dateCompatible);
  const exact = possible.filter((entry) => pregameWarTitleKey(entry.title) === title);
  if (exact.length > 1) return { match: null, ambiguous: true, error: "Round-Zero war identity matches multiple canonical wars." };
  if (exact.length === 1) return { match: exact[0], error: "" };
  if (live.length === 1 && !claimedIds?.has(normalizeString(live[0].id))) {
    const same = pregameWarTitleKey(live[0].title) === title;
    return { match: live[0], ...(same ? {} : { restated: true }), error: "" };
  }
  if (live.length) {
    return { match: null, ambiguous: true, error: "Round-Zero war identity is ambiguous: the same live sides already fight more than one war, or another fact of this answer is that war." };
  }
  return { match: null, error: "" };
};

export const mergePregameWarBaselineRecord = ({ existing = null, incoming = null } = {}) => {
  const prior = normalizeWar(existing);
  const next = normalizeWar(incoming);
  if (!prior || !next || normalizeString(prior.id) !== normalizeString(next.id)) {
    return { record: null, error: "Round-Zero war merge requires the same valid canonical id." };
  }
  if (pregameWarSidePairKey(prior.sideA, prior.sideB) !== pregameWarSidePairKey(next.sideA, next.sideB)) {
    return { record: null, error: `Round-Zero war ${prior.id} changes canonical belligerent identity.` };
  }
  // What canon holds stands: its title and its status. Of two known start
  // dates the earlier is kept (a front a scenario opens is dated at the
  // campaign's start; the war it is part of began before). Each of these used
  // to refuse the whole Round-Zero answer.
  const startedDate = prior.startedDate && next.startedDate
    ? (compareGameDates(next.startedDate, prior.startedDate) < 0 ? next.startedDate : prior.startedDate)
    : prior.startedDate || next.startedDate;
  const sourceEventIds = [...new Set([...prior.sourceEventIds, ...next.sourceEventIds])].slice(-24);
  return {
    record: normalizeWar({
      ...prior,
      startedDate,
      lastUpdatedDate: prior.lastUpdatedDate || next.lastUpdatedDate || startedDate,
      note: prior.note || next.note,
      cause: prior.cause || next.cause || prior.note || next.note,
      sourceEventIds,
      storylineIds: [...new Set([...prior.storylineIds, ...next.storylineIds])].slice(-12),
      createdRound: prior.createdRound || next.createdRound,
      updatedRound: Math.max(prior.updatedRound || 0, next.updatedRound || 0),
    }),
    error: "",
  };
};

export const pregameWarBaselineCompatibilityError = (expected, actual) => {
  const left = normalizeWar(expected);
  const right = normalizeWar(actual);
  if (!left || !right) return "war record is missing or invalid";
  if (left.id !== right.id) return "war id changed";
  if (pregameWarSidePairKey(left.sideA, left.sideB) !== pregameWarSidePairKey(right.sideA, right.sideB)) return "war sides changed";
  if (pregameWarTitleKey(left.title) !== pregameWarTitleKey(right.title)) return "war title identity changed";
  if (left.status !== right.status) return "war status changed";
  if (left.startedDate !== right.startedDate) return "war start date was not conserved";
  if (!samePregameSourceSet(right.sourceEventIds, left.sourceEventIds)) return "war provenance was not conserved";
  for (const storylineId of left.storylineIds) {
    if (!right.storylineIds.includes(storylineId)) return "war storyline linkage was not conserved";
  }
  return "";
};

const parseCsv = (value) =>
  uniquePolities(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const parseEventNumbers = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 1)
    .map((entry) => entry - 1)
    .slice(0, 16);

// A record is fields joined by the separator, so a line with none is not one.
// It is prose a model wrote where records go: a heading, or a sentence saying
// nothing changed, where the prompt asks for an empty string. A player's local
// model answered "### Обновления войн:" and "Нет изменений. В этом периоде ни
// одна война не началась…". Read as a record such a line has an id and no
// operation. A strict pass refuses the whole answer over it, which is a second
// request for the same month; the last attempt's salvage dropped both by "id",
// which put the model's own sentence into its next prompt. A line that has the
// separator and a bad operation is still a record, and still refused.
const isWarUpdateRecordLine = (text) => text.includes(WAR_UPDATE_SEPARATOR);

// The lines of a warUpdates answer that are not records, as written: for the
// caller's one log line saying they were ignored (the decoder runs many times
// over one answer, and says nothing).
export const warUpdateProseLines = (value) => {
  const lines = Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string")
    : String(value ?? "").split(/\r?\n/);
  return lines.map(normalizeString).filter((line) => line && !isWarUpdateRecordLine(line));
};

const parseWarUpdateRecord = (line, index = 0) => {
  const text = normalizeString(line);
  if (!text || !isWarUpdateRecordLine(text)) return null;

  // id~op~actorsCSV~opponentsCSV~eventNumbersCSV~note
  const fields = [];
  let rest = text;
  for (let cut = 0; cut < 5; cut += 1) {
    const pos = rest.indexOf(WAR_UPDATE_SEPARATOR);
    if (pos < 0) {
      fields.push(rest);
      rest = "";
      break;
    }
    fields.push(rest.slice(0, pos));
    rest = rest.slice(pos + 1);
  }
  while (fields.length < 5) fields.push("");
  fields.push(rest);

  let [idRaw, opRaw, actorsRaw, opponentsRaw, eventNumbersRaw, noteRaw] = fields;
  // The event numbers written where the opponents go, and everything after them one field early
  // ("war-uk-ireland-2016~start~United Kingdom,Ireland~1,2~Title|cause"): read back into their places, and a start's
  // two parties, written together, as the side that starts it and the side it is started on.
  const numbersOnly = (text) => /^\s*\d+(\s*,\s*\d+)*\s*$/.test(String(text ?? ""));
  let actors = parseCsv(actorsRaw);
  let opponents = parseCsv(opponentsRaw);
  if (numbersOnly(opponentsRaw) && !numbersOnly(eventNumbersRaw)) {
    noteRaw = normalizeString(noteRaw) ? noteRaw : eventNumbersRaw;
    eventNumbersRaw = opponentsRaw;
    opponents = [];
    if (normalizeString(opRaw).toLowerCase() === "start") [[...actors], [...opponents]] = splitOneSidedWar(actors, opponents);
  }
  return {
    // (A record with no id is named for what it is, never for its place among the lines: "war-0" was
    // whichever war the world happened to hold under that name, and an id-less end ended it.)
    id: normalizeString(idRaw) || contentWarId({ sideA: actors, sideB: opponents }),
    op: normalizeString(opRaw).toLowerCase(),
    actors,
    opponents,
    eventIndexes: parseEventNumbers(eventNumbersRaw),
    eventIds: [],
    renews: "",
    // Internal Round-Zero metadata only. The compact normal-turn line transport
    // has no date field, so ordinary gameplay cannot set this accidentally.
    baselineDate: "",
    note: normalizeString(noteRaw),
  };
};

export const decodeWarUpdates = (value, { limit = MAX_WAR_UPDATES_PER_PASS } = {}) => {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === "string") return parseWarUpdateRecord(entry, index);
        if (!entry || typeof entry !== "object") return null;
        return {
          id: normalizeString(entry.id) || contentWarId({ sideA: entry.actors, sideB: entry.opponents }),
          op: normalizeString(entry.op).toLowerCase(),
          actors: uniquePolities(entry.actors),
          opponents: uniquePolities(entry.opponents),
          // The ended war a start renews (interpretWarLedger), carried to the record it opens.
          renews: normalizeString(entry.renews),
          eventIndexes: normalizeArray(entry.eventIndexes)
            .map(Number)
            .filter((item) => Number.isInteger(item) && item >= 0)
            .slice(0, 16),
          eventIds: [...new Set(normalizeArray(entry.eventIds).map(normalizeString).filter(Boolean))].slice(0, 24),
          baselineDate: normalizeString(entry.baselineDate),
          note: normalizeString(entry.note),
        };
      })
      .filter(Boolean)
      .slice(0, limit);
  }

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => parseWarUpdateRecord(line, index))
    .filter(Boolean)
    .slice(0, limit);
};

export const bindWarUpdatesToEvents = (updates, events, { limit } = {}) => {
  const normalizedEvents = normalizeEvents(events);
  return decodeWarUpdates(updates, { limit }).map((update) => {
    const stableIds = [...new Set(
      normalizeArray(update.eventIds).map(normalizeString).filter(Boolean),
    )].slice(0, 24);
    return {
      ...update,
      // Existing stable ids mean this record already crossed a hidden-pass
      // boundary. Never reinterpret its old pass-local indexes against a later
      // combined event batch.
      eventIds: stableIds.length
        ? stableIds
        : [...new Set(
            normalizeArray(update.eventIndexes)
              .map((index) => normalizeString(normalizedEvents[index]?.id))
              .filter(Boolean),
          )].slice(0, 24),
    };
  });
};

const warMapFromWorld = (world) =>
  new Map(normalizedWars(world).map((war) => [war.id, war]));

const linkedEventsForUpdate = (update, events) => {
  const normalizedEvents = normalizeEvents(events);
  const byId = new Map(normalizedEvents.map((event) => [normalizeString(event.id), event]));
  const result = [];
  const seen = new Set();

  // Once a hidden world pass binds an update to stable event ids, those ids are
  // authoritative. The original eventIndexes were pass-local and must NOT be
  // reinterpreted against the final multi-pass event batch.
  const stableIds = normalizeArray(update.eventIds).map(normalizeString).filter(Boolean);
  if (stableIds.length) {
    for (const idRaw of stableIds) {
      const event = byId.get(idRaw);
      if (!event) continue;
      const id = normalizeString(event.id);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(event);
    }
    return result;
  }

  for (const index of normalizeArray(update.eventIndexes)) {
    const event = normalizedEvents[index];
    if (!event) continue;
    const id = normalizeString(event.id);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(event);
  }
  return result;
};

const firstLinkedDate = (update, events) =>
  linkedEventsForUpdate(update, events)
    .map((event) => normalizeString(event.date))
    .filter((date) => parseIsoDate(date))
    .sort(compareGameDates)[0] || "";

// One record applied to the wars (a Map of id to war), and the war as it then
// stands: { war }, or { error } for a record that cannot apply. One war is never
// written over with another:
// - a start under the id of a war that is over opens a NEW war, under an id of
//   its own (runtime/warRecord.js mintWarId), that renews the old one. The old
//   war keeps its dates, its events and whatever names it. Such a start used to
//   rebuild the ended war in place, so its treaty, its reparations and the
//   events it was fought in all came to mean the new war;
// - a record naming a war that is over and has been renewed means the renewal;
// - what is already so is no error: a ceasefire where one holds, the end of a
//   war that is over, a resumption of a war being fought, a leave by a polity
//   no longer in it;
// - a resumption of a war that is over is that war flaring again: a renewal,
//   between the same sides.
const WAR_OPS = new Set(["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"]);
const applyUpdateToWarMap = ({ map, update, date = "", round = 0, linkedEvents = [] }) => {
  const asked = normalizeString(update?.id);
  const op = normalizeString(update?.op).toLowerCase();
  if (!asked || !op) return { error: "War update is missing id/op." };
  if (!WAR_OPS.has(op)) return { error: `Unsupported war operation "${op}" for ${asked}.` };

  const eventDate = sortDate(date);
  const eventIds = linkedEvents.map((event) => normalizeString(event?.id)).filter(Boolean);
  const storylineIds = linkedEvents.flatMap((event) => normalizeArray(event?.storylineIds)).map(normalizeString).filter(Boolean);
  const startNote = op === "start" ? splitWarStartNote(update.note) : null;
  const turn = Math.max(0, Math.trunc(Number(round) || 0));

  const save = (war) => {
    const normalized = normalizeWar({
      ...war,
      note: (startNote ? startNote.cause : normalizeString(update.note)) || normalizeString(war.note),
      sourceEventIds: [...normalizeArray(war.sourceEventIds), ...eventIds],
      storylineIds: [...normalizeArray(war.storylineIds), ...storylineIds],
      lastUpdatedDate: eventDate || war.lastUpdatedDate,
      updatedRound: turn,
    });
    if (!normalized) return { error: `War ${war.id} became invalid after ${op}.` };
    map.set(normalized.id, normalized);
    return { war: normalized };
  };
  // A new war: under the id asked for while no war has ever held it, else a new one.
  const open = ({ sideA, sideB, title = "", cause = "", renews = "" }) => save({
    id: map.has(asked) ? mintWarId(asked, new Set(map.keys())) : asked,
    title,
    status: "active",
    sideA,
    sideB,
    startedDate: eventDate,
    endedDate: "",
    cause,
    createdRound: turn,
    renews,
  });

  const prior = resolveWarReference(warIndex([...map.values()]), asked);

  if (op === "start") {
    if (prior && prior.status !== "ended") {
      return { error: `War ${prior.id} already exists with status ${prior.status}; use join/resume/end instead of start.` };
    }
    const [sideA, sideB] = warSidesOf(update.actors, update.opponents);
    if (!sideA.length || !sideB.length) return { error: `War ${asked} start requires non-empty opposing actors and opponents.` };
    return open({ sideA, sideB, title: startNote.title, cause: startNote.cause, renews: prior ? prior.id : normalizeString(update.renews) });
  }

  if (!prior) return { error: `War ${asked} does not exist; ${op} cannot be applied before start.` };

  if (op === "join-a" || op === "join-b") {
    const joiners = uniquePolities(update.actors);
    if (!joiners.length) return { error: `War ${prior.id} ${op} requires at least one joining polity.` };
    if (prior.status === "ended") {
      // Joining a war that is over, against those it names: that war flaring
      // again, with the joiner in it from the start.
      const against = uniquePolities(update.opponents).filter((name) => !joiners.some((joiner) => polityKey(joiner) === polityKey(name)));
      if (!against.length) return { error: `War ${prior.id} is over; nobody joins a war that has ended.` };
      return open({ sideA: joiners, sideB: against, title: "", cause: normalizeString(update.note), renews: prior.id });
    }
    const sideA = [...prior.sideA];
    const sideB = [...prior.sideB];
    // The letter is easy to get backwards (#892: the UK "joined" Russia's side
    // of the Ukraine war); whom the joiner fights is not. When the opponents
    // named all stand on one side, the joiner takes the other, whatever the
    // letter said.
    const opponentKeys = new Set(uniquePolities(update.opponents).map(polityKey));
    const againstA = prior.sideA.some((entry) => opponentKeys.has(polityKey(entry)));
    const againstB = prior.sideB.some((entry) => opponentKeys.has(polityKey(entry)));
    const joinsA = againstA !== againstB ? againstB : op === "join-a";
    const own = joinsA ? sideA : sideB;
    const enemy = joinsA ? sideB : sideA;
    const enemyKeys = new Set(enemy.map(polityKey));
    for (const joiner of joiners) {
      if (enemyKeys.has(polityKey(joiner))) return { error: `${joiner} is already on the opposing side of war ${prior.id}.` };
      if (!own.some((entry) => polityKey(entry) === polityKey(joiner))) own.push(joiner);
    }
    if (own.length > MAX_WAR_SIDE_MEMBERS) return { error: `War ${prior.id} already has ${MAX_WAR_SIDE_MEMBERS} members on that side.` };
    return save({ ...prior, sideA, sideB });
  }

  if (op === "leave") {
    if (prior.status === "ended") return { war: prior };
    const leavingKeys = new Set(uniquePolities(update.actors).map(polityKey));
    if (!leavingKeys.size) return { error: `War ${prior.id} leave requires at least one polity.` };
    const sideA = prior.sideA.filter((entry) => !leavingKeys.has(polityKey(entry)));
    const sideB = prior.sideB.filter((entry) => !leavingKeys.has(polityKey(entry)));
    if (sideA.length === prior.sideA.length && sideB.length === prior.sideB.length) return { war: prior };
    if (!sideA.length || !sideB.length) {
      return save({ ...prior, status: "ended", endedDate: eventDate || prior.endedDate });
    }
    return save({ ...prior, sideA, sideB });
  }

  if (op === "ceasefire") {
    if (prior.status !== "active") return { war: prior };
    return save({ ...prior, status: "ceasefire" });
  }
  if (op === "resume") {
    if (prior.status === "active") return { war: prior };
    if (prior.status === "ended") {
      return open({ sideA: prior.sideA, sideB: prior.sideB, title: prior.title, cause: normalizeString(update.note), renews: prior.id });
    }
    return save({ ...prior, status: "active", endedDate: "" });
  }
  if (op === "end") {
    if (prior.status === "ended") return { war: prior };
    return save({ ...prior, status: "ended", endedDate: eventDate || prior.endedDate });
  }

  return { error: `Unsupported war operation "${op}" for ${prior.id}.` };
};

// The live wars whose two sides every one of `combatants` stands on, with at
// least one on each: what an event naming them, and no war, is about.
const matchingWarForCombatants = (wars, combatants, statuses = LIVE_WAR_STATUSES) => {
  const named = uniquePolities(combatants);
  if (named.length < 2) return [];
  return wars.filter((war) => statuses.has(war.status) && named.every((name) => warSideOf(war, name))
    && named.some((name) => warSideOf(war, name) === "A") && named.some((name) => warSideOf(war, name) === "B"));
};

// What the model meant by its war records and the events it tied them to,
// made explicit from the answer's own structure, before anything is applied.
// The engine works it out and never asks the model again for it. Each step
// reads the model's own claim, never past it, and never the words of an event
// (an English word list cannot read a game written in the player's language,
// and misreads plain prose in English: the owner, 2026-11-06, "dont do
// keywording its super unreliable"):
//   - a war id that names a war that is over and has been renewed names the
//     renewal (runtime/warRecord.js resolveWarReference);
//   - a record tied to no event is tied to the event carrying its war's id,
//     else the event naming one of its sides among its combatants, else the
//     answer's only event (the Game Master's first); a record tied only to
//     events of another war is tied to the one event carrying its own id;
//   - a record for a war id nobody knows is the war its event carries, or the
//     one live war whose belligerents it or its event names;
//   - a "join" with no side joins the side opposite the war's members it names;
//   - a start with a side empty takes it from its event's combatants (two
//     parties written on one side are one on each);
//   - a start of a war already being fought is its newcomers' join, or nothing;
//     of one in ceasefire, its resumption; a new id started between two sides
//     already at war is that war; a resumption of a war being fought, and a
//     ceasefire in one already holding, are nothing;
//   - a start of a war that is over is a new war that renews it, under an id
//     of its own, and the answer's events of that id are the new war's; a
//     start under the id of a war being fought between others, or under an id
//     the answer already started for others, is a war of its own, under a new id;
//   - an event tied to a record carries the record's war id;
//   - an event carrying a new war id and naming its two combatants, with no
//     record, starts that war;
//   - a war event's combatants are its belligerents: anyone not in the war is
//     left out (nobody is put in who was not named).
// Run again on its own output it changes nothing: the Game Master's Apply
// re-runs the preview's checks and refuses anything they would change.
export const interpretWarLedger = (candidate, { world = {}, authority = "skip" } = {}) => {
  const outcome = { changed: 0 };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return outcome;
  const gm = authority === "gm";
  const events = Array.isArray(candidate.events) ? candidate.events : [];
  const isEvent = (event) => Boolean(event) && typeof event === "object" && !Array.isArray(event);
  const wars = normalizedWars(world);
  const index = warIndex(wars);
  const warById = index.byId;
  // The war an id means now: itself, or the war renewing it.
  const meant = (warId) => resolveWarReference(index, warId);
  const before = JSON.stringify(decodeWarUpdates(candidate.warUpdates));
  let records = decodeWarUpdates(candidate.warUpdates);
  const drop = new Set();
  const touch = () => { outcome.changed += 1; };
  const holds = (list, name) => list.some((entry) => polityKey(entry) === polityKey(name));
  const member = (war, name) => holds(war.sideA, name) || holds(war.sideB, name);
  const indexById = new Map(events.map((event, at) => [normalizeString(event?.id), at]).filter(([id]) => id));
  const indexesOf = (update) => {
    const ids = normalizeArray(update.eventIds).map(normalizeString).filter(Boolean);
    if (ids.length) return ids.map((id) => indexById.get(id)).filter((at) => Number.isInteger(at));
    return normalizeArray(update.eventIndexes).filter((at) => Number.isInteger(at) && at >= 0 && at < events.length);
  };
  const live = () => records.filter((update) => !drop.has(update));
  const startedHere = (warId) => live().find((update) => update.id === warId && update.op === "start");
  const known = (warId) => warById.has(warId) || live().some((update) => update.id === warId);
  const taken = new Set([...warById.keys(), ...records.map((update) => update.id)]);
  const freshId = (warId) => {
    const id = mintWarId(warId, taken);
    taken.add(id);
    return id;
  };
  const retag = (from, to) => {
    for (const event of events) {
      if (isEvent(event) && normalizeString(event.warId) === from) event.warId = to;
    }
    for (const update of records) {
      if (update.id === from) update.id = to;
    }
  };
  // One record, and the events tied to it, under another id: the rest of the
  // answer's records and events of the old id are left as they are.
  const reid = (update, to) => {
    const from = update.id;
    for (const at of indexesOf(update)) {
      const event = events[at];
      if (isEvent(event) && [from, ""].includes(normalizeString(event.warId))) event.warId = to;
    }
    update.id = to;
  };

  // An id written for a war that is over and has been renewed: the renewal.
  for (const update of records) {
    if (update.op === "start") continue;
    const war = meant(update.id);
    if (war && war.id !== update.id) update.id = war.id;
  }
  for (const event of events) {
    if (!isEvent(event)) continue;
    const tag = normalizeString(event.warId);
    const war = tag ? meant(tag) : null;
    if (war && war.id !== tag) {
      event.warId = war.id;
      touch();
    }
  }

  for (const update of records) {
    const linked = indexesOf(update);
    if (linked.length) {
      // Tied only to events of other wars, while one event carries its own id: that one.
      const own = events.map((event, at) => (isEvent(event) && normalizeString(event.warId) === update.id ? at : -1)).filter((at) => at >= 0);
      const elsewhere = linked.every((at) => {
        const tag = normalizeString(events[at]?.warId);
        return tag && tag !== update.id;
      });
      if (elsewhere && own.length === 1) {
        update.eventIndexes = own;
        update.eventIds = [];
      }
      continue;
    }
    let at = events.findIndex((event) => isEvent(event) && normalizeString(event.warId) === update.id);
    const named = [...update.actors, ...update.opponents];
    if (at < 0 && named.length) {
      at = events.findIndex((event) => isEvent(event) && uniquePolities(event.combatants).some((name) => holds(named, name)));
    }
    if (at < 0 && events.length && (events.length === 1 || gm)) at = 0;
    if (at < 0) continue;
    update.eventIndexes = [at];
  }

  for (const update of records) {
    if (update.op === "start" || warById.has(update.id) || startedHere(update.id)) continue;
    let target = indexesOf(update)
      .map((at) => normalizeString(events[at]?.warId))
      .find((warId) => warId && warId !== update.id && (warById.has(warId) || startedHere(warId))) || "";
    if (!target) {
      const named = ["join", "join-a", "join-b"].includes(update.op) ? update.opponents : [...update.actors, ...update.opponents];
      const matches = named.length
        ? wars.filter((war) => war.status !== "ended" && named.every((name) => member(war, name)))
        : [];
      if (matches.length === 1) target = matches[0].id;
    }
    if (!target) {
      // A record naming nobody (an end, a ceasefire) with a mis-copied id: the
      // one live war its event's combatants fight.
      const combatants = indexesOf(update).flatMap((at) => normalizeArray(events[at]?.combatants));
      const matches = matchingWarForCombatants(wars, combatants);
      if (matches.length === 1) target = matches[0].id;
    }
    if (target) retag(update.id, target);
  }

  for (const update of records) {
    if (update.op !== "join") continue;
    const war = warById.get(update.id);
    const start = startedHere(update.id);
    const [a, b] = war ? [war.sideA, war.sideB] : start ? [start.actors, start.opponents] : [[], []];
    const withB = update.opponents.some((name) => holds(a, name)) || update.actors.some((name) => holds(b, name));
    const withA = update.opponents.some((name) => holds(b, name)) || update.actors.some((name) => holds(a, name));
    if (withA === withB) continue;
    update.op = withA ? "join-a" : "join-b";
    update.actors = update.actors.filter((name) => !holds(a, name) && !holds(b, name));
    update.opponents = [];
    if (!update.actors.length) drop.add(update);
  }

  for (const update of records) {
    if (update.op !== "start") continue;
    let actors = [...update.actors];
    let opponents = update.opponents.filter((name) => !holds(actors, name));
    [actors, opponents] = splitOneSidedWar(actors, opponents);
    if (!actors.length || !opponents.length) {
      const combatants = uniquePolities(indexesOf(update).flatMap((at) => normalizeArray(events[at]?.combatants)));
      if (!actors.length && !opponents.length) {
        if (combatants.length === 2) [actors, opponents] = [[combatants[0]], [combatants[1]]];
      } else if (!opponents.length) {
        opponents = combatants.filter((name) => !holds(actors, name));
      } else {
        actors = combatants.filter((name) => !holds(opponents, name));
      }
    }
    update.actors = actors;
    update.opponents = opponents;
  }

  // The same id started twice in one answer, for two different wars: the later is a war of its own.
  const startedBy = new Map();
  for (const update of records) {
    if (update.op !== "start" || drop.has(update) || !update.actors.length || !update.opponents.length) continue;
    const first = startedBy.get(update.id);
    if (!first) {
      startedBy.set(update.id, update);
      continue;
    }
    const sides = [...first.actors, ...first.opponents];
    if ([...update.actors, ...update.opponents].some((name) => holds(sides, name))) continue;
    reid(update, freshId(update.id));
    startedBy.set(update.id, update);
  }

  const next = [];
  for (const update of records) {
    if (drop.has(update)) continue;
    const prior = meant(update.id);
    if (update.op === "resume" && prior?.status === "active") continue;
    if (update.op === "ceasefire" && prior?.status === "ceasefire") continue;
    // A war that is over flaring again (its resumption, or a join against those
    // it names): a new war that renews it, under an id of its own, as a start
    // of it would be (applyUpdateToWarMap does the same for a caller that
    // interprets nothing).
    if (prior?.status === "ended" && ["resume", "join-a", "join-b"].includes(update.op)) {
      const joiners = update.op === "resume" ? [] : update.actors;
      const [actors, opponents] = update.op === "resume"
        ? [prior.sideA, prior.sideB]
        : [joiners, update.opponents.filter((name) => !holds(joiners, name))];
      if (actors.length && opponents.length) {
        const renewal = freshId(prior.id);
        retag(update.id, renewal);
        next.push({ ...update, id: renewal, op: "start", actors: [...actors], opponents: [...opponents], renews: prior.id });
        continue;
      }
    }
    if (update.op !== "start" || !update.actors.length || !update.opponents.length) {
      next.push(update);
      continue;
    }
    const facing = (entry, mine, theirs) => update.actors.some((name) => holds(mine, name))
      && update.opponents.every((name) => holds(theirs, name));
    const faces = (entry) => facing(entry, entry.sideA, entry.sideB) || facing(entry, entry.sideB, entry.sideA);
    let war = prior && prior.status !== "ended" ? prior : null;
    if (war && ![...update.actors, ...update.opponents].some((name) => member(war, name))) {
      // An id the model gave a war being fought, for a war between others.
      reid(update, freshId(update.id));
      war = null;
    } else if (war && war.id !== update.id) {
      retag(update.id, war.id);
    }
    if (!war) {
      // Its opponents are all of one side of a live war and one of its own is
      // of the other: whoever else it names is joining that war.
      const matches = wars.filter((entry) => entry.status !== "ended" && faces(entry));
      if (matches.length === 1) {
        war = matches[0];
        retag(update.id, war.id);
      }
    }
    if (!war) {
      // A war that is over and flares again: a new war that renews it, under
      // an id of its own. The answer's events of the old id are the new war's
      // (the old one was over before this answer began).
      if (prior?.status === "ended") {
        const renewal = freshId(prior.id);
        retag(update.id, renewal);
        update.renews = prior.id;
      }
      next.push(update);
      continue;
    }
    if (war.status === "ceasefire") {
      next.push({ ...update, op: "resume", actors: [], opponents: [] });
      continue;
    }
    const onA = update.actors.some((name) => holds(war.sideA, name)) || update.opponents.some((name) => holds(war.sideB, name));
    const onB = update.actors.some((name) => holds(war.sideB, name)) || update.opponents.some((name) => holds(war.sideA, name));
    if (onA === onB) {
      next.push(update);
      continue;
    }
    const [joinA, joinB] = onA ? [update.actors, update.opponents] : [update.opponents, update.actors];
    const newcomers = (list) => list.filter((name) => !member(war, name));
    if (newcomers(joinA).length) next.push({ ...update, op: "join-a", actors: newcomers(joinA), opponents: [] });
    if (newcomers(joinB).length) next.push({ ...update, op: "join-b", actors: newcomers(joinB), opponents: [] });
  }
  records = next;
  drop.clear();

  for (const update of records) {
    for (const at of indexesOf(update)) {
      const event = events[at];
      if (!isEvent(event)) continue;
      const current = normalizeString(event.warId);
      if (current === update.id || (current && known(current))) continue;
      event.warId = update.id;
      touch();
    }
  }

  for (const [at, event] of events.entries()) {
    if (!isEvent(event)) continue;
    if (records.some((update) => indexesOf(update).includes(at))) continue;
    const warId = normalizeString(event.warId);
    if (!warId || known(warId)) continue;
    const combatants = uniquePolities(event.combatants);
    if (combatants.length !== 2) continue;
    const existing = matchingWarForCombatants(wars, combatants);
    if (existing.length > 1) continue;
    if (existing.length === 1) {
      event.warId = existing[0].id;
      touch();
      continue;
    }
    records.push({ id: warId, op: "start", actors: [combatants[0]], opponents: [combatants[1]], eventIndexes: [at], eventIds: [], baselineDate: "", renews: "", note: "" });
  }

  const working = warMapFromWorld(world);
  for (const update of records) applyUpdateToWarMap({ map: working, update });
  const after = warIndex([...working.values()]);
  for (const event of events) {
    if (!isEvent(event)) continue;
    const war = resolveWarReference(after, normalizeString(event.warId));
    if (!war) continue;
    const listed = uniquePolities(event.combatants);
    if (!listed.length) continue;
    const kept = listed.filter((name) => member(war, name));
    if (JSON.stringify(kept) === JSON.stringify(normalizeArray(event.combatants))) continue;
    event.combatants = kept;
    touch();
  }

  if (JSON.stringify(records) !== before) {
    candidate.warUpdates = records;
    touch();
  }
  return outcome;
};

// What one answer's war records and war-tagged events come to, settled by the
// engine alone: never a reason to ask the model again. The owner, 2026-11-13:
// "Time skips keep running into war validation failures ... Missing or invalid
// war references can trigger expensive retries, and I've seen cases where
// recovery still leaves contradictory events behind."
//
// It was four passes and a verdict: the interpretation, a combat binder that
// read the events' English words for battles, a rebinder that read them for
// declarations and peaces, then a validator that refused the answer (a second
// request for the same period) and a last-attempt repair that dropped records
// until the validator stopped objecting, and still refused the segment when
// one event's words could not be answered for. Now, in one pass:
//   1. interpretWarLedger makes explicit what the answer's structure says;
//   2. every record is applied to the wars as they stand, starts first (a war
//      the answer opens exists for all of it), and a record that cannot apply
//      is left out and said;
//   3. a war the answer starts began no later than the earliest of its events
//      the answer tells: its start is tied to that one;
//   4. an event tagged with a war carries a war that exists once the records
//      are in, or none: a tag naming no war is removed and said, and the event
//      stays as history;
//   5. a war event names only that war's belligerents among its combatants.
// Nothing is read from what an event says, in any language: what the records
// say happens, and what they do not say does not.
//
// Returns { notes, dropped, unbound }: notes are { kind, text, key, params,
// event } for the turn's receipt (the model reads them at the top of its next
// turn); dropped the records left out; unbound the titles of the events whose
// war tag was removed. Run again on its own output it changes nothing.
export const settleWarLedger = (candidate, { world = {}, authority = "skip" } = {}) => {
  const outcome = { notes: [], dropped: [], unbound: [] };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return outcome;
  const written = decodeWarUpdates(candidate.warUpdates, { limit: Infinity }).length;
  if (written > MAX_WAR_UPDATES_PER_PASS) {
    outcome.notes.push({
      kind: "dropped",
      text: `War ledger: ${written - MAX_WAR_UPDATES_PER_PASS} war record(s) past the ${MAX_WAR_UPDATES_PER_PASS} one answer may hold were left out.`,
      key: "warRecordsMany",
      params: { count: written - MAX_WAR_UPDATES_PER_PASS },
      event: "",
    });
  }
  interpretWarLedger(candidate, { world, authority });

  const events = normalizeArray(candidate.events);
  // The events as the ledger reads them, in the answer's own order (a record
  // names its event by its place in the answer, or once bound by its id).
  const ledgerEvents = normalizeEvents(events);
  const records = decodeWarUpdates(candidate.warUpdates);
  const startOf = (warId) => records.find((update) => update.op === "start" && update.id === warId);

  // A war began no later than the earliest of its events the answer tells: its
  // start is tied to that one too (the start's date is its earliest event's).
  // A battle listed, or dated, before the declaration it belongs to used to
  // date the war after its own first battle.
  const dateOf = (event) => (parseIsoDate(normalizeString(event?.date)) ? normalizeString(event.date) : "");
  for (const update of records) {
    if (update.op !== "start") continue;
    const own = ledgerEvents.map((event, at) => ({ event, at }))
      .filter(({ event }) => normalizeString(event.warId) === update.id && dateOf(event));
    if (!own.length) continue;
    const earliest = own.sort((a, b) => compareGameDates(dateOf(a.event), dateOf(b.event)) || a.at - b.at)[0];
    const first = firstLinkedDate(update, ledgerEvents);
    if (first && compareGameDates(dateOf(earliest.event), first) >= 0) continue;
    if (normalizeArray(update.eventIds).length) {
      update.eventIds = [...new Set([normalizeString(earliest.event.id), ...update.eventIds])].filter(Boolean);
    } else {
      update.eventIndexes = [...new Set([earliest.at, ...normalizeArray(update.eventIndexes)])];
    }
  }

  const working = warMapFromWorld(world);
  const kept = [];
  const order = [...records.filter((update) => update.op === "start"), ...records.filter((update) => update.op !== "start")];
  for (const update of order) {
    const linked = linkedEventsForUpdate(update, ledgerEvents);
    const result = applyUpdateToWarMap({ map: working, update, date: firstLinkedDate(update, ledgerEvents), linkedEvents: linked });
    if (result.error) {
      outcome.dropped.push(update);
      const war = working.get(update.id) || startOf(update.id);
      const a = normalizeString(update.actors[0] || war?.sideA?.[0] || war?.actors?.[0]);
      const b = normalizeString(update.opponents[0] || war?.sideB?.[0] || war?.opponents?.[0]);
      outcome.notes.push({
        kind: "dropped",
        text: `War record "${compactWarField(update.id).slice(0, 60)}" (${update.op}) was left out: ${result.error}`,
        // (Named by its two sides where they are known: the player's note never shows an id.)
        key: a && b ? "gmWarChangeLeftOut" : "warRecordsOne",
        params: a && b ? { a, b } : {},
        event: normalizeString(linked[0]?.title),
      });
      continue;
    }
    // (A record that opened a renewal now names it.)
    kept.push(result.war.id !== update.id ? { ...update, id: result.war.id } : update);
  }
  candidate.warUpdates = kept;

  const after = warIndex([...working.values()]);
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const tag = normalizeString(event.warId);
    if (!tag) continue;
    const war = resolveWarReference(after, tag);
    if (!war) {
      event.warId = "";
      if (normalizeArray(event.combatants).length) event.combatants = [];
      const title = normalizeString(event.title);
      outcome.unbound.push(title);
      outcome.notes.push({
        kind: "adjusted",
        text: `"${title || "An event"}" was tagged with war "${compactWarField(tag).slice(0, 60)}", which no record opens and the ledger does not hold: the tag was removed, and the event stands as history.`,
        key: "warLinkRemoved",
        params: {},
        event: title,
      });
      continue;
    }
    if (war.id !== tag) event.warId = war.id;
    const listed = normalizeArray(event.combatants);
    if (!listed.length) continue;
    const members = uniquePolities(listed).filter((name) => warSideOf(war, name));
    if (members.length !== listed.length) event.combatants = members;
  }
  return outcome;
};

const compactWarField = (value) =>
  normalizeString(value)
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The first thing a settlement would leave out of an answer, in words, or ""
// when it would leave out nothing: for the Game Master, whose administrator
// may be asked once more, and for tests. Asked of a copy: the answer itself is
// not touched. (`startsInForce` and `excused` are what the old validator read
// an answer's order and wording with; nothing here reads either.)
const firstSettlementProblem = (candidate, { world = {}, authority = "skip" } = {}) => {
  const copy = {
    events: normalizeArray(candidate?.events).map((event) => (event && typeof event === "object" ? { ...event, combatants: normalizeArray(event.combatants).slice() } : event)),
    warUpdates: decodeWarUpdates(candidate?.warUpdates, { limit: Infinity }).map((update) => ({ ...update })),
  };
  const { notes } = settleWarLedger(copy, { world, authority });
  return notes[0]?.text || "";
};

export const validateWarLedgerPayload = (candidate, { world = {}, authority = "skip" } = {}) =>
  firstSettlementProblem(candidate, { world, authority });

export const validateCanonicalWarEvents = ({ events, updates, world, limit, authority = "skip" } = {}) =>
  firstSettlementProblem({ events, warUpdates: bindWarUpdatesToEvents(updates, events, { limit }) }, { world, authority });

// Round Zero is an as-of-start canonical baseline, not a replay of every
// historical cause. A live war therefore does not need a duplicated event.warId
// merely to exist. When a matching pre-game event is present we still preserve
// that provenance; when it is absent, the structured war record stands on its
// own and the lifecycle/sides remain fully validated.
export const validatePregameWarBootstrap = ({
  world = {},
  updates = [],
  events = [],
  startDate = "",
} = {}) => {
  const normalizedEvents = normalizeEvents(events);
  const decoded = bindWarUpdatesToEvents(updates, normalizedEvents);
  const lastKnownDateByWar = new Map();

  for (let index = 0; index < decoded.length; index += 1) {
    const update = decoded[index];
    const op = normalizeString(update?.op);
    if (!["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"].includes(op)) {
      return {
        error: `$.warUpdates record ${index + 1} has the unsupported operation ${op || "<blank>"}.`,
        updates: decoded,
        warProbe: null,
      };
    }
    const indexes = normalizeArray(update?.eventIndexes);
    if (indexes.some((eventIndex) => eventIndex < 0 || eventIndex >= normalizedEvents.length)) {
      return {
        error: `$.warUpdates record ${index + 1} references a pre-game event outside $.events.`,
        updates: decoded,
        warProbe: null,
      };
    }

    const baselineDate = normalizeString(update?.baselineDate);
    if (baselineDate) {
      if (!parseIsoDate(baselineDate)) {
        return {
          error: `$.warUpdates record ${index + 1} baseline date must be a valid game date or blank.`,
          updates: decoded,
          warProbe: null,
        };
      }
      if (parseIsoDate(startDate) && compareGameDates(baselineDate, startDate) > 0) {
        return {
          error: `$.warUpdates record ${index + 1} baseline date must be on or before the Round-One date ${startDate}.`,
          updates: decoded,
          warProbe: null,
        };
      }
    }

    const effectiveDate = firstLinkedDate(update, normalizedEvents) || sortDate(baselineDate);
    const warId = normalizeString(update?.id);
    const priorKnownDate = lastKnownDateByWar.get(warId) || "";
    if (effectiveDate && priorKnownDate && compareGameDates(effectiveDate, priorKnownDate) < 0) {
      return {
        error: `$.warUpdates record ${index + 1} for ${warId || "unnamed war"} predates an earlier transition in the same Round-Zero lifecycle.`,
        updates: decoded,
        warProbe: null,
      };
    }
    if (effectiveDate && warId) lastKnownDateByWar.set(warId, effectiveDate);
  }

  // Do not pass startDate as a fallback event date. If the model supplied no
  // provenance event and no known transition date, "unknown" is more honest
  // than pretending the war began on the campaign's first playable day.
  const warProbe = applyWarUpdates({
    world,
    updates: decoded,
    events: normalizedEvents,
    stopDate: "",
    round: 1,
  });
  if (warProbe.appliedIds.length !== decoded.length) {
    return {
      error: "$.warUpdates contains an invalid Round-One war lifecycle sequence. Bootstrap only wars that actually survive into the start date, beginning with a valid start operation.",
      updates: decoded,
      warProbe,
    };
  }

  for (const warId of new Set(decoded.map((update) => normalizeString(update?.id)).filter(Boolean))) {
    const war = normalizeArray(warProbe.wars).find((entry) => normalizeString(entry?.id) === warId);
    if (!war || !["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) {
      return {
        error: `$.warUpdates leaves ${warId} ${normalizeString(war?.status) || "missing"} at Round One. A war that ended before the campaign belongs only in the pre-game events, not the live war ledger.`,
        updates: decoded,
        warProbe,
      };
    }
  }

  return { error: "", updates: decoded, warProbe };
};

// `limit` as in the decoder: a merged turn passes Infinity, because the cap is
// per model answer and each segment's answer was held to it already.
export const applyWarUpdates = ({ world, updates, events = [], stopDate = "", round = 0, limit } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = warMapFromWorld(nextWorld);
  const decoded = bindWarUpdatesToEvents(updates, events, { limit });
  const appliedIds = [];

  for (const update of decoded) {
    const linkedEvents = linkedEventsForUpdate(update, events);
    // A Round-Zero baseline may be valid without a historical event card. In
    // that one transport, gameplay.js carries the canonical transition date as
    // baselineDate. Normal-turn records never have it and remain event-dated.
    const date = firstLinkedDate(update, events) || sortDate(update?.baselineDate) || sortDate(stopDate);
    const result = applyUpdateToWarMap({ map, update, date, round, linkedEvents });
    if (result.error) {
      console.warn(`[OH war ledger] dropped invalid ${update.op} for ${update.id}: ${result.error}`);
      continue;
    }
    // (The war it changed: a renewal's own id where it opened one.)
    appliedIds.push(result.war.id);
  }

  // In the ledger's order, nothing live cut, and an ended war still named by
  // the world kept (runtime/warRecord.js normalizeWarRecords).
  const wars = normalizeWarRecords([...map.values()], { keep: referencedWarIds(nextWorld) });

  return { world: { ...nextWorld, wars }, wars, appliedIds };
};

// A war that ended lately stays in view for two rounds, so the model knows the
// fighting stopped and why a peace is holding: at most five, newest first, one
// short line each. `updatedRound` is the round its end was written in.
const RECENTLY_ENDED_ROUNDS = 2;
const MAX_RECENTLY_ENDED = 5;

const recentlyEndedWars = (wars, round) => {
  const current = Math.trunc(Number(round) || 0);
  if (current <= 0) return [];
  return wars
    .filter((war) => war.status === "ended" && war.updatedRound > current - RECENTLY_ENDED_ROUNDS)
    .sort((a, b) =>
      b.updatedRound - a.updatedRound ||
      compareGameDates(b.endedDate || "", a.endedDate || "") ||
      a.id.localeCompare(b.id))
    .slice(0, MAX_RECENTLY_ENDED);
};

// `round` is the game's current round; without it no ended war is listed.
export const buildCanonicalWarContext = (world, { round = 0 } = {}) => {
  const wars = normalizedWars(world);
  const current = wars.filter((war) => war.status !== "ended");
  const ended = recentlyEndedWars(wars, round);
  const endedLines = ended.length
    ? [
      "",
      "Recently ended (no one is fighting these; a war that flares again is a new war: give it a start record, and the game gives it an id of its own):",
      ...ended.map((war) =>
        `- ${war.id} | ENDED ${war.endedDate || "unknown"} | SIDE A: ${war.sideA.join(", ")} | SIDE B: ${war.sideB.join(", ")}`),
    ]
    : [];
  if (!current.length) {
    return [
      "No active or ceasefire canonical wars are recorded.",
      "Until a war is opened in this ledger, nobody is fighting a battlefield campaign.",
      ...endedLines,
    ].join("\n");
  }
  return [
    ...current.map((war) =>
      `- ${war.id} | ${war.status.toUpperCase()} | SIDE A: ${war.sideA.join(", ")} | SIDE B: ${war.sideB.join(", ")} | started ${war.startedDate || "unknown"}` +
      (war.note ? ` | latest: ${war.note}` : ""),
    ),
    ...endedLines,
    "",
    "This ledger is authoritative belligerency. A storyline, mobilization, historical expectation, or tense relationship does NOT itself create a war; an alliance does only through the game, which enters in this ledger those bound to defend a country that is attacked.",
  ].join("\n");
};

export const activeWarIdsForPolity = (world, polity) => {
  const key = polityKey(polity);
  if (!key) return [];
  return normalizedWars(world)
    .filter((war) => war.status === "active")
    .filter((war) => [...war.sideA, ...war.sideB].some((entry) => polityKey(entry) === key))
    .map((war) => war.id);
};
