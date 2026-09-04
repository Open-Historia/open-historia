/*! Open Historia — native unit director. */
// The main simulator writes history; this pass keeps the persistent order of
// battle coherent with it, so an NPC army is not a decorative counter the turn
// after it is created. It runs once per turn on the merged events: a narrow AI
// call proposes unit operations for the military events, deterministic rules
// below sanitize them, and the accepted ops ride the same application path as
// the simulator's own unitOps (a long move becomes a standing order of the unit
// engine). This build resolves fighting through narrated strength changes and
// postures, so there is no attack op here.

import { normalizeUnitEntry, normalizeUnits } from "../../runtime/gameState.js";
import { distanceKm, moveLeashKm } from "../Map/unitCombat.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const MILITARY_EVENT_PATTERN =
  /\b(battle|clash|combat|skirmish|firefight|shootout|gunfire|exchange(?:s|d)? of fire|opens? fire|comes? under fire|armed border incident|border incident|frontier incident|military incident|offensive|counteroffensive|attack|assault|advanc(?:e|es|ed|ing)|retreat|withdraw|withdrawal|mobiliz(?:e|es|ed|ation)|deploy|deployment|redeploy|redeployment|siege|invad(?:e|es|ed|ing|er|ers)|invasion|garrison(?:ed|ing)?|bombard|blockade|landing|breakthrough|encircle|engag(?:e|es|ed|ement)|make(?:s)? contact|made contact|surrender|capitulat|reinforc|maneuver|manoeuvre|march(?:es|ed|ing)?|cross(?:es|ed|ing) the|storm(?:s|ed|ing))\b/i;

// R3.7: the expensive Unit Director is only useful when prose describes an
// operational change that could actually move/spawn/fight/reinforce/remove a
// persistent counter. Military industry, labs, doctrine, surveillance networks,
// readiness coordination and procurement can remain military events without
// paying an AI unit-state pass.
const OPERATIONAL_UNIT_DELTA_PATTERN =
  /\b(?:battle|clash|combat|skirmish|firefight|opens? fire|comes? under fire|offensive|counteroffensive|attack|assault|advanc(?:e|es|ed|ing)|retreat|withdraw(?:s|al|n|ing)?|mobiliz(?:e|es|ed|ation)|deploy(?:s|ed|ment|ing)?\s+(?:troops?|forces?|brigade|division|corps|army|battalion|regiment|units?)|redeploy(?:s|ed|ment|ing)?|siege|invad(?:e|es|ed|ing)|invasion|garrison(?:s|ed|ing)?|bombard(?:s|ed|ment|ing)?|blockade|landing|breakthrough|encircl(?:e|es|ed|ement)|engag(?:e|es|ed|ement)|surrender|capitulat|reinforcements? (?:arrive|deployed|sent)|reserve(?:s)? (?:activated|mobilized|called up)|march(?:es|ed|ing)?\s+(?:toward|to|into|across)|cross(?:es|ed|ing)\s+(?:the\s+)?(?:border|frontier|river))\b/i;

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

export const eventNeedsNativeUnitDirector = (event) => {
  if (!event || typeof event !== "object") return false;
  return OPERATIONAL_UNIT_DELTA_PATTERN.test(eventText(event));
};

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

export const sanitizeDirectorOrders = ({ events, orders, units, game }) => {
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
        reject("this build resolves fighting through narrated strength changes and postures; move the unit into contact with posture assaulting instead");
        continue;
      }

      if (kind === "strength") {
        const strengthText = `${text} ${normalizeString(op?.note)}`;
        if (!NON_COMBAT_STRENGTH_PATTERN.test(strengthText) && !COMBAT_EVENT_PATTERN.test(strengthText)) {
          reject("strength changes need the event to narrate casualties, attrition, reinforcement or demobilization");
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
    .filter(({ event }) => hasMilitaryContent(event) && eventNeedsNativeUnitDirector(event));

  const units = normalizeUnits(world?.units);

  if (candidates.length === 0 || typeof analyzeBatch !== "function") {
    const skippedReason = candidates.length === 0
      ? "no operational military event candidates matched"
      : "no analyzer supplied";
    publishDirectorDiagnostics({ candidates, units, skippedReason });
    console.groupCollapsed(`[OH unit director] ${candidates.length} military event(s), ${units.length} existing unit(s)`);
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
    const unitOps = [...normalizeArray(impacts.unitOps), ...additions];

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
    `[OH unit director] ${candidates.length} military event(s), ${units.length} existing unit(s)`,
  );
  if (diagnostics.length > 0) console.table(diagnostics);
  else console.info("no unit operations were added this turn.");
  console.groupEnd();

  return nextEvents;
};
