// OpenHistoria Continuum — Native War-State Ledger v0.1.0
//
// Phase 6B.3:
// - authoritative persistent belligerency in world.wars
// - compact Gemini transport; no large nested tool schema
// - hard combat cannot exist without an active canonical war
// - war starts/joins/ceasefires/resumptions/endings are explicit state transitions
// - suitable for the future Stats -> Current Conflicts panel

import { normalizeEvents, normalizeWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";

export const WAR_LEDGER_VERSION = "0.1.0";

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

const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  return { year, month, day };
};

const sortDate = (value) => parseIsoDate(value) ? normalizeString(value) : "";

const deriveWarTitle = (war) => {
  const explicit = normalizeString(war?.title);
  if (explicit) return explicit;
  const a = uniquePolities(war?.sideA, 2);
  const b = uniquePolities(war?.sideB, 2);
  if (a.length && b.length) return `${a[0]}–${b[0]} War`;
  return normalizeString(war?.id) || "Unnamed conflict";
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

const parseWarUpdateRecord = (line, index = 0) => {
  const text = normalizeString(line);
  if (!text) return null;

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
    note: normalizeString(noteRaw),
  };
};

export const decodeWarUpdates = (value) => {
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
          note: normalizeString(entry.note),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_WAR_UPDATES_PER_PASS);
  }

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => parseWarUpdateRecord(line, index))
    .filter(Boolean)
    .slice(0, MAX_WAR_UPDATES_PER_PASS);
};

export const bindWarUpdatesToEvents = (updates, events) => {
  const normalizedEvents = normalizeEvents(events);
  return decodeWarUpdates(updates).map((update) => {
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
    .sort()[0] || "";

const applyUpdateToWarMap = ({ map, update, date = "", round = 0, linkedEvents = [] }) => {
  const id = normalizeString(update?.id);
  const op = normalizeString(update?.op).toLowerCase();
  if (!id || !op) return { error: "War update is missing id/op." };

  const prior = map.get(id) || null;
  const eventDate = sortDate(date);
  const eventIds = linkedEvents.map((event) => normalizeString(event?.id)).filter(Boolean);
  const storylineIds = linkedEvents.flatMap((event) => normalizeArray(event?.storylineIds)).map(normalizeString).filter(Boolean);

  const save = (war) => {
    const normalized = normalizeWar({
      ...war,
      id,
      note: normalizeString(update.note) || normalizeString(war.note),
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
      status: "active",
      sideA,
      sideB,
      startedDate: eventDate,
      endedDate: "",
      cause: normalizeString(update.note),
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

const HARD_COMBAT_RE = /\b(battle|invasion|invades?|bombard(?:ment|s|ed|ing)?|shell(?:ing|s|ed)?|assault|attack(?:s|ed|ing)?|raid(?:s|ed|ing)?|siege|clash(?:es|ed)?|combat|fighting|repuls(?:e|es|ed)|captures?|recaptures?|liberat(?:es|ed|ion)|front\b.*\b(stalemate|fighting)|stalemate\b.*\bfront)\b/i;
const ACTIVE_OFFENSIVE_RE = /\b(launch(?:es|ed|ing)?|begin(?:s|ning)?|open(?:s|ed|ing)?|commence(?:s|d|ing)?|initiat(?:es|ed|ing)?|execute(?:s|d|ing)?)\b.{0,60}\b(counter[- ]?)?offensive\b|\b(counter[- ]?)?offensive\b.{0,60}\b(begins?|opens?|commences?|is launched|is underway)\b/i;
const WAR_START_RE = /\b(declares? war|declaration of war|enters? (?:the )?war|joins? (?:the )?war|war is declared|commences? hostilities)\b/i;
const CEASEFIRE_RE = /\b(ceasefire (?:takes effect|begins|signed|agreed|declared)|armistice (?:takes effect|signed|agreed)|truce (?:takes effect|signed|agreed))\b/i;
const WAR_END_RE = /\b(peace treaty (?:signed|takes effect)|war ends|ends? the war|hostilities formally end|peace is signed)\b/i;

const eventHasHardCombat = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  if (normalizeArray(impacts.unitOps).some((op) => normalizeString(op?.op).toLowerCase() === "attack")) return true;
  const military = normalizeString(event?.kind).toLowerCase() === "military";
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  if (military && (HARD_COMBAT_RE.test(text) || ACTIVE_OFFENSIVE_RE.test(text))) return true;
  const hasControl = normalizeArray(impacts.regionControlOps)
    .some((op) => ["contest", "control"].includes(normalizeString(op?.op).toLowerCase()));
  return hasControl && HARD_COMBAT_RE.test(text);
};

const eventTransitionExpectation = (event) => {
  const title = normalizeString(event?.title);
  if (WAR_START_RE.test(title)) return new Set(["start", "join-a", "join-b", "resume"]);
  if (WAR_END_RE.test(title)) return new Set(["end"]);
  if (CEASEFIRE_RE.test(title)) return new Set(["ceasefire"]);
  return null;
};

const validateCombatantsAgainstWar = (event, war) => {
  const combatants = uniquePolities(event?.combatants, 8);
  if (combatants.length < 2) {
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

const validateBoundWarBatch = ({ events, updates, world, requireUpdateLinks = true }) => {
  const normalizedEvents = normalizeEvents(events);
  const working = warMapFromWorld(world);
  const byEventId = new Map();

  for (const update of decodeWarUpdates(updates)) {
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

  for (const event of normalizedEvents) {
    const eventId = normalizeString(event.id);
    const eventUpdates = byEventId.get(eventId) || [];

    for (const update of eventUpdates) {
      const result = applyUpdateToWarMap({
        map: working,
        update,
        date: normalizeString(event.date),
        linkedEvents: [event],
      });
      if (result.error) return result.error;
      const eventWarId = normalizeString(event.warId);
      if (!eventWarId) {
        return `Event "${normalizeString(event.title)}" performs canonical war operation ${update.op} for ${update.id} but is missing event.warId="${update.id}".`;
      }
      if (eventWarId !== update.id) {
        return `Event "${normalizeString(event.title)}" uses warId ${eventWarId}, but its linked war update modifies ${update.id}.`;
      }
    }

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

    if (eventHasHardCombat(event)) {
      if (!warId) {
        return `Combat event "${normalizeString(event.title)}" has no event.warId. Battles, invasions, offensives, bombardments, active fronts and unit attacks require an active canonical war.`;
      }
      const war = working.get(warId);
      if (!war || war.status !== "active") {
        return `Combat event "${normalizeString(event.title)}" cannot occur because canonical war ${warId} is ${war?.status || "missing"}, not active.`;
      }
      const combatantError = validateCombatantsAgainstWar(event, war);
      if (combatantError) return combatantError;
    }
  }
  return "";
};

export const validateWarLedgerPayload = (candidate, { world = {} } = {}) => {
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
  return validateBoundWarBatch({ events, updates, world, requireUpdateLinks: true });
};

export const validateCanonicalWarEvents = ({ events, updates, world } = {}) =>
  validateBoundWarBatch({
    events,
    updates: bindWarUpdatesToEvents(updates, events),
    world,
    requireUpdateLinks: false,
  });

export const applyWarUpdates = ({ world, updates, events = [], stopDate = "", round = 0 } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const map = warMapFromWorld(nextWorld);
  const decoded = bindWarUpdatesToEvents(updates, events);
  const appliedIds = [];

  for (const update of decoded) {
    const linkedEvents = linkedEventsForUpdate(update, events);
    const date = firstLinkedDate(update, events) || sortDate(stopDate);
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
      String(b.lastUpdatedDate || b.startedDate || "").localeCompare(String(a.lastUpdatedDate || a.startedDate || "")) ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_WARS);

  return { world: { ...nextWorld, wars }, wars, appliedIds };
};

export const buildCanonicalWarContext = (world) => {
  const current = normalizedWars(world).filter((war) => war.status !== "ended");
  if (!current.length) {
    return [
      "No active or ceasefire canonical wars are recorded.",
      "Therefore no polity is currently authorized to fight a battlefield campaign merely because real history says it did.",
    ].join("\n");
  }
  return [
    ...current.map((war) =>
      `- ${war.id} | ${war.status.toUpperCase()} | SIDE A: ${war.sideA.join(", ")} | SIDE B: ${war.sideB.join(", ")} | started ${war.startedDate || "unknown"}` +
      (war.note ? ` | latest: ${war.note}` : ""),
    ),
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
