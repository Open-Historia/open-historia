/*! Open Historia — native unit director. */
// The main simulator writes history; this pass keeps the persistent order of
// battle coherent with it, so an NPC army is not a decorative counter the turn
// after it is created. It runs once per turn on the merged events: a narrow AI
// call proposes unit operations for the military events, deterministic rules
// below sanitize them, and the accepted ops ride the same application path as
// the simulator's own unitOps (a long move becomes a standing order of the unit
// engine). This build resolves fighting through narrated strength changes and
// postures, so there is no attack op here.

import { normalizePendingUnitOrders, normalizeUnitEntry, normalizeUnits } from "../../runtime/gameState.js";
import { mentionCount, nameVariants } from "./regionFocus.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const MILITARY_EVENT_PATTERN =
  /\b(battle|clash|combat|skirmish|firefight|shootout|gunfire|exchange(?:s|d)? of fire|opens? fire|comes? under fire|armed border incident|border incident|frontier incident|military incident|offensive|counteroffensive|attack|assault|advanc(?:e|es|ed|ing)|retreat|withdraw|withdrawal|mobiliz(?:e|es|ed|ation)|deploy|deployment|redeploy|redeployment|siege|invad(?:e|es|ed|ing|er|ers)|invasion|garrison(?:ed|ing)?|bombard|blockade|landing|breakthrough|encircle|engag(?:e|es|ed|ement)|make(?:s)? contact|made contact|surrender|capitulat|reinforc|maneuver|manoeuvre|march(?:es|ed|ing)?|cross(?:es|ed|ing) the|storm(?:s|ed|ing))\b/i;

const MILITARY_FORMATION_PATTERN =
  /\b(army|armies|forces?|troops?|legions?|fleet|flotilla|division|corps|brigade|regiment|battalion|cavalry|infantry|artillery|garrison|war elephants?|navy|naval|air force|squadrons?|warships?|frigates?|destroyers?|submarines?|carriers?)\b/i;

// R3.7: the expensive Unit Director is only useful when prose describes an
// operational change that could actually move/spawn/fight/reinforce/remove a
// persistent counter. Military industry, labs, doctrine, surveillance networks,
// readiness coordination and procurement can remain military events without
// paying an AI unit-state pass.
const OPERATIONAL_UNIT_DELTA_PATTERN =
  /\b(?:battle|clash|combat|skirmish|firefight|opens? fire|comes? under fire|offensive|counteroffensive|attack|assault|advanc(?:e|es|ed|ing)|retreat|withdraw(?:s|al|n|ing)?|mobiliz(?:e|es|ed|ation)|deploy(?:s|ed|ment|ing)?\s+(?:troops?|forces?|brigade|division|corps|army|battalion|regiment|units?)|redeploy(?:s|ed|ment|ing)?|siege|invad(?:e|es|ed|ing)|invasion|garrison(?:s|ed|ing)?|bombard(?:s|ed|ment|ing)?|blockade|landing|breakthrough|encircl(?:e|es|ed|ement)|engag(?:e|es|ed|ement)|surrender|capitulat|reinforcements? (?:arrive|deployed|sent)|reserve(?:s)? (?:activated|mobilized|called up)|march(?:es|ed|ing)?(?:\s+(?:toward|to|into|across))?|cross(?:es|ed|ing)|enter(?:s|ed|ing)?|reach(?:es|ed|ing)?|arriv(?:e|es|ed|ing)|embark(?:s|ed|ing)?|sail(?:s|ed|ing)?|maneuver(?:s|ed|ing)?|manoeuv(?:re|res|red|ring)|encamp(?:s|ed|ing)?|establish(?:es|ed|ing)?\s+(?:camp|encampment|winter quarters?|positions?)|relocat(?:e|es|ed|ing)|fall(?:s|ing)?\s+back)\b/i;

// A formation that comes into being by being built, delivered or stood up
// rather than raised from reserves: a warship commissioned, a submarine
// delivered, a squadron formed, a task group activated. The army wording below
// (NEW_FORMATION_PATTERN) never matched a navy or an air force, so a power that
// commissioned ships for years never gained a counter. The ship or squadron
// must be NAMED as what was commissioned, delivered or formed: "commissions a
// review" and "launches a campaign" stay paperwork.
const SERVICE_FORMATION_NOUN =
  "(?:aircraft carriers?|carriers?|frigates?|destroyers?|submarines?|boats?|warships?|cruisers?|corvettes?|patrol vessels?|vessels?|ships?|squadrons?|air wings?|flotillas?|task (?:forces?|groups?)|strike groups?)";
const SERVICE_FORMATION_PATTERN = new RegExp(
  "\\b(?:commission(?:s|ed|ing)?|deliver(?:s|ed|ing)?|delivery of|launch(?:es|ed|ing)?)\\b[^.!?]{0,60}\\b" + SERVICE_FORMATION_NOUN + "\\b"
  + "|\\b" + SERVICE_FORMATION_NOUN + "\\b[^.!?]{0,40}\\b(?:(?:is|are|was|were|been) (?:formally )?(?:commissioned|formed|activated|stood up)|enters? (?:active |operational )?service|entered (?:active |operational )?service|joins? the fleet|joined the fleet)\\b"
  + "|\\b(?:forms?|formed|stands? up|stood up|activates?|activated|establish(?:es|ed)?|creates?|created)\\b (?:an? |the |its )?(?:new )?(?:[\\w-]+ ){0,3}" + SERVICE_FORMATION_NOUN + "\\b"
  + "|\\bjoins? the fleet\\b|\\bjoined the fleet\\b|\\benters? (?:active |operational )?service\\b",
  "i",
);

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

// What the director is shown of a unit. Posture, composition and cover are
// there because a move op sets a posture, and choosing one blind to the
// current one contradicted it; the standing order because the engine is
// already carrying the unit somewhere (world.pendingUnitOrders), and a new
// order should follow it or knowingly replace it.
const summarizeUnit = (unit, standingOrder = null) => ({
  id: normalizeString(unit?.id),
  name: normalizeString(unit?.name),
  type: normalizeString(unit?.type),
  ownerCode: normalizeString(unit?.ownerCode),
  strength: Number(unit?.strength) || 0,
  status: normalizeString(unit?.status),
  posture: normalizeString(unit?.posture),
  ...(normalizeString(unit?.composition) ? { composition: normalizeString(unit.composition) } : {}),
  ...(unit?.covert === true ? { covert: true } : {}),
  lng: Number(unit?.lng),
  lat: Number(unit?.lat),
  regionId: normalizeString(unit?.regionId),
  ...(standingOrder ? {
    standingOrder: {
      kind: standingOrder.kind,
      target: standingOrder.targetLabel || `lat ${standingOrder.toLat.toFixed(2)}, lng ${standingOrder.toLng.toFixed(2)}`,
      ...(standingOrder.untilRound > 0 ? { untilRound: standingOrder.untilRound } : {}),
    },
  } : {}),
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

const hasMilitaryContent = (event) => {
  if (normalizeArray(event?.impacts?.unitOps).length > 0) return true;
  const text = eventText(event);
  const explicitlyMilitary =
    normalizeString(event?.kind).toLowerCase() === "military"
    || normalizeArray(event?.tags).some((tag) => normalizeString(tag).toLowerCase() === "military");
  return MILITARY_EVENT_PATTERN.test(text)
    || ((explicitlyMilitary || MILITARY_FORMATION_PATTERN.test(text))
      && (OPERATIONAL_UNIT_DELTA_PATTERN.test(text) || SERVICE_FORMATION_PATTERN.test(text)));
};

export const eventNeedsNativeUnitDirector = (event) => {
  if (!event || typeof event !== "object") return false;
  const text = eventText(event);
  return OPERATIONAL_UNIT_DELTA_PATTERN.test(text) || SERVICE_FORMATION_PATTERN.test(text);
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
        if (ownerUnits.length > 0 && !NEW_FORMATION_PATTERN.test(text) && !SERVICE_FORMATION_PATTERN.test(text)) {
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

        // The director describes the formation's TRUE objective from the event.
        // Do not reject a distant objective here: the canonical unit engine
        // already clamps travel by elapsed time and keeps the remainder as a
        // standing order. Dropping the order here strands a counter at its old
        // location and makes every later story movement progressively harder to
        // recover from.
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

// Which events the director would be asked about, and what it would be shown of
// them and of the order of battle. Its own function so the turn review
// (gameplay.js runTurnReview) can tell beforehand whether there is anything to
// ask, and ask it as one job among several, with exactly this input.
const selectUnitDirectorCandidates = (events) => normalizeArray(events)
  .map((event, index) => ({ event, index }))
  .filter(({ event }) => hasMilitaryContent(event) && eventNeedsNativeUnitDirector(event));

// How many units the director is shown. A big scenario map can field
// hundreds, and every one rode the shared turn review uncapped.
export const UNIT_DIRECTOR_UNIT_LIMIT = 60;

// The units the candidate events are about come first: an owner the events
// name exactly, a formation they name, or a unit their own unitOps touch. The
// rest follow in saved order, up to the limit; `omittedUnits` counts the cut.
// The sanitizer still checks every op against the whole order of battle.
const unitDirectorAnalyzerInput = (candidates, units, pendingUnitOrders = []) => {
  const text = candidates.map(({ event }) => eventText(event)).join(" ");
  const touched = new Set(candidates.flatMap(({ event }) => normalizeArray(event?.impacts?.unitOps)
    .map((op) => normalizeString(op?.unitId))
    .filter(Boolean)));
  const ownerNamed = new Map();
  const isNamed = (unit) => {
    const owner = normalizeString(unit?.ownerCode);
    if (owner && !ownerNamed.has(owner)) ownerNamed.set(owner, mentionCount(text, nameVariants(owner)) > 0);
    return touched.has(normalizeString(unit?.id))
      || (owner && ownerNamed.get(owner))
      || (normalizeString(unit?.name) && mentionCount(text, nameVariants(unit.name)) > 0);
  };
  const ordered = units
    .map((unit, index) => ({ unit, index, tier: isNamed(unit) ? 0 : 1 }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.unit);
  const orderByUnit = new Map(normalizePendingUnitOrders(pendingUnitOrders).map((order) => [order.unitId, order]));
  return {
    candidates: candidates.map(({ event, index }) => ({
      eventIndex: index,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title),
      description: normalizeString(event?.description),
      existingUnitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
    })),
    units: ordered.slice(0, UNIT_DIRECTOR_UNIT_LIMIT).map((unit) => summarizeUnit(unit, orderByUnit.get(unit.id) ?? null)),
    omittedUnits: Math.max(0, ordered.length - UNIT_DIRECTOR_UNIT_LIMIT),
  };
};

// null when no event needs the director.
export const buildUnitDirectorInput = ({ events = [], world = {} } = {}) => {
  const candidates = selectUnitDirectorCandidates(events);
  return candidates.length
    ? unitDirectorAnalyzerInput(candidates, normalizeUnits(world?.units), world?.pendingUnitOrders)
    : null;
};

export const directGeneratedUnitOps = async ({
  events = [],
  game = {},
  world = {},
  analyzeBatch,
} = {}) => {
  const sourceEvents = normalizeArray(events);
  const candidates = selectUnitDirectorCandidates(sourceEvents);

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
    analysis = await analyzeBatch(unitDirectorAnalyzerInput(candidates, units, world?.pendingUnitOrders));
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
