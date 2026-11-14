/*! Open Historia — native unit director. */
// The main simulator writes history; this pass keeps the persistent order of
// battle coherent with it, so an NPC army is not a decorative counter the turn
// after it is created. It runs once per turn on the merged events: a narrow AI
// call proposes unit operations for the military events, deterministic rules
// below check them, and the accepted ops ride the same application path as
// the simulator's own unitOps (a long move becomes a standing order of the unit
// engine). This build resolves fighting through narrated strength changes and
// postures, so there is no attack op here.
//
// Which events it reads, and which of its operations it keeps, is decided by
// what each event CARRIES and never by its words: an event's prose is written
// in the player's language, and the English word lists that used to stand here
// ("raises a new battalion", "commissioned", "set sail", the formations a
// strength change or a removal had to name) passed English events and no
// others, so in any other language no unit ever changed (the owner,
// 2026-11-13: no keywording anywhere). The director is the AI; what it says
// an event did to a formation is taken as the operation it wrote.

import { normalizePendingUnitOrders, normalizeUnitEntry, normalizeUnits } from "../../runtime/gameState.js";
import { normalizeEventTags } from "../../runtime/eventTags.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const sameName = (a, b) => Boolean(normalizeString(a)) && normalizeString(a).toLowerCase() === normalizeString(b).toLowerCase();

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

// A player's order that raises or sends forces (mapConsequences.js
// markOrderedEvents) is read from the event that carries it out: an event that
// cites a player's order (impacts.actionIds) is the director's to read,
// whatever the order said. Its words are not read for whether it raised forces.
// Kept, answering no, only while mapConsequences.js still imports it: the
// event's citation is what the director reads now (eventNeedsNativeUnitDirector).
export const orderRaisesForces = () => false;
const citesPlayerOrder = (event) => normalizeArray(event?.impacts?.actionIds).some((id) => normalizeString(id));

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
    return `strength|${normalizeString(op?.unitId)}|${strengthGiven(op) ? Number(op.strength) : `kept|${normalizeString(op?.composition)}`}`;
  }
  if (kind === "remove") {
    return `remove|${normalizeString(op?.unitId)}`;
  }
  return `${kind}|${JSON.stringify(op)}`;
};

// Whether an event is the director's to read, by what it carries:
//   - unit operations of its own: the simulator already raised, moved or wore
//     down a formation in it;
//   - the Military tag (runtime/eventTags.js), or the engine's own kind
//     "military" (a battlefield's report, frontTurn.js);
//   - a war it is bound to (warId), or the powers fighting in it (combatants);
//   - a player's order it carries out (impacts.actionIds).
// A Scene's outcome is tagged by the model that writes its record
// (gameplay.js resolveInteractiveScene), as a skip's events are.
export const eventNeedsNativeUnitDirector = (event) => {
  if (!event || typeof event !== "object") return false;
  return normalizeArray(event?.impacts?.unitOps).length > 0
    || normalizeEventTags(event?.tags).includes("Military")
    || normalizeString(event?.kind).toLowerCase() === "military"
    || Boolean(normalizeString(event?.warId))
    || normalizeArray(event?.combatants).some((name) => normalizeString(name))
    || citesPlayerOrder(event)
    || event?.ordered?.forces === true;
};

// Whether a strength op says a strength: a refit gives only the formation's new make-up, and its strength, missing
// or null, is unchanged (gameState.js normalizeUnitOp). Number(null) is 0, which destroyed the refitted formation.
export const strengthGiven = (op) => op?.strength !== undefined && op?.strength !== null && String(op.strength).trim() !== "" && Number.isFinite(Number(op.strength));

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
    if (!strengthGiven(op)) return;
    if (Number(op.strength) <= 0) unitMap.delete(op.unitId);
    else unitMap.set(op.unitId, { ...unit, strength: Number(op.strength) });
  } else if (op.op === "remove") {
    unitMap.delete(op.unitId);
  }
};

// The director's operations, checked against the order of battle as each event
// leaves it. What is checked is the operation's own structure: an event the
// director was not asked about takes none; a spawn needs an owner and a name
// and fits the turn's budget; any other op needs a unit that exists; an attack
// is not this build's. An op's kind is trusted: a strength change or a
// removal is what the director says the event did to that formation, in the
// event's language, and is not held to English words for casualties.
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
    if (proposedOps.length === 0) continue;
    if (!eventNeedsNativeUnitDirector(event)) {
      for (const raw of proposedOps) {
        diagnostics.push({ eventIndex, op: normalizeString(raw?.op).toLowerCase() || "?", action: "DROP", reason: "the event carries no unit operations, Military tag, war, combatants or player's order" });
      }
      continue;
    }

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

        // A spawn is a new formation: the director was told to reuse a power's
        // units for anything else, and a spawn named like one of them is that
        // unit (gameState.js applyUnitOpBatch).
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

      if (kind === "strength" || kind === "remove") {
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
  .filter(({ event }) => eventNeedsNativeUnitDirector(event));

// How many units the director is shown. A big scenario map can field
// hundreds, and every one rode the shared turn review uncapped.
export const UNIT_DIRECTOR_UNIT_LIMIT = 60;

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
const isActiveWar = (war) => war && normalizeString(war.status).toLowerCase() !== "ended";
// The war an event is about: the active one it is bound to (warId). An event
// that is bound to none is about none: a war is never guessed from the names
// its text mentions, an English stem of which ("Russian" for Russia) found a
// country only where its adjective is spelled like its name. An unbound event
// of fighting still says who fought in its combatants, and those are counted.
const warOfEvent = (event, wars) => {
  const warId = normalizeString(event?.warId);
  return warId ? normalizeArray(wars).filter(isActiveWar).find((war) => normalizeString(war?.id) === warId) ?? null : null;
};
const warSidesOf = (event, wars) => {
  const war = warOfEvent(event, wars);
  if (!war) return { principals: [], members: [] };
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
// combatant put the fighting: a place their `places` field names that the
// power holds, else the part of its own land nearest the first of them
// (gameplay.js raiseMissingCombatants). One per power per skip, and at most
// MAX_RAISED_COMBATANTS a skip, the wars' leading powers first, so a war is shown
// without filling the board with a counter for every ally. `events` lists the
// events naming each by their index, so the caller can try each in turn.
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
      if (!byPower.has(key)) byPower.set(key, { power: normalizeString(power), warId: normalizeString(candidate?.warId), events: [] });
      byPower.get(key).events.push({ eventIndex: candidate.eventIndex });
    }
  }
  return [...byPower.values()].slice(0, MAX_RAISED_COMBATANTS);
};

// Of the places an event's `places` field names, found on the map (gameplay.js
// combatantPlacesOf: { place, regionId, controller }), where the power's
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

// `warId`: the war it is raised for, so it is disbanded when that war ends
// (pruneWarUnits).
export const nativeCombatantSpawn = (power, at, warId = "") => ({
  op: "spawn",
  at,
  unit: {
    name: `${power} Field Army`, type: "infantry", ownerCode: power, strength: 100, posture: "holding",
    ...(normalizeString(warId) ? { raisedForWar: normalizeString(warId) } : {}),
  },
  note: `${power} is fighting with no formation on the map; the engine raised one where the event puts its forces.`,
});

// Who holds land in a world: every owner and lawful sovereign of an overridden
// region, lowercased. Read from the overrides alone, as isPolityLandless does.
export const landHolders = (world) => new Set(
  [...Object.values(world?.regionOwnershipOverrides ?? {}), ...Object.values(world?.regionSovereigntyOverrides ?? {})]
    .map((owner) => normalizeString(owner).toLowerCase())
    .filter(Boolean),
);

// What a war's end and a country's fall take off the map, after a turn's wars
// and borders are applied. Nothing removed units before: they stayed where they
// were until an event destroyed or disbanded them.
//   - A formation the engine raised for a war (raisedForWar) is disbanded when
//     that war is no longer active: it existed only to show the war.
//   - Every unit of a power that held land when the turn began and holds none
//     now: an annexed or conquered country keeps no armies. A power that never
//     held land (a host, a horde, a company of exiles) is not touched.
//   - A story ship (storyVessel) whose expiresRound has passed: its voyage is
//     over even if no event said it arrived.
// Their standing orders go with them. Pure.
export const pruneWarUnits = ({ units = [], orders = [], wars = [], heldBefore = new Set(), heldAfter = new Set(), round = 0 } = {}) => {
  const active = new Set(normalizeArray(wars).filter(isActiveWar).map((war) => normalizeString(war?.id)).filter(Boolean));
  const kept = [];
  const removed = [];
  for (const unit of normalizeArray(units)) {
    const war = normalizeString(unit?.raisedForWar);
    const owner = normalizeString(unit?.ownerCode).toLowerCase();
    const warOver = Boolean(war) && !active.has(war);
    const fallen = Boolean(owner) && heldBefore.has(owner) && !heldAfter.has(owner);
    const voyageOver = unit?.storyVessel === true && Number.isInteger(unit?.expiresRound) && Number(round) > unit.expiresRound;
    if (warOver) removed.push({ unit, reason: "war-ended" });
    else if (fallen) removed.push({ unit, reason: "lost-all-land" });
    else if (voyageOver) removed.push({ unit, reason: "voyage-ended" });
    else kept.push(unit);
  }
  const gone = new Set(removed.map(({ unit }) => normalizeString(unit?.id)));
  return {
    units: kept,
    orders: normalizeArray(orders).filter((order) => !gone.has(normalizeString(order?.unitId))),
    removed,
  };
};

// The units the candidate events are about come first: a unit their own
// unitOps touch, or one of a power they say is fighting (their combatants and
// both sides of the war they are bound to), by its exact name. The rest follow
// in saved order, up to the limit; `omittedUnits` counts the cut. Nothing is
// read from the events' words for a power or a formation they mention.
// The sanitizer still checks every op against the whole order of battle, and a
// combatant is "without units" against the whole of it too, not the listed part.
const unitDirectorAnalyzerInput = (candidates, units, pendingUnitOrders = [], wars = []) => {
  const touched = new Set(candidates.flatMap(({ event }) => normalizeArray(event?.impacts?.unitOps)
    .map((op) => normalizeString(op?.unitId))
    .filter(Boolean)));
  const fighting = candidates.flatMap(({ event }) => {
    const sides = warSidesOf(event, wars);
    return [...sides.principals, ...normalizeArray(event?.combatants), ...sides.members];
  });
  const isNamed = (unit) => touched.has(normalizeString(unit?.id))
    || fighting.some((power) => sameName(power, unit?.ownerCode));
  const ordered = units
    .map((unit, index) => ({ unit, index, tier: isNamed(unit) ? 0 : 1 }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.unit);
  const orderByUnit = new Map(normalizePendingUnitOrders(pendingUnitOrders).map((order) => [order.unitId, order]));
  return {
    candidates: candidates.map(({ event, index }) => {
      const unrepresented = combatantsWithoutUnits(event, units, wars);
      const war = unrepresented.length ? warOfEvent(event, wars) : null;
      return {
        eventIndex: index,
        date: normalizeString(event?.date),
        title: normalizeString(event?.title),
        description: normalizeString(event?.description),
        existingUnitOps: cloneValue(normalizeArray(event?.impacts?.unitOps)),
        ...(unrepresented.length ? { combatantsWithoutUnits: unrepresented } : {}),
        ...(war?.id ? { warId: normalizeString(war.id) } : {}),
        // The player's own event: where the player's story ship (a hired cog, a
        // courier) may sail, which the director judges from the event itself.
        ...(event?.playerRelated === true ? { playerRelated: true } : {}),
      };
    }),
    units: ordered.slice(0, UNIT_DIRECTOR_UNIT_LIMIT).map((unit) => summarizeUnit(unit, orderByUnit.get(unit.id) ?? null)),
    omittedUnits: Math.max(0, ordered.length - UNIT_DIRECTOR_UNIT_LIMIT),
  };
};

// null when no event needs the director.
export const buildUnitDirectorInput = ({ events = [], world = {} } = {}) => {
  const candidates = selectUnitDirectorCandidates(events);
  return candidates.length
    ? unitDirectorAnalyzerInput(candidates, normalizeUnits(world?.units), world?.pendingUnitOrders, world?.wars)
    : null;
};

export const directGeneratedUnitOps = async ({
  events = [],
  game = {},
  world = {},
  analyzeBatch,
  signal = null,
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
    analysis = await analyzeBatch(unitDirectorAnalyzerInput(candidates, units, world?.pendingUnitOrders, world?.wars));
  } catch (error) {
    // The player's Cancel is not a failed analysis: it must reach the skip.
    if (signal?.aborted) throw error;
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
