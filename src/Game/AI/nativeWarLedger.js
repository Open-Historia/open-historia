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

export const WAR_LEDGER_VERSION = "0.1.4-adversarial-war-start";

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

const HARD_COMBAT_RE = /\b(battle|invasion|invades?|bombard(?:ment|s|ed|ing)?|shell(?:ing|s|ed)?|assault|attack(?:s|ed|ing)?|raid(?:s|ed|ing)?|siege|clash(?:es|ed)?|fighting|repuls(?:e|es|ed)|captures?|recaptures?|liberat(?:es|ed|ion)|front\b.*\b(stalemate|fighting)|stalemate\b.*\bfront)\b/i;
// Strong battlefield terms that are safe even if `kind` was imperfectly tagged.
// Bare "combat" is intentionally NOT sufficient: in military prose it is often
// adjectival ("combat battlegroup", "combat-ready", "combat capability") rather
// than evidence that two polities are fighting one another.
const UNAMBIGUOUS_COMBAT_RE = /\b(battle|invasion|invades?|bombard(?:ment|s|ed|ing)?|shell(?:ing|s|ed)?|assault|siege|clash(?:es|ed)?|fighting|firefight|artillery fire|air strike|airstrike|ground fighting)\b/i;
const DIRECT_COMBAT_CONTEXT_RE = /\b(?:engag(?:e|es|ed|ing)|locked)\b.{0,80}\bcombat\b|\bcombat\b.{0,80}\b(?:against|between|with)\b|\bcombat operations?\b.{0,80}\b(?:against|targeting)\b/i;
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

const combatSemanticText = (event) =>
  `${normalizeString(event?.title)} ${normalizeString(event?.description)}`
    .replace(NON_BATTLEFIELD_COMBAT_TERMS_RE, " military-equipment ")
    .replace(NON_BATTLEFIELD_ACTION_TERMS_RE, " military-exercise ");

// Semantic WHAT: does the event itself actually describe battlefield combat?
// This deliberately ignores impacts.unitOps. A post-processor may implement
// event semantics, but it may not turn a conscription law, exercise, readiness
// measure, procurement decision, training cycle or administrative military event
// into combat merely by attaching op=attack.
export const eventNarratesHardCombat = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const text = combatSemanticText(event);
  const military = normalizeString(event?.kind).toLowerCase() === "military";
  const hasControl = normalizeArray(impacts.regionControlOps)
    .some((op) => ["contest", "control"].includes(normalizeString(op?.op).toLowerCase()));

  if (
    UNAMBIGUOUS_COMBAT_RE.test(text) ||
    DIRECT_COMBAT_CONTEXT_RE.test(text) ||
    ACTIVE_OFFENSIVE_RE.test(text)
  ) return true;
  if (military && HARD_COMBAT_RE.test(text)) return true;
  return hasControl && HARD_COMBAT_RE.test(text);
};

// Creating a NEW canonical war is a higher-stakes mutation than binding an
// event to a war that already exists. New-war creation therefore requires
// direct adversarial evidence in the causal event itself. A model-supplied
// combatants[] pair, warId, unit attack op, alliance deployment, exercise,
// readiness measure or the adjective "combat" is never sufficient by itself.
const eventSupportsNewWarStart = (event) => {
  const text = combatSemanticText(event);
  return (
    WAR_START_RE.test(text) ||
    UNAMBIGUOUS_COMBAT_RE.test(text) ||
    DIRECT_COMBAT_CONTEXT_RE.test(text) ||
    ACTIVE_OFFENSIVE_RE.test(text)
  );
};

const eventHasHardCombat = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  if (normalizeArray(impacts.unitOps).some((op) => normalizeString(op?.op).toLowerCase() === "attack")) return true;
  return eventNarratesHardCombat(event);
};

// Integration guard for Native Unit Director and other post-processors.
// Remove only unsupported attack ops. Other unit mutations are left alone.
export const stripUnsupportedUnitAttackOps = (events = []) => {
  const dropped = [];

  normalizeArray(events).forEach((event, eventIndex) => {
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : null;
    if (!impacts || !Array.isArray(impacts.unitOps) || eventNarratesHardCombat(event)) return;

    const kept = [];
    impacts.unitOps.forEach((op, opIndex) => {
      if (normalizeString(op?.op).toLowerCase() !== "attack") {
        kept.push(op);
        return;
      }
      dropped.push({
        eventIndex,
        opIndex,
        title: normalizeString(event?.title),
        unitId: normalizeString(op?.unitId),
        targetUnitId: normalizeString(op?.targetUnitId),
      });
    });
    impacts.unitOps = kept;
  });

  return dropped;
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
      const op = normalizeString(update?.op).toLowerCase();
      if (op === "start" && !eventSupportsNewWarStart(event)) {
        return `War update ${update.id} (start) cannot create a canonical war from "${normalizeString(event.title)}": the causal event does not narrate a war declaration, commencement of hostilities, or direct adversarial battlefield combat. Military cooperation, deployments, exercises, readiness, deterrence, and force labels such as "combat battlegroup" are not belligerency.`;
      }
      if (op === "resume" && !eventSupportsNewWarStart(event)) {
        return `War update ${update.id} (resume) cannot resume hostilities from "${normalizeString(event.title)}": the causal event lacks direct adversarial combat or explicit renewed-hostilities semantics.`;
      }

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

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;

    const hardCombat = eventHasHardCombat(event);
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
      const war = ceasefireMatches[0];
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
