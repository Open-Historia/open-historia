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

// A land formation of any size coming into being: "raises a new VDP
// rapid-reaction battalion", "forms a mechanized company", "stands up a new joint
// border force". Up to three describing words may sit between the cue and the
// noun, but not a preposition or article, so "raises funds for the army" is money,
// not a formation. Seen in a live game (2026-09-27): a battalion the director
// raised correctly was thrown away because only armies down to regiments, with
// nothing between "new" and the noun, counted.
const FORMATION_NOUN =
  "(?:army|armies|corps|divisions?|brigades?|regiments?|battalions?|compan(?:y|ies)|militias?|forces?|legions?|detachments?|contingents?|battle ?groups?|formations?|garrisons?)";
const DESCRIBING_WORD = "(?:(?!(?:for|to|of|with|and|or|the|in|on|at|from|against|by)\\b)[\\w-]+ )";
// A garrison is placed rather than raised: "place a garrison in Stranraer",
// "establishes a permanent military garrison". Only a garrison takes these verbs
// as a new formation; "stations its battalion at Dori" is still a move.
const GARRISON_PLACED =
  "\\b(?:places?|placed|placing|stations?|stationed|stationing|posts?|posted|posting|establish(?:es|ed|ing)?|sets? up|setting up)\\b"
  + " (?:an? |its )?(?:new )?" + DESCRIBING_WORD + "{0,3}garrisons?\\b";
const RAISED_FORMATION_PATTERN = new RegExp(
  "\\bnew " + DESCRIBING_WORD + "{0,3}" + FORMATION_NOUN + "\\b"
  + "|\\b(?:forms?|formed|forming|raises?|raised|raising|activates?|activated|stands? up|stood up|creates?|created|musters?|mustered)\\b"
  + " (?:an? |its )?(?:new )?" + DESCRIBING_WORD + "{0,3}" + FORMATION_NOUN + "\\b"
  + "|" + GARRISON_PLACED,
  "i",
);

const NEW_FORMATION_PATTERN =
  /\b(new (?:army|corps|division|brigade|regiment|formation)|forms? (?:an? )?(?:army|corps|division|brigade|regiment)|raises? (?:an? )?(?:army|corps|division|brigade|regiment)|mobiliz(?:e|es|ed|ation)|newly mobilized|reinforcements? arrive|reserve(?:s)? activated|conscription creates|expands? the army|new formation)\b/i;
const isNewFormation = (text) => NEW_FORMATION_PATTERN.test(text) || RAISED_FORMATION_PATTERN.test(text);

// A player's order that raises or sends forces (mapConsequences.js
// markOrderedEvents): its outcome event is the unit director's to read, however
// that event happens to be worded.
const ORDER_RAISES_PATTERN = /\b(?:raise|raises|recruit|recruits|form|forms|mobili[sz]e|mobili[sz]es|muster|musters|stand up|create|creates|deploy|deploys|send|sends)\b/i;
const FORMATION_NOUN_PATTERN = new RegExp("\\b" + FORMATION_NOUN + "\\b", "i");
const GARRISON_PLACED_PATTERN = new RegExp(GARRISON_PLACED, "i");
export const orderRaisesForces = (text) => {
  const value = String(text ?? "");
  return GARRISON_PLACED_PATTERN.test(value)
    || (ORDER_RAISES_PATTERN.test(value) && (FORMATION_NOUN_PATTERN.test(value) || MILITARY_FORMATION_PATTERN.test(value)));
};
const orderedForces = (event) => event?.ordered?.forces === true;

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
  // One move per unit per event: an event is one moment, and the unit can only
  // go to one place in it. This used to key on the destination too, and never
  // matched — placement keeps every placed thing clear of what already stands
  // there, so the director's move for a unit the simulator had already moved
  // landed a few hundred metres from the first and was kept as a second one.
  // The event then listed the same move twice under its map changes.
  if (kind === "move") {
    return `move|${normalizeString(op?.unitId)}`;
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
      && (OPERATIONAL_UNIT_DELTA_PATTERN.test(text) || SERVICE_FORMATION_PATTERN.test(text)))
    || RAISED_FORMATION_PATTERN.test(text)
    || orderedForces(event);
};

export const eventNeedsNativeUnitDirector = (event) => {
  if (!event || typeof event !== "object") return false;
  const text = eventText(event);
  return OPERATIONAL_UNIT_DELTA_PATTERN.test(text) || SERVICE_FORMATION_PATTERN.test(text) || RAISED_FORMATION_PATTERN.test(text)
    || orderedForces(event);
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
        if (ownerUnits.length > 0 && !isNewFormation(text) && !SERVICE_FORMATION_PATTERN.test(text) && !orderedForces(event)) {
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

// The event's combatants that have no unit at all: a war between powers the
// map gives no counters to (Russia and Ukraine in a player's Modern Day Game,
// 2026-09-30) otherwise stays a war nobody can see, because the director only
// moves the units it is shown. The combatants are the event's own and both
// sides of the war it is bound to: the events of that Game named only the
// player and Russia, so Ukraine was never counted. Owners compare by name,
// ignoring case.
// The war's leading powers (the first of each side) come first, then the
// event's own combatants, then the rest of each side: when only a few can be
// given a counter, the principals of the war are the ones that should be.
const warSidesOf = (event, wars) => {
  const war = normalizeArray(wars).find((entry) => normalizeString(entry?.id) && normalizeString(entry?.id) === normalizeString(event?.warId));
  if (!war || normalizeString(war.status).toLowerCase() === "ended") return { principals: [], members: [] };
  const sideA = normalizeArray(war.sideA);
  const sideB = normalizeArray(war.sideB);
  return { principals: [sideA[0], sideB[0]].filter(Boolean), members: [...sideA.slice(1), ...sideB.slice(1)] };
};
const combatantsWithoutUnits = (event, units, wars = []) => {
  const owners = new Set(units.map((unit) => normalizeString(unit?.ownerCode).toLowerCase()).filter(Boolean));
  const sides = warSidesOf(event, wars);
  const names = [...sides.principals, ...normalizeArray(event?.combatants), ...sides.members].map(normalizeString).filter(Boolean);
  const seen = new Set();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (owners.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// The director is told who has no counter, and asked to spawn one, but a model
// can ignore it: in a live check on that Game (2026-10-02) the review was told
// "Russia has no unit" and moved the player's Falklands garrison to Kherson
// instead. So the engine makes sure of it. For each power the director left
// without a spawn, one formation is raised where the events naming it as a
// combatant put the fighting: a place in them the power holds, else the part of
// its own land nearest the first place they name (gameplay.js
// raiseMissingCombatants). One per power per skip, and at most
// MAX_RAISED_COMBATANTS a skip, the wars' leading powers first, so a war is shown
// without filling the board with a counter for every ally. `events` lists the
// events naming each, so the caller can try each in turn.
export const MAX_RAISED_COMBATANTS = 2;
export const missingCombatantSpawns = (input, payload) => {
  const spawned = new Set(normalizeArray(payload?.eventOrders)
    .flatMap((entry) => normalizeArray(entry?.unitOps))
    .filter((op) => normalizeString(op?.op).toLowerCase() === "spawn")
    .map((op) => normalizeString(op?.unit?.ownerCode ?? op?.unit?.owner).toLowerCase())
    .filter(Boolean));
  const byPower = new Map();
  for (const candidate of normalizeArray(input?.candidates)) {
    for (const power of normalizeArray(candidate?.combatantsWithoutUnits)) {
      const key = normalizeString(power).toLowerCase();
      if (!key || spawned.has(key)) continue;
      if (!byPower.has(key)) byPower.set(key, { power: normalizeString(power), events: [] });
      byPower.get(key).events.push({ eventIndex: candidate.eventIndex, text: `${normalizeString(candidate.title)}. ${normalizeString(candidate.description)}` });
    }
  }
  return [...byPower.values()].slice(0, MAX_RAISED_COMBATANTS);
};

// Of the places an event names (lookupTools.js placesNamedIn), where the power's
// formation goes: one it holds. Never one another power holds — seen in a live
// check (2026-10-02), "the first place named" put a Russian army in Kyiv, which
// reads as Russia having taken it. When it holds none of them, the first place on
// the map is returned as `anchorRegionId`, for the caller to find the power's
// own land nearest it. null when the event names nowhere on the map.
export const pickCombatantPlace = (power, places) => {
  const key = normalizeString(power).toLowerCase();
  const onMap = normalizeArray(places).filter((place) => normalizeString(place?.regionId));
  const held = onMap.find((place) => normalizeString(place?.controller).toLowerCase() === key);
  if (held) return { at: normalizeString(held.place) };
  return onMap.length ? { anchorRegionId: normalizeString(onMap[0].regionId) } : null;
};

// The power's own region nearest a point: where its side of a front is, when the
// events name only the other side's places. Rows are the lookup context's
// (owner after overrides, centroid [lng, lat]). null when it holds no land.
export const nearestOwnRegion = ({ power, anchor, rows }) => {
  const key = normalizeString(power).toLowerCase();
  if (!Array.isArray(anchor) || !key) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const row of normalizeArray(rows)) {
    if (normalizeString(row?.owner).toLowerCase() !== key || !Array.isArray(row?.centroid)) continue;
    const dLng = (row.centroid[0] - anchor[0]) * Math.cos((anchor[1] * Math.PI) / 180);
    const dLat = row.centroid[1] - anchor[1];
    const distance = dLng * dLng + dLat * dLat;
    if (distance < bestDistance) { bestDistance = distance; best = row; }
  }
  return best ? normalizeString(best.name) : null;
};

export const nativeCombatantSpawn = (power, at) => ({
  op: "spawn",
  at,
  unit: { name: `${power} Field Army`, type: "infantry", ownerCode: power, strength: 100, posture: "holding" },
  note: `${power} is fighting with no formation on the map; the engine raised one where the event puts its forces.`,
});

const unitDirectorAnalyzerInput = (candidates, units, wars = []) => ({
  candidates: candidates.map(({ event, index }) => {
    const unrepresented = combatantsWithoutUnits(event, units, wars);
    return {
      eventIndex: index,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title),
      description: normalizeString(event?.description),
      existingUnitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
      ...(unrepresented.length ? { combatantsWithoutUnits: unrepresented } : {}),
    };
  }),
  units: units.map(summarizeUnit),
});

// null when no event needs the director.
export const buildUnitDirectorInput = ({ events = [], world = {} } = {}) => {
  const candidates = selectUnitDirectorCandidates(events);
  return candidates.length ? unitDirectorAnalyzerInput(candidates, normalizeUnits(world?.units), world?.wars) : null;
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
    analysis = await analyzeBatch(unitDirectorAnalyzerInput(candidates, units, world?.wars));
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
