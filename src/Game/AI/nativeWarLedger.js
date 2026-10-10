// Open Historia — native war-state ledger (from kernely's Continuum branch).
//
// What it owns:
// - authoritative persistent belligerency in world.wars
// - compact Gemini transport; no large nested tool schema
// - hard combat cannot exist without an active canonical war
// - war starts/joins/ceasefires/resumptions/endings are explicit state transitions
// - suitable for the Stats -> Current Conflicts panel

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { compareGameDates, parseGameDate } from "../../runtime/gameDates.js";

const WAR_UPDATE_SEPARATOR = "~";
const MAX_WAR_UPDATES_PER_PASS = 16;
const MAX_WARS = 64;

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const canonicalPolity = (value) => {
  const raw = normalizeString(value);
  if (!raw) return "";
  return normalizeString(toCountryName(raw)) || raw;
};

const polityKey = (value) => canonicalPolity(value).toLocaleLowerCase();

const uniquePolities = (value, limit = 12) => {
  const seen = new Set();
  const result = [];
  for (const raw of normalizeArray(value)) {
    const polity = canonicalPolity(raw);
    const key = polity.toLocaleLowerCase();
    if (!polity || seen.has(key)) continue;
    seen.add(key);
    result.push(polity);
    if (result.length >= limit) break;
  }
  return result;
};

// Any game date, BC included (runtime/gameDates.js).
const parseIsoDate = parseGameDate;

const sortDate = (value) => parseIsoDate(value) ? normalizeString(value) : "";

const deriveWarTitle = (war) => {
  const explicit = normalizeString(war?.title);
  if (explicit) return explicit;
  const a = uniquePolities(war?.sideA, 2);
  const b = uniquePolities(war?.sideB, 2);
  if (a.length && b.length) return `${a[0]}–${b[0]} War`;
  return normalizeString(war?.id) || "Unnamed conflict";
};

// A start's note may open with the war's own name — "Title: The Winter War;
// Soviet demands on the Karelian isthmus" — and the rest is its cause. Without
// it every war the model opened was called "A–B War" and the model's own name
// for it was lost.
const WAR_TITLE_NOTE_RE = /^title\s*:\s*([^;]+?)\s*(?:;\s*([\s\S]*))?$/i;
export const splitWarStartNote = (note) => {
  const text = normalizeString(note);
  const match = text.match(WAR_TITLE_NOTE_RE);
  return match
    ? { title: normalizeString(match[1]), cause: normalizeString(match[2]) }
    : { title: "", cause: text };
};

const normalizeWar = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = normalizeString(entry.id) || `war-${index}`;
  const sideA = uniquePolities(entry.sideA);
  const sideAKeys = new Set(sideA.map(polityKey));
  const sideB = uniquePolities(entry.sideB).filter((name) => !sideAKeys.has(polityKey(name)));
  if (!id || !sideA.length || !sideB.length) return null;

  const rawStatus = normalizeString(entry.status).toLowerCase();
  const status = ["active", "ceasefire", "ended"].includes(rawStatus) ? rawStatus : "active";

  const war = {
    id,
    title: normalizeString(entry.title),
    status,
    sideA,
    sideB,
    startedDate: sortDate(entry.startedDate),
    endedDate: status === "ended" ? sortDate(entry.endedDate || entry.lastUpdatedDate) : "",
    lastUpdatedDate: sortDate(entry.lastUpdatedDate || entry.startedDate),
    cause: normalizeString(entry.cause),
    note: normalizeString(entry.note),
    sourceEventIds: [...new Set(normalizeArray(entry.sourceEventIds).map(normalizeString).filter(Boolean))].slice(-24),
    storylineIds: [...new Set(normalizeArray(entry.storylineIds).map(normalizeString).filter(Boolean))].slice(-12),
    createdRound: Math.max(0, Math.trunc(Number(entry.createdRound) || 0)),
    updatedRound: Math.max(0, Math.trunc(Number(entry.updatedRound) || 0)),
  };
  war.title = deriveWarTitle(war);
  return war;
};

const normalizedWars = (world) =>
  normalizeArray(normalizeWorldState(world)?.wars)
    .map(normalizeWar)
    .filter(Boolean)
    .slice(0, MAX_WARS);

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
// ONE live war between the same two sides, with no conflicting known date, is
// that war whatever the fact calls it: the same belligerents are not fighting
// each other twice at once, and a model that restates canon writes the war's
// name in the game's language. Such a fact used to be "ambiguous: the same live
// sides/date already exist under a different canonical title", which refused
// the whole Round-Zero answer; it is now the match, marked `restated`, and the
// caller keeps the canonical title (see resolvePregameAgreementBaselineMatch,
// where a player's game met this).
//
// MORE than one such war is still an error, marked `ambiguous` so the caller
// can leave that fact out on its last attempt. So is a single one that another
// fact of the same answer already resolved to (`claimedIds`), or that has no
// title of its own to keep. Neither is permission to fork a second live war.
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
  if (possible.length === 1 && pregameWarTitleKey(possible[0].title) && !claimedIds?.has(normalizeString(possible[0].id))) {
    return { match: possible[0], restated: true, error: "" };
  }
  if (possible.length) {
    return { match: null, ambiguous: true, error: "Round-Zero war identity is ambiguous: the same live sides/date already exist under a different canonical title." };
  }

  const conflictingKnownDate = live.some((entry) =>
    pregameWarTitleKey(entry.title) === title &&
    date && normalizeString(entry.startedDate) && normalizeString(entry.startedDate) !== date
  );
  if (conflictingKnownDate) {
    return { match: null, error: "Round-Zero war conflicts with a live war having the same sides/title but a different known start date." };
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
  if (pregameWarTitleKey(prior.title) !== pregameWarTitleKey(next.title)) {
    return { record: null, error: `Round-Zero war ${prior.id} changes canonical title identity.` };
  }
  if (prior.status !== next.status) {
    return { record: null, error: `Round-Zero war ${prior.id} conflicts on status (${prior.status} vs ${next.status}).` };
  }
  if (prior.startedDate && next.startedDate && prior.startedDate !== next.startedDate) {
    return { record: null, error: `Round-Zero war ${prior.id} conflicts on known start date.` };
  }
  const startedDate = prior.startedDate || next.startedDate;
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

  const [idRaw, opRaw, actorsRaw, opponentsRaw, eventNumbersRaw, noteRaw] = fields;
  return {
    id: normalizeString(idRaw) || `war-${index}`,
    op: normalizeString(opRaw).toLowerCase(),
    actors: parseCsv(actorsRaw),
    opponents: parseCsv(opponentsRaw),
    eventIndexes: parseEventNumbers(eventNumbersRaw),
    eventIds: [],
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
          id: normalizeString(entry.id) || `war-${index}`,
          op: normalizeString(entry.op).toLowerCase(),
          actors: uniquePolities(entry.actors),
          opponents: uniquePolities(entry.opponents),
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

const applyUpdateToWarMap = ({ map, update, date = "", round = 0, linkedEvents = [] }) => {
  const id = normalizeString(update?.id);
  const op = normalizeString(update?.op).toLowerCase();
  if (!id || !op) return { error: "War update is missing id/op." };

  const prior = map.get(id) || null;
  const eventDate = sortDate(date);
  const eventIds = linkedEvents.map((event) => normalizeString(event?.id)).filter(Boolean);
  const storylineIds = linkedEvents.flatMap((event) => normalizeArray(event?.storylineIds)).map(normalizeString).filter(Boolean);
  const startNote = op === "start" ? splitWarStartNote(update.note) : null;

  const save = (war) => {
    const normalized = normalizeWar({
      ...war,
      id,
      note: (startNote ? startNote.cause : normalizeString(update.note)) || normalizeString(war.note),
      sourceEventIds: [...new Set([...normalizeArray(war.sourceEventIds), ...eventIds])],
      storylineIds: [...new Set([...normalizeArray(war.storylineIds), ...storylineIds])],
      lastUpdatedDate: eventDate || war.lastUpdatedDate,
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    });
    if (!normalized) return { error: `War ${id} became invalid after ${op}.` };
    map.set(id, normalized);
    return { war: normalized };
  };

  if (op === "start") {
    if (prior && prior.status !== "ended") {
      return { error: `War ${id} already exists with status ${prior.status}; use join/resume/end instead of start.` };
    }
    const sideA = uniquePolities(update.actors);
    const sideBKeys = new Set(sideA.map(polityKey));
    const sideB = uniquePolities(update.opponents).filter((name) => !sideBKeys.has(polityKey(name)));
    if (!sideA.length || !sideB.length) return { error: `War ${id} start requires non-empty opposing actors and opponents.` };
    return save({
      id,
      title: startNote.title,
      status: "active",
      sideA,
      sideB,
      startedDate: eventDate,
      endedDate: "",
      cause: startNote.cause,
      createdRound: Math.max(0, Math.trunc(Number(round) || 0)),
    });
  }

  if (!prior) return { error: `War ${id} does not exist; ${op} cannot be applied before start.` };

  if (op === "join-a" || op === "join-b") {
    if (prior.status !== "active") return { error: `War ${id} is ${prior.status}; participants may join only an active war.` };
    const joiners = uniquePolities(update.actors);
    if (!joiners.length) return { error: `War ${id} ${op} requires at least one joining polity.` };
    const sideA = [...prior.sideA];
    const sideB = [...prior.sideB];
    const own = op === "join-a" ? sideA : sideB;
    const enemy = op === "join-a" ? sideB : sideA;
    const enemyKeys = new Set(enemy.map(polityKey));
    for (const joiner of joiners) {
      if (enemyKeys.has(polityKey(joiner))) return { error: `${joiner} is already on the opposing side of war ${id}.` };
      if (!own.some((entry) => polityKey(entry) === polityKey(joiner))) own.push(joiner);
    }
    return save({ ...prior, sideA, sideB });
  }

  if (op === "leave") {
    const leavers = uniquePolities(update.actors);
    if (!leavers.length) return { error: `War ${id} leave requires at least one polity.` };
    const leavingKeys = new Set(leavers.map(polityKey));
    const sideA = prior.sideA.filter((entry) => !leavingKeys.has(polityKey(entry)));
    const sideB = prior.sideB.filter((entry) => !leavingKeys.has(polityKey(entry)));
    if (sideA.length === prior.sideA.length && sideB.length === prior.sideB.length) {
      return { error: `None of the leaving polities are participants in war ${id}.` };
    }
    if (!sideA.length || !sideB.length) {
      return save({ ...prior, status: "ended", endedDate: eventDate || prior.endedDate });
    }
    return save({ ...prior, sideA, sideB });
  }

  if (op === "ceasefire") {
    if (prior.status !== "active") return { error: `War ${id} must be active before a ceasefire.` };
    return save({ ...prior, status: "ceasefire" });
  }
  if (op === "resume") {
    if (prior.status !== "ceasefire") return { error: `War ${id} must be in ceasefire before hostilities resume.` };
    return save({ ...prior, status: "active", endedDate: "" });
  }
  if (op === "end") {
    if (prior.status === "ended") return { error: `War ${id} is already ended.` };
    return save({ ...prior, status: "ended", endedDate: eventDate || prior.endedDate });
  }

  return { error: `Unsupported war operation "${op}" for ${id}.` };
};

const HARD_COMBAT_RE = /\b(battle|invasion|invades?|bombard(?:ment|s|ed|ing)?|shell(?:ing|s|ed)?|assault|attack(?:s|ed|ing)?|raid(?:s|ed|ing)?|siege|clash(?:es|ed)?|fighting|repuls(?:e|es|ed)|captures?|recaptures?|liberat(?:es|ed|ion)|front\b.*\b(stalemate|fighting)|stalemate\b.*\bfront)\b/i;
// Strong battlefield terms that are safe even if `kind` was imperfectly tagged.
// Bare "combat" is intentionally NOT sufficient: in military prose it is often
// adjectival ("combat battlegroup", "combat-ready", "combat capability") rather
// than evidence that two polities are fighting one another.
const UNAMBIGUOUS_COMBAT_RE = /\b(battle|invasion|invades?|bombard(?:ment|s|ed|ing)?|shell(?:ing|s|ed)?|assault|siege|clash(?:es|ed)?|fighting|firefight|artillery fire|air strike|airstrike|ground fighting)\b/i;
const DIRECT_COMBAT_CONTEXT_RE = /\b(?:engag(?:e|es|ed|ing)|locked)\b.{0,80}\bcombat\b|\bcombat\b.{0,80}\b(?:against|between|with)\b|\bcombat operations?\b.{0,80}\b(?:against|targeting)\b/i;
// Direct adversarial action is stronger evidence than a combat noun somewhere in
// background prose. This catches real fighting such as "assaults on insurgent
// positions" while leaving "assault plan", "battle tanks" and historical
// references alone.
const DIRECT_ADVERSARIAL_ACTION_RE = /\b(?:attack(?:s|ed|ing)?|assault(?:s|ed|ing)?|bombard(?:s|ed|ing)?|shell(?:s|ed|ing)?|raid(?:s|ed|ing)?)\b[^.!?;]{0,72}\b(?:on|against|at|targeting)\b/i;
const HIGH_CONFIDENCE_COMBAT_TITLE_RE = /(?:\bbattle of\b|\binvasion of\b|\binvad(?:e|es|ed|ing)\b|\bamphibious assault\b|\b(?:air ?strikes?|bombard(?:s|ed|ment|ing)?|shell(?:s|ed|ing)?)\b|\b(?:army|armies|troops?|brigades?|battalions?|regiments?|military units?|warships?|aircraft)\b[^:;.!?]{0,64}\b(?:attack(?:s|ed|ing)?|assault(?:s|ed|ing)?|capture|captures|captured|seize|seizes|seized|storm|storms|stormed|overrun|overruns|overran)\b|\bsiege of\b)/i;
const ORGANIZED_FORCE_CLASH_RE = /\b(?:army|armies|troops?|brigades?|battalions?|regiments?|military units?)\b[^.!?;]{0,80}\b(?:clash(?:es|ed)?|fight(?:s|ing)?|exchange(?:s|d)? fire|engag(?:e|es|ed|ing))\b/i;
const ACTIVE_OFFENSIVE_RE = /\b(launch(?:es|ed|ing)?|begin(?:s|ning)?|open(?:s|ed|ing)?|commence(?:s|d|ing)?|initiat(?:es|ed|ing)?|execute(?:s|d|ing)?)\b.{0,60}\b(counter[- ]?)?offensive\b|\b(counter[- ]?)?offensive\b.{0,60}\b(begins?|opens?|commences?|is launched|is underway)\b/i;
const WAR_START_RE = /\b(declares? war|declaration of war|enters? (?:the )?war|joins? (?:the )?war|war is declared|commences? hostilities)\b/i;
const CEASEFIRE_RE = /\b(ceasefire (?:takes effect|begins|signed|agreed|declared)|armistice (?:takes effect|signed|agreed)|truce (?:takes effect|signed|agreed))\b/i;
const WAR_END_RE = /\b(peace treaty (?:signed|takes effect)|war ends|ends? the war|hostilities formally end|peace is signed)\b/i;

// Military vocabulary is full of nouns that contain combat words without
// describing combat: "infantry fighting vehicle", "main battle tank",
// "attack helicopter", "assault rifle", "combat readiness", etc.
//
// Mask those lexicalized platform/doctrine phrases before battlefield detection.
// This is generic semantic normalization, not a country/event-specific exception.
const NON_BATTLEFIELD_COMBAT_TERMS_RE = new RegExp(
  [
    String.raw`\b(?:infantry|armou?red|tracked|mechanized|mechanised)?\s*fighting vehicles?\b`,
    String.raw`\bmain battle tanks?\b`,
    String.raw`\battack helicopters?\b`,
    String.raw`\bassault rifles?\b`,
    String.raw`\bassault weapons?\b`,
    String.raw`\bcombat vehicles?\b`,
    String.raw`\bcombat aircraft\b`,
    String.raw`\bcombat systems?\b`,
    String.raw`\bcombat readiness\b`,
    String.raw`\bcombat training\b`,
    String.raw`\bcombat capability\b`,
    String.raw`\bcombat capabilities\b`,
    String.raw`\bcombat support\b`,
    String.raw`\bcombat battlegroups?\b`,
    String.raw`\bcombat[- ]ready\b`,
    String.raw`\bcombat deployments?\b`,
    String.raw`\bcombat formations?\b`,
    String.raw`\bcombat units?\b`,
    // Unit names and task-force labels. "FAE 21st Combat Wing Redeploys to
    // Quito Amid Border Strains" read as combat in a player's Ecuador game on
    // two turns running, because a bare "combat" stood within eighty characters
    // of "with" (DIRECT_COMBAT_CONTEXT_RE) — an air wing changing bases. A
    // "battle group" is a formation too, and "battle" alone is a battle.
    String.raw`\bcombat (?:wings?|groups?|teams?|brigades?|squadrons?|air patrols?|engineers?|aviation|divisions?|regiments?|battalions?|commands?)\b`,
    String.raw`\b(?:carrier )?battle ?groups?\b`,
  ].join("|"),
  "gi",
);

const NON_BATTLEFIELD_ACTION_TERMS_RE = new RegExp(
  [
    String.raw`\b(?:simulated|mock|training|exercise)\s+(?:attack|assault|invasion|raid|battle|combat)\b`,
    String.raw`\b(?:attack|assault|invasion|raid|battle|combat)\s+(?:scenario|scenarios|drill|drills|exercise|exercises)\b`,
  ].join("|"),
  "gi",
);

// "Offensive" is also the ordinary word for a concerted non-military campaign.
// A player's Iran game queued a démarche for sanctions relief and the model
// wrote it up faithfully — "Ministry of Foreign Affairs Launches European
// Diplomatic Offensive for Sanctions Relief" — which ACTIVE_OFFENSIVE_RE read as
// a launched military offensive with no combatants. The correction the retry
// sent was about that phantom battle, and on the final attempt the salvage
// dropped the player's own action from the turn. A qualifier that makes the
// campaign non-military masks it; real fighting in the same event still trips
// the battlefield terms, which this leaves untouched. "Cyber" is deliberately
// not on the list: a cyber offensive is a hostile act, not a figure of speech.
const NON_BATTLEFIELD_OFFENSIVE_RE =
  /\b(?:diplomatic|charm|peace|political|media|public[- ]relations|propaganda|information|legal|lobbying|economic|trade|investment|marketing|publicity|messaging)\s+(?:counter[- ]?)?offensives?\b/gi;

const combatSemanticText = (event) =>
  [normalizeString(event?.title), normalizeString(event?.description)]
    .filter(Boolean)
    .join(". ")
    .replace(NON_BATTLEFIELD_COMBAT_TERMS_RE, " military-equipment ")
    .replace(NON_BATTLEFIELD_ACTION_TERMS_RE, " military-exercise ")
    .replace(NON_BATTLEFIELD_OFFENSIVE_RE, " non-military-campaign ");

// Semantic WHAT: does the event itself actually describe battlefield combat?
// This deliberately ignores impacts.unitOps. A post-processor may implement
// event semantics, but it may not turn a conscription law, exercise, readiness
// measure, procurement decision, training cycle or administrative military event
// into combat merely by attaching op=attack.
export const eventNarratesHardCombat = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const text = combatSemanticText(event);
  const title = combatSemanticText({ title: event?.title, description: "" });
  const military = normalizeString(event?.kind).toLowerCase() === "military";
  const combatants = uniquePolities(event?.combatants, 8);
  const hasOpposingActors = combatants.length >= 2;
  const hasControl = normalizeArray(impacts.regionControlOps)
    .some((op) => ["contest", "control"].includes(normalizeString(op?.op).toLowerCase()));

  // High-confidence causal evidence may stand on its own. Generic words such as
  // "clashes", "fighting" or "battle" in background prose do not. If the
  // title is not itself a battlefield claim, a military-tagged event needs two
  // structured combatants before those weaker nouns can demand a canonical war.
  if (HIGH_CONFIDENCE_COMBAT_TITLE_RE.test(title)) return true;
  if (ORGANIZED_FORCE_CLASH_RE.test(text)) return true;
  // Generic "attack/assault against" language is common in politics and law.
  // Outside a high-confidence battlefield title, require military classification
  // or at least two structured opposing combatants before it can demand a war.
  if ((military || hasOpposingActors) && DIRECT_ADVERSARIAL_ACTION_RE.test(text)) return true;
  if ((military || hasOpposingActors) && (DIRECT_COMBAT_CONTEXT_RE.test(text) || ACTIVE_OFFENSIVE_RE.test(text))) return true;
  if (military && hasOpposingActors && UNAMBIGUOUS_COMBAT_RE.test(text)) return true;
  return hasControl && HARD_COMBAT_RE.test(text);
};

// What can OPEN a war is read more widely than what makes an event a battle.
// eventNarratesHardCombat decides whether an event must belong to a war at all,
// and a loose word there turns "the government battles wildfires" into a
// phantom war. This is asked only of an event the model already named as the
// start of a war between two belligerents, and there a word form the patterns
// above miss throws a real war away. A player's Albania answered its own
// declaration with "1st Albanian Motorized Brigade Assaults Prizren", and a
// Sweden that ordered "we move troops into norway" got "Swedish Armed Forces
// Cross the Norwegian Border in Shock Mobilization": "Assaults", "declared war"
// and a border crossing were none of them read as opening a war.
const WAR_START_EVIDENCE_RE = new RegExp(
  [
    String.raw`\bdeclar(?:e|es|ed|ing) (?:a )?(?:state of )?war\b`,
    String.raw`\bdeclarations? of war\b`,
    String.raw`\bwar (?:is|was|has been) declared\b`,
    String.raw`\b(?:enter(?:s|ed|ing)?|join(?:s|ed|ing)?) (?:the )?war\b`,
    String.raw`\b(?:commenc(?:e|es|ed|ing)|open(?:s|ed|ing)?|begin(?:s|ning)?|began|begun) hostilities\b`,
    String.raw`\binvad(?:e|es|ed|ing)\b`,
    String.raw`\binvasions?\b`,
    String.raw`\bassault(?:s|ed|ing)?\b`,
    String.raw`\bbattles?\b`,
    String.raw`\bbesieg(?:e|es|ed|ing)\b`,
    String.raw`\bair ?strikes?\b`,
    String.raw`\bfirefights?\b`,
    String.raw`\bfought\b`,
    // An army over the border: "Swedish Armed Forces Cross the Norwegian
    // Border", "troops pour across the frontier".
    String.raw`\b(?:troops|forces|army|armies|tanks|armou?r|divisions?|brigades?|battalions?|regiments?|soldiers|columns?|units)\b[^.]{0,80}?\b(?:cross(?:es|ed|ing)?|breach(?:es|ed|ing)?)\b[^.]{0,40}?\b(?:border|frontier|boundary)\b`,
    String.raw`\b(?:pour(?:s|ed|ing)?|push(?:es|ed|ing)?|advanc(?:e|es|ed|ing)|march(?:es|ed|ing)?|roll(?:s|ed|ing)?|surg(?:e|es|ed|ing)) (?:across|over) (?:the )?(?:[a-z-]+ )?(?:border|frontier)\b`,
  ].join("|"),
  "i",
);

// Creating a NEW canonical war is a higher-stakes mutation than binding an
// event to a war that already exists. New-war creation therefore requires
// direct adversarial evidence in the causal event itself. A model-supplied
// combatants[] pair, warId, unit attack op, alliance deployment, exercise,
// readiness measure or the adjective "combat" is never sufficient by itself.
const eventSupportsNewWarStart = (event) => {
  const text = combatSemanticText(event);
  return (
    WAR_START_RE.test(text) ||
    eventNarratesHardCombat(event) ||
    WAR_START_EVIDENCE_RE.test(text)
  );
};

// The fighting of a war already under way, in the words a report of it uses.
// A game that starts in the middle of history starts with the ledger it was
// given, and Modern Day's is empty: in 2016 the wars in Syria and Iraq are on
// no record, so the model opens each from whichever of its battles it writes
// first (the prompt's "if you write fighting, open the war in the same
// answer"). A player's turn opened them on "Iraqi Forces Secure Central Ramadi
// and Clear Anbar Pockets" and on an advance north of Aleppo; neither is a
// declaration or holds a word of the lists above, both starts were refused,
// and the turn lost both wars. Each entry here is something done to an enemy:
// ground taken from one, one cleared out or struck or thrown back. A word that
// only says where forces are (a front line, a deployment forward) is not here,
// and neither is "offensive" used of a capability or a doctrine.
const WAR_FIGHTING_REPORT_RE = new RegExp(
  [
    String.raw`\b(?:re)?captur(?:e|es|ed|ing)\b`,
    String.raw`\bretak(?:e|es|en|ing)\b`,
    String.raw`\bretook\b`,
    String.raw`\bliberat(?:e|es|ed|ing|ion)\b`,
    String.raw`\boverr(?:un|uns|an|unning)\b`,
    String.raw`\b(?:counter[- ]?)?attack(?:s|ed|ing)?\b`,
    String.raw`\b(?:counter[- ]?)?offensives?\b(?!\s+(?:capabilit(?:y|ies)|weapons?|arms|missiles?|systems?|posture|doctrine|power|cyber|operations?|potential|options?|plans?|planning|exercises?|drills?)\b)`,
    String.raw`\bbomb(?:ed|ing|ings)\b`,
    String.raw`\bstrikes? (?:on|against)\b`,
    String.raw`\brepel(?:s|led|ling)?\b`,
    String.raw`\brepuls(?:e|es|ed|ing)\b`,
    String.raw`\bencircl(?:e|es|ed|ing|ement)\b`,
    String.raw`\b(?:clear(?:s|ed|ing)?|mop(?:s|ped|ping)? up)\b[^.]{0,60}?\b(?:pockets?|holdouts?|remnants|strongholds?|positions|fighters|militants|insurgents|resistance)\b`,
    String.raw`\bpockets? of (?:resistance|fighters|militants|insurgents|troops)\b`,
    String.raw`\bstrongholds?\b`,
    String.raw`\b(?:rebel|government|regime|enemy|opposition|militant|insurgent|separatist|loyalist|coalition)-held\b`,
    // A force going forward over ground: "Syrian and Russian Forces Advance
    // North of Aleppo", "armoured columns push into Idlib".
    String.raw`\b(?:troops|forces|army|armies|tanks|armou?r|divisions?|brigades?|battalions?|regiments?|soldiers|columns?|units|fighters|militants|insurgents|rebels)\b[^.]{0,60}?\b(?:advanc(?:e|es|ed|ing)\b[^.]{0,20}?\b(?:on|into|through|across|north|south|east|west|deep)|push(?:es|ed|ing)?\b[^.]{0,20}?\b(?:into|through|across|deep))\b`,
  ].join("|"),
  "i",
);

// An exercise is told in the words of a battle ("the drill simulates an attack
// on the gap"), and the masks above know only its commonest forms. Where an
// event says it is one, the wider reading below is not used at all.
const EXERCISE_REPORT_RE = /\b(?:exercises?|drills?|war ?games?|manoeuvres|maneuvers|simulat(?:e|es|ed|ing|ion|ions)|rehears(?:e|es|ed|al|als|ing)|mock|training)\b/i;

// What a war record THE MODEL WROTE may be opened on. The record already names
// the war and its two sides, so the question here is only whether its event
// narrates fighting or a declaration at all, and it is asked more widely than
// eventSupportsNewWarStart, which the engine also asks before it makes up a
// war of its own from two names (reconcileCombatWarState). One thing is added:
// the report of a war already being fought (above). An exercise is reported
// in a battle's own words ("simulates an attack on"), so short of a
// declaration it opens nothing, whatever else its text matches.
const eventCanOpenDeclaredWar = (event) => {
  const text = combatSemanticText(event);
  if (WAR_START_RE.test(text) || WAR_START_EVIDENCE_RE.test(text)) return true;
  if (EXERCISE_REPORT_RE.test(text)) return false;
  return eventNarratesHardCombat(event) || WAR_FIGHTING_REPORT_RE.test(text);
};

const eventTransitionExpectation = (event) => {
  const title = normalizeString(event?.title);
  if (WAR_START_RE.test(title)) return new Set(["start", "join-a", "join-b", "resume"]);
  if (WAR_END_RE.test(title)) return new Set(["end"]);
  if (CEASEFIRE_RE.test(title)) return new Set(["ceasefire"]);
  return null;
};

const validateCombatantsAgainstWar = (event, war, { allowLinkedStartSides = false } = {}) => {
  const combatants = uniquePolities(event?.combatants, 8);
  if (combatants.length < 2) {
    // The causal event that opens a war does not have to duplicate the same
    // opposing sides already carried by its linked canonical start record.
    // That start record has already been applied to `war` above, so its sideA /
    // sideB membership is authoritative for this one event. Any explicit but
    // incomplete combatants metadata still fails closed instead of being
    // silently completed from the ledger.
    if (allowLinkedStartSides && combatants.length === 0) return "";
    return `Combat event "${normalizeString(event?.title)}" must include event.combatants naming at least the two opposing belligerent polities.`;
  }
  const sideA = new Set(war.sideA.map(polityKey));
  const sideB = new Set(war.sideB.map(polityKey));
  let hasA = false;
  let hasB = false;
  for (const combatant of combatants) {
    const key = polityKey(combatant);
    if (sideA.has(key)) hasA = true;
    else if (sideB.has(key)) hasB = true;
    else return `Combat event "${normalizeString(event?.title)}" names ${combatant}, but that polity is not a belligerent in canonical war ${war.id}.`;
  }
  if (!hasA || !hasB) {
    return `Combat event "${normalizeString(event?.title)}" must include at least one belligerent from EACH side of canonical war ${war.id}.`;
  }
  return "";
};

const validateBoundWarBatch = ({ events, updates, world, requireUpdateLinks = true, startsInForce = false, excused = null }) => {
  const normalizedEvents = normalizeEvents(events);
  const working = warMapFromWorld(world);
  const byEventId = new Map();
  const decoded = decodeWarUpdates(updates);

  for (const update of decoded) {
    if (requireUpdateLinks && !normalizeArray(update.eventIds).length && !normalizeArray(update.eventIndexes).length) {
      return `War update ${update.id} (${update.op}) must reference the event number that establishes this transition.`;
    }
    const linked = linkedEventsForUpdate(update, normalizedEvents);
    if (requireUpdateLinks && linked.length === 0) {
      return `War update ${update.id} (${update.op}) does not reference a valid event in this response.`;
    }
    for (const event of linked) {
      const id = normalizeString(event.id);
      if (!byEventId.has(id)) byEventId.set(id, []);
      byEventId.get(id).push(update);
    }
  }

  // startsInForce: a war this batch starts exists for every event of the batch,
  // not only for the events listed after its start. The order of one response's
  // events is the model's, not history's. A player's Albania had "1st Albanian
  // Motorized Brigade Assaults Prizren" ahead of the event its war was started
  // on, and read in that order the assault came before any war existed; the
  // salvage then dropped the war the player had just declared. The strict pass
  // still reads the order as written, and says so while a retry remains. The
  // last attempt's repair and the merged-turn check read the batch as the one
  // period it is. Only a start whose own event can open a war is brought
  // forward; joins, ceasefires, resumptions and ends happen where they are
  // listed.
  const hoisted = new Set();
  if (startsInForce) {
    for (const update of decoded) {
      if (normalizeString(update?.op).toLowerCase() !== "start") continue;
      const id = normalizeString(update?.id);
      if (!id || working.has(id)) continue;
      const opener = linkedEventsForUpdate(update, normalizedEvents)[0];
      if (!opener || !eventCanOpenDeclaredWar(opener)) continue;
      const result = applyUpdateToWarMap({
        map: working,
        update,
        date: normalizeString(opener.date),
        linkedEvents: [opener],
      });
      if (!result.error) hoisted.add(update);
    }
  }

  for (const [eventIndex, event] of normalizedEvents.entries()) {
    const eventId = normalizeString(event.id);
    const eventUpdates = byEventId.get(eventId) || [];

    for (const update of eventUpdates) {
      const op = normalizeString(update?.op).toLowerCase();
      if (op === "start" && !eventCanOpenDeclaredWar(event)) {
        return `War update ${update.id} (start) cannot create a canonical war from "${normalizeString(event.title)}": the causal event does not narrate a war declaration, commencement of hostilities, or direct adversarial battlefield combat. Military cooperation, deployments, exercises, readiness, deterrence, and force labels such as "combat battlegroup" are not belligerency.`;
      }
      if (op === "resume" && !eventCanOpenDeclaredWar(event)) {
        return `War update ${update.id} (resume) cannot resume hostilities from "${normalizeString(event.title)}": the causal event lacks direct adversarial combat or explicit renewed-hostilities semantics.`;
      }

      if (!hoisted.has(update)) {
        const result = applyUpdateToWarMap({
          map: working,
          update,
          date: normalizeString(event.date),
          linkedEvents: [event],
        });
        if (result.error) return result.error;
      }
      const eventWarId = normalizeString(event.warId);
      if (!eventWarId) {
        return `Event "${normalizeString(event.title)}" performs canonical war operation ${update.op} for ${update.id} but is missing event.warId="${update.id}".`;
      }
      if (eventWarId !== update.id) {
        return `Event "${normalizeString(event.title)}" uses warId ${eventWarId}, but its linked war update modifies ${update.id}.`;
      }
    }

    // The records linked to this event have been applied. What follows is
    // about the event's own wording, and the repair's question about one war
    // is not answered by the wording of another war's event (`excused`,
    // repairWarLedgerPayload).
    if (excused?.has(eventIndex)) continue;

    const expectation = eventTransitionExpectation(event);
    if (expectation) {
      const matching = eventUpdates.find((update) => expectation.has(normalizeString(update.op).toLowerCase()));
      if (!matching) {
        return `Event "${normalizeString(event.title)}" narrates a canonical war transition but has no matching warUpdates record. Belligerency must change explicitly.`;
      }
    }

    const warId = normalizeString(event.warId);
    if (warId && !working.get(warId)) {
      return `Event "${normalizeString(event.title)}" references warId ${warId}, but no such canonical war exists at that point in the timeline.`;
    }

    if (eventNarratesHardCombat(event)) {
      if (!warId) {
        return `Combat event "${normalizeString(event.title)}" has no event.warId. Battles, invasions, offensives, bombardments, active fronts and unit attacks require an active canonical war.`;
      }
      const war = working.get(warId);
      if (!war || war.status !== "active") {
        return `Combat event "${normalizeString(event.title)}" cannot occur because canonical war ${warId} is ${war?.status || "missing"}, not active.`;
      }
      const linkedStart = eventUpdates.find((update) =>
        normalizeString(update?.op).toLowerCase() === "start" &&
        normalizeString(update?.id) === warId
      );
      const combatantError = validateCombatantsAgainstWar(event, war, {
        allowLinkedStartSides: Boolean(linkedStart),
      });
      if (combatantError) return combatantError;
    }
  }
  return "";
};

const compactWarField = (value) =>
  normalizeString(value)
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const generatedWarIdPart = (value) =>
  canonicalPolity(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "belligerent";

const matchingWarForCombatants = (wars, combatants, statuses = new Set(["active"])) => {
  const combatantKeys = new Set(combatants.map(polityKey).filter(Boolean));
  if (combatantKeys.size < 2) return [];

  return wars.filter((war) => {
    if (!statuses.has(war.status)) return false;
    const sideA = new Set(war.sideA.map(polityKey));
    const sideB = new Set(war.sideB.map(polityKey));
    const hasA = [...combatantKeys].some((key) => sideA.has(key));
    const hasB = [...combatantKeys].some((key) => sideB.has(key));
    const allKnown = [...combatantKeys].every((key) => sideA.has(key) || sideB.has(key));
    return hasA && hasB && allKnown;
  });
};

const matchingStartUpdateForCombatants = (updates, combatants) => {
  const combatantKeys = new Set(combatants.map(polityKey).filter(Boolean));
  if (combatantKeys.size < 2) return [];

  return updates.filter((update) => {
    if (!["start", "resume"].includes(normalizeString(update?.op).toLowerCase())) return false;
    const sideA = new Set(uniquePolities(update?.actors).map(polityKey));
    const sideB = new Set(uniquePolities(update?.opponents).map(polityKey));
    if (!sideA.size || !sideB.size) return false;
    const hasA = [...combatantKeys].some((key) => sideA.has(key));
    const hasB = [...combatantKeys].some((key) => sideB.has(key));
    const allKnown = [...combatantKeys].every((key) => sideA.has(key) || sideB.has(key));
    return hasA && hasB && allKnown;
  });
};

const appendCompactWarUpdate = (candidate, line) => {
  if (Array.isArray(candidate?.warUpdates)) {
    const parsed = parseWarUpdateRecord(line, candidate.warUpdates.length);
    if (parsed) candidate.warUpdates = [...candidate.warUpdates, parsed];
    return;
  }
  const prior = String(candidate?.warUpdates ?? "").trim();
  candidate.warUpdates = prior ? `${prior}\n${line}` : line;
};

const deriveGeneratedWarId = ({ combatants, event, world, updates }) => {
  const parts = [...combatants]
    .map(generatedWarIdPart)
    .filter(Boolean)
    .sort()
    .slice(0, 2);
  const datePart = normalizeString(event?.date).replace(/[^0-9]/g, "") || "undated";
  const base = `war-${parts.join("-")}-${datePart}`.slice(0, 120);

  const occupied = new Set([
    ...normalizedWars(world).map((entry) => entry.id),
    ...decodeWarUpdates(updates).map((entry) => normalizeString(entry?.id)),
  ].filter(Boolean));

  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidateId = `${base}-${suffix}`;
    if (!occupied.has(candidateId)) return candidateId;
  }
  return `${base}-${Date.now()}`;
};

/**
 * Native combat -> war-ledger reconciliation.
 *
 * AI owns the semantic WHAT: an event says that named combatants are actually
 * fighting. Javascript owns the canonical HOW: bind that combat to the one
 * matching active war, resume the one matching ceasefire, or — when exactly two
 * opposing combatants are explicit and no canonical conflict exists — materialize
 * the missing war start instead of throwing away the entire world pass.
 *
 * Ambiguous combat remains invalid. We never guess sides for 3+ ungrouped actors
 * and never create a war without at least two explicit event.combatants.
 */
export const reconcileCombatWarState = (candidate, { world = {} } = {}) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { bound: 0, started: 0, resumed: 0, sanitized: 0, unresolved: [] };
  }

  const events = Array.isArray(candidate.events) ? candidate.events : [];
  const wars = normalizedWars(world);
  let updates = decodeWarUpdates(candidate.warUpdates);
  let bound = 0;
  let started = 0;
  let resumed = 0;
  let sanitized = 0;
  const unresolved = [];

  // Renewed hard combat between a ceasefire war's own sides resumes it: the
  // event is bound to the war and a resume record is added for it.
  const resumeCeasefireWar = (war, event, index) => {
    event.warId = war.id;
    const note = compactWarField(
      `Hostilities resumed in ${normalizeString(event.title)}`,
    );
    appendCompactWarUpdate(
      candidate,
      `${compactWarField(war.id)}~resume~~~${index + 1}~${note}`,
    );
    updates = decodeWarUpdates(candidate.warUpdates);
    resumed += 1;
    console.warn(
      `[OH war ledger bootstrap] materialized resume ${war.id} from renewed hard combat ` +
      `"${normalizeString(event.title)}".`,
    );
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;

    const hardCombat = eventNarratesHardCombat(event);
    if (!hardCombat) {
      const explicitWarId = normalizeString(event.warId);
      const matchingUpdate = explicitWarId
        ? updates.find((update) => normalizeString(update?.id) === explicitWarId)
        : null;
      const knownWar = explicitWarId
        ? wars.find((war) => war.id === explicitWarId)
        : null;
      const transition = eventTransitionExpectation(event);

      // combatants[] is reserved for direct battlefield opponents. Clear stray
      // model metadata on non-combat prose so a cooperative military event cannot
      // seed later war inference merely by naming two allied participants.
      if (!transition && normalizeArray(event.combatants).length) {
        event.combatants = [];
        sanitized += 1;
      }

      // Unknown war metadata on a non-combat, non-transition event is unsupported
      // bookkeeping, not history. Preserve the event itself and fail closed on
      // belligerency by stripping only that impossible link.
      if (explicitWarId && !knownWar && !matchingUpdate && !transition) {
        event.warId = "";
        sanitized += 1;
        console.warn(
          `[OH war metadata guard] stripped unsupported warId ${explicitWarId} from non-combat event ` +
          `"${normalizeString(event.title)}".`,
        );
      }
      continue;
    }

    const combatants = uniquePolities(event.combatants, 8);
    if (combatants.length < 2) {
      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: "hard combat has fewer than two explicit combatants",
      });
      continue;
    }

    const explicitWarId = normalizeString(event.warId);
    if (explicitWarId) {
      const known = wars.find((war) => war.id === explicitWarId);
      const matchingUpdate = updates.find((update) => normalizeString(update?.id) === explicitWarId);
      // The prompt tells the model to tag fighting with the war's id, and a
      // ceasefire war's id is one it is shown. Without a record of its own for
      // the war this used to fail the segment ("ceasefire, not active") where
      // the same event untagged resumed the war.
      if (
        known?.status === "ceasefire"
        && !matchingUpdate
        && matchingWarForCombatants([known], combatants, new Set(["ceasefire"])).length === 1
      ) {
        resumeCeasefireWar(known, event, index);
        continue;
      }
      if (known || matchingUpdate) continue;

      // A model-supplied id + two names is NOT enough to create belligerency.
      // The causal event must independently narrate direct opposition or an
      // explicit war start. Otherwise fail closed and request correction.
      if (combatants.length === 2 && !eventSupportsNewWarStart(event)) {
        unresolved.push({
          index,
          title: normalizeString(event.title),
          reason: `unknown warId ${explicitWarId} has two combatants but lacks direct adversarial evidence sufficient to start a new canonical war`,
        });
        continue;
      }

      if (combatants.length === 2) {
        const note = compactWarField(
          `Native bootstrap from hard-combat event: ${normalizeString(event.title)}`,
        );
        appendCompactWarUpdate(
          candidate,
          `${compactWarField(explicitWarId)}~start~${compactWarField(combatants[0])}~${compactWarField(combatants[1])}~${index + 1}~${note}`,
        );
        updates = decodeWarUpdates(candidate.warUpdates);
        started += 1;
        console.warn(
          `[OH war ledger bootstrap] materialized missing start ${explicitWarId} from hard combat ` +
          `"${normalizeString(event.title)}".`,
        );
        continue;
      }

      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: `unknown warId ${explicitWarId} with ambiguous ${combatants.length}-combatant sides`,
      });
      continue;
    }

    const activeMatches = matchingWarForCombatants(
      wars,
      combatants,
      new Set(["active"]),
    );
    if (activeMatches.length === 1) {
      event.warId = activeMatches[0].id;
      bound += 1;
      console.warn(
        `[OH war ledger binding] attached combat event "${normalizeString(event.title)}" ` +
        `to active canonical war ${activeMatches[0].id}.`,
      );
      continue;
    }
    if (activeMatches.length > 1) {
      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: "combatants match more than one active canonical war",
      });
      continue;
    }

    const updateMatches = matchingStartUpdateForCombatants(updates, combatants);
    if (updateMatches.length === 1) {
      event.warId = updateMatches[0].id;
      bound += 1;
      console.warn(
        `[OH war ledger binding] attached combat event "${normalizeString(event.title)}" ` +
        `to supplied ${updateMatches[0].op} update ${updateMatches[0].id}.`,
      );
      continue;
    }
    if (updateMatches.length > 1) {
      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: "combatants match more than one supplied war start/resume",
      });
      continue;
    }

    const ceasefireMatches = matchingWarForCombatants(
      wars,
      combatants,
      new Set(["ceasefire"]),
    );
    if (ceasefireMatches.length === 1) {
      resumeCeasefireWar(ceasefireMatches[0], event, index);
      continue;
    }
    if (ceasefireMatches.length > 1) {
      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: "combatants match more than one ceasefire war",
      });
      continue;
    }

    // Exactly two names still do not prove belligerency. event.combatants is a
    // model claim; a NEW war additionally requires direct adversarial evidence
    // in the event's own title/description.
    if (combatants.length === 2 && !eventSupportsNewWarStart(event)) {
      unresolved.push({
        index,
        title: normalizeString(event.title),
        reason: "two combatants were supplied, but the event lacks direct adversarial evidence sufficient to create a new canonical war",
      });
      continue;
    }

    if (combatants.length === 2) {
      const warId = deriveGeneratedWarId({
        combatants,
        event,
        world,
        updates: candidate.warUpdates,
      });
      event.warId = warId;
      const note = compactWarField(
        `Native bootstrap from hard-combat event: ${normalizeString(event.title)}`,
      );
      appendCompactWarUpdate(
        candidate,
        `${warId}~start~${compactWarField(combatants[0])}~${compactWarField(combatants[1])}~${index + 1}~${note}`,
      );
      updates = decodeWarUpdates(candidate.warUpdates);
      started += 1;
      console.warn(
        `[OH war ledger bootstrap] created ${warId}: ${combatants[0]} ↔ ${combatants[1]} ` +
        `from hard combat "${normalizeString(event.title)}".`,
      );
      continue;
    }

    unresolved.push({
      index,
      title: normalizeString(event.title),
      reason: `cannot infer opposing sides from ${combatants.length} ungrouped combatants`,
    });
  }

  return { bound, started, resumed, sanitized, unresolved };
};

export const validateWarLedgerPayload = (candidate, { world = {}, startsInForce = false, excused = null } = {}) => {
  const events = normalizeEvents(candidate?.events);
  const updates = bindWarUpdatesToEvents(candidate?.warUpdates, events);
  if (updates.length > MAX_WAR_UPDATES_PER_PASS) return `$.warUpdates may contain at most ${MAX_WAR_UPDATES_PER_PASS} records.`;
  for (const update of updates) {
    if (!["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"].includes(update.op)) {
      return `Unsupported warUpdates operation "${update.op}" for ${update.id}.`;
    }
    for (const index of normalizeArray(update.eventIndexes)) {
      if (index < 0 || index >= events.length) {
        return `War update ${update.id} references event ${index + 1}, but this response has only ${events.length} event(s).`;
      }
    }
  }
  return validateBoundWarBatch({ events, updates, world, requireUpdateLinks: true, startsInForce, excused });
};

export const validateCanonicalWarEvents = ({ events, updates, world, startsInForce = false, limit } = {}) =>
  validateBoundWarBatch({
    events,
    updates: bindWarUpdatesToEvents(updates, events, { limit }),
    world,
    requireUpdateLinks: false,
    startsInForce,
  });

// The words a war transition is narrated with, per operation: how a record is
// rebound to the event that establishes it when the model's own number and
// event.warId disagree.
const WORLD_WAR_TRANSITION_HINTS = Object.freeze({
  start: /\b(declar(?:e|es|ed|ation)|war begins|hostilities begin|invad(?:e|es|ed|ing|sion)|opens? hostilities)\b/i,
  "join-a": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  "join-b": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  leave: /\b(leaves?|withdraws?|withdrawal|exits?|separate peace)\b/i,
  ceasefire: /\b(cease[- ]?fire|armistice|truce|suspends? hostilities)\b/i,
  resume: /\b(resumes? hostilities|cease[- ]?fire collapses?|armistice collapses?|fighting resumes?)\b/i,
  end: /\b(peace|surrenders?|capitulat(?:e|es|ed|ion)|war ends?|ends? the war|peace settlement)\b/i,
});

const transitionText = (event) => `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;

// The model decides WHAT happened; the engine owns which event a war record is
// bound to. Model-supplied event numbers are hints, rebound here from
// event.warId plus the transition's own vocabulary, so a wrong number can never
// bind a declaration to an unrelated event.
//
// When nothing on the event side answers to the record — no event carries its
// warId — the model's own numbers are KEPT. They used to be blanked here, and
// the validator then told the model to "reference the event number that
// establishes this transition" for a number it had already given; told the
// same thing on the retry, it gave the same answer, and a finished turn fell to
// the canned fallback. Kept, the validator names the real defect instead: the
// event it points at is missing its warId.
export const normalizeWorldWarEventLinks = (candidate) => {
  if (!candidate || typeof candidate !== "object") return { rebound: 0, updates: [] };
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  let rebound = 0;

  const normalized = updates.map((update) => {
    const warId = normalizeString(update?.id);
    const supplied = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);

    const sameWar = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => normalizeString(event?.warId) === warId);

    const hint = WORLD_WAR_TRANSITION_HINTS[normalizeString(update?.op).toLowerCase()];
    const semantic = hint ? sameWar.filter(({ event }) => hint.test(transitionText(event))) : [];

    let eventIndexes;
    if (semantic.length === 1) {
      eventIndexes = [semantic[0].index];
    } else if (sameWar.length === 1) {
      eventIndexes = [sameWar[0].index];
    } else {
      // Several events carry this warId, or none does. The model's numbers
      // choose among the ones that do; failing that, they stand as given.
      const suppliedSameWar = supplied.filter((index) => normalizeString(events[index]?.warId) === warId);
      const suppliedSemantic = semantic.length
        ? suppliedSameWar.filter((index) => semantic.some((row) => row.index === index))
        : suppliedSameWar;
      if (suppliedSemantic.length) eventIndexes = [suppliedSemantic[0]];
      else if (suppliedSameWar.length) eventIndexes = [suppliedSameWar[0]];
      else eventIndexes = supplied;
    }

    if (JSON.stringify(eventIndexes) !== JSON.stringify(supplied)) rebound += 1;
    return { ...update, eventIndexes, eventIds: [] };
  });

  candidate.warUpdates = normalized;
  if (rebound) {
    console.info(`[OH war ledger] rebound ${rebound} record(s) from event.warId and transition semantics.`);
  }
  return { rebound, updates: normalized };
};

// A start bound to an event that cannot open a war, while another event of the
// same war can: the start moves to the earliest event that can. The model put
// the record on a mobilisation or an aftermath while the event that crossed
// the border carries the war's id too, and the validator's complaint — this
// event narrates no war — was about where the record sat, not about the war.
// Nothing is invented: the record, its two sides and the event that narrates
// the opening are all the model's.
const anchorStartsOnOpeners = (candidate) => {
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  let moved = 0;
  const next = updates.map((update) => {
    if (normalizeString(update?.op).toLowerCase() !== "start") return update;
    const warId = normalizeString(update?.id);
    if (!warId) return update;
    const current = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);
    if (current.length && current.every((index) => eventCanOpenDeclaredWar(events[index]))) return update;
    const opener = events.findIndex((event) =>
      event && typeof event === "object" && normalizeString(event.warId) === warId && eventCanOpenDeclaredWar(event));
    if (opener < 0) return update;
    moved += 1;
    return { ...update, eventIndexes: [opener], eventIds: [] };
  });
  if (moved) candidate.warUpdates = next;
  return moved;
};

// The last attempt's repair, run instead of discarding a finished segment whose
// war records the model could not fix on its corrective retry.
//
// 1. A record's own event numbers are its declaration of the link: every event
//    it names that carries no warId is stamped with the record's id, and the
//    batch is rebound and validated again.
// 2. From here the batch is read as the one period it is: a war it starts is in
//    force for all of its events (startsInForce), and a start sitting on an
//    event that cannot open a war moves to the earliest event of that war that
//    can (anchorStartsOnOpeners). What these undo is an ORDER — the assault
//    listed before the event its war was started on — over which a player's
//    Albania and Sweden each lost the war they had just declared.
// 3. What still fails is dropped, a war at a time. Each war's records are
//    asked about with that war's own events: they stand as they are, or
//    without the first one of them whose removal lets the rest stand. Failing
//    that they are asked about alone: records that apply are kept even when
//    the ledger objects to the wording of one of the war's events, and the
//    objection is left for the residual. Only records that do not apply are
//    dropped. An event bound to another war, or to none, is narrative to
//    these questions and is not held against the records. It used to be one
//    question of the whole batch, and whatever no record could answer for (a
//    riot that reads like a battle and belongs to no war, another war's
//    refused start, a battle naming one side only) left no removal that made
//    the batch valid, so every war of the turn went: a player's Modern Day
//    lost its Syrian war to a complaint about its Iraqi one. An event bound
//    to a war that no kept record creates and that does not already exist in
//    the world loses its war bindings (warId, combatants); events of wars
//    that already exist keep theirs.
// 4. Whatever the validator still says about the remaining narrative (a title
//    that reads like a declaration with no record behind it, a battle narrated
//    during a ceasefire) comes back as `residual` for the caller to log and
//    accept: the events stand as narrative, apply time drops what cannot be
//    applied (applyWarUpdates) and the merged turn is checked again with a
//    warning, not a rejection.
export const repairWarLedgerPayload = (candidate, { world = {} } = {}) => {
  const result = { stamped: 0, anchored: 0, droppedIds: [], strippedEvents: 0, residual: "" };
  if (!candidate || typeof candidate !== "object") return result;
  const eventAt = (index) => {
    const event = normalizeArray(candidate.events)[index];
    return event && typeof event === "object" ? event : null;
  };

  for (const update of decodeWarUpdates(candidate.warUpdates)) {
    const warId = normalizeString(update.id);
    if (!warId) continue;
    for (const index of normalizeArray(update.eventIndexes)) {
      const event = eventAt(index);
      if (!event || normalizeString(event.warId)) continue;
      event.warId = warId;
      result.stamped += 1;
    }
  }
  normalizeWorldWarEventLinks(candidate);
  if (!validateWarLedgerPayload(candidate, { world })) return result;

  const lenient = { world, startsInForce: true };
  const relink = (target) => {
    normalizeWorldWarEventLinks(target);
    return anchorStartsOnOpeners(target);
  };
  result.anchored = anchorStartsOnOpeners(candidate);
  if (!validateWarLedgerPayload(candidate, lenient)) return result;

  const existing = new Set(normalizedWars(world).map((war) => war.id));
  const records = decodeWarUpdates(candidate.warUpdates);
  // War bindings that neither an existing war nor a kept record can honour.
  const stripBindings = (events, keptIds) => {
    let stripped = 0;
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const warId = normalizeString(event.warId);
      if (!warId || existing.has(warId) || keptIds.has(warId)) continue;
      event.warId = "";
      if (Array.isArray(event.combatants) && event.combatants.length) event.combatants = [];
      stripped += 1;
    }
    return stripped;
  };
  const idsOf = (list) => new Set(list.map((update) => normalizeString(update.id)));
  // Do these records of one war stand? Asked with the war's own events and no
  // others: an event bound to another war, or to none, or whose own record is
  // not among the ones asked about, is narrative to this question and is not
  // held against them (`excused`). `recordsOnly` asks it of the records alone:
  // do they apply, whatever the war's events say.
  const stands = (warId, keep, { recordsOnly = false } = {}) => {
    const copy = {
      ...candidate,
      events: normalizeArray(candidate.events).map((event) => (event && typeof event === "object" ? { ...event } : event)),
      warUpdates: keep.map((update) => ({ ...update })),
    };
    stripBindings(copy.events, idsOf(keep));
    relink(copy);
    const excused = new Set();
    copy.events.forEach((event, index) => {
      if (recordsOnly || normalizeString(event?.warId) !== warId) excused.add(index);
    });
    for (const update of records) {
      if (keep.includes(update)) continue;
      for (const index of normalizeArray(update.eventIndexes)) excused.add(index);
    }
    return !validateWarLedgerPayload(copy, { ...lenient, excused });
  };
  const settle = (warId, own) => {
    const without = (index) => own.filter((_, position) => position !== index);
    if (stands(warId, own)) return own;
    // Without one record, when the rest then agrees with the war's events: a
    // join that cannot be made, a ceasefire the fighting contradicts. A war
    // this batch opens is not dropped whole on that ground.
    for (let index = 0; index < own.length; index += 1) {
      const rest = without(index);
      if ((rest.length || existing.has(warId)) && stands(warId, rest)) return rest;
    }
    // The records alone. They apply, and what the ledger objects to is the
    // wording of one of the war's events (a battle that names one side only):
    // the war is kept, and the objection comes back as the residual.
    if (stands(warId, own, { recordsOnly: true })) return own;
    for (let index = 0; index < own.length; index += 1) {
      const rest = without(index);
      if (stands(warId, rest, { recordsOnly: true })) return rest;
    }
    return [];
  };

  const byWar = new Map();
  for (const update of records) {
    const warId = normalizeString(update.id);
    if (!byWar.has(warId)) byWar.set(warId, []);
    byWar.get(warId).push(update);
  }
  const kept = new Set();
  for (const [warId, own] of byWar) {
    for (const update of settle(warId, own)) kept.add(update);
  }
  const keep = records.filter((update) => kept.has(update));

  result.droppedIds = records.filter((update) => !kept.has(update)).map((update) => normalizeString(update.id));
  result.strippedEvents = stripBindings(normalizeArray(candidate.events), idsOf(keep));
  candidate.warUpdates = keep;
  relink(candidate);
  result.residual = validateWarLedgerPayload(candidate, lenient);
  return result;
};

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
    appliedIds.push(update.id);
  }

  const statusRank = { active: 0, ceasefire: 1, ended: 2 };
  const wars = [...map.values()]
    .map(normalizeWar)
    .filter(Boolean)
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      compareGameDates(b.lastUpdatedDate || b.startedDate || "", a.lastUpdatedDate || a.startedDate || "") ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_WARS);

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
      "Recently ended (no one is fighting these; a war that flares again needs a new start record):",
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
    "This ledger is authoritative belligerency. A storyline, alliance, mobilization, historical expectation, or tense relationship does NOT itself create a war.",
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
