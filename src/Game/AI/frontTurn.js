/*! Open Historia — a turn's land war, handed to the front engine and brought back © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The front engine (runtime/fronts/engine.js) knows nothing of a turn: it is
// given battlefields, a span of days and what happens on which day, and it
// answers with the battlefields afterwards and the regions that changed hands.
// This is the turn's side of that conversation:
//
//   before   the engine's own changes of an earlier apply are taken out of the
//            events (stripFrontOps), the turn's orders, its wars and the map
//            changes the model wrote itself are laid out day by day
//            (planFrontMoments), and each country is given a weight
//            (countryWeight);
//   the run  with the arenas it has cached, and again with the map's regions
//            when it says it needs them (runFrontTurn);
//   after    each change of hands is put on the event of its day as an ordinary
//            control operation marked by: "front" (attachFrontFlips), so the
//            reveal, a view of the world as seen, the region's history and
//            every reader of who holds what need nothing new; and the
//            formations that fought come back with where they stand
//            (applyFrontUnitChanges).
//
// runTurnFronts, at the end, is all of it in the order a turn needs it.
//
// Nothing here needs the map or the model, and it loads in plain Node: the
// engine and the map's regions are handed in (frontApply.js, for gameplay.js
// applySimulationResult).

import { addGameDays, diffGameDays, gameDateYear } from "../../runtime/gameDates.js";
import { eraOf, yearInEra } from "../../runtime/unitMotion.js";
import { resolveAirStrikes, withTroopHits } from "../../runtime/fronts/airStrike.js";
import { airArmsForOrders } from "../../runtime/fronts/airStrikeOps.js";
import { militaryLookup } from "../../runtime/militaryStats.js";
import { DEFAULT_MUSTER, musterTable } from "../../runtime/mustering.js";
import { warSettingsOf } from "../../runtime/warSettings.js";
import { normalizeClimateZones, normalizeFortifications, normalizeFreezingRegions, normalizeTerrainAreas, zoneWeightAt } from "../../runtime/warGeography.js";
import { climateZonesOf, terrainAreasOf } from "../../runtime/worldGeographyDefaults.js";
import { freezesAt } from "../../runtime/fronts/climate.js";
import { hashKey } from "../../runtime/fronts/codec.js";
import { forcesFunding, middleFundingPerHead } from "../../runtime/militaryFunding.js";
import { countryWeight, middleWeight } from "../../runtime/countryWeight.js";
import { populationFigureOf } from "../../runtime/populationFigure.js";
import { forceGroupDescription, groupOwnerOf, normalizeGroupOp } from "../../runtime/groups.js";
import { arenaFor } from "../../runtime/fronts/arena.js";
import { REINFORCE_ORDER, SCENARIO_MARK } from "../../runtime/fronts/constants.js";
import { anyMechanic } from "../../runtime/fronts/mechanics.js";
import { pointInFrame } from "../../runtime/fronts/frame.js";
import { foldBattlefieldName, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { TRANSPORT_LOAD_USUAL, TRANSPORT_ORDERS, isUnderWay, normalizeTransports, orderTransport } from "../../runtime/fronts/transports.js";
import { buildWorldGrid, distanceTo, measureOptions, seasOf, worldSheetKey } from "../../runtime/fronts/worldGrid.js";
import { waterTypeIds } from "../../runtime/regionTypes.js";
import { chooseFleetPostures } from "../../runtime/naval/admiral.js";
import { runNaval } from "../../runtime/naval/engine.js";
import { normalizeBlockades, shortageOfBlockade } from "../../runtime/naval/blockade.js";
import { shortagesTogether, wearinessGoingIn, wearyShortage } from "../../runtime/warWeariness.js";
import { normalizeWarResources, resourceShortage } from "../../runtime/warResources.js";
import { STRIKES_PER_TURN_MOST, findStrikePlace, fliesAsAircraft, pickStrikeOrigin, seaLaunchPlace } from "../../runtime/strikes.js";

export const FRONT_MARK = "front";
// The mark on an order the turn itself drew from an event's own operations
// (statedCaptures): what the engine says of it is not the model's to be told.
export const STATED_REF = "stated:";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
// The orders that send troops at something (the engine's ATTACK_ORDERS).
const ATTACKING = ["advance", "blitz", "spearhead", "flank", "encircle", "assault", "land"];
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- before ----------------------------------------------------------------------

// The events without what the engine added to them. A turn applied a second
// time (a turn cut short and continued, a held turn retried) works the land war
// out afresh from the same orders; left in, the first run's changes would be
// applied beside the second's.
export const stripFrontOps = (events) => asArray(events).map((event) => {
  const impacts = event?.impacts;
  if (!isRecord(impacts)) return event;
  const control = asArray(impacts.regionControlOps);
  const groups = asArray(impacts.groupOps);
  const own = (op) => op?.by !== FRONT_MARK;
  if (control.every(own) && groups.every(own)) return event;
  return { ...event, impacts: { ...impacts, regionControlOps: control.filter(own), groupOps: groups.filter(own) } };
});

// How many days the run covers, and the day an event falls on, counted from
// the day the turn began. A calendar the game cannot read (a fantasy
// scenario's own) gives no dates to count between: the run is then as long as
// the skip that was asked for, and the events are spread evenly through it in
// the order they were told.
export const frontRunSpan = ({ fromDate, toDate, requestedDays = 0, events = [] } = {}) => {
  const counted = diffGameDays(fromDate, toDate);
  const days = counted !== null && counted >= 0 ? counted : Math.max(0, Math.round(Number(requestedDays) || 0));
  const list = asArray(events);
  const dayOf = (event) => {
    const day = diffGameDays(fromDate, event?.date);
    if (day !== null) return Math.max(0, Math.min(days, day));
    const index = list.indexOf(event);
    return index < 0 ? days : Math.round(((index + 1) * days) / (list.length + 1));
  };
  return { days, dayOf };
};

const warSides = (war) => [asArray(war?.sideA).map(clean).filter(Boolean), asArray(war?.sideB).map(clean).filter(Boolean)];
const missingFrom = (list, others) => list.filter((name) => !others.some((other) => fold(other) === fold(name)));

// What the war ledger did this turn, as the engine is told it: read off the
// wars before and after the ledger's own merge, never off the model's records,
// because the ledger refuses and repairs records and the battlefields must
// follow the wars that actually stand.
const warMoments = (warsBefore, warsAfter, { fromDate, days }) => {
  const dayOn = (date) => {
    const day = diffGameDays(fromDate, date);
    return day === null ? days : Math.max(0, Math.min(days, day));
  };
  const before = new Map(asArray(warsBefore).map((war) => [clean(war?.id), war]));
  const moments = [];
  for (const war of asArray(warsAfter)) {
    const warId = clean(war?.id);
    if (!warId) continue;
    const was = before.get(warId);
    const [sideA, sideB] = warSides(war);
    const status = clean(war?.status) || "active";
    const changed = dayOn(war?.lastUpdatedDate || war?.startedDate);
    if (!was || clean(was.status) === "ended") {
      if (status !== "ended") {
        moments.push({ day: dayOn(war?.startedDate || war?.lastUpdatedDate), type: "war", warId, op: "start", names: sideA, opponents: sideB, title: clean(war?.title) });
        if (status === "ceasefire") moments.push({ day: changed, type: "war", warId, op: "ceasefire", names: [] });
      }
      continue;
    }
    const [wasA, wasB] = warSides(was);
    const joinedA = missingFrom(sideA, wasA);
    const joinedB = missingFrom(sideB, wasB);
    const left = [...missingFrom(wasA, sideA), ...missingFrom(wasB, sideB)];
    if (joinedA.length) moments.push({ day: changed, type: "war", warId, op: "join-a", names: joinedA });
    if (joinedB.length) moments.push({ day: changed, type: "war", warId, op: "join-b", names: joinedB });
    if (left.length) moments.push({ day: changed, type: "war", warId, op: "leave", names: left });
    const wasStatus = clean(was.status) || "active";
    if (status !== wasStatus) {
      const op = status === "ended" ? "end" : status === "ceasefire" ? "ceasefire" : "resume";
      moments.push({ day: status === "ended" ? dayOn(war?.endedDate || war?.lastUpdatedDate) : changed, type: "war", warId, op, names: [] });
    }
  }
  return moments;
};

// Everything the engine is told happens during the run, each with its day.
//   events        the turn's events in the order they are kept (stripFrontOps first)
//   frontOrders   the orders, bound to those events' ids (nativeFrontLedger.js)
//   warsBefore    world.wars as the turn began
//   warsAfter     world.wars as the ledger's merge of this turn leaves them
//   warStages     the same a record at a time, when the caller has it so: the
//                 wars as the turn began, then as each record the ledger
//                 merged left them. Two changes to one war in one turn (an
//                 ally joins on the fifth, a ceasefire on the twentieth) then
//                 fall each on its own day; read off the first and the last
//                 alone, both would fall on the day of the later.
// An order takes effect on the day of the earliest event it rests on, and one
// that rests on none on the first day. Except on a battlefield in `settled`
// (their names, folded): there the period was fought before the story was
// written and the story was told how it went, so an order is for what comes
// next: it is put to the troops as the run ends, and what the answer was told
// happened stays what happened. A change of control the model wrote
// itself (a control operation, a single region handed over) is told to the
// engine on its event's day: the world as written wins over the line, which is
// what makes the engine bend the line round it rather than fight it.
export const planFrontMoments = ({ events = [], frontOrders = [], warsBefore = [], warsAfter = [], warStages = null, fromDate = "", days = 0, dayOf = () => 0, settled = null } = {}) => {
  const list = asArray(events);
  const dayById = new Map(list.map((event) => [clean(event?.id), dayOf(event)]));
  const stages = asArray(warStages).length >= 2 ? asArray(warStages) : [warsBefore, warsAfter];
  const moments = [];
  for (let stage = 1; stage < stages.length; stage += 1) moments.push(...warMoments(stages[stage - 1], stages[stage], { fromDate, days }));

  for (const event of list) {
    const day = dayOf(event);
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const op of asArray(impacts.regionControlOps)) {
      if (op?.by === FRONT_MARK || fold(op?.op) !== "control" || op?.wholeCountry === true) continue;
      const regionId = clean(op?.regionId);
      const to = clean(op?.toCode);
      // (A control operation is the story's capture: the engine hands it over only where enough of the taker's troops
      // stand near, engine.js captureRefused. A transfer is a treaty's, and needs nobody there.)
      if (regionId && to) moments.push({ day, type: "control", regionId, to, ref: clean(event?.id), capture: true });
    }
    for (const transfer of asArray(impacts.regionTransfers)) {
      if (transfer?.wholeCountry === true) continue;
      const regionId = clean(transfer?.regionId);
      const to = clean(transfer?.toCode);
      if (regionId && to) moments.push({ day, type: "control", regionId, to, ref: clean(event?.id) });
    }
    // A group taking a region into its area, or letting one go, is told the same way (engine.js, a "group" moment).
    // (A release of its whole area, or a group dissolved, names no region: the next run finds the area as it stands.)
    for (const raw of asArray(impacts.groupOps)) {
      const op = raw?.by === FRONT_MARK ? null : normalizeGroupOp(raw);
      if (!op || (op.op !== "take" && op.op !== "create" && op.op !== "release")) continue;
      for (const regionId of op.regionIds) {
        moments.push(op.op === "release"
          ? { day, type: "group", regionId, group: "", from: op.name, ref: clean(event?.id) }
          : { day, type: "group", regionId, group: op.name, ref: clean(event?.id) });
      }
    }
  }

  for (const order of asArray(frontOrders)) {
    if (!isRecord(order) || order.problem) continue;
    const bound = asArray(order.eventIds).map((id) => dayById.get(clean(id))).filter((day) => day !== undefined);
    const held = settled instanceof Set && settled.has(foldBattlefieldName(order.battlefield));
    // An order a player's action gave through the skip's own function
    // (frontOrderFunction.js) is carried out from the day it was given, on a
    // battlefield that was fought beforehand as on any other: the period was
    // fought again with it, and that is the period the story told.
    const given = order.now === true ? diffGameDays(fromDate, order.date) : null;
    const moment = {
      day: order.now === true ? Math.max(0, Math.min(Math.max(0, days - 1), given ?? (Number(order.day) || 0))) : held ? days : bound.length ? Math.min(...bound) : 0,
      type: "order",
      battlefield: clean(order.battlefield),
      side: clean(order.side),
      order: clean(order.order),
      sector: clean(order.sector) || "all",
      ref: clean(order.id),
    };
    if (clean(order.objective)) moment.objective = clean(order.objective);
    // (Where the turn found the place for the engine: a city the map spells another way.)
    if (isRecord(order.objectiveAt) && Number.isFinite(Number(order.objectiveAt.lng)) && Number.isFinite(Number(order.objectiveAt.lat))) moment.objectiveAt = { lng: Number(order.objectiveAt.lng), lat: Number(order.objectiveAt.lat) };
    if (clean(order.result)) moment.result = clean(order.result);
    if (clean(order.effort)) moment.effort = clean(order.effort);
    // (How many formations an order for more troops brings, where it says.)
    if (moment.order === REINFORCE_ORDER && Number(order.count) >= 1) moment.count = Math.round(Number(order.count));
    // Whose order it is, for the engine: what a scenario's author made the
    // front; a person's own, given through the skip's function; or the story's
    // with no event of its answer behind it (which opens no war by itself and
    // does not end a posture a scenario set: runtime/fronts/constants.js).
    if (order.mark === SCENARIO_MARK) moment.mark = SCENARIO_MARK;
    else if (order.now === true) moment.given = true;
    else if (bound.length === 0) moment.unbound = true;
    if (moment.battlefield && moment.side && (moment.order || moment.result)) moments.push(moment);
  }

  // By day, and within a day in the order above (wars, then the map as
  // written, then orders): a stable order, so the same turn plans the same run.
  return moments
    .map((moment, index) => ({ moment, index }))
    .sort((a, b) => a.moment.day - b.moment.day || a.index - b.index)
    .map(({ moment }) => moment);
};

// A country's weight in a land war (runtime/countryWeight.js): handed on
// from here under the name the turn has always had for it.
export { countryWeight };

// How many regions the engine may move this run under a scenario's ceiling on
// the map's tempo, after what the model's own changes already used. null where
// the scenario sets no ceiling.
export const frontFlipAllowance = ({ allowance, events = [] } = {}) => {
  if (!Number.isFinite(allowance)) return null;
  let used = 0;
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    used += asArray(impacts.regionTransfers).length;
    used += asArray(impacts.regionControlOps).filter((op) => fold(op?.op) === "control" && op?.by !== FRONT_MARK).length;
  }
  return Math.max(0, Math.floor(allowance - used));
};

// ---- the map and the world, as the engine takes them ---------------------------------

// The box round a shape, [west, south, east, north], by its outer rings. null
// for one that runs across the date line: the engine works that box out itself.
const boxOf = (geometry) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of geometry.type === "Polygon" ? [geometry.coordinates] : asArray(geometry.coordinates)) {
    for (const point of asArray(polygon?.[0])) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west <= east && south <= north && east - west <= 180 ? [west, south, east, north] : null;
};

// The map's regions as the engine takes them, from the regions file the game
// draws: an id (read the way every other reader of that file reads it), a
// name, the shape, the box round it and its Workshop type. `nameOf(id)` is the
// name the rest of the game calls the region by; one with no name of its own is
// known by its id, which no reader is ever shown.
export const engineRegionsOf = (geojson, { nameOf = null } = {}) => {
  const regions = [];
  for (const feature of asArray(geojson?.features)) {
    const props = isRecord(feature?.properties) ? feature.properties : {};
    const id = String(props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id ?? "").trim();
    const geometry = feature?.geometry;
    if (!id || !isRecord(geometry) || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const region = {
      id,
      name: clean(typeof nameOf === "function" ? nameOf(id) : "") || clean(props.name ?? props.NAME_1 ?? props.name_1) || id,
      geometry,
    };
    const bbox = boxOf(geometry);
    if (bbox) region.bbox = bbox;
    const typeId = clean(props.typeId);
    if (typeId) region.typeId = typeId;
    regions.push(region);
  }
  return regions;
};

// Who controls, lawfully owns and groups each region as the turn began, and
// what each country weighs: the engine's questions about the world, answered
// from the world's own stores. What the turn's events change is told to the
// engine day by day (planFrontMoments), never read from here.
//   baseOwners   Map, region id -> who holds it on the map as drawn, for a
//                region no event has moved yet
//   groups       false when groups are switched off for the game
export const frontWorldReaders = (world, { baseOwners = null, groups = true } = {}) => {
  const control = isRecord(world?.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {};
  const sovereignty = isRecord(world?.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {};
  const groupAreas = groups && isRecord(world?.groupAreas) ? world.groupAreas : {};
  const groupNames = new Set(Object.keys(groups && isRecord(world?.groups) ? world.groups : {}).map(fold));
  const base = baseOwners instanceof Map ? baseOwners : new Map();
  const controllerOf = (id) => clean(Object.hasOwn(control, id) ? control[id] : base.get(id));
  const sovereignOf = (id) => clean(Object.hasOwn(sovereignty, id) ? sovereignty[id] : "") || controllerOf(id);

  const sheets = isRecord(world?.countryStats) ? world.countryStats : {};
  let people = null;
  const peopleOf = (name) => {
    if (!people) {
      people = new Map();
      // What the scenario's author gives a country or a group (runtime/populationFigure.js) ...
      for (const [key, record] of Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {})) {
        const figure = populationFigureOf(record);
        if (!(figure > 0)) continue;
        people.set(fold(key), figure);
        if (clean(record?.name)) people.set(fold(record.name), figure);
      }
      for (const [key, record] of Object.entries(groups && isRecord(world?.groups) ? world.groups : {})) {
        const figure = populationFigureOf(record);
        if (figure > 0) people.set(fold(key), figure);
      }
      // ... until its sheet of statistics says what they are now.
      for (const [key, sheet] of Object.entries(sheets)) {
        const total = Number(sheet?.population?.total);
        if (Number.isFinite(total) && total > 0) people.set(fold(key), total);
      }
    }
    return people.get(fold(name));
  };
  const military = militaryLookup(world);
  const scenarioMuster = warSettingsOf(world).muster;
  const curves = new Map();
  // What a country's forces have to spend, as its weight takes it (runtime/militaryFunding.js forcesFunding): what
  // it was rated at against the others where the scenario counts countries' figures, else what its economy pays for.
  const counted = warSettingsOf(world).mechanics.military;
  let middleFunding = null;
  const sheetOf = (name) => {
    const key = fold(name);
    for (const [other, sheet] of Object.entries(sheets)) if (fold(other) === key) return sheet;
    return null;
  };
  const fundingOf = (name) => {
    if (middleFunding === null) middleFunding = middleFundingPerHead(sheets);
    return forcesFunding({ sheet: sheetOf(name), middle: middleFunding, military: counted ? military(name) : null });
  };
  // What a country weighs in a land war: its people and what its forces have to spend (runtime/countryWeight.js).
  // One whose people nobody knows yet is counted as the middle of those known: never by the land it holds ("remove
  // region count power entirely", the owner, 2026-10-16). The AI rates its people and figures against every other
  // country's as the game first needs them (militaryRating.js), where its scenario's designer did not.
  const weightOf = (name) => countryWeight({ population: peopleOf(name), funding: fundingOf(name) });
  let unknownWeight = null;
  const strengthOf = (name) => {
    const weight = weightOf(name);
    if (weight !== null) return weight;
    if (unknownWeight === null) {
      peopleOf("");
      unknownWeight = middleWeight([...people.keys()].map(weightOf).filter((known) => known !== null));
    }
    return unknownWeight;
  };

  return {
    controllerOf,
    sovereignOf,
    groupAreas,
    isGroup: (name) => groupNames.has(fold(name)),
    // The country whose force a group is, where it is one (runtime/groups.js `owner`).
    groupOwnerOf: (name) => (groups ? groupOwnerOf(world?.groups, name) : ""),
    strengthOf,
    // A country's own military figures, where its author or its sheet gives them (runtime/militaryStats.js;
    // what they do: runtime/fronts/military.js).
    militaryOf: military,
    // How long it takes a country to call up its army (runtime/mustering.js), as the engine takes it:
    // its own curve, else the scenario's, else the game's (runtime/fronts/muster.js).
    musterOf: (name) => {
      const points = military(name)?.muster ?? scenarioMuster ?? DEFAULT_MUSTER;
      const key = JSON.stringify(points);
      if (!curves.has(key)) curves.set(key, { table: musterTable(points), head: points[0][1] });
      return curves.get(key);
    },
    // A country's people, where its sheet says: what its troops are raised from (runtime/fronts/manpower.js).
    peopleOf: (name) => {
      const people = Number(peopleOf(name));
      return Number.isFinite(people) && people > 0 ? people : 0;
    },
  };
};

// The ground a scenario made harder to cross, as the engine's map carries it
// (runtime/fronts/arena.js): { key, areas }, or null for none. Its own, or on
// the built-in basemaps the real world's (runtime/worldGeographyDefaults.js).
// Worked out once for the same list of areas.
const terrains = new WeakMap();
const terrainOf = (world) => {
  const source = terrainAreasOf(world);
  if (terrains.has(source)) return terrains.get(source);
  const areas = normalizeTerrainAreas(source).filter((area) => area.level > 0);
  const terrain = areas.length > 0 ? { key: hashKey(areas.map((area) => `${area.id}:${area.level}:${JSON.stringify(area.rings)}`)), areas } : null;
  terrains.set(source, terrain);
  return terrain;
};

// The water a scenario lets freeze that is frozen for a turn: by its climate
// zones' winters (or the world's own, by latitude), on the turn's middle day,
// at the middle of each such water's box (runtime/fronts/climate.js
// freezesAt). [{ id, box }] where any is; [] otherwise.
export const frozenFor = ({ world, regions, fromDate = "", days = 0 }) => {
  const freezing = normalizeFreezingRegions(world?.freezingRegions);
  if (freezing.length === 0 || !Array.isArray(regions)) return [];
  const zones = normalizeClimateZones(climateZonesOf(world)).map((zone) => ({ zone, inside: (lng, lat) => zoneWeightAt(zone, lng, lat) }));
  const middle = addGameDays(fromDate, Math.floor(Math.max(0, Number(days) || 0) / 2)) || fromDate;
  const wanted = new Set(freezing);
  const frozen = [];
  for (const region of regions) {
    if (!wanted.has(String(region?.id)) || !Array.isArray(region.bbox) || region.bbox.length < 4) continue;
    const [west, south, east, north] = region.bbox;
    if (freezesAt(zones, (west + east) / 2, (south + north) / 2, middle)) frozen.push({ id: String(region.id), box: [west, south, east, north] });
  }
  return frozen;
};

// ---- names ---------------------------------------------------------------------------

// The renames a turn's events make, in the order they make them: a country
// given a new name by a polity change, a group by a group operation.
export const turnRenames = (events) => {
  const renames = [];
  const add = (from, to) => {
    if (clean(from) && clean(to) && fold(from) !== fold(to)) renames.push({ from: clean(from), to: clean(to) });
  };
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const change of asArray(impacts.polityChanges)) add(change?.code, change?.name);
    for (const op of asArray(impacts.groupOps)) add(op?.name, op?.newName);
  }
  return renames;
};

// The engine knows every country and group by the name it had as the turn
// began: it runs before the turn's events are applied, and the rename that one
// of them makes re-keys its battlefields afterwards with everything else. So a
// name an event gave during the turn is turned back into the one it replaced
// before the engine is told anything by it. `known` are the names in use as
// the turn began: a "new" name that one of them already answers to is somebody
// else's, and is left alone.
export const engineNamer = (renames, known = []) => {
  const taken = new Set(asArray(known).map(fold).filter(Boolean));
  const back = asArray(renames).filter((entry) => !taken.has(fold(entry?.to)));
  return (name) => {
    let current = clean(name);
    for (let index = back.length - 1; index >= 0; index -= 1) {
      if (fold(back[index].to) === fold(current)) current = back[index].from;
    }
    return current;
  };
};

// "country: Russia" in a field that takes a country or a group is Russia.
const withoutKind = (value) => clean(value).replace(/^(?:country|group|polity|nation|state|side)\s*:\s*/i, "");

// A turn's strikes placed (runtime/strikes.js): each with its places where they can be found, among the places of
// the event that tells of it, the map's cities, the world's structures and its formations, and then as the game finds
// any place a model names (a city by another of its names, a country, a region). One launched from nowhere that is
// named sets off from what its owner has on the map for it, and failing that from a city of its own. The battlefield
// turn places those its frontOrders wrote; the turn itself those its events carry (impacts.strikes), Fronts on or off.
//   struck        strike records (nativeFrontLedger.js), each bound to its event by eventIds
//   strikePlaces  the game's own reader of places (gameplay.js createStrikePlaceReader), or null
//   idPrefix      what sets the ids apart from another batch of the same turn
export const placeStrikes = async (struck, { events = [], cities = [], world = null, strikePlaces = null, fromDate = "", toDate = "", idPrefix = "strike" } = {}) => {
  const lookedFor = async (ask) => {
    try {
      return (await ask()) ?? null;
    } catch (error) {
      console.warn("[strikes] a strike's place could not be looked for; the map finds it by name when it plays the strike.", error);
      return null;
    }
  };
  const placed = [];
  const told = new Map(asArray(events).map((event) => [clean(event?.id), event]));
  const found = async (text, known) => findStrikePlace(text, known) ?? (typeof strikePlaces?.find === "function" ? lookedFor(() => strikePlaces.find(text)) : null);
  for (const [at, order] of asArray(struck).entries()) {
    const event = asArray(order.eventIds).map((id) => told.get(id)).find(Boolean) ?? null;
    const owner = clean(withoutKind(order.side));
    const known = { places: asArray(event?.places), cities: asArray(cities), markers: asArray(world?.markers), units: asArray(world?.units) };
    const target = await found(order.objective, known);
    const launch = clean(order.from) ? await found(order.from, known) : null;
    const picked = launch
      ? null
      : pickStrikeOrigin({ weapon: order.weapon, owner, to: target, markers: known.markers, units: known.units })
        // (A submarine with no fleet to stand for it: the battlefield turn puts it to sea; elsewhere the map draws it from its owner's country.)
        ?? (order.weapon !== "submarine missile" && typeof strikePlaces?.origin === "function" ? await lookedFor(() => strikePlaces.origin({ owner, weapon: order.weapon, to: target })) : null);
    placed.push({
      id: `${idPrefix}:${clean(toDate) || clean(fromDate)}:${at}`,
      eventId: clean(event?.id),
      date: clean(event?.date) || clean(toDate),
      owner,
      weapon: order.weapon,
      count: order.count,
      down: order.down,
      from: launch ? { name: clean(order.from), ...launch } : picked ?? (clean(order.from) ? { name: clean(order.from) } : null),
      to: { name: clean(order.objective), ...(target ?? {}) },
    });
  }
  return placed;
};

// ---- what the events themselves say of the war ---------------------------------------

// A change of control the turn's events carry for a region that lies on a
// battlefield being fought over, taking it from one side of that battlefield
// for the other, is the story stating a result: the region was CAPTURED that
// day. That is what a model writes when it does not write an order (it is how
// every capture was written before there were battlefields), what a capture
// told only in an event's prose becomes (narratedCapture.js), and what the
// Game Master writes. The operation stays on its event and is applied as it
// always was; the engine is told of the change of control on that day, as it
// is of any other, AND told the capture as a result, so that the nearest
// troops of the side walk there and the ground between follows them, in place
// of a region changing colour behind the line with nobody near it.
//   events        the turn's events, in the order they will be applied
//   battlefields  the battlefields as the turn began
//   arenaOf       (record) => the ground under a battlefield, or null when it
//                 is not to be had
//   readers       frontWorldReaders
//   nameOf        engineNamer
// Returns orders as planFrontMoments reads them, each resting on its event.
export const statedCaptures = ({ events = [], battlefields = [], arenaOf = () => null, readers = null, nameOf = clean } = {}) => {
  const fought = normalizeBattlefields(battlefields).filter((record) => record.status === "active" && record.field);
  if (fought.length === 0 || !readers) return [];
  const sideOf = (record, name) => {
    const wanted = fold(name);
    return wanted ? record.sides.findIndex((members) => members.some((member) => fold(member) === wanted)) : -1;
  };
  // Who controls a region as the events before this one leave it.
  const moved = new Map();
  const controllerNow = (id) => (moved.has(id) ? moved.get(id) : readers.controllerOf(id));
  const stated = [];
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const transfer of asArray(impacts.regionTransfers)) {
      const regionId = clean(transfer?.regionId);
      if (transfer?.wholeCountry !== true && regionId && clean(transfer?.toCode)) moved.set(regionId, nameOf(transfer.toCode));
    }
    for (const op of asArray(impacts.regionControlOps)) {
      if (op?.by === FRONT_MARK || fold(op?.op) !== "control" || op?.wholeCountry === true) continue;
      const regionId = clean(op?.regionId);
      const to = nameOf(op?.toCode);
      if (!regionId || !to) continue;
      let best = null;
      for (const record of fought) {
        const arena = arenaOf(record);
        const index = arena?.indexOf?.get(regionId);
        if (index === undefined || !(arena.cells[index] > 0)) continue;
        const taker = sideOf(record, to);
        if (taker < 0) continue;
        const group = clean(readers.groupAreas?.[regionId]);
        const holder = group && sideOf(record, group) >= 0 ? group : controllerNow(regionId);
        if (sideOf(record, holder) !== 1 - taker) continue;
        if (!best || arena.cells[index] > best.arena.cells[best.index]) best = { record, arena, index };
      }
      moved.set(regionId, to);
      if (!best) continue;
      // The engine finds a region by its exact name: two of one name on the same
      // ground cannot be told apart, and the change of control alone is told.
      const name = best.arena.names[best.index];
      if (best.arena.names.filter((other) => fold(other) === fold(name)).length !== 1) continue;
      stated.push({
        id: `${STATED_REF}${clean(event?.id)}:${regionId}`,
        battlefield: best.record.name,
        side: to,
        order: "",
        sector: "all",
        eventIds: [clean(event?.id)],
        objective: `region: ${name}`,
        result: "captured",
      });
    }
  }
  return stated;
};

// With the newer mechanics on (Wars and Fronts Pt.2) the ground of a battlefield
// is its troops' to take: "how did these troops take this territory, its like
// its forgetting to update the troop positions" (the owner, 2026-10-15, of a
// region the story handed over far behind the line). A change of control the
// events write for a region on a battlefield, from one of its sides to the
// other (`stated`, statedCaptures), is left out of its event, so that neither
// the engine nor the map is told it: the troops take the region or they do not.
// Returns the events and the regions left out, by name.
export const leaveCapturesToTroops = (events, stated) => {
  const named = new Map(asArray(stated).map((order) => [clean(order?.id).slice(STATED_REF.length), clean(order?.objective).replace(/^region\s*:\s*/i, "")]));
  if (named.size === 0) return { events: asArray(events), left: [] };
  const left = [];
  const next = asArray(events).map((event) => {
    const ops = asArray(event?.impacts?.regionControlOps);
    const kept = ops.filter((op) => {
      const key = `${clean(event?.id)}:${clean(op?.regionId)}`;
      if (op?.by === FRONT_MARK || fold(op?.op) !== "control" || !named.has(key)) return true;
      left.push(named.get(key) || clean(op?.regionName));
      return false;
    });
    return kept.length === ops.length ? event : { ...event, impacts: { ...event.impacts, regionControlOps: kept } };
  });
  return { events: next, left: [...new Set(left.filter(Boolean))] };
};

// A formation fighting on a battlefield is one of its side's troops there, and
// the engine is what moves it. A move an event still writes for one (the model
// remembered it from an earlier turn, a player ordered it by name) is left out,
// or the world would say it stands in one place and its battlefield in another.
// `ignored` names the formations, for the turn's receipt.
export const withoutCommittedMoves = (events, units) => {
  const committed = new Map(asArray(units)
    .filter((unit) => clean(unit?.committedTo) && clean(unit?.id))
    .map((unit) => [clean(unit.id), clean(unit.name)]));
  if (committed.size === 0) return { events: asArray(events), ignored: [] };
  const ignored = [];
  const next = asArray(events).map((event) => {
    const ops = asArray(event?.impacts?.unitOps);
    const kept = ops.filter((op) => {
      if (fold(op?.op) !== "move" || !committed.has(clean(op?.unitId))) return true;
      ignored.push(committed.get(clean(op.unitId)));
      return false;
    });
    return kept.length === ops.length ? event : { ...event, impacts: { ...event.impacts, unitOps: kept } };
  });
  return { events: next, ignored: [...new Set(ignored.filter(Boolean))] };
};

// (regionRef) => whether a region, named by its id or by its exact name, lies
// on an open battlefield: one of that battlefield's sides holds it, and its
// middle is on the battlefield's frame. Who holds such a region is the engine's
// to work out, so the territory Director's own marks on it are left out
// (nativeTerritoryDirector.js). By the frame and not by the ground, because the
// Director is checked before any shape of the map is read; a region the frame's
// edge cuts is judged by where its middle falls. null when no battlefield is
// open, or none has a region.
//   rows      the map's regions: { id, name, lng, lat } (the middle of each), or
//             `bounds` [[west, south], [east, north]] where it has no middle
//   readers   frontWorldReaders
export const battlefieldRegionTest = ({ battlefields = [], rows = [], readers = null } = {}) => {
  const open = normalizeBattlefields(battlefields).filter((record) => record.status !== "closed");
  if (open.length === 0 || !readers) return null;
  const middle = (own, box, axis) => {
    if (own !== null && own !== undefined && own !== "" && Number.isFinite(Number(own))) return Number(own);
    return Array.isArray(box) ? (Number(box[0]?.[axis]) + Number(box[1]?.[axis])) / 2 : NaN;
  };
  const ids = new Set();
  const names = new Set();
  for (const row of asArray(rows)) {
    const id = String(row?.id ?? "").trim();
    const lng = middle(row?.lng, row?.bounds, 0);
    const lat = middle(row?.lat, row?.bounds, 1);
    if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const holders = [readers.groupAreas?.[id], readers.controllerOf(id)].map(fold).filter(Boolean);
    const onOne = open.some((record) => pointInFrame(record.frame, lng, lat)
      && record.sides.some((members) => members.some((member) => holders.includes(fold(member)))));
    if (!onOne) continue;
    ids.add(id);
    if (clean(row.name) && clean(row.name) !== id) names.add(fold(row.name));
  }
  if (ids.size === 0) return null;
  return (regionRef) => {
    const text = clean(regionRef);
    return ids.has(text) || names.has(fold(text.replace(/^region\s*:\s*/i, "")));
  };
};

// ---- the run -----------------------------------------------------------------------

// Runs the engine over the turn. First with only the arenas it has kept from
// earlier turns: reading the map's regions is a fetch and a parse of tens of
// megabytes, and a war that is already being fought needs none of it. When the
// engine answers that it needs the regions (a battlefield has to open, a frame
// has to grow), they are loaded and the run starts again from the beginning.
//   createFrontRun  runtime/fronts/engine.js
//   input           everything but map.regions
//   loadRegions     async () => the map's regions, or null when they cannot be read
//   pause           async () => {} between chunks of days, so a long war does
//                   not hold the page; and, where a staff thinks in steps
//                   (runtime/fronts/mind/planner.js), whenever ENGINE_SLICE_MS
//                   have gone by between them
// null when the regions were needed and could not be had: the turn then goes on
// without the engine, and the battlefields stay as they were.
// How long the engine works on before the page is let draw. The staff that looks ahead thinks for seconds at a time,
// and the page stood still while it did: "its SOO LAGGY while in war" (the owner, 2026-10-15).
export const ENGINE_SLICE_MS = 16;
const clock = () => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());
// Up to `days` more days of a run: a run that gives its days as steps is taken a step at a time and the page let draw
// (pause) whenever ENGINE_SLICE_MS have gone by. True once the run is finished. A step that is something to wait for
// ({ wait }: a staff's plans being fought on other cores, runtime/fronts/mind/rehearsers.js) is waited for, and what
// it came to handed back to the run.
const advanceIn = async (run, days, pause) => {
  if (typeof run.steps !== "function" || typeof pause !== "function") return run.advance(days);
  let since = clock();
  const steps = run.steps(days);
  let reply;
  for (let step = steps.next(); !step.done; step = steps.next(reply)) {
    reply = undefined;
    if (typeof step.value?.wait === "function") {
      try {
        reply = await step.value.wait();
      } catch {
        reply = undefined;
      }
      continue;
    }
    if (clock() - since < ENGINE_SLICE_MS) continue;
    await pause();
    since = clock();
  }
  return run.finished();
};

export const runFrontTurn = async ({ createFrontRun, input, loadRegions = null, pause = null, chunkDays = 15 } = {}) => {
  if (typeof createFrontRun !== "function") return null;
  let regions = input?.map?.regions ?? null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = createFrontRun({ ...input, map: { ...input?.map, regions } });
    while (!(await advanceIn(run, chunkDays, pause))) {
      if (typeof pause === "function") await pause();
    }
    const result = run.finish();
    if (!result?.needsRegions) return result ?? null;
    if (regions || typeof loadRegions !== "function") return null;
    regions = await loadRegions();
    if (!Array.isArray(regions) || regions.length === 0) return null;
  }
  return null;
};

// ---- after ---------------------------------------------------------------------------

// Each change of hands on the first event of its day or later, as the ordinary
// operation every reader of the map already understands. An event told to some
// governments only is passed over (a change everyone can see on the map does
// not ride on a secret), and a change later than every event goes on the last.
// A turn whose every event is such a secret still has the map to change: its
// last event carries them all. `unattached` is what there was no event at all
// to carry. With `aboutOf(event, battlefield)` (whether an event tells of the
// war on that battlefield), a change rides on such an event where there is
// one: the first of its day or later, else the last before it. The map then
// moves with the report of the fighting, not with whatever came next.
export const attachFrontFlips = (events, flips, { dayOf = () => 0, aboutOf = null } = {}) => {
  const list = asArray(events);
  const dated = list.map((event, index) => ({ index, day: dayOf(event), open: asArray(event?.audience).length === 0 && !clean(event?.audience) }));
  const carriers = (dated.some((entry) => entry.open) ? dated.filter((entry) => entry.open) : dated.slice(-1))
    .sort((a, b) => a.day - b.day || a.index - b.index);
  const added = new Map();
  const unattached = [];
  for (const flip of asArray(flips)) {
    const regionId = clean(flip?.regionId);
    if (!regionId) continue;
    const day = Number(flip?.day) || 0;
    const own = typeof aboutOf === "function" ? carriers.filter((entry) => aboutOf(list[entry.index], clean(flip?.battlefield))) : [];
    const carrier = own.find((entry) => entry.day >= day) ?? own[own.length - 1] ?? carriers.find((entry) => entry.day >= day) ?? carriers[carriers.length - 1];
    if (!carrier) {
      unattached.push(flip);
      continue;
    }
    if (!added.has(carrier.index)) added.set(carrier.index, { regionControlOps: [], groupOps: [] });
    const ops = added.get(carrier.index);
    const note = clean(flip?.battlefield);
    if (flip?.kind === "groupTake" || flip?.kind === "groupRelease") {
      const name = clean(flip.kind === "groupTake" ? flip.to : flip.from);
      // A country's force taking ground from a group on a third country's land (runtime/fronts/day.js
      // settleRegions) is founded by its first take as that country's, and told what it is.
      const owner = flip.kind === "groupTake" ? clean(flip.owner) : "";
      const force = owner ? { owner, description: forceGroupDescription(owner, flip.land, flip.from) } : {};
      if (name) ops.groupOps.push({ op: flip.kind === "groupTake" ? "take" : "release", name, regionIds: [regionId], note, by: FRONT_MARK, ...force });
    } else if (clean(flip?.from) && clean(flip?.to)) {
      ops.regionControlOps.push({ op: "control", regionId, fromCode: clean(flip.from), toCode: clean(flip.to), basis: "occupation", note, by: FRONT_MARK });
    }
  }
  const next = list.map((event, index) => {
    const ops = added.get(index);
    if (!ops) return event;
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    return {
      ...event,
      impacts: {
        ...impacts,
        ...(ops.regionControlOps.length ? { regionControlOps: [...asArray(impacts.regionControlOps), ...ops.regionControlOps] } : {}),
        ...(ops.groupOps.length ? { groupOps: [...asArray(impacts.groupOps), ...ops.groupOps] } : {}),
      },
    };
  });
  return { events: next, unattached };
};

// The world's formations after the run: one taken onto a battlefield carries its
// name, one that came back stands where its troop stood with what is left of
// it, and one that was destroyed there is gone.
export const applyFrontUnitChanges = (units, changes) => {
  const byId = new Map(asArray(changes).filter(isRecord).map((change) => [clean(change.unitId), change]));
  if (byId.size === 0) return asArray(units);
  const next = [];
  for (const unit of asArray(units)) {
    const change = byId.get(clean(unit?.id));
    if (!change) {
      next.push(unit);
      continue;
    }
    if (change.remove === true) continue;
    const { committedTo: _was, ...rest } = unit;
    // (A place the change does not have is none: Number(null) is 0, and a unit put at lng 0, lat 0 is taken off the map.)
    const coordinate = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN);
    const lng = coordinate(change.lng);
    const lat = coordinate(change.lat);
    const placed = Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
    const strength = Number(change.strength);
    next.push({
      ...rest,
      ...(placed ? { lng, lat } : {}),
      ...(Number.isFinite(strength) ? { strength: Math.max(1, Math.min(100, Math.round(strength))) } : {}),
      // (A fleet that broke off a battle at sea is withdrawing: runtime/naval/engine.js.)
      ...(clean(change.posture) ? { posture: clean(change.posture) } : {}),
      ...(clean(change.committedTo) ? { committedTo: clean(change.committedTo) } : {}),
    });
  }
  return next;
};

// What the engine could not do as it was told, in the words the simulator
// reads at the top of its next turn. One line a kind, the cases counted.
const named = (notes, field) => [...new Set(notes.map((note) => clean(note?.[field])).filter(Boolean))];
const quoted = (notes, field) => named(notes, field).slice(0, 4).join("; ") || "unnamed";
const one = (notes, field) => named(notes, field).length <= 1;
const NOTE_TEXT = {
  "unknown-battlefield": (notes) => `Front orders named ${one(notes, "battlefield") ? "a battlefield that does" : "battlefields that do"} not exist (${quoted(notes, "battlefield")}). Use the names listed under [Fronts]; a battlefield opens by itself where two sides at war hold touching land. To have a country attack one it is at peace with, name their border (\`border: A / B\`) or give the order an objective the other holds.`,
  // A country's forces at home (runtime/fronts/home.js).
  "home-not-found": (notes) => `Forces were not built up at home (${quoted(notes, "side")}): that country holds no land on the map with another country's near it.`,
  "called-today": (notes) => `Forces at home were called up once already that day (${quoted(notes, "side")}): a country calls up its forces at home once a day.`,
  "home-no-front": (notes) => `An order to forces at home was not carried out (${quoted(notes, "side")}): they have no front to go forward from. Station them on a border (hold or dig in, objective country: X); a war begins with an attack across a border.`,
  "side-not-fighting": (notes) => `Front orders were given for ${quoted(notes, "side")}, which ${one(notes, "side") ? "is" : "are"} not fighting on the battlefield named. Only a side of that battlefield's war takes orders there.`,
  "sector-read-as-all": (notes) => `A sector that does not fit its line was read as the whole line (${quoted(notes, "detail")}). The sectors each line has are listed under [Fronts].`,
  "objective-not-found": (notes) => `An objective was not found on its battlefield and was left out (${quoted(notes, "detail")}). Name a city or a region that lies on that battlefield.`,
  "objective-unreachable": (notes) => `A capture was stated that the side's troops had no way to reach, and the place was not taken (${quoted(notes, "detail")}). A side takes only what its troops on that battlefield can get to.`,
  "landing-refused": (notes) => {
    const places = named(notes, "detail").filter((detail) => detail !== "no-reserves").slice(0, 4).join("; ");
    return `A landing was not made${places ? ` (${places})` : ""}: it needs a place the other side holds, and reserves left to put ashore.`;
  },
  "no-pocket-there": (notes) => `A surrender was stated where no troops are cut off (${quoted(notes, "detail")}). Only a whole side, or the troops of a pocket, can be made to surrender.`,
  // The war it was for is not named: a war has a title only sometimes, and never an id a model is shown.
  "minor-attack": (notes) => `An attack across a border at peace opened no war and no battlefield (${quoted(notes, "side")}): it was given no effort, or token or limited, and no war between the two was opened in warUpdates. A border clash, a raid or an incident is told with the formations that fought it (unitOps), as before. A real invasion is ordered at effort major or total, or with its war opened in warUpdates.`,
  "posture-stands": (notes) => `An order to attack was not carried out (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): that side's posture there (${quoted(notes, "detail")}) is what the scenario's author made the front, and it stands until an event changes it. Give the order the number of the event in which the side goes over to the attack.`,
  "reinforce-needs-event": (notes) => `More troops were not brought to a front (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): a country nobody plays mobilises or sends reinforcements in an event of the answer, and the line carries that event's number.`,
  "reinforce-halted": (notes) => `More troops were not brought to a front (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): the fighting there is halted.`,
  "reinforce-no-men": (notes) => `More troops were not brought to a front (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): that country has no more men fit to serve; all it can raise are under arms already.`,
  "reinforce-full": (notes) => `More troops were not brought to a front (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): that side has all the troops its strength and its line can carry there.`,
  "reinforce-no-ground": (notes) => `More troops were not brought to a front (${quoted(notes, "side")} on ${quoted(notes, "battlefield")}): that side holds no ground there to bring them to.`,
  "too-many-battlefields": () => "No more battlefields can be open at once, so a front that should have opened did not. It opens when another closes.",
  tempo: () => "The fronts stopped moving for the rest of the period: this scenario's ceiling on how fast the map may change was reached.",
  "transport-refused": (notes) => `${one(notes, "detail") ? "A transporter was" : "Transporters were"} not sent (${quoted(notes, "detail")}). One is sent to a place on the map that its kind can reach (a ship to a coast, rail through land its side holds): by a side at war, or in peace to another country's land, which is an attack on it.`,
  "capture-failed": (notes) => notes.slice(0, 4).map((note) => `${clean(note?.taker)} could not take ${clean(note?.region) || "a region"}: too few of its troops near`).join("; ")
    + ". A region is taken only where enough of the taker's troops stand near it, more for a larger region: move them up first, in an earlier event.",
  closed: (notes) => `${one(notes, "battlefield") ? "A battlefield" : "Battlefields"} closed (${quoted(notes, "battlefield")}): the fighting there is over. Land a side still holds there that is not its own stays occupied until an event settles it.`,
};

// Why a transporter did not set out, in words.
const TRANSPORT_REFUSALS = {
  "no-war": "its sender is fighting no war and it was not bound for another country's land",
  "no-place": "the place it was sent to is not on the map",
  "no-origin": "its sender has no city to send it from",
  "no-coast": "no sea is near where it would set out",
  "no-shore": "no shore is near where it was sent",
  "no-sea-way": "no sea leads there",
  "no-ground": "it has no land of its own side's to start on",
  "no-troops": "the troops it was to take are gone",
  "too-far": "no way there was found",
  "off-map": "the place is off the map",
  "not-yet": "nothing of that kind exists yet",
  "too-many": "too many transporters are out already",
  "nothing-aboard": "it was given nothing to carry",
  "no-navy": "its sender has no navy to carry it by sea",
  "no-air-force": "its sender has no air arm to carry it by air",
  incomplete: "its order is incomplete",
};
export const transportRefusal = (code) => TRANSPORT_REFUSALS[clean(code)] ?? "it could not set out";

export const describeFrontNotes = (notes) => {
  const byKind = new Map();
  for (const note of asArray(notes)) {
    const kind = clean(note?.kind);
    if (!NOTE_TEXT[kind]) continue;
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(note);
  }
  return [...byKind.entries()].map(([kind, list]) => ({
    kind: kind === "tempo" || kind === "closed" ? "adjusted" : "dropped",
    text: NOTE_TEXT[kind](list),
  }));
};

// ---- a turn, start to finish ---------------------------------------------------------

const isOpen = (record) => record?.status !== "closed";
const listed = (names, most = 3) => `${names.slice(0, most).join("; ")}${names.length > most ? `; and ${names.length - most} more` : ""}`;

// A turn's land war: everything above, in the order a turn needs it.
//   createFrontRun   runtime/fronts/engine.js
//   world            the world as the turn began
//   events           the turn's events, as they are about to be applied
//   frontOrders      the orders that survived with them (nativeFrontLedger.js)
//   warStages        the wars as the turn began, then as each record of the
//                    turn's war ledger leaves them (planFrontMoments)
//   fromDate, toDate, requestedDays   the days the turn covers (frontRunSpan)
//   map              { key, cities, flat, scale, structures }: all of the map
//                    the engine is told but its shapes
//   regionTypes      world.regionTypes
//   baseOwners, groups   frontWorldReaders
//   arenas           the Map the caller keeps the engine's arenas in
//   readMap          async () => { map, baseOwners, regionIds, arenas }, for a
//                    caller that has to read them: asked only once it is known
//                    there is a war, a battlefield or an order to run
//   loadRegions      async () => the map's regions as engineRegionsOf gives
//                    them, or null when they cannot be read. Called at most once.
//   pause            async () => {} between chunks of days
//   pace             the scenario's pace for an advance, as a factor
//   tempoAllowance   (days) => the regions a scenario lets the map move in a
//                    span of that many days, or null for no ceiling
//   seed             what makes this turn's run its own
//   players          the countries and groups people play
//   difficulty       the game's difficulty, by its id: above Medium the side
//                    fighting a person's country has an edge in the land war,
//                    below it that side is held back (runtime/fronts/handicap.js)
//   narratesCombat   (event) => whether an event tells of fighting
//   foretold         true when the period was fought BEFORE the story was asked
//                    for and the story was given its account (frontApply.js
//                    forecastTurnFronts): the same run, then, with the answer's
//                    orders for the battlefields that were being fought put at
//                    its end, for the next period to carry out
// Returns
//   events           the turn's events: an earlier apply's changes of hands
//                    taken out, moves of formations that are on a battlefield
//                    left out, this run's changes of hands put on
//   battlefields     world.battlefields as the run leaves it; null to leave it
//                    as it is (nothing to run on, or the map could not be read)
//   unitChanges      for applyFrontUnitChanges
//   notes            [{ kind, text }] for the turn's receipt
//   flips, stats     what the engine reported, for the log
//   news             what the days of the run added to the battlefields' logs
//   joins            the countries troops were sent into, each now in its war:
//                    [{ day, date, battlefield, warId, name, side, by }], for
//                    the war ledger (frontApply.js frontWarJoins)
//   starts           the wars that began because one country sent its troops
//                    at another it was at peace with:
//                    [{ day, date, warId, attacker, defender }], for the war
//                    ledger too (frontApply.js frontWarStarts)
//   transports       world.transports as the run leaves it, with what the
//                    answer ordered added (those set out when the next period
//                    begins); null to leave it as it is
//   voyages          what became of each transporter during the run
//   strikes          the missiles and bombing runs the answer wrote, with the
//                    places of each found where the turn can find them
//                    (runtime/strikes.js): for the map to play
//   airStrikes       the war room's air strikes as they were flown, as the period
//                    began (runtime/fronts/airStrike.js): [] when none waited or the
//                    scenario has no air units, null when the run was not made
// The same arguments give the same result: a turn applied twice is one turn.
export const runTurnFronts = async ({
  createFrontRun,
  world = {},
  events = [],
  frontOrders = [],
  warStages = null,
  fromDate = "",
  toDate = "",
  requestedDays = 0,
  map: givenMap = {},
  regionTypes = [],
  baseOwners: givenOwners = null,
  groups = true,
  arenas: givenArenas = null,
  readMap = null,
  loadRegions = null,
  pause = null,
  pace = 1,
  tempoAllowance = null,
  seed = "",
  players = [],
  // false leaves every side nobody plays to the orders it is given (runtime/fronts/staff.js decides for it otherwise).
  staff = true,
  // EXPERIMENT, in the lab (runtime/fronts/mind/policy.js): a staff of the caller's own, asked before the engine's.
  staffPolicy = null,
  // The cores such a staff's plans may be fought on together (runtime/fronts/mind/rehearsers.js), where the caller has them.
  rehearsers = null,
  // How many troops are raised, of the usual: a factor, 1 unless a run says (runtime/fronts/troops.js troopsFactor).
  troops = 1,
  // false charges no country's people for the troops raised (runtime/fronts/manpower.js).
  manpower = true,
  // false leaves the fleets alone: the war at sea is not fought (runtime/naval/engine.js).
  naval = true,
  // false: the scenario has no air units (the Wars feature): nothing is airlifted, and no aircraft is drawn striking.
  air = true,
  // The most formations a country and the world may have, for a fleet the war at sea commissions.
  unitCaps = null,
  // The era the scenario set, 0 to 3, or null to read it off the date (runtime/warSettings.js).
  era = null,
  // Which of the engine's newer mechanics the scenario has on (runtime/warSettings.js; runtime/fronts/mechanics.js).
  mechanics = null,
  // How its wars' troops stand where nobody deploys them otherwise: "front", or "swarm" (runtime/fronts/swarms.js).
  warfare = "",
  // The men a counter stands for and the share of people who can fight, where the scenario set them (runtime/fronts/manpower.js).
  menEach = null,
  manpowerShare = null,
  // When the game began: a war that began after it musters its levies (runtime/fronts/muster.js).
  gameBegan = "",
  // The campaign's own seed for its weather (runtime/fronts/weather.js): the same whatever the turn.
  climateSeed = "",
  difficulty = "",
  narratesCombat = null,
  // The fronts a scenario begins with (runtime/fronts/scenarioFronts.js), on
  // the one run that builds them: what they are called and how many troops
  // each side has. No other run is given any.
  authored = null,
  foretold = false,
  // The game's own reader of places, for a strike (gameplay.js
  // createStrikePlaceReader): { find(text), origin({ owner, weapon, to }), seat(owner) },
  // each async and each answering null for what it cannot say.
  strikePlaces = null,
} = {}) => {
  const cleared = withoutCommittedMoves(stripFrontOps(events), world?.units);
  let list = cleared.events;
  const notes = [];
  if (cleared.ignored.length) {
    notes.push({
      kind: "dropped",
      text: `Unit operations moved ${cleared.ignored.length === 1 ? "a formation that is" : "formations that are"} fighting on a battlefield (${listed(cleared.ignored)}); the moves were left out. `
        + "Troops on a battlefield are moved by front orders, under [Fronts].",
    });
  }
  let strikes = [];
  const nothing = (battlefields) => ({ events: list, battlefields, unitChanges: [], notes, flips: [], stats: null, news: [], joins: [], starts: [], transports: null, voyages: [], strikes, airStrikes: null });

  const saved = normalizeBattlefields(world?.battlefields);
  const stages = asArray(warStages).length ? asArray(warStages).map(asArray) : [asArray(world?.wars)];
  const written = asArray(frontOrders).filter((order) => isRecord(order) && !order.problem);
  // A line that sends a transporter is not an order for a battlefield: it is
  // set apart here and becomes a transporter of the world, below.
  // And a strike is no order at all: it is something to show (runtime/strikes.js).
  // (With no air units in the scenario no aircraft strikes, and with none of air or sea nothing is carried by it.)
  const struck = written.filter((order) => order.order === "strike" && (air !== false || !fliesAsAircraft(order.weapon))).slice(0, STRIKES_PER_TURN_MOST);
  const orders = written.filter((order) => order.order !== "strike" && !Object.hasOwn(TRANSPORT_ORDERS, order.order));
  const carriedBy = (order) => TRANSPORT_ORDERS[order.order];
  const dispatches = written.filter((order) => Object.hasOwn(TRANSPORT_ORDERS, order.order)
    && !(naval === false && carriedBy(order) === "sea") && !(air === false && carriedBy(order) === "air"));
  const atWar = stages.some((wars) => wars.some((war) => clean(war?.status) !== "ended"));
  const committed = asArray(world?.units).some((unit) => clean(unit?.committedTo));
  // No battlefield, no war, no order and nothing at sea: there is nothing for
  // the engine to do. (A transporter may be under way in peace: sent at a
  // country its owner is not at war with, it begins the war where it lands.)
  // A battlefield that closed last turn has had its one more turn on the map.
  const sailing = asArray(world?.transports).some(isUnderWay);
  if (!saved.some(isOpen) && !atWar && written.length === 0 && !committed && !sailing) return nothing(saved.length ? [] : null);

  const read = typeof readMap === "function" ? await readMap() : null;
  const map = read?.map ?? givenMap;
  const baseOwners = read?.baseOwners ?? givenOwners;
  const arenas = read?.arenas ?? givenArenas;
  const { days, dayOf } = frontRunSpan({ fromDate, toDate, requestedDays, events: list });
  const readers = frontWorldReaders(world, { baseOwners, groups });
  // The strikes the answer wrote, each with its places where they can be
  // found: among the places of the event that tells of it, the map's cities,
  // the world's structures and its formations, and then as the game finds any
  // place a model names (a city by another of its names, a country, a region).
  // One launched from nowhere that is named sets off from what its owner has
  // on the map for it, and failing that from a city of its own.
  const lookedFor = async (ask) => {
    try {
      return (await ask()) ?? null;
    } catch (error) {
      console.warn("[fronts] a strike's place could not be looked for; the map finds it by name when it plays the strike.", error);
      return null;
    }
  };
  if (struck.length > 0) strikes.push(...await placeStrikes(struck, { events: list, cities: asArray(map?.cities), world, strikePlaces, fromDate, toDate }));
  // The air strikes the war room ordered (runtime/fronts/airStrike.js), flown as the period begins: who rose
  // against each and the air battle fought here, and their bombs on the battlefields in the engine's run below.
  // The same in the run made before the story and the one that applies it. (None in a scenario without air units.)
  const sorties = air !== false
    ? resolveAirStrikes({
      orders: world?.airStrikeOrders,
      // (And the air arms of the fronts some of them were ordered for: airStrikeOps.js airArmsOf.)
      units: [...asArray(world?.units), ...airArmsForOrders(world)],
      wars: stages[0],
      seed,
      era: eraOf(fromDate, Number.isInteger(era) ? era : null),
      measure: measureOptions(map),
      militaryOf: mechanics?.military === true ? readers.militaryOf : null,
      markers: asArray(world?.markers),
      peopleOf: readers.peopleOf,
      date: fromDate,
    })
    : { strikes: [], moments: [], unitChanges: [] };
  // The formations as the strikes leave them: those that flew or rose are worn, and the land war begins with them so.
  const flown = applyFrontUnitChanges(asArray(world?.units), sorties.unitChanges);

  const nameOf = engineNamer(turnRenames(list), [
    ...stages[0].flatMap((war) => [...asArray(war?.sideA), ...asArray(war?.sideB)]),
    ...saved.flatMap((record) => record.sides.flat()),
    ...Object.keys(isRecord(world?.polityOverrides) ? world.polityOverrides : {}),
    ...Object.keys(groups && isRecord(world?.groups) ? world.groups : {}),
  ]);

  // The groups the turn's events found or give ground to are groups to the engine too: a group the world did not
  // have as the turn began, fighting in it, took what it captured as a COUNTRY does, by a control operation to its
  // name, which founded a landless country of that name owning the ground beside the group holding it.
  // Only a create founds one, and a take naming a group nobody has (applyGroupOps creates it): a stray take or
  // update naming a COUNTRY made it a group to the engine, and its captures that turn were recorded as a group's area.
  const countries = new Set([
    ...Object.entries(isRecord(world?.polityOverrides) ? world.polityOverrides : {}).flatMap(([key, record]) => [key, record?.name]),
    ...(baseOwners instanceof Map ? baseOwners.values() : []),
    ...Object.values(isRecord(world?.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {}),
    ...Object.values(isRecord(world?.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {}),
  ].map(clean).filter(Boolean).map((name) => fold(nameOf(name))));
  const foundedGroups = new Set(groups ? list.flatMap((event) => asArray(event?.impacts?.groupOps))
    .filter((op) => op?.by !== FRONT_MARK).map(normalizeGroupOp)
    .filter((op) => op && (op.op === "create" || (op.op === "take" && !countries.has(fold(nameOf(op.name))))))
    .map((op) => fold(nameOf(op.name))) : []);

  // The map's shapes, read once and only if something needs them.
  let regions = null;
  let asked = false;
  const readRegions = async () => {
    if (!asked) {
      asked = true;
      const loaded = typeof loadRegions === "function" ? await loadRegions() : null;
      regions = Array.isArray(loaded) && loaded.length ? loaded : null;
    }
    return regions;
  };

  // A submarine's missile that no fleet on the map fires is fired from the sea
  // all the same: from open water within reach of what it is fired at, found
  // on the map's own sheet of land and sea (the one the transporters sail on).
  const adrift = strikes.filter((strike) => strike.weapon === "submarine missile" && !Number.isFinite(strike.from?.lng) && Number.isFinite(strike.to?.lng));
  if (adrift.length > 0) {
    try {
      const water = waterTypeIds(regionTypes);
      const key = worldSheetKey(clean(map?.key), water);
      let sheet = clean(map?.key) && arenas ? arenas.get(key) ?? null : null;
      if (!sheet) {
        const shapes = await readRegions();
        sheet = shapes ? buildWorldGrid(shapes, { ...measureOptions(map), water }) : null;
        if (sheet && clean(map?.key) && arenas) arenas.set(key, sheet);
      }
      for (const strike of adrift) {
        // (Nearest a place of its owner's: something it has on the map, else its capital.)
        const own = [...asArray(world?.markers), ...asArray(world?.units)].find((entry) => fold(entry?.ownerCode) === fold(strike.owner) && Number.isFinite(Number(entry?.lng)) && Number.isFinite(Number(entry?.lat)))
          ?? (typeof strikePlaces?.seat === "function" ? await lookedFor(() => strikePlaces.seat(strike.owner)) : null);
        const at = sheet ? seaLaunchPlace(sheet, { to: strike.to, near: own ? { lng: Number(own.lng), lat: Number(own.lat) } : null, seasOf, distanceTo }) : null;
        if (at) strike.from = { name: clean(strike.from?.name), ...at };
      }
    } catch (error) {
      console.warn("[fronts] no place at sea could be found for a submarine's missile; the map draws it from its owner's country.", error);
    }
  }

  // What the events themselves state of the battlefields being fought over.
  // It needs the ground under each: kept from an earlier turn, or drawn now
  // from the shapes, which the engine would then have asked for anyway.
  const fought = saved.filter((record) => record.status === "active" && record.field);
  const writesControl = list.some((event) => asArray(event?.impacts?.regionControlOps)
    .some((op) => op?.by !== FRONT_MARK && fold(op?.op) === "control" && op?.wholeCountry !== true));
  let stated = [];
  if (fought.length && writesControl) {
    const drawn = new Map();
    const arenaOf = (record) => {
      if (!drawn.get(record)) drawn.set(record, arenaFor(arenas, { ...map, regions }, record.frame, regionTypes));
      return drawn.get(record);
    };
    if (fought.some((record) => !arenaOf(record))) await readRegions();
    stated = statedCaptures({ events: list, battlefields: fought, arenaOf, readers, nameOf });
  }
  // With the newer mechanics on, what the events state of a battlefield's ground is left to its troops.
  if (stated.length && anyMechanic(mechanics)) {
    const kept = leaveCapturesToTroops(list, stated);
    list = kept.events;
    stated = [];
    if (kept.left.length) {
      notes.push({
        kind: "dropped",
        text: `Region control written for ground a battlefield is being fought over (${listed(kept.left)}) was left out: on a battlefield the troops take ground or they do not. `
          + "Give a front order under [Fronts] to send them at it.",
      });
    }
  }

  // An order that aims its side's troops at a place, on a battlefield nobody
  // has, is an attack on whoever holds the place (engine.js attackAtObjective).
  // The engine knows a city only as the map spells it, so where the map has no
  // city of that name the game's own reader of places is asked where it is.
  const open = new Set(saved.filter(isOpen).map((record) => foldBattlefieldName(record.name)));
  const aimed = [];
  for (const order of orders) {
    const lost = clean(order.objective) && ATTACKING.includes(order.order) && !/^border\s*:/i.test(clean(order.battlefield)) && !open.has(foldBattlefieldName(order.battlefield))
      && !/^(region|country|group)\s*:/i.test(clean(order.objective)) && !findStrikePlace(order.objective, { cities: asArray(map?.cities) });
    const at = lost && typeof strikePlaces?.find === "function" ? await lookedFor(() => strikePlaces.find(order.objective)) : null;
    aimed.push(at ? { ...order, objectiveAt: at } : order);
  }

  // The battlefields whose period the story was told before it was written.
  const settled = foretold ? new Set(saved.filter((record) => record.status === "active").map((record) => foldBattlefieldName(record.name))) : null;
  const moments = [...sorties.moments, ...planFrontMoments({ events: list, frontOrders: [...aimed, ...stated], warStages: stages, fromDate, days, dayOf, settled })
    .map((moment) => {
      if (moment.type === "order") return { ...moment, side: nameOf(withoutKind(moment.side)) };
      if (moment.type === "control") return { ...moment, to: nameOf(moment.to) };
      if (moment.type === "group") return { ...moment, group: moment.group ? nameOf(moment.group) : "", ...(moment.from ? { from: nameOf(moment.from) } : {}) };
      if (moment.type === "war") return { ...moment, names: asArray(moment.names).map(nameOf), ...(moment.opponents ? { opponents: asArray(moment.opponents).map(nameOf) } : {}) };
      return moment;
    })];

  const allowance = typeof tempoAllowance === "function" ? tempoAllowance(days) : tempoAllowance;
  // The countries under blockade as the period begins, and how short each is for it.
  const short = new Map(naval === false ? [] : normalizeBlockades(world?.blockades).map((record) => [fold(record.country), shortageOfBlockade(record)]).filter(([, lacks]) => lacks > 0));
  // And a country weary of its war keeps its armies up no better than one cut off (runtime/warWeariness.js): the two together.
  // One the game holds no weariness for yet goes to war as weary as its military figures say, where the scenario weighs them.
  for (const entry of wearinessGoingIn(world?.warWeariness, { wars: stages.flat(), startOf: mechanics?.military === true ? (name) => readers.militaryOf(name)?.weariness ?? null : null })) {
    const weary = wearyShortage(entry.value);
    if (weary > 0) short.set(fold(entry.country), shortagesTogether(short.get(fold(entry.country)) ?? 0, weary));
  }
  // And one that has spent its war resources advancing and building (runtime/warResources.js): all of them together.
  if (mechanics?.supply === true) {
    for (const entry of normalizeWarResources(world?.warResources)) {
      const lacks = resourceShortage(entry.value);
      if (lacks > 0) short.set(fold(entry.country), shortagesTogether(short.get(fold(entry.country)) ?? 0, lacks));
    }
  }
  // The water a scenario lets freeze that is frozen this turn (runtime/fronts/climate.js): read from the map's
  // shapes, only where it has any such water and seasons.
  const frozen = mechanics?.weather === true && normalizeFreezingRegions(world?.freezingRegions).length > 0
    ? frozenFor({ world, regions: await readRegions(), fromDate, days })
    : [];
  const result = await runFrontTurn({
    createFrontRun,
    input: {
      battlefields: saved,
      fromDate,
      toDate,
      days,
      moments,
      wars: stages[0],
      controllerOf: readers.controllerOf,
      sovereignOf: readers.sovereignOf,
      groupAreas: readers.groupAreas,
      isGroup: (name) => readers.isGroup(name) || foundedGroups.has(fold(name)),
      groupOwnerOf: readers.groupOwnerOf,
      units: flown,
      transports: normalizeTransports(world?.transports),
      // (With the ground the scenario made harder to cross, where it weighs terrain: runtime/fronts/arena.js;
      // and the water frozen this turn, where it has seasons and weather: runtime/fronts/climate.js.)
      map: { ...map, regions, ...(mechanics?.terrain === true && terrainOf(world) ? { terrain: terrainOf(world) } : {}), ...(frozen.length > 0 ? { frozen: frozen.map((entry) => entry.id) } : {}) },
      regionTypes: asArray(regionTypes),
      strengthOf: readers.strengthOf,
      peopleOf: readers.peopleOf,
      // (A run may be told to charge nobody for the troops it raises.)
      ...(manpower === false ? { manpower: false } : {}),
      // Who is played by a person: on a side of several countries nobody's order stands in for theirs.
      players: asArray(players).map(clean).filter(Boolean),
      difficulty: clean(difficulty),
      ...(Number.isInteger(era) ? { era } : {}),
      ...(mechanics && typeof mechanics === "object" ? { mechanics } : {}),
      ...(warfare === "swarm" ? { warfare } : {}),
      // A country with no aircraft on the map flies its air arm over its battlefields (runtime/fronts/air.js).
      ...(mechanics?.air === true ? { airArms: true } : {}),
      // Each country's own military figures, where the scenario weighs them (runtime/fronts/military.js).
      ...(mechanics?.military === true ? { militaryOf: readers.militaryOf } : {}),
      ...(Number(menEach) >= 1 ? { menEach: Number(menEach) } : {}),
      // A scenario's own climate zones, where it has seasons and weather (runtime/fronts/climate.js).
      // (Its own, or on the built-in basemaps the real world's: runtime/worldGeographyDefaults.js.)
      ...(mechanics?.weather === true && climateZonesOf(world).length > 0 ? { climateZones: normalizeClimateZones(climateZonesOf(world)) } : {}),
      // The walls the scenario drew and the War Room built, where it has them (runtime/fronts/walls.js).
      ...(mechanics?.walls === true && normalizeFortifications(world?.fortifications).length > 0 ? { fortifications: normalizeFortifications(world?.fortifications) } : {}),
      // The seasons and weather, where the scenario has them (runtime/fronts/weather.js).
      ...(mechanics?.weather === true && clean(climateSeed) ? { climateSeed: clean(climateSeed) } : {}),
      // Each country's mustering curve, where the scenario musters wars (runtime/fronts/muster.js).
      ...(mechanics?.muster === true && clean(gameBegan) ? { musterOf: readers.musterOf, gameBegan: clean(gameBegan) } : {}),
      ...(Number(manpowerShare) > 0 ? { manpowerShare: Number(manpowerShare) } : {}),
      // How short each country is of what comes by sea, by the blockades standing as the period begins
      // (runtime/naval/blockade.js): the side it fights on is weighed for it (runtime/fronts/handicap.js).
      ...(short.size > 0 ? { shortageOf: (name) => short.get(fold(name)) ?? 0 } : {}),
      ...(staff === false ? { staff: false } : {}),
      ...(typeof staffPolicy === "function" ? { staffPolicy, ...(rehearsers ? { rehearsers } : {}) } : {}),
      ...(Number(troops) > 0 && Number(troops) !== 1 ? { troops: Number(troops) } : {}),
      pace,
      flipAllowance: frontFlipAllowance({ allowance, events: list }),
      seed,
      arenas,
      ...(asArray(authored).length ? { authored: asArray(authored) } : {}),
    },
    loadRegions: readRegions,
    pause,
    // (A staff that looks every day weighs its plans on copies of the battle: a day at a time, so that the page
    // is not held for the half month a chunk would be.)
    ...(staffPolicy?.often === true ? { chunkDays: 1 } : {}),
  });
  // The map could not be read: the turn goes on without the engine.
  if (!result) return nothing(null);

  // The war at sea (runtime/naval/engine.js): the fleets of the countries at
  // war, over the same days. They are the world's own formations, so what it
  // comes to is changes to those (a fleet worn down, moved, broken off, gone)
  // and, for a country at war with a coast and no fleet, one commissioned. It
  // is given the sheet of the whole map when one has been drawn or can be:
  // without it nobody is commissioned and nobody closes, and fleets in reach
  // of each other still fight.
  let sea = null;
  if (naval !== false && atWar && days > 0) {
    try {
      const water = waterTypeIds(regionTypes);
      const key = worldSheetKey(clean(map?.key), water);
      let sheet = clean(map?.key) && arenas ? arenas.get(key) ?? null : null;
      if (!sheet) {
        const shapes = await readRegions();
        sheet = shapes ? buildWorldGrid(shapes, { ...measureOptions(map), water }) : null;
        if (sheet && clean(map?.key) && arenas) arenas.set(key, sheet);
      }
      const seaInput = {
        fromDate,
        days,
        seed: `${seed}|sea`,
        wars: stages[0],
        units: asArray(world?.units),
        strengthOf: readers.strengthOf,
        controllerOf: readers.controllerOf,
        grid: sheet,
        cities: asArray(map?.cities),
        seas: asArray(world?.seas).map((entry) => ({ name: clean(entry?.name), lng: Number(entry?.point?.[0] ?? entry?.lng), lat: Number(entry?.point?.[1] ?? entry?.lat) })),
        ...measureOptions(map),
        caps: unitCaps ?? {},
        raised: asArray(world?.naviesRaised),
        era: Number.isInteger(era) ? era : null,
        ...(mechanics?.military === true ? { militaryOf: readers.militaryOf } : {}),
        ...(mechanics?.weather === true && clean(climateSeed) ? { weatherSeed: clean(climateSeed) } : {}),
        ...(frozen.length > 0 ? { iced: frozen.map((entry) => entry.box) } : {}),
      };
      // EXPERIMENT, in the lab: where the lab's own staff leads the land war (runtime/fronts/mind/trained.js), the
      // countries nobody plays have an admiral too (runtime/naval/admiral.js), who chooses their fleets' postures
      // by fighting the period out with each. A fleet the turn's story moved or ordered keeps what it was told.
      const ordered = new Set(list.flatMap((event) => asArray(event?.impacts?.unitOps).map((op) => clean(op?.unit?.id ?? op?.unitId ?? op?.id)).filter(Boolean)));
      const admiral = typeof staffPolicy === "function" ? chooseFleetPostures(seaInput, { players, kept: ordered }) : null;
      sea = runNaval(admiral ? { ...seaInput, units: admiral.units } : seaInput);
      // What the admiral chose is what the world keeps (unless the war at sea sank the fleet or broke it off).
      if (admiral) {
        for (const [unitId, posture] of admiral.chosen) {
          const change = sea.unitChanges.find((entry) => entry.unitId === unitId);
          if (!change) sea.unitChanges.push({ unitId, posture });
          else if (!change.remove && !change.posture) change.posture = posture;
        }
      }
      // (How long the period was, for what its blockades cost: frontApply.js withBlockadeEconomy.)
      sea.days = days;
    } catch (error) {
      console.warn("[naval] the war at sea could not be fought this turn; the fleets stand as they were.", error);
      sea = null;
    }
  }

  // A battlefield an order names "border: A / B" is a border fortified in
  // peace, which the engine opens itself; one it does not know is not the
  // model's mistake to be told of. Nor is what it says of an order the turn
  // drew from an event's own operations.
  const told = asArray(result.notes).filter((note) => !clean(note?.ref).startsWith(STATED_REF)
    && !(note?.kind === "unknown-battlefield" && /^border\s*:/i.test(clean(note?.battlefield))));
  notes.push(...describeFrontNotes(told));

  // Which events tell of the war on a battlefield: bound to its war, or with
  // members of both its sides on the field.
  const byName = new Map(asArray(result.battlefields).map((record) => [foldBattlefieldName(record.name), record]));
  const aboutOf = (event, battlefield) => {
    const record = byName.get(foldBattlefieldName(battlefield));
    if (!record) return false;
    const bound = clean(event?.warId);
    if (bound) return bound === record.warId;
    return record.sides.every((members) => asArray(event?.combatants).some((name) => members.some((member) => fold(member) === fold(nameOf(name)))));
  };

  // Fighting told on a battlefield no order was written for: the troops there
  // kept the orders they had, and the model is told so it writes them next time.
  // (Not where the story was told the fighting before it wrote: it tells what
  // standing orders did, and owes no line for it.)
  if (typeof narratesCombat === "function" && !foretold) {
    const human = new Set(asArray(players).map(fold).filter(Boolean));
    const ordered = new Set(orders.map((order) => foldBattlefieldName(order.battlefield)));
    const unordered = asArray(result.battlefields).filter((record) => record.status === "active"
      && !ordered.has(foldBattlefieldName(record.name))
      && !record.sides.flat().every((member) => human.has(fold(member)))
      && list.some((event) => {
        const bound = clean(event?.warId);
        const onIt = bound
          ? bound === record.warId
          : record.sides.every((members) => asArray(event?.combatants).some((name) => members.some((member) => fold(member) === fold(nameOf(name)))));
        return onIt && narratesCombat(event);
      }));
    if (unordered.length) {
      notes.push({
        kind: "short",
        text: `Events told of fighting on ${listed(unordered.map((record) => record.name))} and no line of frontOrders gave a side there an order, so its troops kept the orders they had. `
          + "Give each side an event has attacking, holding or falling back its order in frontOrders.",
      });
    }
  }

  // The transporters the answer ordered: each is the world's from now, and
  // sets out when the next period begins, so that its voyage is fought before
  // the story of that period is written and told in it.
  let transports = normalizeTransports(result.transports);
  const refused = [];
  // One the run refused when it was to set out, when it was the story that ordered it.
  for (const voyage of asArray(result.voyages)) {
    const mine = transports.find((entry) => entry.id === voyage?.id);
    if (voyage?.k === "refused" && mine && !mine.by) refused.push({ kind: "transport-refused", detail: `${clean(voyage.owner)} to ${clean(voyage.to) || "?"}: ${transportRefusal(voyage.why)}` });
  }
  const year = yearInEra(gameDateYear(fromDate), Number.isInteger(era) ? era : null);
  for (const order of dispatches) {
    const owner = nameOf(withoutKind(order.side));
    // The battlefield it names is the one its landing opens: not one that is open already.
    const taken = asArray(result.battlefields).some((record) => record.status !== "closed" && foldBattlefieldName(record.name) === foldBattlefieldName(order.battlefield));
    // (A city the map spells another way is found here: the engine knows it only by the map's name.)
    const known = /^(region|country|group)\s*:/i.test(clean(order.objective)) || findStrikePlace(order.objective, { cities: asArray(map?.cities) });
    const bound = !known && typeof strikePlaces?.find === "function" ? await lookedFor(() => strikePlaces.find(order.objective)) : null;
    const sent = orderTransport(transports, {
      medium: TRANSPORT_ORDERS[order.order],
      owner,
      to: { name: clean(order.objective), ...(bound ?? {}) },
      battlefield: taken ? "" : clean(order.battlefield),
      kind: clean(order.carrier),
      speed: Number(order.speed) || 0,
      raise: Number(order.strength) > 0 ? Number(order.strength) : TRANSPORT_LOAD_USUAL,
    }, { date: toDate, year });
    if (sent.error) refused.push({ kind: "transport-refused", detail: `${owner} to ${clean(order.objective) || "?"}: ${transportRefusal(sent.error)}` });
    else transports = sent.transports;
  }
  notes.push(...describeFrontNotes(refused));

  // A capture the engine refused (too few of the taker's troops near, engine.js captureRefused) is not made in the
  // world either: its control operation comes off its event, and the event stays.
  const failedCaptures = asArray(result.notes).filter((note) => note?.kind === "capture-failed" && clean(note?.ref));
  const kept = failedCaptures.length === 0 ? list : list.map((event) => {
    const failed = failedCaptures.filter((note) => clean(note.ref) === clean(event?.id));
    if (failed.length === 0 || !isRecord(event?.impacts)) return event;
    const ops = asArray(event.impacts.regionControlOps).filter((op) => !failed.some((note) => clean(op?.regionId) === clean(note.regionId)
      && fold(nameOf(op?.toCode)) === fold(note.taker)));
    return { ...event, impacts: { ...event.impacts, regionControlOps: ops } };
  });

  return {
    strikes: strikes.map((strike) => ({ ...strike, owner: nameOf(strike.owner) })),
    transports,
    voyages: asArray(result.voyages),
    underWay: transports.filter(isUnderWay).length,
    events: attachFrontFlips(kept, result.flips, { dayOf, aboutOf }).events,
    // A battlefield whose period the story was told before it was written says
    // so (brief.told): the next turn has nothing of this one left to tell. One
    // that does not (it opened in this answer, or the turn was asked for the
    // old way) is told then, with the period after it (frontPrompt.js).
    battlefields: asArray(result.battlefields).map((record) => (settled?.has(foldBattlefieldName(record?.name)) && isRecord(record.brief)
      ? { ...record, brief: { ...record.brief, told: true } }
      : record)),
    // (A formation the land war took up this period is the land war's: the sea says nothing more of it.)
    // (And an air unit worn by an air strike, where the land war did not wear it further: its own change says all.)
    unitChanges: [
      ...asArray(result.unitChanges),
      ...sorties.unitChanges.filter((change) => !asArray(result.unitChanges).some((entry) => clean(entry?.unitId) === clean(change?.unitId))),
      ...asArray(sea?.unitChanges).filter((change) => ![...asArray(result.unitChanges), ...sorties.unitChanges].some((entry) => clean(entry?.unitId) === clean(change?.unitId))),
    ],
    // The war room's air strikes as they were flown, with what their bombs did to the troops on the battlefields.
    airStrikes: withTroopHits(sorties.strikes, result.notes),
    // What the period came to at sea: its battles, the fleets as it leaves them, and any commissioned (runtime/naval/engine.js).
    sea: sea ? { battles: asArray(sea.battles), fleets: asArray(sea.fleets), commissioned: asArray(sea.commissioned), raised: asArray(sea.raised), blockades: asArray(sea.blockades), fromDate, days: sea.days } : null,
    notes,
    flips: asArray(result.flips),
    stats: result.stats ?? null,
    news: asArray(result.news),
    joins: asArray(result.joins),
    starts: asArray(result.starts),
    // What recruitment drew from each country's people and what came home, in men: for frontApply.js withFrontManpower.
    manpower: asArray(result.manpower),
    // How much each country's formations advanced, which its war resources pay for (runtime/warResources.js).
    effort: asArray(result.effort),
    // What the weather and being cut off took from each country, besides the fighting (runtime/fronts/attrition.js).
    attrition: asArray(result.attrition),
    // What the fighting did to the walls: their breaches and wear (runtime/fronts/walls.js).
    fortifications: asArray(result.fortifications),
    // The water frozen this turn (runtime/fronts/climate.js): for the map to show as ice.
    frozen: frozen.map((entry) => entry.id),
  };
};
