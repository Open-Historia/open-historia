/*!
 * open historia enhanced — native unit director
 * v0.1.2
 *
 * the main simulator writes history. this thing makes sure armies do not become
 * decorative map stickers the moment an npc owns them.
 */

import { normalizeUnitEntry, normalizeUnits } from "../../runtime/gameState.js";
import { distanceKm, engagementRangeKm, moveLeashKm } from "../Map/unitCombat.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const MILITARY_EVENT_PATTERN =
  /\b(battle|clash|combat|skirmish|firefight|shootout|gunfire|exchange(?:s|d)? of fire|opens? fire|comes? under fire|armed border incident|border incident|frontier incident|military incident|offensive|counteroffensive|attack|assault|advanc(?:e|es|ed|ing)|retreat|withdraw|withdrawal|mobiliz(?:e|es|ed|ation)|deploy|deployment|redeploy|redeployment|siege|invad(?:e|es|ed|ing|er|ers)|invasion|garrison(?:ed|ing)?|bombard|blockade|landing|breakthrough|encircle|engag(?:e|es|ed|ement)|make(?:s)? contact|made contact|surrender|capitulat|reinforc|maneuver|manoeuvre|march(?:es|ed|ing)?|cross(?:es|ed|ing) the|storm(?:s|ed|ing))\b/i;

const COMBAT_EVENT_PATTERN =
  /\b(battle|clash|combat|offensive|counteroffensive|attack|assault|advance|breakthrough|siege|invasion|invade|engage|fighting|war|recapture|capture|seize|retake)\b/i;

const DECISIVE_OUTCOME_PATTERN =
  /\b(captures?|recaptures?|seizes?|retakes?|conquers?|defeats?|routs?|annihilates?|surrenders?|capitulates?|falls? to|holds? the field)\b/i;

const NEW_FORMATION_PATTERN =
  /\b(new (?:army|corps|division|brigade|regiment|formation)|forms? (?:an? )?(?:army|corps|division|brigade|regiment)|raises? (?:an? )?(?:army|corps|division|brigade|regiment)|mobiliz(?:e|es|ed|ation)|newly mobilized|reinforcements? arrive|reserve(?:s)? activated|conscription creates|expands? the army|new formation)\b/i;

const NON_COMBAT_STRENGTH_PATTERN =
  /\b(reinforc|replacement|attrition|disease|desertion|demobiliz|reorgan|refit|resupply|replenish|training loss|accident)\b/i;

const eventText = (event) =>
  `${normalizeString(event?.title)} ${normalizeString(event?.description)}`.trim();

const summarizeUnit = (unit) => ({
  id: normalizeString(unit?.id),
  name: normalizeString(unit?.name),
  type: normalizeString(unit?.type),
  ownerCode: normalizeString(unit?.ownerCode),
  strength: Number(unit?.strength) || 0,
  status: normalizeString(unit?.status),
  lng: Number(unit?.lng),
  lat: Number(unit?.lat),
  regionId: normalizeString(unit?.regionId),
});

const opKey = (op) => {
  const kind = normalizeString(op?.op).toLowerCase();
  if (kind === "spawn") {
    return `spawn|${normalizeString(op?.unit?.ownerCode).toLowerCase()}|${normalizeString(op?.unit?.name).toLowerCase()}|${normalizeString(op?.unit?.type).toLowerCase()}`;
  }
  if (kind === "move") {
    return `move|${normalizeString(op?.unitId)}|${Number(op?.toLng).toFixed(4)}|${Number(op?.toLat).toFixed(4)}`;
  }
  if (kind === "attack") {
    return `attack|${normalizeString(op?.unitId)}|${normalizeString(op?.targetUnitId)}`;
  }
  if (kind === "strength") {
    return `strength|${normalizeString(op?.unitId)}|${Number(op?.strength)}`;
  }
  if (kind === "remove") {
    return `remove|${normalizeString(op?.unitId)}`;
  }
  return `${kind}|${JSON.stringify(op)}`;
};

const hasMilitaryContent = (event) =>
  normalizeArray(event?.impacts?.unitOps).length > 0 || MILITARY_EVENT_PATTERN.test(eventText(event));

const makeWorkingUnitMap = (units) =>
  new Map(normalizeUnits(units).map((unit) => [unit.id, { ...unit }]));

const applyWorkingOp = (unitMap, op) => {
  if (op.op === "spawn") {
    const normalized = normalizeUnitEntry(op.unit, unitMap.size);
    if (normalized?.id) unitMap.set(normalized.id, normalized);
    return;
  }

  const unit = unitMap.get(op.unitId);
  if (!unit) return;

  if (op.op === "move") {
    unitMap.set(op.unitId, {
      ...unit,
      lng: op.toLng,
      lat: op.toLat,
      regionId: normalizeString(op.regionId) || unit.regionId,
      status: "moving",
    });
  } else if (op.op === "strength") {
    if (Number(op.strength) <= 0) unitMap.delete(op.unitId);
    else unitMap.set(op.unitId, { ...unit, strength: Number(op.strength) });
  } else if (op.op === "remove") {
    unitMap.delete(op.unitId);
  }
};

const sanitizeDirectorOrders = ({ events, orders, units, game }) => {
  const unitMap = makeWorkingUnitMap(units);
  const diagnostics = [];
  const acceptedByEvent = new Map();
  let spawnBudget = 4;

  const ordersByEvent = new Map();
  for (const entry of normalizeArray(orders)) {
    const eventIndex = Number(entry?.eventIndex);
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= events.length) continue;
    const list = ordersByEvent.get(eventIndex) || [];
    list.push(...normalizeArray(entry?.unitOps));
    ordersByEvent.set(eventIndex, list);
  }

  // Walk EVERY event in chronological order, even when the director returned no
  // entry for it. Existing simulator unitOps still changed the order of battle,
  // and later director decisions must see those updated positions/strengths.
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const existingOps = normalizeArray(event?.impacts?.unitOps);
    for (const op of existingOps) applyWorkingOp(unitMap, op);

    const proposedOps = ordersByEvent.get(eventIndex) || [];
    if (proposedOps.length === 0 || !hasMilitaryContent(event)) continue;

    const text = eventText(event);
    const seen = new Set(existingOps.map(opKey));
    const accepted = [];

    for (const raw of proposedOps) {
      const op = cloneValue(raw);
      const kind = normalizeString(op?.op).toLowerCase();
      const reject = (reason) => diagnostics.push({ eventIndex, op: kind || "?", action: "DROP", reason });
      const keep = () => {
        const key = opKey(op);
        if (seen.has(key)) {
          reject("duplicate of an operation already attached to this event");
          return false;
        }
        seen.add(key);
        accepted.push(op);
        diagnostics.push({ eventIndex, op: kind, action: "KEEP", reason: "accepted" });
        applyWorkingOp(unitMap, op);
        return true;
      };

      if (kind === "spawn") {
        const owner = normalizeString(op?.unit?.ownerCode);
        const name = normalizeString(op?.unit?.name);
        if (!owner || !name) {
          reject("spawn has no owner/name");
          continue;
        }
        if (spawnBudget <= 0) {
          reject("per-turn spawn budget exhausted");
          continue;
        }

        const ownerUnits = [...unitMap.values()].filter((unit) => unit.ownerCode === owner);
        if (ownerUnits.length > 0 && !NEW_FORMATION_PATTERN.test(text)) {
          reject("existing units already represent this polity; no explicit new-formation cue");
          continue;
        }

        spawnBudget -= 1;
        keep();
        continue;
      }

      const unitId = normalizeString(op?.unitId);
      const unit = unitMap.get(unitId);
      if (!unit) {
        reject(`unitId ${unitId || "(blank)"} does not identify a current unit`);
        continue;
      }

      if (kind === "move") {
        const toLng = Number(op?.toLng);
        const toLat = Number(op?.toLat);
        if (!Number.isFinite(toLng) || !Number.isFinite(toLat) || (toLng === 0 && toLat === 0)) {
          reject("move destination is invalid");
          continue;
        }

        const distance = distanceKm(unit, { lng: toLng, lat: toLat });
        const leash = moveLeashKm(unit.type, normalizeString(event?.date || game?.gameDate));
        if (distance > leash) {
          reject(`move is ${Math.round(distance)} km, beyond the ${unit.type} leash of ~${leash} km`);
          continue;
        }

        keep();
        continue;
      }

      if (kind === "attack") {
        // v0.1 is a unit-coherence pass, not yet the authority that decides a
        // canonical battle winner. If the event already declares a decisive
        // outcome/territorial transfer, do not let a random clash roll contradict
        // history that the main simulator has already committed to. The next
        // territory-control phase is where those two systems get married properly.
        if (normalizeArray(event?.impacts?.regionTransfers).length > 0 || DECISIVE_OUTCOME_PATTERN.test(text)) {
          reject("event already declares a decisive outcome; v0.1 will not roll a clash that could contradict it");
          continue;
        }

        const targetUnitId = normalizeString(op?.targetUnitId);
        const defender = unitMap.get(targetUnitId);
        if (!defender) {
          reject(`targetUnitId ${targetUnitId || "(blank)"} does not identify a current unit`);
          continue;
        }
        if (defender.id === unit.id) {
          reject("a unit cannot attack itself");
          continue;
        }
        if (defender.ownerCode === unit.ownerCode) {
          reject("attacker and defender belong to the same polity");
          continue;
        }

        const distance = distanceKm(unit, defender);
        const range = engagementRangeKm(unit.type, normalizeString(event?.date || game?.gameDate));
        if (distance > range) {
          reject(`target is ${Math.round(distance)} km away, beyond ~${range} km engagement range`);
          continue;
        }

        keep();
        continue;
      }

      if (kind === "strength") {
        if (!NON_COMBAT_STRENGTH_PATTERN.test(`${text} ${normalizeString(op?.note)}`)) {
          reject("director may not invent combat casualties with a strength op; use attack");
          continue;
        }
        keep();
        continue;
      }

      if (kind === "remove") {
        if (!/\b(destroy|annihilat|disband|demobiliz|surrender|captur(?:ed)? entire|ceases? to exist)\b/i.test(`${text} ${normalizeString(op?.note)}`)) {
          reject("remove lacks an explicit destruction/disbandment cue");
          continue;
        }
        keep();
        continue;
      }

      reject(`unsupported unit op ${kind || "(blank)"}`);
    }

    if (accepted.length > 0) acceptedByEvent.set(eventIndex, accepted);
  }

  return { acceptedByEvent, diagnostics };
};

const publishDirectorDiagnostics = ({ candidates = [], units = [], analysis = null, eventOrders = [], diagnostics = [], skippedReason = "" } = {}) => {
  if (typeof window !== "undefined") {
    window.__OH_NATIVE_UNIT_DIRECTOR__ = {
      version: "0.1.2",
      last: () => ({
        candidateCount: candidates.length,
        candidateTitles: candidates.map(({ event, index }) => ({ index, title: normalizeString(event?.title) })),
        unitCount: units.length,
        analysisSource: analysis?.generation?.source || (skippedReason ? "not-run" : "ai"),
        skippedReason,
        eventOrders: cloneValue(eventOrders),
        diagnostics: cloneValue(diagnostics),
      }),
    };
  }
};

export const directGeneratedUnitOps = async ({
  events = [],
  game = {},
  world = {},
  analyzeBatch,
} = {}) => {
  const sourceEvents = normalizeArray(events);
  const candidates = sourceEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => hasMilitaryContent(event));

  const units = normalizeUnits(world?.units);

  if (candidates.length === 0 || typeof analyzeBatch !== "function") {
    const skippedReason = candidates.length === 0
      ? "no operational military event candidates matched"
      : "no analyzer supplied";
    publishDirectorDiagnostics({ candidates, units, skippedReason });
    console.groupCollapsed(`[OH Native Unit Director v0.1.2] ${candidates.length} military event(s), ${units.length} existing unit(s)`);
    console.info(skippedReason);
    console.groupEnd();
    return sourceEvents;
  }

  let analysis = null;

  try {
    analysis = await analyzeBatch({
      candidates: candidates.map(({ event, index }) => ({
        eventIndex: index,
        date: normalizeString(event?.date),
        title: normalizeString(event?.title),
        description: normalizeString(event?.description),
        existingUnitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
      })),
      units: units.map(summarizeUnit),
    });
  } catch (error) {
    console.warn("[unit director] analysis failed; preserving simulator unitOps unchanged.", error);
    return sourceEvents;
  }

  const payload = analysis?.payload ?? analysis ?? {};
  const { acceptedByEvent, diagnostics } = sanitizeDirectorOrders({
    events: sourceEvents,
    orders: payload.eventOrders,
    units,
    game,
  });

  const nextEvents = sourceEvents.map((event, index) => {
    const additions = acceptedByEvent.get(index) || [];
    if (additions.length === 0) return event;

    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    let unitOps = [...normalizeArray(impacts.unitOps), ...additions];

    // If a real deterministic attack is present, do not also let a made-up
    // combat strength edit hit either participant in the same event. Strength
    // remains valid for explicit reinforcement/attrition, just not as a second
    // casualty system layered on top of resolveClash().
    const combatIds = new Set();
    for (const op of unitOps) {
      if (op?.op === "attack") {
        combatIds.add(normalizeString(op.unitId));
        combatIds.add(normalizeString(op.targetUnitId));
      }
    }
    if (combatIds.size > 0) {
      unitOps = unitOps.filter((op) => {
        if (op?.op !== "strength" || !combatIds.has(normalizeString(op.unitId))) return true;
        return NON_COMBAT_STRENGTH_PATTERN.test(`${eventText(event)} ${normalizeString(op.note)}`);
      });
    }

    return {
      ...event,
      impacts: {
        ...impacts,
        unitOps,
      },
    };
  });

  publishDirectorDiagnostics({
    candidates,
    units,
    analysis,
    eventOrders: payload.eventOrders || [],
    diagnostics,
  });

  console.groupCollapsed(
    `[OH Native Unit Director v0.1.2] ${candidates.length} military event(s), ${units.length} existing unit(s)`,
  );
  if (diagnostics.length > 0) console.table(diagnostics);
  else console.info("no unit operations were added this turn.");
  console.groupEnd();

  return nextEvents;
};
