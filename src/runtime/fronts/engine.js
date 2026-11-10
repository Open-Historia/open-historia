/*! Open Historia — battlefields and fronts: the run © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The front engine. Given the battlefields as they stood, the days that passed
// and what was ordered and what happened on them, it says how every
// battlefield stands afterwards: where the line runs, where the troops are,
// which regions changed hands and when.
//
//   const run = createFrontRun(input);
//   while (!run.advance(15)) { /* the caller may yield here */ }
//   const result = run.finish();          // runFronts(input) does the same in one call
//
// The model commands and narrates; it never sets a position. The engine never
// writes who controls a region: it reports each change of hands as a flip and
// the game applies it the ordinary way.
//
// Two promises the rest of the game relies on. The same input gives the same
// result to the last character. And nothing dated day d changes anything
// before day d: a run cut at day k ends exactly as the full run stood after
// day k, which is what lets a player break into a turn half way through.
//
// The map's shapes are tens of megabytes, so a run is first tried without
// them (input.map.regions null): it works from arenas already drawn. When it
// finds it needs shapes after all (a battlefield to open, a frame to grow, an
// arena not kept) it answers { needsRegions: true } having changed nothing,
// and is run again in full with them.

import { attritionReport } from "./attrition.js";
import { addGameDays, compareGameDates, diffGameDays, gameDateYear } from "../gameDates.js";
import { waterTypeIds } from "../regionTypes.js";
import { ADVANCE_KM_PER_DAY, OVERLAND_KM_PER_DAY, eraOf, yearInEra } from "../unitMotion.js";
import { arenaFor } from "./arena.js";
import { dawn } from "./dawn.js";
import { anyMechanic, readMechanics } from "./mechanics.js";
import { levyOwed, musterShare } from "./muster.js";
import { DEPLOY_USUAL, DEPLOY_WHY, deployCells } from "./deploy.js";
import { CALL_UP_FULL_DAYS, marchKmOf, marchOn, marchesFor, sendInland, walkRoute } from "./march.js";
import { liveOrder } from "./closing.js";
import { HOME_JOIN_KM, HOME_MARGIN_KM, borderCells, homeBounds, homeCells, homeName, homeNeighbours, wayInto } from "./home.js";
import { linesChanged } from "./walls.js";
import { AIR_MISSIONS, wingChanges } from "./air.js";
import { bombTroops } from "./airStrike.js";
import { MILITARY_NEUTRAL, airWorth, landWorth, mixOf, readMilitary, seaWorth } from "./military.js";
import { absorbUnit, holderOf, isLandFormation, keepStart, lineLength, loadBattle, memberIndex, memberWeights, openBattle, paintGround, raiseTroops, readRegion, reconcile, releaseNamed, saveBattle, setHandicap, setRadii, sideOfName } from "./battle.js";
import { buildBrief } from "./brief.js";
import { assignCommands } from "./command.js";
import { hashKey } from "./codec.js";
import {
  BATTLEFIELD_NAME_MAX,
  BREAKTHROUGH_LOOK_DAYS,
  EFFORT_FACTORS,
  FRONT_EFFORTS,
  FRONT_ORDERS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  HAND_OVER_REACH_CELLS,
  OBJECTIVE_BEYOND_KM,
  REINFORCED_LINE_MOST,
  REINFORCED_SIZE_MOST,
  REINFORCE_MOST,
  REINFORCE_ORDER,
  STORY_TAKER_REACH_KM,
  REINFORCE_USUAL_SHARE,
  SCENARIO_MARK,
  WAR_EFFORTS,
  INVADE_REACH_KM,
  LANDING_CELLS,
  MAX_BATTLEFIELDS,
  MAX_HOME_FORCES,
  MUSTER_STANDING_SHARE,
  MAX_CLOSED_BATTLEFIELDS,
  MAX_SIDE_MEMBERS,
  MAX_TROOPS_PER_SIDE,
  POOL_PER_TROOP,
  STAFF_MARK,
  MIND_MARK,
  STAFF_CALL_UP_CEILING,
  STAFF_CALL_UP_DAYS,
  STAFF_REVIEW_DAYS,
  STANDING_QUIET_DAYS,
  TROOPS_PER_STRENGTH,
  TROOP_KINDS,
  WITHDRAW_DAYS_MOST,
  WITHDRAW_KM,
  takersFor,
} from "./constants.js";
import { contactAt, findContacts, frameForContact, middleOf } from "./contact.js";
import { REGIONS_NEEDED, growToHold, prepare, recordDay, settleRegions, simulateDay, startRecorder } from "./day.js";
import { redistance, takeCapsule, traceContour } from "./field.js";
import { cellAt, downhill, measure } from "./ground.js";
import { createFrame, pointInFrame, projectorOf } from "./frame.js";
import { landWithin, othersOnWay } from "./invade.js";
import { draw, formationsLeft, manpowerReport, menOf, menPerFormation, partLeft, sendHome } from "./manpower.js";
import { applyOrder, assignOrder, fallBackOverland, giveWay, landCarried, putAshore, readSieges, setStandingOrder, standingOf } from "./orders.js";
import { foldBattlefieldName, isWarIdName, normalizeBattlefields } from "./record.js";
import { authoredName } from "./scenarioFronts.js";
import { breakthroughAnswer, callUpNeed, sideIsPlayed, staffDecision, staffMayOrder, staffStanding } from "./staff.js";
import { findPockets } from "./supply.js";
import { SWARM_FORM, gatherNewcomers } from "./swarms.js";
import { EMBARK_PORTS_MOST, TRANSPORT_ENDED, TRANSPORT_START_FAILS, airliftIntercepts, boundFor, departuresFor, interceptionOf, loadOf, moveOn, normalizeTransports, setOut, stretchOf, struck, transportBar, transportChance, transportLoadMost } from "./transports.js";
import { describePoint, findPlace, inSector, resolveSector } from "./sectors.js";
import { STATE_HOLDING, createTroop, isLive, kindsFor, liveCount, troopsCap, troopsFactor, troopsLeast, troopsWanted } from "./troops.js";
import { buildWorldGrid, kmBetween, measureOptions, placeAlong, worldSheetKey } from "./worldGrid.js";

const clean = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
const fold = (value) => clean(value).toLowerCase();

const memberList = (value) => {
  const members = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const name = clean(entry);
    if (name && !members.some((member) => fold(member) === fold(name)) && members.length < MAX_SIDE_MEMBERS) members.push(name);
  }
  return members;
};

// ---- the run's own books -------------------------------------------------------

const createRun = (input) => {
  const days = Math.max(0, Math.floor(Number(input?.days) || 0));
  const fromDate = String(input?.fromDate ?? "");
  const dated = addGameDays(fromDate, 0) !== "";
  // (A scenario may set its era outright: runtime/warSettings.js.)
  const era = eraOf(fromDate, Number.isInteger(input?.era) ? input.era : null);
  const controller = new Map();
  const group = new Map();
  // The forces the run founded (day.js settleRegions): folded name -> [name, the country whose force it is].
  const forces = new Map();
  const areas = input?.groupAreas && typeof input.groupAreas === "object" ? input.groupAreas : {};
  const run = {
    input,
    days,
    day: 0,
    steps: 0,
    era,
    // Which of the newer mechanics this run uses (mechanics.js): none unless the input turns them on.
    mech: readMechanics(input?.mechanics),
    // How its wars are fought where nobody chose otherwise (swarms.js; runtime/warSettings.js warfare): along a front
    // unless the input says in swarms.
    warfare: input?.warfare === SWARM_FORM ? SWARM_FORM : "front",
    seed: String(input?.seed ?? ""),
    // How many troops are raised, of the usual (troops.js troopsFactor).
    troops: troopsFactor(input?.troops),
    // The men a formation is (the scenario's where it set them, else its era's), and what each
    // country has been charged and given back this run (manpower.js).
    menEach: Number(input?.menEach) >= 1 ? Math.round(Number(input.menEach)) : menPerFormation(era),
    // The share of a country's people who can fight, where the scenario set it: else MANPOWER_SHARE (manpower.js).
    manpowerShare: Number(input?.manpowerShare) > 0 && Number(input.manpowerShare) <= 100 ? Number(input.manpowerShare) / 100 : 0,
    manpower: new Map(),
    // Each country's days of advance this run, for its war resources (dawn.js dusk, runtime/warResources.js).
    effort: new Map(),
    pace: Math.min(3, Math.max(0.1, Number(input?.pace) || 1)),
    // The weights that bend a troop's step, for a test or the rig to set aside.
    steer: input?.steering && typeof input.steering === "object" ? input.steering : {},
    advanceKm: [ADVANCE_KM_PER_DAY.infantry[era], ADVANCE_KM_PER_DAY.armor[era], ADVANCE_KM_PER_DAY.artillery[era]],
    overlandKm: [OVERLAND_KM_PER_DAY.infantry[era], OVERLAND_KM_PER_DAY.armor[era], OVERLAND_KM_PER_DAY.artillery[era]],
    battles: [],
    wars: new Map(),
    flips: [],
    // The countries troops were sent into during the run, each brought into
    // its war (invadeWhereSent): the caller writes them into the war ledger.
    joins: [],
    // The wars that began during the run because one country sent its troops
    // at another it was at peace with (attackOpensWar): for the ledger too.
    starts: [],
    // The transporters of the world (transports.js), and what became of each
    // during the run, in the order it happened.
    transports: [],
    voyages: [],
    unitChanges: [],
    notes: [],
    taken: new Set(),
    cursor: 0,
    flipsLeft: Number.isFinite(input?.flipAllowance) ? Math.max(0, Math.floor(input.flipAllowance)) : Infinity,
    braked: false,
    cache: input?.arenas instanceof Map ? input.arenas : null,
    regionIds: null,
    // A date the calendar cannot read gives every day the run's first date, and its end the last.
    dateOf: (day) => (dated ? addGameDays(fromDate, day) : day >= days && input?.toDate ? String(input.toDate) : fromDate),
    controllerOf: (id) => (controller.has(id) ? controller.get(id) : clean(input?.controllerOf?.(id))),
    sovereignOf: (id) => clean(input?.sovereignOf?.(id)),
    groupOf: (id) => (group.has(id) ? group.get(id) : clean(areas[id])),
    isGroup: (name) => forces.has(fold(name)) || input?.isGroup?.(name) === true,
    // The country whose force a group is (runtime/groups.js `owner`), or "".
    groupOwnerOf: (name) => (forces.has(fold(name)) ? forces.get(fold(name))[1] : clean(input?.groupOwnerOf?.(name))),
    // A country's force founded during the run (day.js settleRegions).
    foundForce: (name, owner) => forces.set(fold(name), [clean(name), clean(owner)]),
    strengthOf: (name) => {
      const weight = Number(input?.strengthOf?.(name));
      return weight > 0 && Number.isFinite(weight) ? weight : 1;
    },
    // How short a country is of what comes by sea, 0 to 1 (handicap.js shortEdge): 0 where nobody says.
    shortageOf: (name) => {
      const short = Number(input?.shortageOf?.(name));
      return short > 0 && Number.isFinite(short) ? (short > 1 ? 1 : short) : 0;
    },
    setController: (id, name) => controller.set(id, clean(name)),
    setGroup: (id, name) => group.set(id, clean(name)),
  };
  // Each country's own military figures (military.js): read once a run, and
  // only where the run weighs them; every country is neutral otherwise.
  const figures = new Map();
  run.militaryOf = (name) => {
    if (!run.mech.military) return MILITARY_NEUTRAL;
    const key = fold(name);
    if (!figures.has(key)) figures.set(key, readMilitary(input?.militaryOf?.(name)));
    return figures.get(key);
  };
  // Each country's mustering curve (muster.js), as the run is handed it: { table, head }, or null.
  const curves = new Map();
  run.musterOf = (name) => {
    if (!run.mech.muster) return null;
    const key = fold(name);
    if (!curves.has(key)) {
      const curve = input?.musterOf?.(name);
      curves.set(key, curve && Array.isArray(curve.table) ? curve : null);
    }
    return curves.get(key);
  };
  // (What the run has itself been told or worked out of the world, kept where a copy of it fought on another core
  // can be given it: rehearsalPacket below. Not among its own keys.)
  Object.defineProperty(run, "lookups", { value: { controller, group, figures, curves, forces } });
  // A region changed hands: every battlefield it lies on reads its side again.
  run.regionChanged = (id) => {
    for (const battle of run.battles) {
      if (battle.status === "closed" || !battle.arena.indexOf.has(id)) continue;
      readRegion(battle, run, id);
      battle.planKey = "";
    }
  };
  // A scenario's ceiling on how much may change hands in a run: once it is
  // reached nobody advances for the rest of it, and the caller is told once.
  run.spendFlip = () => {
    run.flipsLeft -= 1;
    if (run.flipsLeft > 0 || run.braked) return;
    run.braked = true;
    run.notes.push({ kind: "tempo" });
  };
  if (run.flipsLeft <= 0) run.braked = true;

  for (const war of Array.isArray(input?.wars) ? input.wars : []) {
    const id = clean(war?.id);
    if (!id || run.wars.has(id)) continue;
    // (When it began, for whether its levies must muster: muster.js.)
    run.wars.set(id, { id, title: clean(war.title), status: ["active", "ceasefire", "ended"].includes(war.status) ? war.status : "active", sides: [memberList(war.sideA), memberList(war.sideB)], began: clean(war.startedDate) });
  }
  run.moments = (Array.isArray(input?.moments) ? input.moments : [])
    .filter((moment) => moment && typeof moment === "object")
    .map((moment, index) => ({ moment, index, day: Math.min(days, Math.max(0, Math.floor(Number(moment.day) || 0))) }))
    .sort((a, b) => a.day - b.day || a.index - b.index);
  return run;
};

const regionsOf = (run) => (Array.isArray(run.input?.map?.regions) ? run.input.map.regions : null);
const openBattles = (run) => run.battles.filter((battle) => battle.status !== "closed" && !battle.home);

// Which side of a war holds a region: the group in whose area it lies if that
// group is in the war, or the country whose force that group is if that
// country is (battle.js groupSideOf), else its controller.
const warSideOf = (run, war, id) => {
  const sideOf = (name) => {
    const wanted = fold(name);
    if (!wanted) return -1;
    return war.sides[0].some((member) => fold(member) === wanted) ? 0 : war.sides[1].some((member) => fold(member) === wanted) ? 1 : -1;
  };
  const name = run.groupOf(id);
  const group = name ? sideOf(name) : -1;
  if (group >= 0) return group;
  const owner = name ? sideOf(run.groupOwnerOf(name)) : -1;
  return owner >= 0 ? owner : sideOf(run.controllerOf(id));
};

// ---- battlefields opening and closing ------------------------------------------

// The name of a battlefield that opened by itself: its two leading members,
// made its own with the largest city near the line if another has that name.
const nameFor = (run, battle) => {
  const { arena } = battle;
  const lead = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
    const cells = new Float64Array(battle.sides[side].length);
    for (let region = 1; region < arena.ids.length; region += 1) {
      // (A group outside the war holds nothing on it: its regions are its country's, holderOf.)
      const holder = holderOf(battle, run, arena.ids[region]);
      const index = battle.sides[side].findIndex((member) => fold(member) === fold(holder));
      if (index >= 0) cells[index] += arena.cells[region];
    }
    let best = 0;
    for (let index = 1; index < cells.length; index += 1) if (cells[index] > cells[best]) best = index;
    return battle.sides[side][best];
  });
  const taken = (name) => run.battles.some((other) => other !== battle && foldBattlefieldName(other.name) === foldBattlefieldName(name));
  // A front its scenario's author named is called that (scenarioFronts.js).
  const authored = clean(authoredName(run.input?.authored, battle.sides), BATTLEFIELD_NAME_MAX);
  if (authored && !taken(authored)) return authored;
  const plain = clean(`${lead[0]} - ${lead[1]} front`, BATTLEFIELD_NAME_MAX);
  if (!taken(plain)) return plain;
  const contour = traceContour(battle.field);
  let city = null;
  for (const candidate of arena.cities) {
    let near = false;
    for (let vertex = 0; vertex < contour.x.length && !near; vertex += 1) {
      near = Math.abs(contour.x[vertex] - candidate.x) <= 12 && Math.abs(contour.y[vertex] - candidate.y) <= 12;
    }
    if (near && (!city || candidate.population > city.population)) city = candidate;
  }
  const named = city ? clean(`${lead[0]} - ${lead[1]} front, ${city.name}`, BATTLEFIELD_NAME_MAX) : "";
  if (named && !taken(named)) return named;
  for (let count = 2; ; count += 1) {
    const numbered = clean(`${plain} ${count}`, BATTLEFIELD_NAME_MAX);
    if (!taken(numbered)) return numbered;
  }
};

// The name an order gives a battlefield, as it may be kept: none when it is a
// war's id (record.js isWarIdName), so the battlefield is called what nameFor
// calls it ("France - Italy front") and not "WAR-FRANCE-ITALY-2016".
const givenName = (run, value) => {
  const name = clean(value, BATTLEFIELD_NAME_MAX);
  return name && !isWarIdName(name, run.wars.keys()) ? name : "";
};

// Formations of the world's that stand on a battle and belong to its sides are
// taken into it.
const absorbUnits = (battle, run) => {
  for (const unit of Array.isArray(run.input?.units) ? run.input.units : []) {
    const id = clean(unit?.id);
    if (!id || clean(unit.committedTo) || run.taken.has(id)) continue;
    // One that withdrew from here is left where it went, and a side that is away takes nobody in.
    if (battle.sentHome.has(id)) continue;
    const side = sideOfName(battle, unit?.ownerCode ?? unit?.owner);
    if (side >= 0 && battle.away[side]) continue;
    if (absorbUnit(battle, run, unit)) run.taken.add(id);
  }
};

// A battle that has just opened: troops are raised, formations taken in, and
// its first day goes to the recorder.
//   landed   troops a transporter brought there: { side, x, y, load, owner }.
//            They are its side's force, so only the side landed on raises any.
const startBattle = (run, battle, day, landed = null) => {
  run.battles.push(battle);
  // (Forces at home near it join it first, and fewer are raised for it: home.js.)
  const handed = bringHome(run, battle, day);
  raiseTroops(battle, run, landed ? 1 - landed.side : -1);
  if (landed) {
    battle.base[landed.side] = Math.round(memberWeights(battle, run, landed.side).reduce((sum, weight) => sum + weight, 0) * 1000) / 1000;
    putAshore(battle, landed.side, landed.x, landed.y, landed.load, landed.owner);
  }
  absorbUnits(battle, run);
  setRadii(battle);
  paintGround(battle, run);
  keepStart(battle);
  readSieges(battle);
  findPockets(battle);
  homeOrders(run, battle, handed, day);
  startRecorder(battle, run, day);
  recordDay(battle, day, day >= run.days);
};

const closeBattle = (run, battle, day) => {
  if (battle.status === "closed") return;
  const { arena } = battle;
  battle.status = "closed";
  battle.closedDate = run.dateOf(day);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) sendHome(run, battle, side);
  releaseNamed(battle, run);
  // What is still held by a country that is not its sovereign: the war ending
  // moves no border, so the model is told what is left occupied.
  const occupied = [];
  for (let region = 1; region < arena.ids.length && occupied.length < 12; region += 1) {
    const id = arena.ids[region];
    const controller = run.controllerOf(id);
    if (battle.regionSide[region] < 0 || arena.names[region] === id || fold(controller) === fold(run.sovereignOf(id))) continue;
    occupied.push(`region: ${arena.names[region]}`);
  }
  run.notes.push({ kind: "closed", battlefield: battle, detail: occupied.join(", ") });
  if (!battle.recorder) startRecorder(battle, run, day);
  recordDay(battle, day, true);
  battle.replay = battle.recorder.finish({ date: run.input.fromDate, days: day });
  battle.closing = "";
};

// The map's regions that are LAND. Two sides touch where their land does: a
// stretch of sea each holds a region of is no front, and no frame is laid
// round it. null while the shapes have not been read.
// (With the water frozen this turn, climate.js: ground the two sides may meet across.)
const landRegionsOf = (run) => {
  const regions = regionsOf(run);
  if (!regions) return null;
  if (run.landRegions?.of !== regions) {
    const water = waterTypeIds(run.input.regionTypes);
    const frozen = Array.isArray(run.input.map?.frozen) && run.input.map.frozen.length > 0 ? new Set(run.input.map.frozen) : null;
    run.landRegions = { of: regions, list: water.size > 0 ? regions.filter((region) => !water.has(clean(region?.typeId)) || (frozen && frozen.has(region?.id))) : regions };
  }
  return run.landRegions.list;
};

// What names a war as it stands for the question "do its sides touch anywhere
// no battlefield covers": its members, and the regions each side holds that do
// not lie wholly inside one of its battlefields. "" when the regions are not known.
const contactKey = (run, war) => {
  if (!run.regionIds) return "";
  const frames = run.battles.filter((battle) => battle.warId === war.id && battle.status !== "closed");
  const covered = (id) => frames.some((battle) => battle.arena.indexOf.has(id) && battle.arena.outside[battle.arena.indexOf.get(id)] === 0);
  const held = [[], []];
  for (const id of run.regionIds) {
    const side = warSideOf(run, war, id);
    if (side >= 0 && !covered(id)) held[side].push(id);
  }
  // (And which water is frozen: ice may join two sides that did not touch.)
  const frozen = Array.isArray(run.input.map?.frozen) ? run.input.map.frozen.slice().sort().join("\u0002") : "";
  return `contact|${clean(run.input.map?.key)}|${war.id}|${hashKey([war.sides[0].join("\u0002"), war.sides[1].join("\u0002"), held[0].length, held[1].length, held[0].join("\u0002"), held[1].join("\u0002"), frozen])}`;
};

// Opens a battlefield for every stretch where an active war's two sides touch
// and none covers it. A war already looked at as it stands is not looked at
// again: that answer is kept with the arenas, so an overseas war does not ask
// for the map's shapes turn after turn.
const STANDING_REACH_KM = 300;
const landWhereTroopsStand = (run, war, day) => {
  if (run.battles.some((battle) => battle.warId === war.id && battle.status !== "closed")) return;
  const standing = [];
  for (const unit of Array.isArray(run.input?.units) ? run.input.units : []) {
    const owner = clean(unit?.ownerCode ?? unit?.owner);
    const side = warSide(war, owner);
    const region = clean(unit?.regionId);
    const lng = Number(unit?.lng);
    const lat = Number(unit?.lat);
    if (side < 0 || !region || unit?.covert === true || clean(unit?.committedTo) || !isLandFormation(unit) || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (warSide(war, holderIn(run, war, region)) !== 1 - side) continue;
    standing.push({ owner, lng, lat });
  }
  if (standing.length === 0) return;
  const map = run.input.map;
  const near = (a, b) => kmBetween(a.lng, a.lat, b.lng, b.lat, measureOptions(map)) <= STANDING_REACH_KM;
  let best = null;
  let most = 0;
  for (const entry of standing) {
    const count = standing.filter((other) => near(entry, other)).length;
    if (count > most) {
      best = entry;
      most = count;
    }
  }
  const tried = `standing|${clean(map?.key)}|${war.id}|${best.owner}|${best.lng}|${best.lat}`;
  if (run.cache?.get(tried) === true) return;
  if (!openLandingAt(run, { war, sideName: best.owner, lng: best.lng, lat: best.lat, day }) && run.cache) run.cache.set(tried, true);
};

const examineWar = (run, war, day) => {
  if (war.status !== "active" || war.sides[0].length === 0 || war.sides[1].length === 0) return;
  adoptStanding(run, war);
  landWhereTroopsStand(run, war, day);
  const key = contactKey(run, war);
  if (key && run.cache?.get(key) === true) return;
  // A stretch the world had no room for is looked at again once it has: "I have the south eastern borders and the
  // west, however the game only allows me to attack from the west" (a player, 2026-11-05). That answer was kept as
  // the war's whole answer, and the stretch never opened after other battlefields closed.
  if (key && run.cache?.get(`${key}|full`) === true && openBattles(run).length >= MAX_BATTLEFIELDS) return;
  const regions = landRegionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  let full = false;
  for (const contact of findContacts(regions, (id) => warSideOf(run, war, id), map)) {
    if (run.battles.some((battle) => battle.warId === war.id && battle.status !== "closed" && pointInFrame(battle.frame, contact.lng, contact.lat))) continue;
    if (openBattles(run).length >= MAX_BATTLEFIELDS) {
      run.notes.push({ kind: "too-many-battlefields", detail: war.title || war.id });
      full = true;
      break;
    }
    const frame = frameForContact(contact, map);
    const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
    if (!arena) continue;
    const battle = openBattle(run, { name: "", warId: war.id, sides: war.sides, frame, arena, day });
    if (!battle) continue;
    battle.name = nameFor(run, battle);
    battle.autoNamed = true;
    startBattle(run, battle, day);
  }
  const after = contactKey(run, war);
  if (after && run.cache) run.cache.set(full ? `${after}|full` : after, true);
};

// ---- a war changing ------------------------------------------------------------

// Counters for a member that has just joined a battle, on its side's ground
// along the line: as many as its own strength brings, while the line has room
// for them.
const raiseFor = (battle, run, side, owner) => {
  const member = battle.sides[side][owner];
  const military = run.mech.military;
  // (A country with no army raises none: military.js.)
  if (military && landWorth(run.militaryOf(member)) === 0) return;
  const wanted = Math.round(TROOPS_PER_STRENGTH * run.troops * memberWeights(battle, run, side)[owner] * EFFORT_FACTORS[battle.effort[side]]);
  const room = Math.min(MAX_TROOPS_PER_SIDE - battle.troops[side].length, troopsCap(battle.lineKm, run.troops) - liveCount(battle.troops[side]));
  const whole = formationsLeft(run, member);
  const part = military ? partLeft(run, member) : 0;
  const count = Math.max(0, Math.min(room, Math.max(2, wanted), whole + (part > 0 ? 1 : 0)));
  const contour = traceContour(battle.field);
  const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;
  let cells = [];
  for (let vertex = 0; vertex < own.length; vertex += 1) if (own[vertex] >= 0) cells.push(own[vertex]);
  // On its OWN stretch of the line, where it has one: a country that has just
  // been attacked stands on its own border, not along its ally's front.
  const wantedName = fold(battle.sides[side][owner]);
  const home = cells.filter((cell) => {
    const region = battle.arena.region[cell];
    return region > 0 && fold(holderOf(battle, run, battle.arena.ids[region])) === wantedName;
  });
  if (home.length > 0) cells = home;
  // (On the line its commander drew for its new troops, where it drew one: deploy.js.)
  cells = deployCells(battle, side, member, cells);
  if (cells.length === 0) return;
  const kinds = military ? kindsFor(count, run.era, mixOf(run.militaryOf(member))) : null;
  let men = 0;
  const first = battle.troops[side].length;
  for (let index = 0; index < count; index += 1) {
    const cell = cells[Math.min(cells.length - 1, Math.floor(((index + 0.5) * cells.length) / count))];
    // (Its last men, fewer than a counter's: a counter at part strength.)
    const strength = military && index === count - 1 && count > whole ? Math.round(100 * part) : 100;
    battle.troops[side].push(createTroop({ x: (cell % battle.field.cols) + 0.5, y: Math.floor(cell / battle.field.cols) + 0.5, owner, strength, ...(kinds ? { kind: kinds[index] } : {}) }));
    men += (strength / 100) * menOf(run, member);
  }
  draw(run, member, military ? men : count * run.menEach);
  battle.pool[side] += count * POOL_PER_TROOP * battle.edge[side].reserves;
  // (Where they come as a swarm they stand as one: swarms.js.)
  gatherNewcomers(battle, side, owner, first, run.warfare);
  // (And they are called up inside its country, and march there: march.js.)
  if (marchesFor(run, battle, run.wars.get(battle.warId))) sendInland(battle, run, side, battle.troops[side].slice(first));
};

// A side's new troops, from `first` on in its list, come under what their
// stretch of the line is told: an order for that stretch before one for the whole line.
const putUnderStanding = (run, battle, side, first, today, day) => {
  const standing = battle.orders.filter((order) => order.s === side && !order.chosen && order.order !== "assault" && order.order !== "withdraw");
  const under = new Map();
  for (let at = first; at < battle.troops[side].length; at += 1) {
    const troop = battle.troops[side][at];
    const fits = (order) => {
      const stretch = resolveSector(battle.arena, today.line, today.sectors, order.sector);
      return stretch && stretch.kind !== "all" && inSector(stretch, troop.x, troop.y, battle.place.kmAt);
    };
    const order = standing.find(fits) ?? standing.find((entry) => fold(entry.sector) === "all") ?? null;
    if (order) under.set(order, [...(under.get(order) ?? []), at]);
  }
  for (const [order, picked] of under) assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run }, { picked, lagless: true });
};

// Weighing a war's mustering (muster.js): each morning the levies each member
// is owed come in as its curve says, as many as it has men for, in its own
// unit mix, on its own ground along the line, under what their stretch of the
// line is told, each charged to its people as it comes.
const musterDay = (run, battle, day) => {
  if (!run.mech.muster || !levyOwed(battle.levy)) return;
  let today = null;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const entry of battle.levy[side]) {
      const member = battle.sides[side][entry.o];
      if (entry.r >= entry.t || !member || battle.gone[side].has(entry.o)) continue;
      const days = diffGameDays(entry.f, run.dateOf(day));
      const share = days === null ? 1 : musterShare(run, member, days);
      const military = run.mech.military;
      const whole = formationsLeft(run, member);
      const part = military ? partLeft(run, member) : 0;
      const due = Math.min(Math.min(entry.t, Math.floor(entry.t * share)) - entry.r, MAX_TROOPS_PER_SIDE - battle.troops[side].length, whole + (part > 0 ? 1 : 0));
      if (due <= 0) continue;
      const contour = traceContour(battle.field);
      const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;
      let cells = [];
      for (let vertex = 0; vertex < own.length; vertex += 1) if (own[vertex] >= 0) cells.push(own[vertex]);
      const home = cells.filter((cell) => {
        const region = battle.arena.region[cell];
        return region > 0 && fold(holderOf(battle, run, battle.arena.ids[region])) === fold(member);
      });
      if (home.length > 0) cells = home;
      if (cells.length === 0 && battle.field.holders.indexOf(side) >= 0) cells = [battle.field.holders.indexOf(side)];
      // (At home, round its cities: home.js.)
      if (battle.home) cells = homeCells(battle, side, ownGroundOf(battle, run, side, member), due);
      // (On the line its commander drew for its new troops, where it drew one: deploy.js.)
      cells = deployCells(battle, side, member, cells);
      if (cells.length === 0) continue;
      today = today ?? prepare(battle, day);
      const kinds = kindsFor(entry.t, run.era, military ? mixOf(run.militaryOf(member)) : null).slice(entry.r, entry.r + due);
      const first = battle.troops[side].length;
      let men = 0;
      for (let index = 0; index < due; index += 1) {
        const cell = cells[Math.min(cells.length - 1, Math.floor(((index + 0.5) * cells.length) / due))];
        const strength = military && index === due - 1 && due > whole ? Math.round(100 * part) : 100;
        battle.troops[side].push(createTroop({ x: (cell % battle.field.cols) + 0.5, y: Math.floor(cell / battle.field.cols) + 0.5, kind: kinds[index], owner: entry.o, strength }));
        men += (strength / 100) * menOf(run, member);
      }
      draw(run, member, men);
      battle.pool[side] += due * POOL_PER_TROOP * battle.edge[side].reserves;
      entry.r += due;
      // (Where they come as a swarm they stand as one first: swarms.js.)
      gatherNewcomers(battle, side, entry.o, first, run.warfare);
      // (Called up inside its country, they march there: march.js.)
      if (marchesFor(run, battle)) sendInland(battle, run, side, battle.troops[side].slice(first));
      putUnderStanding(run, battle, side, first, today, day);
      battle.touched = true;
      battle.planKey = "";
    }
  }
  battle.levy = battle.levy.map((list) => list.filter((entry) => entry.r < entry.t));
  if (today) setRadii(battle);
};

const joinBattle = (run, battle, side, names) => {
  for (const name of names) {
    const index = battle.sides[side].findIndex((member) => fold(member) === fold(name));
    if (index >= 0 && !battle.gone[side].has(index)) continue;
    if (sideOfName(battle, name) >= 0) continue;
    let owner = index;
    if (index >= 0) battle.gone[side].delete(index);
    else if (battle.sides[side].length < MAX_SIDE_MEMBERS) owner = battle.sides[side].push(name) - 1;
    else continue;
    // Its land in the frame becomes its side's ground, and the line is as
    // long as it now is: how many troops there is room for goes by that.
    reconcile(battle, run);
    lineLength(battle);
    // (Who is fighting has changed: so, it may be, has which side the difficulty weighs.)
    setHandicap(battle, run);
    raiseFor(battle, run, side, owner);
    paintGround(battle, run);
  }
  battle.planKey = "";
};

const leaveBattle = (run, battle, names) => {
  for (const name of names) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const index = battle.sides[side].findIndex((member, at) => fold(member) === fold(name) && !battle.gone[side].has(at));
      if (index < 0) continue;
      battle.gone[side].add(index);
      // Its troops go home with it: a named formation back to the world, the rest away.
      sendHome(run, battle, side, battle.troops[side].map((troop, at) => (troop.owner === index && isLive(troop) ? at : -1)).filter((at) => at >= 0));
      battle.troops[side].forEach((troop, at) => {
        if (troop.owner !== index || !isLive(troop)) return;
        const named = battle.named.find((entry) => entry.s === side && entry.i === at);
        if (named && !named.reported) {
          const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
          run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
          named.reported = true;
        }
        troop.strength = 0;
        troop.station = null;
      });
      if (battle.gone[side].size >= battle.sides[side].length) battle.closing = "left";
    }
  }
  setHandicap(battle, run);
  // Its ground is no longer either side's: it becomes wall.
  reconcile(battle, run);
  battle.planKey = "";
};

// ---- a border fortified in peace -----------------------------------------------
// Troops may be deployed along a border with no war behind it: a battlefield
// that is STANDING. Nothing fights there and no ground changes hands; an order
// to attack is refused. If a war between its two sides begins it becomes
// active as it stands, with whoever is dug in there.

const BORDER = /^\s*border\s*:\s*(.+?)\s*\/\s*(.+?)\s*$/i;

// Which side of a war a name fights on: 0, 1, or -1.
const warSide = (war, name) => (war.sides[0].some((member) => fold(member) === fold(name)) ? 0 : war.sides[1].some((member) => fold(member) === fold(name)) ? 1 : -1);
// A battle's side for a side of its war: the same, unless the battle was laid
// out before the war and its first side fights on the war's second.
const battleSide = (battle, side) => (battle.swap ? 1 - side : side);

// A standing battlefield whose two sides have gone to war with each other is
// that war's from now on: whoever has nobody there yet raises troops.
const adoptStanding = (run, war) => {
  for (const battle of run.battles) {
    if (battle.status !== "standing" || battle.home) continue;
    const first = warSide(war, battle.sides[0][0]);
    const second = warSide(war, battle.sides[1][0]);
    if (first < 0 || second < 0 || first === second) continue;
    battle.warId = war.id;
    battle.status = war.status === "ceasefire" ? "frozen" : "active";
    battle.swap = first === 1;
    // What stood on it was the posture of a border at peace: the war is the
    // event that ends it, and whoever began the war is there to attack (reviewStaff).
    for (const order of battle.orders) if (order.mark === SCENARIO_MARK) delete order.mark;
    battle.begun = battle.status === "active";
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) if (liveCount(battle.troops[side]) === 0) raiseTroops(battle, run, side);
    setRadii(battle);
    paintGround(battle, run);
    battle.planKey = "";
    battle.touched = true;
  }
};

// A day on a border built up in peace (march.js): the levies it is owed come in, and every troop on its way to it
// marches on; one told to dig in digs in where it is. Those told to stand down go home, their men given back
// (manpower.js), and a side that stands down whole calls up nobody more there. Nothing is fought and no ground
// changes hands.
const peaceDay = (run, battle, day) => {
  musterDay(run, battle, day);
  const marchKm = marchKmOf(run);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const leaving = [];
    battle.troops[side].forEach((troop, at) => {
      if (!isLive(troop)) return;
      if (liveOrder(troop)?.kind === "withdraw") leaving.push(at);
      else if (troop.dug) troop.goal = -1;
      // A route drawn for it in the war room, over its own side's ground (march.js walkRoute).
      else if (liveOrder(troop)?.kind === "way") {
        troop.goal = -1;
        if (walkRoute(battle, side, troop, marchKm, day)) battle.touched = true;
      } else if (troop.goal >= 0 && marchOn(battle, side, troop, marchKm)) battle.touched = true;
    });
    if (leaving.length === 0) continue;
    sendHome(run, battle, side, leaving);
    for (const at of leaving) battle.troops[side][at].strength = 0;
    if (liveCount(battle.troops[side]) === 0) battle.levy[side] = [];
    battle.log.push({ d: run.dateOf(day), k: "stood-down", s: side, at: `${leaving.length} formations sent home`, n: leaving.length });
    battle.touched = true;
  }
};

// A day on a border fortified in peace: nothing happens. Left at token effort
// with nothing ordered for long enough, or with nobody on it, it is given up.
const standDay = (battle) => {
  battle.quiet += 1;
  const manned = [HOLDER_SIDE_A, HOLDER_SIDE_B].filter((side) => liveCount(battle.troops[side]) > 0);
  // (A country's forces at home are given up only when none are left there or still to come: home.js.)
  if (battle.home) {
    if (manned.length === 0 && !levyOwed(battle.levy)) battle.closing = "stood-down";
    return;
  }
  if (manned.length === 0 || (battle.quiet >= STANDING_QUIET_DAYS && manned.every((side) => battle.effort[side] === "token"))) battle.closing = "stood-down";
};

// A saved battlefield against its war as the war now stands: who is in it,
// and whether it is fought, frozen or over.
const syncWithWar = (run, battle) => {
  if (battle.status === "standing") {
    for (const war of run.wars.values()) if (war.status !== "ended") adoptStanding(run, war);
    if (battle.status === "standing") return;
  }
  const war = run.wars.get(battle.warId);
  if (!war || war.status === "ended") {
    battle.closing = "war-over";
    return;
  }
  battle.swap = warSide(war, battle.sides[0][0]) === 1;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const theirs = war.sides[battleSide(battle, side)];
    const left = battle.sides[side].filter((member) => !theirs.some((name) => fold(name) === fold(member)));
    if (left.length > 0) leaveBattle(run, battle, left);
    joinBattle(run, battle, side, theirs);
  }
  battle.status = war.status === "ceasefire" ? "frozen" : "active";
};

// ---- a war that begins with an attack -------------------------------------------
// A side may send its troops at a country it is not at war with: a line of
// orders that has it attack across their border, an order aimed at a place the
// other holds, a transporter bound for its land. That IS the war beginning,
// whoever the other is: a country a person plays is attacked like any other.
// A war begins between the two (`starts`), whatever other war either is
// fighting: the country attacked is at war with whoever attacked it and with
// nobody else, and who else comes into that war is the story's to say. (Only
// a ROUTE drawn through a country outside a war brings it into that war,
// `joins`: the troops on that battlefield are the ones it has to fight.) The
// caller writes it into the war ledger, so the ledger says what the
// battlefields do.

const ATTACK_ORDERS = ["advance", "blitz", "spearhead", "flank", "encircle", "assault", "land"];
const isAttackWord = (word) => ATTACK_ORDERS.includes(word);
// The war two names are on opposite sides of (fought, or frozen), or null.
const warBetween = (run, a, b) => [...run.wars.values()].find((war) => war.status !== "ended" && warSide(war, a) >= 0 && warSide(war, b) >= 0 && warSide(war, a) !== warSide(war, b)) ?? null;
const slugOf = (name) => fold(name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
// Nobody's war: what stands in for one while a country at peace is finding its
// way to another's land, or asking whose a place is.
const peaceOf = (owner, others = []) => ({ id: "", status: "active", sides: [[owner], others], peace: true });

// The war an attack by one country on another is fought in from `day`, or
// null when there is none to be had (they are allies in a war, a ceasefire
// stands between them, or there is no room for another member).
//   serious   false for an order of the story's that is no war by itself (seriousAttack):
//             it opens only a war the story opens in the same answer
const attackOpensWar = (run, attacker, defender, day, serious = true) => {
  if (!clean(attacker) || !clean(defender) || fold(attacker) === fold(defender)) return null;
  const between = warBetween(run, attacker, defender);
  if (between) return between.status === "active" ? between : null;
  const date = run.dateOf(day);
  // Nobody attacks a country it is fighting a war beside.
  if ([...run.wars.values()].some((war) => war.status !== "ended" && warSide(war, attacker) >= 0 && warSide(war, attacker) === warSide(war, defender))) return null;
  // The story may open this very war in the same answer, on a later day: that is the war, and it begins today.
  const told = run.moments.findIndex(({ moment }, at) => at >= run.cursor && moment.type === "war" && moment.op === "start"
    && [[moment.names, moment.opponents], [moment.opponents, moment.names]].some(([one, other]) => memberList(one).some((name) => fold(name) === fold(attacker)) && memberList(other).some((name) => fold(name) === fold(defender))));
  if (told >= 0) {
    const [{ moment }] = run.moments.splice(told, 1);
    applyWarMoment(run, moment, day);
    return run.wars.get(clean(moment.warId)) ?? null;
  }
  if (!serious) return null;
  const id = `war-${slugOf(attacker)}-${slugOf(defender)}-${date}`;
  if (run.wars.has(id)) return run.wars.get(id).status === "active" ? run.wars.get(id) : null;
  run.wars.set(id, { id, title: "", status: "active", sides: [[clean(attacker)], [clean(defender)]], began: date });
  run.starts.push({ day, date, warId: id, attacker: clean(attacker), defender: clean(defender) });
  examineWar(run, run.wars.get(id), day);
  return run.wars.get(id);
};

// BATTLEFIELDS ARE FOR WARS. "Border clashes, minor incidents and so forth
// also just cause war fronts to happen": an order of the story's to attack a
// country its giver is at peace with used to be the war beginning, whatever
// the event behind it was. It begins one now only as a real offensive (effort
// major or total), or when the story opens that war itself in its ledger. A
// person's own order is that person's decision and always does: one given
// through the skip's function, and any line for a country a person plays (the
// story writes none for it of its own: such a line is what that person's
// action said).
const seriousAttack = (run, moment) => moment.given === true || WAR_EFFORTS.includes(moment.effort)
  || (Array.isArray(run.input?.players) ? run.input.players : []).some((name) => fold(name) === fold(moment.side));

// The battlefields two names fight each other on.
const frontsBetween = (run, a, b) => run.battles.filter((entry) => entry.status === "active" && sideOfName(entry, a) >= 0 && sideOfName(entry, b) >= 0 && sideOfName(entry, a) !== sideOfName(entry, b));
// The log's word for an attack that began a war, or brought a country into one.
const tellAttack = (run, battle, attacker, defender, day) => {
  const side = sideOfName(battle, attacker);
  if (side >= 0) battle.log.push({ d: run.dateOf(day), k: "attacked", s: side, at: `${run.isGroup(defender) ? "group" : "country"}: ${defender}` });
};
// Which of two names holds a region, 0 or 1, or -1: the group in whose area it lies where that group is one of
// them, else its controller, as in a war between the two (warSideOf). A group that is neither of them takes
// nothing from its country: an attack across a border it holds was refused as no border at all.
// (A country's force holds for the country whose force it is: battle.js groupSideOf.)
const pairSideOf = (run, first, second) => (id) => {
  const one = (name) => name && (name === fold(first) || name === fold(second));
  const group = fold(run.groupOf(id));
  const owner = group && !one(group) ? fold(run.groupOwnerOf(group)) : "";
  const holder = one(group) ? group : one(owner) ? owner : fold(run.controllerOf(id));
  return holder && holder === fold(first) ? 0 : holder && holder === fold(second) ? 1 : -1;
};
// Whether two names hold land that touches.
const landsTouch = (run, first, second) => {
  const regions = landRegionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  return findContacts(regions, pairSideOf(run, first, second), run.input.map).length > 0;
};

// An order that names no battlefield there is, but aims its side's troops at a
// place: who holds the place is who is attacked. Between two at war already it
// goes to the battlefields they share; between two at peace the war begins,
// and the battlefield that opens for it takes the order's name. A landing
// opens one round the place where they do not touch. Returns true when the
// order was put to somebody.
const attackAtObjective = (run, moment, day) => {
  const attacker = clean(moment.side);
  const grid = worldGridOf(run);
  if (!grid || !attacker) return false;
  const alone = peaceOf(attacker);
  const at = moment.objectiveAt && Number.isFinite(Number(moment.objectiveAt.lng)) && Number.isFinite(Number(moment.objectiveAt.lat))
    ? { lng: Number(moment.objectiveAt.lng), lat: Number(moment.objectiveAt.lat) }
    : placeNamed(run, grid, alone, moment.objective);
  if (!at) return false;
  const defender = holderAtPoint(run, grid, alone, at.lng, at.lat);
  if (!defender || fold(defender) === fold(attacker)) return false;
  const already = warBetween(run, attacker, defender);
  // (A landing needs no border; anything else needs one to cross.)
  if (!already && moment.order !== "land" && !landsTouch(run, attacker, defender)) return false;
  const war = already ?? attackOpensWar(run, attacker, defender, day, seriousAttack(run, moment));
  if (!war && !already && !seriousAttack(run, moment)) {
    run.notes.push({ kind: "minor-attack", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: attacker, ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return true;
  }
  if (!war || war.status !== "active") return false;
  let fronts = frontsBetween(run, attacker, defender);
  if (fronts.length === 0 && moment.order === "land" && openBattles(run).length < MAX_BATTLEFIELDS) {
    const taken = run.battles.some((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(moment.battlefield));
    const landing = openLandingAt(run, { war, sideName: attacker, lng: at.lng, lat: at.lat, name: taken ? "" : moment.battlefield, day });
    if (!landing) return false;
    if (!already) tellAttack(run, landing, attacker, defender, day);
    return true;
  }
  if (fronts.length === 0) return false;
  // The one the place lies on, where there are several.
  const near = fronts.find((entry) => pointInFrame(entry.frame, at.lng, at.lat)) ?? fronts[0];
  const named = givenName(run, moment.battlefield);
  if (named && near.autoNamed && near.fresh && !run.battles.some((entry) => entry !== near && entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(named))) {
    near.name = named;
    near.autoNamed = false;
  }
  if (!already) for (const front of fronts) tellAttack(run, front, attacker, defender, day);
  orderOnFront(run, near, { ...moment, battlefield: near.name }, day);
  return true;
};

// ---- moments -------------------------------------------------------------------

// A landing where no battlefield is: one opens round the place, the attacker
// holding a disc of ground there with an anchor that feeds it. The place is a
// city of the map or a region, by its exact name. null when it cannot be done.
const openLanding = (run, moment, day) => {
  const regions = regionsOf(run);
  const war = [...run.wars.values()].find((entry) => entry.status === "active" && entry.sides.some((members) => members.some((member) => fold(member) === fold(moment.side))));
  const named = /^\s*(city|region)\s*:\s*(.*)$/i.exec(String(moment.objective ?? ""));
  const wanted = fold(named ? named[2] : moment.objective);
  if (!war || !wanted || openBattles(run).length >= MAX_BATTLEFIELDS) return null;
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  const kind = named ? named[1].toLowerCase() : "";
  const city = kind === "region" ? null : (Array.isArray(map.cities) ? map.cities : []).find((entry) => fold(entry?.name) === wanted);
  const region = city || kind === "city" ? null : regions.find((entry) => fold(entry?.name) === wanted);
  if (!city && !region) return null;
  const [lng, lat] = city ? [Number(city.lng), Number(city.lat)] : middleOf(region);
  return openLandingAt(run, { war, sideName: moment.side, lng, lat, name: moment.battlefield, day });
};

// The battlefield a landing at a point opens, begun: the attacker holds a disc
// of ground there. null when it cannot be (no room for another battlefield,
// neither side's land near, or the place is not the other side's).
//   carried   the troops a transporter brought ([[strength, kind]...]): they
//             are the attacker's force there. Without it both sides raise theirs.
const openLandingAt = (run, { war, sideName, lng, lat, name = "", day, carried = null }) => {
  const regions = landRegionsOf(run);
  if (!war || openBattles(run).length >= MAX_BATTLEFIELDS) return null;
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  // The frame a contact there would have: the box round both sides' land within reach of the place.
  const contact = contactAt(regions, (id) => warSideOf(run, war, id), map, lng, lat);
  const frame = contact ? frameForContact(contact, map) : null;
  const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
  if (!arena) return null;
  const opening = { name: givenName(run, name), warId: war.id, sides: war.sides, frame, arena, day };
  const battle = openBattle(run, opening) ?? landingGround(run, opening);
  const side = sideOfName(battle, sideName);
  let [x, y] = battle.place.toCell(lng, lat);
  let cell = x >= 0 && y >= 0 && x < arena.cols && y < arena.rows ? Math.floor(y) * arena.cols + Math.floor(x) : -1;
  // (Troops set down on a coast are put on the other side's nearest ground: the point may fall in the water beside it.)
  if (carried && side >= 0 && cell >= 0 && battle.field.holders[cell] !== 1 - side) {
    cell = nearestHeldCell(battle.field, 1 - side, x, y, 4);
    if (cell >= 0) {
      x = (cell % arena.cols) + 0.5;
      y = Math.floor(cell / arena.cols) + 0.5;
    }
  }
  if (side < 0 || cell < 0 || battle.field.holders[cell] !== 1 - side) return null;
  takeCapsule(battle.field, side, x, y, x, y, LANDING_CELLS, LANDING_CELLS);
  redistance(battle.field);
  battle.anchors.push({ s: side, x, y });
  if (!opening.name) {
    battle.name = nameFor(run, battle);
    battle.autoNamed = true;
  }
  startBattle(run, battle, day, carried ? { side, x, y, load: carried, owner: Math.max(0, memberIndex(battle, side, sideName)) } : null);
  return battle;
};
const nearestHeldCell = (field, side, x, y, reach) => {
  const { cols, rows, holders } = field;
  let best = -1;
  let least = Infinity;
  for (let dy = -reach; dy <= reach; dy += 1) {
    const row = Math.floor(y) + dy;
    if (row < 0 || row >= rows) continue;
    for (let dx = -reach; dx <= reach; dx += 1) {
      const col = Math.floor(x) + dx;
      if (col < 0 || col >= cols || holders[row * cols + col] !== side) continue;
      const far = dx * dx + dy * dy;
      if (far < least) {
        least = far;
        best = row * cols + col;
      }
    }
  }
  return best;
};

// The ground of a battlefield whose sides do not touch yet: every cell held by
// its region's side, and no line.
const landingGround = (run, opening) => {
  const battle = loadBattle(run, {
    name: opening.name,
    warId: opening.warId,
    sides: opening.sides,
    frame: opening.frame,
    openedDate: run.dateOf(opening.day),
    status: "active",
    field: { mask: "", band: "", key: opening.arena.key },
    troops: ["", ""],
    named: [],
    pool: [0, 0],
    base: [0, 0],
    quality: [1, 1],
    effort: ["major", "major"],
    orders: [],
    brief: {},
    log: [],
  }, opening.arena);
  battle.openedDay = opening.day;
  battle.fresh = true;
  return battle;
};

// ---- withdrawing ------------------------------------------------------------------
// Troops told to withdraw go back from the line and leave the battlefield: a
// formation of the world is a unit of the world again, where it left from, and
// a counter the battle raised is stood down. THE GROUND STAYS AS IT IS: what a
// side took it still holds, with nobody standing on it, until the other side
// walks back in. A side whose last troops have gone is AWAY: it has nobody
// there, takes no formation in, and stands under an order to withdraw until it
// is told anything else. Then it comes back onto the ground it holds.

const standsToWithdraw = (battle, side) => battle.orders.some((order) => order.s === side && !order.chosen && order.order === "withdraw");
const withdrawWhoLeft = (run, battle, day) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const troops = battle.troops[side];
    let left = 0;
    for (let index = 0; index < troops.length; index += 1) {
      const troop = troops[index];
      const order = isLive(troop) && troop.order && troop.order.kind === "withdraw" ? troop.order : null;
      // Clear of the line, or with nowhere further back to go, or long enough on the way.
      if (!order || !(order.home === true || order.gone >= WITHDRAW_KM || day - order.since >= WITHDRAW_DAYS_MOST)) continue;
      const named = battle.named.find((entry) => entry.s === side && entry.i === index);
      if (named && !named.reported) {
        const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
        run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
        named.reported = true;
        battle.sentHome.set(named.unitId, side);
      }
      sendHome(run, battle, side, [index]);
      troop.strength = 0;
      troop.station = null;
      troop.order = null;
      left += 1;
    }
    if (left === 0) continue;
    battle.touched = true;
    battle.planKey = "";
    if (liveCount(troops) > 0) continue;
    // The last of them has gone.
    battle.away[side] = true;
    battle.pool[side] = 0;
    if (!standsToWithdraw(battle, side)) setStandingOrder(battle, side, { sector: "all", order: "withdraw", since: run.dateOf(day), age: 0 });
    battle.log.push({ d: run.dateOf(day), k: "withdrew", s: side, at: "" });
  }
};
// A side that is away and is no longer told to be comes back: it raises its troops on the ground it holds.
const comeBack = (run, battle, day) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (!battle.away[side] || standsToWithdraw(battle, side)) continue;
    battle.away[side] = false;
    for (const [unitId, of] of [...battle.sentHome]) if (of === side) battle.sentHome.delete(unitId);
    if (liveCount(battle.troops[side]) > 0) continue;
    raiseTroops(battle, run, side);
    setRadii(battle);
    paintGround(battle, run);
    battle.planKey = "";
    battle.touched = true;
    if (liveCount(battle.troops[side]) > 0) battle.log.push({ d: run.dateOf(day), k: "returned", s: side, at: "" });
  }
};

// MORE TROOPS FOR A FRONT (REINFORCE_ORDER). "Make it so actions can deploy
// more troops to fronts: this allows the user to do a draft for more troops or
// send reinforcements." Fresh formations for one side of a battlefield, as
// many as the order says: raised on that side's own ground along the stretch
// of line the order names, with the reserves that keep them up to strength,
// and put under whatever that stretch is told to do. A person's own order
// always brings them; the story's, for a country nobody plays, when it rests
// on an event of its answer (a mobilisation is something that happens). How
// many a side can be brought to is held (REINFORCED_SIZE_MOST, REINFORCED_LINE_MOST).
const reinforceOnFront = (run, battle, moment, day) => {
  const note = { kind: "", battlefield: battle.name, side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const side = sideOfName(battle, moment.side);
  if (side < 0) {
    run.notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  const played = (Array.isArray(run.input?.players) ? run.input.players : []).some((name) => fold(name) === fold(moment.side));
  if (moment.unbound === true && moment.given !== true && !played) {
    run.notes.push({ ...note, kind: "reinforce-needs-event" });
    return;
  }
  if (battle.status !== "active" && battle.status !== "standing") {
    run.notes.push({ ...note, kind: "reinforce-halted" });
    return;
  }
  const owner = Math.max(0, memberIndex(battle, side, moment.side));
  const strength = memberWeights(battle, run, side).reduce((sum, weight) => sum + weight, 0);
  // What its own strength raises here: the number a draft is judged against.
  const usual = Math.max(troopsLeast(run.troops), Math.round(troopsWanted(strength, battle.effort[side], run.troops)));
  const live = liveCount(battle.troops[side]);
  // (A call-up of a deployment drawn in the war room is a player's own: it is held by the men there are and the room
  // the line has, never by what its strength usually raises, which knows nothing of the army it already fields.)
  const room = Math.min(
    MAX_TROOPS_PER_SIDE - battle.troops[side].length,
    moment.deployed ? MAX_TROOPS_PER_SIDE : REINFORCED_SIZE_MOST * usual - live,
    // (At home there is no line to be crowded: home.js.)
    battle.home ? MAX_TROOPS_PER_SIDE : REINFORCED_LINE_MOST * troopsCap(battle.lineKm, run.troops) - live,
  );
  // And the men have to be there to call up (manpower.js): weighing military figures, a country's last men too, as a
  // counter at part strength, and a country with no army has nobody to call up (military.js).
  const military = run.mech.military;
  const drafted = battle.sides[side][owner];
  const noArmy = military && landWorth(run.militaryOf(drafted)) === 0;
  const fullCounters = noArmy ? 0 : formationsLeft(run, drafted);
  const lastPart = military && !noArmy ? partLeft(run, drafted) : 0;
  const men = fullCounters + (lastPart > 0 ? 1 : 0);
  const said = Number(moment.count);
  const asked = Number.isFinite(said) && said >= 1 ? Math.min(REINFORCE_MOST, Math.round(said)) : Math.max(2, Math.round(usual * REINFORCE_USUAL_SHARE));
  const count = Math.max(0, Math.min(asked, room, men));
  if (count === 0) {
    run.notes.push({ ...note, kind: room > 0 && men <= 0 ? "reinforce-no-men" : "reinforce-full" });
    return;
  }
  // Where: its side's own ground along the line, on the stretch the order names, and its own country's where it has some.
  const today = prepare(battle, day);
  const sector = resolveSector(battle.arena, today.line, today.sectors, moment.sector);
  const whole = !sector || sector.kind === "all";
  const { cols } = battle.field;
  const contour = traceContour(battle.field);
  const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;
  let cells = [];
  for (let vertex = 0; vertex < own.length; vertex += 1) if (own[vertex] >= 0) cells.push(own[vertex]);
  if (!whole) {
    const inside = cells.filter((cell) => inSector(sector, (cell % cols) + 0.5, Math.floor(cell / cols) + 0.5, battle.place.kmAt));
    if (inside.length > 0) cells = inside;
  }
  const wantedName = fold(battle.sides[side][owner]);
  const home = cells.filter((cell) => {
    const region = battle.arena.region[cell];
    return region > 0 && fold(holderOf(battle, run, battle.arena.ids[region])) === wantedName;
  });
  if (home.length > 0) cells = home;
  if (cells.length === 0 && battle.field.holders.indexOf(side) >= 0) cells = [battle.field.holders.indexOf(side)];
  // (At home, round its cities: home.js.)
  if (battle.home) cells = homeCells(battle, side, ownGroundOf(battle, run, side, drafted), count);
  // (On the line its commander drew for its new troops, where it drew one: deploy.js.)
  const along = cells;
  cells = deployCells(battle, side, drafted, cells);
  const onLine = cells !== along;
  if (cells.length === 0) {
    run.notes.push({ ...note, kind: "reinforce-no-ground" });
    return;
  }
  const first = battle.troops[side].length;
  let called = 0;
  kindsFor(count, run.era, military ? mixOf(run.militaryOf(drafted)) : null).forEach((kind, index) => {
    const cell = cells[Math.min(cells.length - 1, Math.floor(((index + 0.5) * cells.length) / count))];
    const strength = military && index === count - 1 && count > fullCounters ? Math.round(100 * lastPart) : 100;
    battle.troops[side].push(createTroop({ x: (cell % cols) + 0.5, y: Math.floor(cell / cols) + 0.5, kind, owner, strength }));
    called += (strength / 100) * menOf(run, drafted);
  });
  draw(run, drafted, military ? called : count * run.menEach);
  battle.pool[side] += count * POOL_PER_TROOP * battle.edge[side].reserves;
  // (Where they come as a swarm they stand as one first: swarms.js.)
  const swarmed = gatherNewcomers(battle, side, owner, first, run.warfare);
  // (Called up inside its country, they march there: march.js.)
  if (marchesFor(run, battle)) sendInland(battle, run, side, battle.troops[side].slice(first));
  putUnderStanding(run, battle, side, first, today, day);
  // (Troops come back to a battlefield their side had left.)
  if (battle.away[side]) comeBack(run, battle, day);
  // (Called up on a deployment, where they came in is where it was drawn: callUpDeployed.)
  const where = moment.deployed && swarmed > 0 ? "where its swarm gathers"
    : moment.deployed && onLine ? "on its deployment line"
      : battle.home ? "round its cities"
      : whole ? "along its whole line" : `in the ${sector.word ?? clean(moment.sector)}`;
  // (Called up by its own staff, it says so: staffCallUp.)
  battle.log.push({ d: run.dateOf(day), k: moment.staff ? "mobilised" : "drafted", s: side, at: `${count} fresh formations ${where}`, n: count });
  battle.quiet = 0;
  battle.touched = true;
  battle.planKey = "";
};

// TROOPS CALLED UP ON A DEPLOYMENT. "the deployment tool in the war room
// doesnt seem to work. it does draw the line, but the troops are never
// actually deployed" (the owner, 2026-10-24). A deployment drawn in the war
// room calls up fresh formations of its country's there (deploy.js `call`):
// on the first day of the run after it was drawn they are drafted as for an
// order for more troops of the whole line (reinforceOnFront), and so come in
// on the line or at the swarm's place, with the men it has left and the room
// the battlefield has. The call is then spent, and `last` on the deployment
// says what came of it, kept with it as it is handed on (battle.js).
//
// HOW MANY. "people also report that being able to just spawn 60 troops every
// turn is super op, so remove the thing to select how many troops and just
// make it a realistic amount based on how many availible troops remain, how
// many supplies, weariness, and mustering speed" (the owner, 2026-11-02). Of
// the army the country's strength fields there (troopsWanted), the share its
// mustering curve calls up in the days the run passes (muster.js; all of it in
// CALL_UP_FULL_DAYS where no curve is known), less what it is short of
// (supplies, war weariness and a blockade together: run.shortageOf); held, as
// every draft is, to the men it has left and the room there is
// (reinforceOnFront). At least one; none for a deployment drawn as a line only.
export const callUpSize = (run, battle, side, member) => {
  const owner = Math.max(0, memberIndex(battle, side, member));
  const usual = Math.max(troopsLeast(run.troops), Math.round(troopsWanted(memberWeights(battle, run, side)[owner] ?? 0, battle.effort[side], run.troops)));
  const days = Math.max(1, run.days);
  const table = run.musterOf(member)?.table;
  const called = Array.isArray(table) && table.length > 0 ? table[Math.min(table.length - 1, days)] : Math.min(1, days / CALL_UP_FULL_DAYS);
  return Math.max(1, Math.floor(usual * called * (1 - run.shortageOf(member))));
};

const callUpDeployed = (run) => {
  for (const battle of run.battles) {
    if (battle.status === "closed" || battle.closing || !Array.isArray(battle.deploy)) continue;
    battle.deploy.forEach((entries, side) => {
      entries.forEach((entry, at) => {
        if (entry.call === undefined) return;
        const before = battle.troops[side].length;
        const noted = run.notes.length;
        // (At home, once a day at most: callUpAtHome.)
        if (battle.home && battle.calledOn === run.dateOf(0)) return;
        const moment = { side: entry.country, sector: "all", given: true, deployed: true, count: entry.call === 0 ? 0 : callUpSize(run, battle, side, entry.country) };
        if (battle.home) battle.calledOn = run.dateOf(0);
        reinforceOnFront(run, battle, moment, 0);
        const n = battle.troops[side].length - before;
        const said = run.notes.slice(noted).map((note) => note.kind).filter((kind) => DEPLOY_WHY[kind]);
        const spent = { ...entry };
        delete spent.call;
        entries[at] = { ...spent, last: { n, why: n > 0 ? "" : DEPLOY_WHY[said[said.length - 1]] ?? "", d: run.dateOf(0) } };
      });
    });
  }
};

// A CITY BEYOND THE BATTLEFIELD'S EDGE AS AN OBJECTIVE. "Why do they not see
// Mexico City": a battlefield's places were the cities inside its frame, and
// the frame is the box round its line. A city the map has, past the edge and
// within OBJECTIVE_BEYOND_KM of it, is a place troops can be sent at: the
// frame grows to hold it before the order is read, and the order then finds
// it as it finds any other. (A region, a structure or a formation named is
// looked for where it always was.)
const holdObjective = (run, battle, objective, day) => {
  const text = clean(objective);
  if (!text || battle.status === "closed" || !battle.field || findPlace(battle.arena, text)) return false;
  const colon = text.indexOf(":");
  const kind = colon >= 0 ? fold(text.slice(0, colon)) : "";
  const name = fold(colon >= 0 ? text.slice(colon + 1) : text);
  if (!name || (kind && kind !== "city")) return false;
  const city = (Array.isArray(run.input?.map?.cities) ? run.input.map.cities : []).find((entry) => fold(entry?.name) === name);
  if (!city || !Number.isFinite(Number(city.lng)) || !Number.isFinite(Number(city.lat))) return false;
  const [x, y] = battle.place.toCell(Number(city.lng), Number(city.lat));
  const beyond = Math.max(0, -x, x - battle.frame.cols, -y, y - battle.frame.rows);
  if (!(beyond * battle.frame.km <= OBJECTIVE_BEYOND_KM)) return false;
  return growToHold(battle, run, day, Number(city.lng), Number(city.lat));
};

// An order on a battlefield that is fought over (or frozen): put to its side as it is.
const orderOnFront = (run, battle, moment, day) => {
  if (moment.order === REINFORCE_ORDER) {
    reinforceOnFront(run, battle, moment, day);
    return;
  }
  if (moment.objective) holdObjective(run, battle, moment.objective, day);
  // A side that had withdrawn and is told anything else comes back first, and the order is put to those who came.
  const ordered = sideOfName(battle, moment.side);
  if (battle.status === "active" && ordered >= 0 && battle.away[ordered] && FRONT_ORDERS.includes(moment.order) && moment.order !== "withdraw") {
    battle.orders = battle.orders.filter((order) => !(order.s === ordered && !order.chosen && order.order === "withdraw"));
    comeBack(run, battle, day);
  }
  const today = prepare(battle, day);
  applyOrder(battle, moment, { ...today, date: run.dateOf(day), run }, run.notes);
  battle.touched = true;
  // What a result took is counted on its own day: a town in the log, a region changing hands.
  if (battle.status === "active" && battle.cityHolder) settleRegions(battle, run, day);
};

// An order for a border: `border: A / B`, to dig in or to hold. It opens a
// standing battlefield along the stretch where the two touch if there is none,
// raises troops there for the side that gives it, and puts the order to them.
// Between two that are at war already the border is the front: the order goes
// to every battlefield the two share, whatever it is. And an order to ATTACK
// across a border in peace, from one of the two, is the war beginning: the
// battlefield along it opens (one fortified in peace becomes the front), and
// the order is carried out there.
const applyBorderMoment = (run, moment, day, first, second) => {
  const note = { kind: "", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const names = [clean(`${first} / ${second} border`, BATTLEFIELD_NAME_MAX), clean(`${second} / ${first} border`, BATTLEFIELD_NAME_MAX)];
  let battle = run.battles.find((entry) => entry.status !== "closed" && names.some((name) => foldBattlefieldName(entry.name) === foldBattlefieldName(name))) ?? null;
  const peace = !warBetween(run, first, second);
  const other = fold(moment.side) === fold(first) ? second : fold(moment.side) === fold(second) ? first : "";
  if (peace && !battle && other && fold(first) !== fold(second) && ATTACK_ORDERS.includes(moment.order) && moment.order !== "land") {
    if (!landsTouch(run, first, second)) {
      run.notes.push({ ...note, kind: "border-not-found" });
      return;
    }
    const war = attackOpensWar(run, clean(moment.side), other, day, seriousAttack(run, moment));
    const fronts = war ? frontsBetween(run, first, second) : [];
    if (fronts.length === 0) {
      run.notes.push({ ...note, kind: !war && !seriousAttack(run, moment) ? "minor-attack" : "not-at-war" });
      return;
    }
    for (const front of fronts) {
      tellAttack(run, front, clean(moment.side), other, day);
      orderOnFront(run, front, { ...moment, battlefield: front.name }, day);
    }
    return;
  }
  if (!battle) {
    const fronts = run.battles.filter((entry) => entry.status !== "closed" && entry.status !== "standing" && sideOfName(entry, first) >= 0 && sideOfName(entry, second) >= 0 && sideOfName(entry, first) !== sideOfName(entry, second));
    if (fronts.length > 0) {
      for (const front of fronts) orderOnFront(run, front, { ...moment, battlefield: front.name }, day);
      return;
    }
    const atWar = [...run.wars.values()].some((war) => war.status !== "ended" && warSide(war, first) >= 0 && warSide(war, second) >= 0 && warSide(war, first) !== warSide(war, second));
    if (atWar || !["dig in", "hold"].includes(moment.order) || fold(first) === fold(second)) {
      run.notes.push({ ...note, kind: atWar ? "border-at-war" : "not-at-war" });
      return;
    }
    if (openBattles(run).length >= MAX_BATTLEFIELDS) {
      run.notes.push({ ...note, kind: "too-many-battlefields" });
      return;
    }
    const regions = landRegionsOf(run);
    if (!regions) throw REGIONS_NEEDED;
    const map = run.input.map;
    for (const contact of findContacts(regions, pairSideOf(run, first, second), map)) {
      const frame = frameForContact(contact, map);
      const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
      battle = arena ? openBattle(run, { name: names[0], warId: "", sides: [[first], [second]], frame, arena, day }) : null;
      if (battle) break;
    }
    if (!battle) {
      run.notes.push({ ...note, kind: "border-not-found" });
      return;
    }
    battle.status = "standing";
    run.battles.push(battle);
    setRadii(battle);
    paintGround(battle, run);
    keepStart(battle);
    readSieges(battle);
    findPockets(battle);
    startRecorder(battle, run, day);
  }
  orderOnBorder(run, battle, moment, day);
};

// An order given on a border fortified in peace, by whichever name the
// battlefield was called. The side that gives it raises troops there if it has
// none; told to leave by every side that has troops there, it is given up.
const orderOnBorder = (run, battle, moment, day) => {
  const note = { kind: "", battlefield: battle.name, side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const side = sideOfName(battle, moment.side);
  if (side < 0) {
    run.notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  battle.quiet = 0;
  battle.touched = true;
  // An order to attack across a border fortified in peace is the war beginning:
  // the battlefield is that war's from today, with whoever stands on it.
  if (battle.status === "standing" && ATTACK_ORDERS.includes(moment.order) && moment.order !== "land") {
    const attacker = battle.sides[side].find((member) => fold(member) === fold(moment.side)) ?? battle.sides[side][0];
    const defender = battle.sides[1 - side][0];
    if (attackOpensWar(run, attacker, defender, day, seriousAttack(run, moment)) && battle.status === "active") tellAttack(run, battle, attacker, defender, day);
    else if (battle.status === "standing" && !seriousAttack(run, moment)) {
      run.notes.push({ ...note, kind: "minor-attack" });
      return;
    }
  }
  if (battle.status === "standing") {
    if (FRONT_EFFORTS.includes(moment.effort)) battle.effort[side] = moment.effort;
    // Told to leave by every side that has troops there, it is given up.
    // (To fall back from a border fortified in peace, or to withdraw from it, is to go home.)
    const goes = moment.order === "fall back" || moment.order === "withdraw";
    battle.leaving[side] = goes;
    if ([HOLDER_SIDE_A, HOLDER_SIDE_B].every((each) => battle.leaving[each] || liveCount(battle.troops[each]) === 0) && goes) {
      battle.closing = "stood-down";
      return;
    }
    if (liveCount(battle.troops[side]) === 0 && ["dig in", "hold"].includes(moment.order)) {
      raiseTroops(battle, run, side);
      setRadii(battle);
      paintGround(battle, run);
    }
  }
  orderOnFront(run, battle, { ...moment, battlefield: battle.name }, day);
};

// ---- a country's forces at home ----------------------------------------------------------
// (home.js.) The story builds them up for any country, `home: Country`, and
// stations them on a border: for a country a person plays, when an action or a
// project of theirs does ("there shouldnt be a build up forces button, it should
// only be done through actions and projects": the owner, 2026-11-03). They are
// a battlefield of their own, standing, and fight nobody.

const HOME = /^\s*home\s*:\s*(.+?)\s*$/i;
const COUNTRY_OBJECTIVE = /^\s*country\s*:\s*(.+?)\s*$/i;

const homeForcesOf = (run, country) => run.battles.find((battle) => battle.home && battle.status !== "closed" && !battle.closing && fold(battle.sides[0][0]) === fold(country)) ?? null;

// Who holds the ground a cell of a battle is: the region's group in its war, or its controller; "" for none.
const holderAtCell = (battle, run, cell) => {
  const region = cell >= 0 ? battle.arena.region[cell] : 0;
  return region > 0 ? clean(holderOf(battle, run, battle.arena.ids[region])) : "";
};

// A test of a cell for a member's own ground on a battle, its regions read once.
const ownGroundOf = (battle, run, side, member) => {
  const { arena, field } = battle;
  const mine = new Uint8Array(arena.ids.length);
  for (let region = 1; region < arena.ids.length; region += 1) if (fold(holderOf(battle, run, arena.ids[region])) === fold(member)) mine[region] = 1;
  return (cell) => field.holders[cell] === side && field.play[cell] === 1 && mine[arena.region[cell]] === 1;
};

// A country's forces at home, opened: a frame round its land (HOME_MARGIN_KM beyond it), its neighbours the
// other side. null where it holds no land on the map, or nobody else's is near.
const openHome = (run, country, day) => {
  const regions = landRegionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const holderOfId = (id) => run.groupOf(id) || run.controllerOf(id);
  const bounds = homeBounds(regions.filter((region) => fold(holderOfId(region.id)) === fold(country)));
  if (!bounds) return null;
  const map = run.input.map;
  const frame = createFrame(bounds, { ...measureOptions(map), marginKm: HOME_MARGIN_KM });
  const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
  if (!arena) return null;
  const neighbours = homeNeighbours(arena, holderOfId, country);
  if (neighbours.length === 0) return null;
  const battle = openBattle(run, { name: homeName(country), warId: "", sides: [[clean(country)], neighbours], frame, arena, day, home: true });
  if (!battle) return null;
  battle.status = "standing";
  battle.effort = ["major", "token"];
  run.battles.push(battle);
  setRadii(battle);
  paintGround(battle, run);
  keepStart(battle);
  readSieges(battle);
  findPockets(battle);
  startRecorder(battle, run, day);
  return battle;
};

// A call-up of a country's forces at home, once a day at most: the army its strength fields (troopsWanted, at a
// major effort), less what it is short of (supplies, war weariness, a blockade: run.shortageOf), or as many as the
// story says if that is fewer; round its cities (reinforceOnFront: home.js homeCells), held to the men it has.
// Weighing a war's mustering (muster.js) only its peacetime army (MUSTER_STANDING_SHARE) is there at once, and the
// rest come in as its curve calls them up from today, round its cities too (musterDay).
const callUpAtHome = (run, battle, moment, day) => {
  const date = run.dateOf(day);
  if (battle.calledOn === date) {
    run.notes.push({ kind: "called-today", battlefield: battle.name, side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return;
  }
  const member = battle.sides[HOLDER_SIDE_A][0];
  const usual = Math.max(troopsLeast(run.troops), Math.round(troopsWanted(memberWeights(battle, run, HOLDER_SIDE_A)[0] ?? 0, "major", run.troops)));
  const most = Math.max(1, Math.round(usual * (1 - run.shortageOf(member))));
  const said = Number(moment.count);
  const count = Number.isFinite(said) && said >= 1 ? Math.min(Math.round(said), most) : most;
  const mustering = Boolean(run.musterOf(member)?.table);
  const now = mustering ? Math.max(1, Math.floor(count * MUSTER_STANDING_SHARE)) : count;
  const before = battle.troops[HOLDER_SIDE_A].length;
  reinforceOnFront(run, battle, { ...moment, battlefield: battle.name, sector: "all", given: true, deployed: true, count: now }, day);
  const came = battle.troops[HOLDER_SIDE_A].length - before;
  if (mustering && came > 0 && count > came) battle.levy[HOLDER_SIDE_A].push({ o: 0, t: count, r: came, f: date });
  battle.calledOn = date;
};

// A country's forces at home sent to stand on its border with another (the story: an order with `country: X` for
// its objective): the nearest of them to it, half of them (all, at effort major or total), each to its own place
// along it, at the march's pace (march.js marchOn); dug in there, where they were told to dig in.
const stationOnBorder = (run, battle, target, moment, day) => {
  const { field } = battle;
  const theirs = (cell) => fold(holderAtCell(battle, run, cell)) === fold(target);
  const border = borderCells(battle, HOLDER_SIDE_A, theirs);
  if (border.length === 0) {
    run.notes.push({ kind: "border-not-found", battlefield: battle.name, side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return;
  }
  const troops = battle.troops[HOLDER_SIDE_A];
  const nearest = (troop) => {
    let best = Infinity;
    for (let at = 0; at < border.length; at += Math.max(1, Math.floor(border.length / 64))) {
      const dx = (border[at] % field.cols) + 0.5 - troop.x;
      const dy = Math.floor(border[at] / field.cols) + 0.5 - troop.y;
      if (dx * dx + dy * dy < best) best = dx * dx + dy * dy;
    }
    return best;
  };
  const live = troops.map((troop, at) => ({ at, far: isLive(troop) ? nearest(troop) : Infinity })).filter((entry) => entry.far < Infinity).sort((a, b) => a.far - b.far || a.at - b.at);
  const count = WAR_EFFORTS.includes(moment.effort) ? live.length : Math.ceil(live.length / 2);
  const going = live.slice(0, count).map((entry) => entry.at).sort((a, b) => troops[a].y - troops[b].y || troops[a].x - troops[b].x || a - b);
  going.forEach((at, index) => {
    const troop = troops[at];
    troop.goal = border[Math.min(border.length - 1, Math.floor(((index + 0.5) * border.length) / going.length))];
    troop.dug = false;
    if (troop.order && !troop.order.done) troop.order.done = true;
  });
  if (going.length > 0) battle.log.push({ d: run.dateOf(day), k: "stationed", s: HOLDER_SIDE_A, at: `${going.length} formations to the border with ${target}`, n: going.length });
};

// Every troop of a country's forces at home sent home, its men given back; nothing more called up there.
const standDownAtHome = (run, battle, day) => {
  sendHome(run, battle, HOLDER_SIDE_A);
  for (const troop of battle.troops[HOLDER_SIDE_A]) troop.strength = 0;
  battle.levy[HOLDER_SIDE_A] = [];
  battle.log.push({ d: run.dateOf(day), k: "stood-down", s: HOLDER_SIDE_A, at: "all its forces at home sent home" });
  battle.closing = "stood-down";
};

const applyHomeMoment = (run, moment, day, country) => {
  const note = { kind: "", battlefield: homeName(country), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  // Only a country orders its own forces at home.
  if (fold(moment.side) !== fold(country)) {
    run.notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  let battle = homeForcesOf(run, country);
  if (moment.order === "withdraw" || moment.order === "fall back") {
    if (battle) standDownAtHome(run, battle, day);
    return;
  }
  if (!battle) {
    if (run.battles.filter((entry) => entry.home && entry.status !== "closed").length >= MAX_HOME_FORCES) {
      run.notes.push({ ...note, kind: "too-many-battlefields" });
      return;
    }
    battle = openHome(run, country, day);
    if (!battle) {
      run.notes.push({ ...note, kind: "home-not-found" });
      return;
    }
  }
  battle.quiet = 0;
  battle.touched = true;
  if (moment.order === "reinforce") {
    callUpAtHome(run, battle, moment, day);
    return;
  }
  const target = COUNTRY_OBJECTIVE.exec(String(moment.objective ?? ""));
  if (target && ["hold", "dig in"].includes(moment.order)) {
    stationOnBorder(run, battle, clean(target[1]), moment, day);
    return;
  }
  if (["hold", "dig in"].includes(moment.order)) orderOnFront(run, battle, { ...moment, battlefield: battle.name }, day);
  else run.notes.push({ ...note, kind: "home-no-front" });
};

// THE WAR BEGUN FROM GROUND BUILT UP IN PEACE. "it shouldnt prevent attacks,
// you should be able to start wars by moving troops into others land" (the
// owner, 2026-11-02). Troops of a border built up in peace told from the war
// room to attack across it, or of a border or a country's forces at home sent
// along a route into another country's land: the war between the two begins
// as the run does (attackOpensWar), and they carry the order out on its
// battlefield (adoptStanding; for those at home, bringHome).
const attackFromStanding = (run, battle) => {
  if (battle.status !== "standing" || battle.closing) return;
  for (const order of battle.orders) {
    if (!order.chosen || !(order.s === HOLDER_SIDE_A || order.s === HOLDER_SIDE_B)) continue;
    const attacker = battle.sides[order.s].find((member) => fold(member) === fold(order.by)) ?? battle.sides[order.s][0];
    let defender = "";
    if (Array.isArray(order.way) && order.way.length > 0) {
      // From where its troops stand: the way to the route's first point is part of it.
      let x = 0;
      let y = 0;
      let count = 0;
      for (const troop of battle.troops[order.s]) {
        if (!isLive(troop) || !(troop.order && !troop.order.done && troop.order.standing === order)) continue;
        x += troop.x;
        y += troop.y;
        count += 1;
      }
      const way = order.way.map(([lng, lat]) => battle.place.toCell(lng, lat));
      defender = wayInto(battle, order.s, count > 0 ? [[x / count, y / count], ...way] : way, (cell) => holderAtCell(battle, run, cell));
    } else if (!battle.home && ATTACK_ORDERS.includes(order.order)) defender = battle.sides[1 - order.s][0];
    if (!defender || fold(defender) === fold(attacker)) continue;
    const war = attackOpensWar(run, attacker, defender, 0, true);
    if (!war) continue;
    for (const front of run.battles) if (front.warId === war.id && front.status === "active") tellAttack(run, front, attacker, defender, 0);
    if (battle.status !== "standing") return;
  }
};

// FORCES AT HOME JOIN A WAR'S BATTLEFIELD. Those of a country's forces at home
// that stand on its side's ground within HOME_JOIN_KM of a battlefield's line,
// in a war of that country's, join it where they stand, as troops of its side,
// and are at home no more; what they were told there (a route drawn for them)
// they carry on with (homeOrders). Returns what homeOrders needs: [{ order, picked }].
const bringHome = (run, battle, day) => {
  const handed = [];
  if (battle.status !== "active" || battle.home) return handed;
  for (const home of run.battles) {
    if (!home.home || home.status === "closed" || home.closing) continue;
    const country = home.sides[0][0];
    const side = sideOfName(battle, country);
    if (side < 0) continue;
    const owner = Math.max(0, memberIndex(battle, side, country));
    const toOther = measure(battle)[1 - side];
    const moved = new Map();
    home.troops[HOLDER_SIDE_A].forEach((troop, at) => {
      if (!isLive(troop) || battle.troops[side].length >= MAX_TROOPS_PER_SIDE) return;
      const [lng, lat] = home.place.toLngLat(troop.x, troop.y);
      const [x, y] = battle.place.toCell(lng, lat);
      const cell = cellAt(battle.field, x, y);
      if (cell < 0 || battle.field.holders[cell] !== side || (toOther[cell] / 3) * battle.frame.km > HOME_JOIN_KM) return;
      const joined = createTroop({ x, y, kind: troop.kind, owner, strength: troop.strength });
      if (troop.fatigue > 0) joined.fatigue = troop.fatigue;
      battle.troops[side].push(joined);
      moved.set(at, { index: battle.troops[side].length - 1, order: troop.order && !troop.order.done ? troop.order.standing ?? null : null });
      troop.strength = 0;
    });
    if (moved.size === 0) continue;
    for (const order of home.orders) {
      if (!order.chosen) continue;
      const picked = [...moved.values()].filter((entry) => entry.order === order).map((entry) => entry.index);
      if (picked.length === 0) continue;
      handed.push({ order: { s: side, sector: "all", order: order.order, since: run.dateOf(day), chosen: true, ...(order.way ? { way: order.way } : {}), ...(order.by ? { by: order.by } : {}), ...(order.effort ? { effort: order.effort } : {}) }, picked });
    }
    home.touched = true;
    home.planKey = "";
    battle.log.push({ d: run.dateOf(day), k: "drafted", s: side, at: `${moved.size} formations from ${country}'s forces at home`, n: moved.size });
    battle.touched = true;
    battle.planKey = "";
  }
  return handed;
};

// What the troops brought from home were told, told them here.
const homeOrders = (run, battle, handed, day) => {
  if (!Array.isArray(handed) || handed.length === 0) return;
  const today = prepare(battle, day);
  for (const { order, picked } of handed) {
    battle.orders.push(order);
    assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run }, { picked, lagless: true });
  }
  markAttacks(run, battle);
};

const applyOrderMoment = (run, moment, day) => {
  // A capture the story stated, as the order the turn drew from it (its ref ends "<event>:<region>",
  // AI/frontTurn.js statedCaptures), is not made where the same capture was refused (captureRefused).
  if (moment.result === "captured" && run.capturesRefused?.size > 0) {
    const ref = clean(moment.ref);
    for (const key of run.capturesRefused) if (ref.endsWith(key)) return;
  }
  const border = BORDER.exec(String(moment.battlefield ?? ""));
  if (border) {
    applyBorderMoment(run, moment, day, clean(border[1]), clean(border[2]));
    return;
  }
  const home = HOME.exec(String(moment.battlefield ?? ""));
  if (home) {
    applyHomeMoment(run, moment, day, clean(home[1]));
    return;
  }
  const wanted = foldBattlefieldName(moment.battlefield);
  let battle = wanted ? run.battles.find((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === wanted) : null;
  // A war's id for the name: the order is for that war's battlefield where the
  // side fights, which keeps its own name.
  if (!battle && wanted && !givenName(run, moment.battlefield)) {
    battle = run.battles.find((entry) => entry.status !== "closed" && fold(entry.warId) === wanted && sideOfName(entry, moment.side) >= 0) ?? null;
    if (battle) moment = { ...moment, battlefield: battle.name };
  }
  if (!battle && wanted) {
    // A battlefield that opened by itself this run takes the name its first
    // order gives it, unless that name is a war's id.
    battle = run.battles.find((entry) => entry.autoNamed && entry.fresh && entry.status === "active" && sideOfName(entry, moment.side) >= 0) ?? null;
    const named = givenName(run, moment.battlefield);
    if (battle && named) {
      battle.name = named;
      battle.autoNamed = false;
    }
    if (battle) moment = { ...moment, battlefield: battle.name };
  }
  if (!battle && wanted && moment.order === "land") {
    battle = openLanding(run, moment, day);
    if (battle) return;
  }
  // No battlefield of that name: an attack aimed at a place is an attack on whoever holds it.
  if (!battle && wanted && ATTACK_ORDERS.includes(moment.order) && clean(moment.objective) && attackAtObjective(run, moment, day)) return;
  if (!battle) {
    run.notes.push({ kind: "unknown-battlefield", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return;
  }
  if (battle.status === "standing") orderOnBorder(run, battle, moment, day);
  else orderOnFront(run, battle, moment, day);
};

const applyWarMoment = (run, moment, day) => {
  const id = clean(moment.warId);
  const names = memberList(moment.names);
  const mine = () => run.battles.filter((battle) => battle.warId === id && battle.status !== "closed");
  if (moment.op === "start") {
    if (!id || run.wars.has(id)) return;
    run.wars.set(id, { id, title: clean(moment.title), status: "active", sides: [names, memberList(moment.opponents)], began: run.dateOf(day) });
    examineWar(run, run.wars.get(id), day);
    return;
  }
  const war = run.wars.get(id);
  if (!war) return;
  if (moment.op === "join-a" || moment.op === "join-b") {
    const side = moment.op === "join-a" ? 0 : 1;
    // A country that troops are on their way into is brought in by those
    // troops, on the day they come to it (invadeWhereSent), and not on the day
    // the story names: the run that was made before the story was written did
    // it that way, and this one has to be that run again.
    if (moment.sent !== true) {
      // (The same for a country a transporter is bound for: it is in the war on the day the troops are put down there.)
      const shipped = (name) => run.transports.some((transport) => transport.status === "moving" && transport.warId === id && warSide(war, transport.owner) === 1 - side
        && asArrayOf(transport.attacks).some((entry) => fold(entry) === fold(name)));
      const awaited = (name) => shipped(name) || run.battles.some((battle) => battle.warId === id && battle.status === "active" && sideOfName(battle, name) < 0
        && battle.orders.some((order) => order.chosen && battleSide(battle, side) !== order.s && asArrayOf(order.attacks).some((entry) => fold(entry) === fold(name))));
      for (let index = names.length - 1; index >= 0; index -= 1) if (awaited(names[index])) names.splice(index, 1);
      if (names.length === 0) return;
    }
    for (const name of names) {
      if (!war.sides.some((members) => members.some((member) => fold(member) === fold(name))) && war.sides[side].length < MAX_SIDE_MEMBERS) war.sides[side].push(name);
    }
    for (const battle of mine()) {
      joinBattle(run, battle, battleSide(battle, side), names);
      battle.touched = true;
    }
    examineWar(run, war, day);
  } else if (moment.op === "leave") {
    war.sides = war.sides.map((members) => members.filter((member) => !names.some((name) => fold(name) === fold(member))));
    for (const battle of mine()) {
      leaveBattle(run, battle, names);
      battle.touched = true;
    }
  } else if (moment.op === "ceasefire") {
    war.status = "ceasefire";
    for (const battle of mine()) battle.status = "frozen";
  } else if (moment.op === "resume") {
    war.status = "active";
    for (const battle of mine()) battle.status = "active";
    examineWar(run, war, day);
  } else if (moment.op === "end") {
    war.status = "ended";
    for (const battle of mine()) battle.closing = "war-over";
  }
};

// A land formation raised or sent to a battlefield during the run.
const applyReinforce = (run, moment) => {
  const kind = typeof moment.kind === "number" ? TROOP_KINDS[moment.kind] : String(moment.kind ?? "infantry");
  const unit = { id: clean(moment.unitId), name: clean(moment.name), type: kind, ownerCode: moment.owner, strength: moment.strength, lng: moment.lng, lat: moment.lat };
  for (const battle of run.battles) {
    if (battle.status !== "active" || sideOfName(battle, moment.owner) < 0 || !pointInFrame(battle.frame, Number(moment.lng), Number(moment.lat))) continue;
    if (unit.id) {
      if (run.taken.has(unit.id) || !absorbUnit(battle, run, unit, { anyDistance: true })) continue;
      run.taken.add(unit.id);
    } else {
      const side = sideOfName(battle, moment.owner);
      if (battle.troops[side].length >= MAX_TROOPS_PER_SIDE || !TROOP_KINDS.includes(kind)) continue;
      const [x, y] = battle.place.toCell(Number(moment.lng), Number(moment.lat));
      const owner = battle.sides[side].findIndex((member) => fold(member) === fold(moment.owner));
      battle.troops[side].push(createTroop({ x, y, strength: Math.min(100, Math.max(1, Number(moment.strength) || 100)), kind: TROOP_KINDS.indexOf(kind), owner }));
      battle.planKey = "";
    }
    battle.touched = true;
    return;
  }
};

// A region on a battlefield, for a story capture: its cells, its area, and the
// live troops of a side standing in it or within STORY_TAKER_REACH_KM of it
// (constants.js takersFor).
const regionTakers = (battle, side, region) => {
  const { field, arena } = battle;
  const { cols } = field;
  const cells = [];
  for (let index = 0; index < field.size; index += 1) if (field.play[index] && arena.region[index] === region) cells.push(index);
  const km = battle.frame.km;
  const reach = STORY_TAKER_REACH_KM / km;
  const reachSquared = reach * reach;
  const inside = [];
  const near = [];
  for (const troop of side >= 0 ? battle.troops[side] : []) {
    if (!isLive(troop)) continue;
    const at = Math.floor(troop.y) * cols + Math.floor(troop.x);
    if (at >= 0 && at < field.size && arena.region[at] === region) {
      inside.push(troop);
      continue;
    }
    let closest = Infinity;
    for (const cell of cells) {
      const dx = (cell % cols) + 0.5 - troop.x;
      const dy = Math.floor(cell / cols) + 0.5 - troop.y;
      const far = dx * dx + dy * dy;
      if (far < closest) closest = far;
    }
    if (closest <= reachSquared) near.push({ troop, far: closest });
  }
  near.sort((a, b) => a.far - b.far);
  return { cells, areaKm2: cells.length * km * km, inside, near };
};

// Whether a capture the story told cannot be made on any battlefield it falls
// on: the taker fights there, the other side holds some of the region, and
// fewer of the taker's troops stand in or near it than the region's size asks
// (constants.js takersFor). Returns that battlefield and the region's name, or null.
const captureRefused = (battles, regionId, taker) => {
  for (const battle of battles) {
    if (battle.status !== "active" || !battle.arena.indexOf.has(regionId)) continue;
    const side = sideOfName(battle, taker);
    if (side < 0) continue;
    const region = battle.arena.indexOf.get(regionId);
    const { cells, areaKm2, inside, near } = regionTakers(battle, side, region);
    if (!cells.some((cell) => battle.field.holders[cell] === 1 - side)) continue;
    if (inside.length + near.length < takersFor(areaKm2).least) {
      return { battlefield: battle.name, region: battle.arena.names[region] || regionId };
    }
  }
  return null;
};

// A REGION THE STORY SAYS WAS TAKEN. "make sure the simulation ai is able to
// say that a region is taken by an army which causes the nearest troops to move
// accordingly so when that event happens, the region has been taken" (the
// owner, 2026-10-28). Once a control moment has given a region to a member of a
// side (reconcile has painted it theirs), as many of that side's troops as the
// region's size asks (constants.js takersFor) stand in it, the nearest within
// STORY_TAKER_REACH_KM first, counting those already there; and the
// other side's troops left on what is now the taker's ground fall back overland
// to the nearest of their own they can reach (orders.js fallBackOverland), without loss.
const marchInto = (run, battle, region, taker, day) => {
  const side = sideOfName(battle, taker);
  if (side < 0 || !(region > 0)) return;
  const { field, arena } = battle;
  const { cols } = field;
  const cells = [];
  for (let index = 0; index < field.size; index += 1) {
    if (field.play[index] && arena.region[index] === region && field.holders[index] === side) cells.push(index);
  }
  if (cells.length > 0) {
    const takers = regionTakers(battle, side, region);
    const nearest = takers.near.slice(0, Math.max(0, takersFor(takers.areaKm2).most - takers.inside.length));
    const used = new Set();
    for (const { troop } of nearest) {
      let best = -1;
      let bestFar = Infinity;
      for (const cell of cells) {
        if (used.has(cell)) continue;
        const dx = (cell % cols) + 0.5 - troop.x;
        const dy = Math.floor(cell / cols) + 0.5 - troop.y;
        const far = dx * dx + dy * dy;
        if (far < bestFar) {
          bestFar = far;
          best = cell;
        }
      }
      if (best < 0) break;
      used.add(best);
      troop.x = (best % cols) + 0.5;
      troop.y = Math.floor(best / cols) + 0.5;
      troop.dig = 0;
    }
    if (nearest.length > 0) battle.log.push({ d: run.dateOf(day), k: "whole", s: side, at: `region: ${arena.names[region] || arena.ids[region]}` });
  }
  fallBackOverland(battle, 1 - side, run.dateOf(day), region, field.cols + field.rows);
};

// A region the world gave someone during a run (a change of control, or a group's area): every battlefield it lies
// on is brought into step and the taker's troops walk in (marchInto). And land handed to a side of a war outside
// its battlefields (a treaty, a capture the story told far off) may touch the other side where nothing did: that
// war is added to `handed`, to be looked at again once the day's moments are in. Returns `handed`.
const landChanged = (run, id, taker, day, handed) => {
  for (const battle of run.battles) {
    if (battle.status === "closed" || !battle.arena.indexOf.has(id)) continue;
    reconcile(battle, run);
    // And the troops follow: the taker's nearest stand in it, the other side's fall back out of it.
    if (battle.status === "active") marchInto(run, battle, battle.arena.indexOf.get(id), taker, day);
    battle.planKey = "";
    battle.touched = true;
  }
  let wars = handed;
  for (const war of run.wars.values()) {
    if (war.status !== "active" || warSideOf(run, war, id) < 0) continue;
    if (!run.battles.some((battle) => battle.warId === war.id && battle.status !== "closed" && battle.arena.indexOf.has(id) && battle.arena.outside[battle.arena.indexOf.get(id)] === 0)) (wars ??= new Set()).add(war);
  }
  return wars;
};

// Applies every moment dated up to a day, in the order they were given.
const applyMoments = (run, day) => {
  let handed = null;
  while (run.cursor < run.moments.length && run.moments[run.cursor].day <= day) {
    const { moment } = run.moments[run.cursor];
    run.cursor += 1;
    if (moment.type === "order") applyOrderMoment(run, moment, day);
    else if (moment.type === "war") applyWarMoment(run, moment, day);
    else if (moment.type === "reinforce") applyReinforce(run, moment);
    // An air strike the war room ordered, flown before the period (airStrike.js): its bombs on whoever stands there.
    else if (moment.type === "airstrike") bombTroops(run, moment, day);
    else if (moment.type === "control") {
      // Someone other than the engine changed who controls a region: the world wins.
      const id = clean(moment.regionId);
      // Unless the story said an army took it and too few of its troops stand near to (captureRefused).
      const refused = moment.capture === true ? captureRefused(run.battles, id, moment.to) : null;
      if (refused) {
        run.notes.push({ kind: "capture-failed", regionId: id, region: refused.region, taker: clean(moment.to), battlefield: refused.battlefield, ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
        if (clean(moment.ref)) (run.capturesRefused ??= new Set()).add(`${clean(moment.ref)}:${id}`);
        continue;
      }
      run.setController(id, moment.to);
      handed = landChanged(run, id, moment.to, day, handed);
    } else if (moment.type === "group") {
      // A group took a region into its area, or let one go (a groupOps entry of the story's): the world wins here
      // too, and the troops follow as for a change of control. Told to nobody before, the area changed between
      // runs: the next run painted it at once, far behind the line and with nobody there.
      const id = clean(moment.regionId);
      const group = clean(moment.group);
      const held = run.groupOf(id);
      if (!id || fold(held) === fold(group) || (!group && moment.from && fold(held) !== fold(moment.from))) continue;
      run.setGroup(id, group);
      handed = landChanged(run, id, group || run.controllerOf(id), day, handed);
    }
  }
  for (const war of handed ?? []) examineWar(run, war, day);
  for (const battle of run.battles) if (battle.closing && battle.status !== "closed") closeBattle(run, battle, day);
  // What a moment did to the orders or the ground is read at once: which
  // places are besieged, and what is cut off.
  for (const battle of run.battles) {
    if (battle.status === "closed" || !battle.touched) continue;
    readSieges(battle);
    findPockets(battle);
  }
};

// ---- troops sent into a country outside the war ----------------------------------

const asArrayOf = (value) => (Array.isArray(value) ? value : []);

// Reads, for every route a battle's troops were sent along by hand, the
// countries outside the war it goes into (invade.js): what sending troops
// along it attacks. Worked out from the ground whenever the routes are put to
// their troops, and kept on the order for whoever reads the record.
const markAttacks = (run, battle) => {
  if (battle.status !== "active") return;
  for (const order of battle.orders) {
    if (!order.chosen || !Array.isArray(order.way) || order.way.length === 0) continue;
    // (A trained staff's routes bring nobody into the war: the ground outside it is a wall to them. mind/policy.js.)
    if (order.mark === MIND_MARK) {
      delete order.attacks;
      delete order.crosses;
      continue;
    }
    const troops = battle.troops[order.s];
    let midX = 0;
    let midY = 0;
    let count = 0;
    troops.forEach((troop) => {
      if (!isLive(troop) || !(troop.order && !troop.order.done && (troop.order.standing === order || troop.order.resume?.standing === order))) return;
      midX += troop.x;
      midY += troop.y;
      count += 1;
    });
    const route = order.way.map(([lng, lat]) => battle.place.toCell(lng, lat));
    const names = othersOnWay({
      arena: battle.arena,
      place: battle.place,
      // From where they stand, as they will go: the way to the route's first point is part of it.
      way: count > 0 ? [[midX / count, midY / count], ...route] : route,
      holderOf: (id) => holderOf(battle, run, id),
      inWar: (name) => sideOfName(battle, name) >= 0,
    });
    // A country their own is at war with already, on a battlefield of that
    // war's, is no newcomer to be brought into this one: troops sent into its
    // land go over to the battlefield where it is fought (handOver).
    const sender = senderOf(battle, order);
    const elsewhere = names.filter((name) => otherFrontAgainst(run, battle, sender, name));
    const fresh = names.filter((name) => !elsewhere.includes(name));
    if (fresh.length > 0) order.attacks = fresh;
    else delete order.attacks;
    if (elsewhere.length > 0) order.crosses = elsewhere;
    else delete order.crosses;
  }
};

// Who a hand order's troops belong to: whoever gave it, else its side's first country still there.
const senderOf = (battle, order) => clean(order.by) || battle.sides[order.s].find((member, at) => !battle.gone[order.s].has(at)) || "";

// The battlefield on which a country already fights another, in a war of
// their own: not this one.
const otherFrontAgainst = (run, battle, member, name) => (member ? frontsBetween(run, member, name).find((entry) => entry !== battle && entry.field) ?? null : null);

// The troops marching a hand order's route.
const onRoute = (battle, order, day) => {
  const marching = [];
  battle.troops[order.s].forEach((troop, at) => {
    if (!isLive(troop)) return;
    const mine = troop.order && !troop.order.done ? troop.order : null;
    const way = mine && mine.kind !== "way" ? mine.resume : mine;
    if (way && !way.done && way.standing === order && day >= way.since) marching.push(at);
  });
  return marching;
};

// Every troop a hand order was given to that has not finished with it, whether it has set off yet or not.
const underOrder = (battle, order) => {
  const serving = [];
  battle.troops[order.s].forEach((troop, at) => {
    if (isLive(troop) && troop.order && !troop.order.done && (troop.order.standing === order || troop.order.resume?.standing === order)) serving.push(at);
  });
  return serving;
};

// Whether any of a route's troops has come within reach of a country's land on this battlefield.
const reachedLandOf = (run, battle, order, name, day) => {
  const { arena } = battle;
  const held = new Uint8Array(arena.ids.length);
  let any = false;
  for (let region = 1; region < arena.ids.length; region += 1) {
    if (fold(holderOf(battle, run, arena.ids[region])) !== fold(name)) continue;
    held[region] = 1;
    any = true;
  }
  if (!any) return false;
  return onRoute(battle, order, day).some((at) => {
    const troop = battle.troops[order.s][at];
    return landWithin(arena, held, troop.x, troop.y, INVADE_REACH_KM / battle.place.kmAt(troop.y));
  });
};

// TROOPS OF ONE FRONT SENT AGAINST THE ENEMY OF ANOTHER. A country at war
// with two others fights each on a battlefield of its own, and the ground one
// of them holds is that battlefield's ground: on every other it is a wall. So
// troops sent from the first front into land the second enemy holds (to take
// back their own country's ground, most often) cannot fight for it where they
// are. They used to bring that enemy into their own war as if it were a
// newcomer, and the same ground then lay on two battlefields that each kept
// its own account of who held it: the troops fought, and the map went on
// showing the land as the enemy's.
//
// They GO OVER instead. On the day the first of them comes to that land, the
// troops on the route leave this battlefield and stand, where they are, on the
// one that is fought against that enemy, with the same route to march. A
// formation of the world's own (a named one) goes back to the world there, and
// that battlefield takes it in when it next begins.
const handOver = (run, battle, order, other, day) => {
  const side = order.s;
  const date = run.dateOf(day);
  const moved = [[], []];
  let lngSum = 0;
  let latSum = 0;
  for (const at of underOrder(battle, order)) {
    const troop = battle.troops[side][at];
    const member = battle.sides[side][troop.owner] ?? senderOf(battle, order);
    const theirSide = sideOfName(other, member);
    if (theirSide < 0 || other.troops[theirSide].length >= MAX_TROOPS_PER_SIDE) continue;
    const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
    const named = battle.named.find((entry) => entry.s === side && entry.i === at);
    if (named) {
      if (!named.reported) {
        run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
        named.reported = true;
      }
    } else {
      // Where it stands, on that battlefield's own sheet: on its side's ground there, or the nearest of it.
      const [x, y] = other.place.toCell(lng, lat);
      const inside = x >= 0 && y >= 0 && x < other.field.cols && y < other.field.rows;
      const cell = inside && other.field.holders[Math.floor(y) * other.field.cols + Math.floor(x)] === theirSide
        ? Math.floor(y) * other.field.cols + Math.floor(x)
        : nearestHeldCell(other.field, theirSide, Math.max(0, Math.min(other.field.cols - 1, x)), Math.max(0, Math.min(other.field.rows - 1, y)), HAND_OVER_REACH_CELLS);
      // (Nowhere of its side's to stand there: it stays where it is, at the wall.)
      if (cell < 0) continue;
      const exact = inside && cell === Math.floor(y) * other.field.cols + Math.floor(x);
      moved[theirSide].push(other.troops[theirSide].length);
      other.troops[theirSide].push(createTroop({
        x: exact ? x : (cell % other.field.cols) + 0.5,
        y: exact ? y : Math.floor(cell / other.field.cols) + 0.5,
        strength: troop.strength,
        kind: troop.kind,
        owner: Math.max(0, memberIndex(other, theirSide, member)),
      }));
      lngSum += lng;
      latSum += lat;
    }
    troop.strength = 0;
    troop.station = null;
    troop.order = null;
  }
  const count = moved[0].length + moved[1].length;
  // The route is that battlefield's now: here it has nobody left to march it.
  if (underOrder(battle, order).length === 0) battle.orders = battle.orders.filter((entry) => entry !== order);
  battle.touched = true;
  battle.planKey = "";
  if (count === 0) return 0;
  const today = prepare(other, day);
  for (const theirSide of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (moved[theirSide].length === 0) continue;
    const entry = { s: theirSide, sector: "all", order: "advance", since: date, age: 0, chosen: true, way: order.way.map((point) => point.slice()), ...(order.by ? { by: order.by } : {}) };
    other.orders.push(entry);
    assignOrder(other, run, entry, { ...today, date, run }, { picked: moved[theirSide] });
  }
  const at = cityNear(run, lngSum / count, latSum / count, 150) || other.name;
  other.log.push({ d: date, k: "reinforced", s: moved[0].length > 0 ? HOLDER_SIDE_A : HOLDER_SIDE_B, at });
  other.touched = true;
  other.planKey = "";
  assignCommands(other);
  return count;
};

// A day's look at the troops sent into a country outside the war: the first
// of them to come within reach of its land brings it into the war, against
// their side. It is the war ledger's own "joins" (applyWarMoment), so the
// country joins every battlefield of that war, raises its troops, and a new
// battlefield opens wherever else it now touches an enemy. What it holds on
// this one is ground to be fought over from then on.
const invadeWhereSent = (run, battle, day) => {
  if (battle.status !== "active" || !battle.orders.some((order) => order.chosen && (asArrayOf(order.attacks).length > 0 || asArrayOf(order.crosses).length > 0))) return;
  const war = run.wars.get(battle.warId);
  if (!war || war.status !== "active") return;
  // Troops sent against a country their own already fights on another battlefield go over to it.
  for (const order of battle.orders.slice()) {
    if (!order.chosen) continue;
    for (const name of asArrayOf(order.crosses)) {
      const other = otherFrontAgainst(run, battle, senderOf(battle, order), name);
      if (!other || !reachedLandOf(run, battle, order, name, day)) continue;
      handOver(run, battle, order, other, day);
      break;
    }
  }
  // Once a country is in the war a route into it attacks nobody new, and its order no longer says so.
  const settle = (order, name) => {
    const left = asArrayOf(order.attacks).filter((other) => fold(other) !== fold(name));
    if (left.length > 0) order.attacks = left;
    else delete order.attacks;
  };
  for (const order of battle.orders.slice()) {
    if (!order.chosen) continue;
    for (const name of asArrayOf(order.attacks)) {
      if (sideOfName(battle, name) >= 0) {
        settle(order, name);
        continue;
      }
      if (warSide(war, name) >= 0) continue;
      if (!reachedLandOf(run, battle, order, name, day)) continue;
      // The side of the war the country joins: the one its attackers are not on.
      const joins = battleSide(battle, 1 - order.s);
      applyWarMoment(run, { type: "war", op: joins === 0 ? "join-a" : "join-b", warId: war.id, names: [name], sent: true }, day);
      // No room for another member there: it stays a wall, and nobody is at war with it.
      if (sideOfName(battle, name) < 0) continue;
      const date = run.dateOf(day);
      battle.log.push({ d: date, k: "invaded", s: order.s, at: `${run.isGroup(name) ? "group" : "country"}: ${name}` });
      run.joins.push({ day, date, battlefield: battle, warId: war.id, name, side: joins, by: clean(order.by) || battle.sides[order.s][0] });
      settle(order, name);
      battle.touched = true;
      battle.planKey = "";
    }
  }
};

// ---- transporters ----------------------------------------------------------------

// The sheet of the whole map (worldGrid.js), drawn once and kept with the arenas.
const worldGridOf = (run) => {
  const map = run.input.map ?? {};
  // (Regions of a type that is water are sea on it: ships sail them.)
  const water = waterTypeIds(run.input.regionTypes);
  const key = worldSheetKey(clean(map.key), water);
  const kept = clean(map.key) && run.cache ? run.cache.get(key) : null;
  if (kept) return kept;
  if (run.worldGrid) return run.worldGrid;
  const regions = regionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const grid = buildWorldGrid(regions, { ...measureOptions(map), water });
  if (grid && clean(map.key) && run.cache) run.cache.set(key, grid);
  run.worldGrid = grid;
  return grid;
};

// The war a transporter serves: the one it was sent for while that is being
// fought with its owner in it, else the first such war of its owner's.
const transportWar = (run, transport) => {
  const fought = (war) => Boolean(war) && war.status === "active" && warSide(war, transport.owner) >= 0;
  const named = run.wars.get(transport.warId);
  return fought(named) ? named : [...run.wars.values()].find(fought) ?? null;
};
// Who holds a region in name, to a war: the group whose area it is if that group is in it, or the country whose
// force that group is if that country is (battle.js groupSideOf), else its controller.
const holderIn = (run, war, id) => {
  const group = run.groupOf(id);
  if (group && warSide(war, group) >= 0) return group;
  const owner = group ? run.groupOwnerOf(group) : "";
  return owner && warSide(war, owner) >= 0 ? owner : run.controllerOf(id);
};
const holderAtPoint = (run, grid, war, lng, lat) => {
  const cell = grid.cellOf(lng, lat);
  const mark = cell >= 0 ? grid.region[cell] : 0;
  return mark ? clean(holderIn(run, war, grid.ids[mark])) : "";
};
const cityNear = (run, lng, lat, withinKm) => {
  const measure = measureOptions(run.input.map);
  let best = null;
  for (const city of Array.isArray(run.input.map?.cities) ? run.input.map.cities : []) {
    const far = kmBetween(lng, lat, Number(city.lng), Number(city.lat), measure);
    if (far <= withinKm && (!best || far < best.far)) best = { far, name: clean(city.name) };
  }
  return best ? `city: ${best.name}` : "";
};
const tellVoyage = (run, day, k, transport, extra = {}) => {
  run.voyages.push({ d: run.dateOf(day), day, k, id: transport.id, owner: transport.owner, kind: transport.kind, medium: transport.medium, to: boundFor(transport), n: loadOf(transport), ...extra });
};

// Where a place named by the story is: a city of the map, a region, or a
// country (its capital, or its largest city). null when nothing is called that.
const placeNamed = (run, grid, war, text) => {
  const named = /^\s*(city|region|country|group)\s*:\s*(.*)$/i.exec(String(text ?? ""));
  const wanted = fold(named ? named[2] : text);
  const kind = named ? named[1].toLowerCase() : "";
  if (!wanted) return null;
  const cities = Array.isArray(run.input.map?.cities) ? run.input.map.cities : [];
  if (kind !== "region" && kind !== "country" && kind !== "group") {
    const city = cities.find((entry) => fold(entry?.name) === wanted);
    if (city) return { lng: Number(city.lng), lat: Number(city.lat), name: `city: ${clean(city.name)}` };
    if (kind === "city") return null;
  }
  if (kind !== "region") {
    const seat = seatOf(run, grid, war, wanted);
    if (seat) return { lng: seat.lng, lat: seat.lat, name: seat.name };
    if (kind === "country" || kind === "group") return null;
  }
  const regions = regionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const region = regions.find((entry) => fold(entry?.name) === wanted);
  if (!region) return null;
  const [lng, lat] = middleOf(region);
  return { lng, lat, name: `region: ${clean(region.name)}` };
};
// A country's seat: its capital among the map's cities, else the largest city on its land.
const seatOf = (run, grid, war, wanted) => {
  let best = null;
  for (const city of Array.isArray(run.input.map?.cities) ? run.input.map.cities : []) {
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (fold(holderAtPoint(run, grid, war, lng, lat)) !== wanted) continue;
    const weight = (city.capital ? 1e12 : 0) + Math.max(0, Number(city.population) || 0);
    if (!best || weight > best.weight) best = { weight, lng, lat, name: `city: ${clean(city.name)}` };
  }
  return best;
};
// Where a dispatch sets out from when nobody gave it a starting place, or its
// troops' own place will not do: its owner's cities, the nearest to where it is
// sent first, or with troops standing somewhere the one on their way there
// (transports.js departuresFor).
const originsOf = (run, grid, war, transport, near = null, most = 8) => {
  const measure = measureOptions(run.input.map);
  return departuresFor({
    cities: run.input.map?.cities,
    holderAt: (lng, lat) => holderAtPoint(run, grid, war, lng, lat),
    owner: transport.owner,
    to: transport.to,
    near,
    km: (lngA, latA, lngB, latB) => kmBetween(lngA, latA, lngB, latB, measure),
    most,
  });
};

// Whether a transporter set out with its owner fighting no war, to attack a
// country it was at peace with (departTransport): it serves no war yet.
const sailsInPeace = (transport) => !clean(transport.warId) && asArrayOf(transport.attacks).length > 0;

// A transporter that was ordered sets out: its war is found, its troops go
// aboard, and its way is found. One that cannot is refused, and says why.
const departTransport = (run, index, day) => {
  let transport = run.transports[index];
  const date = run.dateOf(day);
  const refuse = (note) => {
    run.transports[index] = { ...transport, status: "refused", note, ended: date };
    tellVoyage(run, day, "refused", transport, { why: note });
  };
  // (Weighing countries' own military figures, one with no navy sends nothing by sea and one with no
  // air arm nothing by air: military.js.)
  if (run.mech.military && transport.medium === "sea" && seaWorth(run.militaryOf(transport.owner)) === 0) return refuse("no-navy");
  if (run.mech.military && transport.medium === "air" && airWorth(run.militaryOf(transport.owner)) === 0) return refuse("no-air-force");
  // (Nor by a medium the game's features switched off: transports.js transportBar.)
  if (transportBar(transport.medium, { media: Array.isArray(run.input?.transportMedia) ? run.input.transportMedia : null })) return refuse("switched-off");
  // The most it carries: an airlift fewer than a train or a ship (transports.js transportLoadMost).
  const year = yearInEra(gameDateYear(run.dateOf(0)), Number.isInteger(run.input?.era) ? run.input.era : null);
  const most = Math.max(1, transportLoadMost(transport.medium, year, run.mech.military ? run.militaryOf(transport.owner) : null));
  let war = transportWar(run, transport);
  const grid = worldGridOf(run);
  // Its owner is fighting no war: bound for land of a country it is at peace
  // with, it is an attack on that country, and the war begins where it lands.
  let surprise = "";
  if (!war) {
    if (!grid) return refuse("off-map");
    const alone = peaceOf(transport.owner);
    const place = Number.isFinite(transport.to.lng) && Number.isFinite(transport.to.lat) ? transport.to : placeNamed(run, grid, alone, transport.to.name);
    const holder = place ? holderAtPoint(run, grid, alone, place.lng, place.lat) : "";
    // (Its own land, nobody's, or a country a ceasefire stands with: nothing sails.)
    if (!holder || fold(holder) === fold(transport.owner) || warBetween(run, transport.owner, holder)) return refuse("no-war");
    surprise = holder;
    war = peaceOf(transport.owner, [holder]);
  }
  if (!grid) return refuse("off-map");
  const mine = warSide(war, transport.owner);
  const friendly = (name) => warSide(war, name) === mine;
  const hostile = (name) => warSide(war, name) === 1 - mine;
  if (!Number.isFinite(transport.to.lng) || !Number.isFinite(transport.to.lat)) {
    const place = placeNamed(run, grid, war, transport.to.name);
    if (!place) return refuse("no-place");
    transport = { ...transport, to: place };
  }
  // What goes aboard, and from where.
  let load = transport.load;
  let origins = transport.from ? [transport.from] : [];
  let boarding = null;
  if (transport.embark) {
    const battle = run.battles.find((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(transport.embark.battlefield));
    const side = transport.embark.side;
    const picked = (battle ? transport.embark.troops.filter((at) => battle.troops[side][at] && isLive(battle.troops[side][at]) && !battle.named.some((entry) => entry.s === side && entry.i === at)) : []).slice(0, most);
    if (picked.length === 0) return refuse("no-troops");
    let x = 0;
    let y = 0;
    for (const at of picked) {
      x += battle.troops[side][at].x;
      y += battle.troops[side][at].y;
    }
    const [lng, lat] = battle.place.toLngLat(x / picked.length, y / picked.length);
    origins = [{ lng, lat, name: cityNear(run, lng, lat, 150) }];
    load = picked.map((at) => [Math.round(battle.troops[side][at].strength), battle.troops[side][at].kind]);
    boarding = { battle, side, picked };
  } else if (load.length === 0) {
    load = kindsFor(Math.min(most, Math.max(1, transport.raise || 1)), run.era, run.mech.military ? mixOf(run.militaryOf(transport.owner)) : null).map((kind) => [100, kind]);
    draw(run, transport.owner, load.length * menOf(run, transport.owner));
    if (origins.length === 0) origins = originsOf(run, grid, war, transport);
  }
  if (origins.length === 0) return refuse("no-origin");
  const { embark: _embark, raise: _raise, ...bare } = transport;
  const loaded = { ...bare, load: load.slice(0, most), warId: war.id };
  const fromHere = (origin) => setOut({ ...loaded, from: { lng: origin.lng, lat: origin.lat, name: clean(origin.name) } }, {
    grid,
    from: [origin.lng, origin.lat],
    holderOf: (id) => holderIn(run, war, id),
    friendly,
    hostile,
    year,
    date,
    dateOf: (days) => run.dateOf(day + days),
  });
  let out = null;
  for (const origin of origins) {
    out = fromHere(origin);
    if (out.status === "moving") break;
  }
  // Troops taken off a battlefield set out from where they stand. Where no way
  // begins there (a ship with no sea near, a train with none of its side's
  // land) they go overland to a city of their country's on their way that one
  // does begin from; where none does, they are refused for where they stand.
  if (boarding && out.status !== "moving" && TRANSPORT_START_FAILS.includes(out.note)) {
    const there = out;
    for (const origin of originsOf(run, grid, war, transport, [origins[0].lng, origins[0].lat], EMBARK_PORTS_MOST)) {
      out = fromHere(origin);
      if (out.status === "moving") break;
    }
    if (out.status !== "moving") out = there;
  }
  if (out.status !== "moving") return refuse(out.note || "no-way");
  // Where it is to put them down is somebody's land: a country outside the war is attacked by it.
  const holder = holderAtPoint(run, grid, war, out.landing[0], out.landing[1]);
  if (surprise) out = { ...out, attacks: [holder && fold(holder) !== fold(transport.owner) ? holder : surprise] };
  else if (holder && warSide(war, holder) < 0) out = { ...out, attacks: [holder] };
  if (boarding) {
    for (const at of boarding.picked) {
      boarding.battle.troops[boarding.side][at].strength = 0;
      boarding.battle.troops[boarding.side][at].station = null;
    }
    boarding.battle.touched = true;
    boarding.battle.planKey = "";
  }
  run.transports[index] = out;
  tellVoyage(run, day, "sailed", out, { from: out.from.name, due: out.due, km: out.km });
};

// A transporter that has come to the end of its way puts its troops down.
const landTransport = (run, index, day) => {
  const transport = run.transports[index];
  const date = run.dateOf(day);
  const end = (status, k, extra = {}) => {
    run.transports[index] = { ...transport, status, ended: date, at: transport.landing ?? transport.at };
    tellVoyage(run, day, k, transport, extra);
  };
  let war = transportWar(run, transport);
  const grid = worldGridOf(run);
  const [lng, lat] = transport.landing ?? [transport.to.lng, transport.to.lat];
  // It set out in peace, to attack: the war begins here, today, with whoever holds this land.
  let opened = "";
  if (!war && sailsInPeace(transport)) {
    const target = grid ? holderAtPoint(run, grid, peaceOf(transport.owner), lng, lat) : "";
    const before = run.starts.length;
    war = target && fold(target) !== fold(transport.owner) ? attackOpensWar(run, transport.owner, target, day) : null;
    if (war && run.starts.length > before) opened = target;
  }
  // The war it was sent for is over, or frozen: it turns back with its troops.
  if (!war) return end("returned", "returned");
  const mine = warSide(war, transport.owner);
  const holder = grid ? holderAtPoint(run, grid, war, lng, lat) : "";
  let joined = null;
  // Troops put down in a country that was in no war with their sender: it is
  // at war with them from today, on the other side of theirs.
  if (holder && warSide(war, holder) < 0) {
    applyWarMoment(run, { type: "war", op: mine === 0 ? "join-b" : "join-a", warId: war.id, names: [holder], sent: true }, day);
    if (warSide(war, holder) < 0) return end("returned", "returned", { why: "no-room" });
    joined = holder;
  }
  let battle = run.battles.find((entry) => entry.warId === war.id && entry.status === "active" && sideOfName(entry, transport.owner) >= 0 && pointInFrame(entry.frame, lng, lat)) ?? null;
  let hostile = true;
  let landed = 0;
  if (battle) {
    const side = sideOfName(battle, transport.owner);
    const [x, y] = battle.place.toCell(lng, lat);
    const put = landCarried(battle, side, x, y, transport.load, Math.max(0, memberIndex(battle, side, transport.owner)), date);
    landed = put.landed;
    hostile = put.hostile;
    if (landed === 0) battle = null;
    else {
      battle.touched = true;
      if (hostile && battle.cityHolder) settleRegions(battle, run, day);
    }
  } else {
    const before = run.battles.length;
    // (The name it was given for the front it opens, unless a battlefield is called that already.)
    const named = run.battles.some((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(transport.battlefield)) ? "" : transport.battlefield;
    battle = openLandingAt(run, { war, sideName: transport.owner, lng, lat, name: named, day, carried: transport.load });
    if (battle) {
      landed = Math.min(transport.load.length, battle.troops[sideOfName(battle, transport.owner)].length);
      // Troops put ashore to open a front go inland unless they are told otherwise: nobody has ordered anything there yet.
      orderOnFront(run, battle, { type: "order", battlefield: battle.name, side: transport.owner, order: "advance", sector: "all" }, day);
    } else if (run.battles.length > before) run.battles.length = before;
  }
  if (joined) {
    run.joins.push({ day, date, battlefield: battle ?? { name: "" }, warId: war.id, name: joined, side: 1 - mine, by: transport.owner });
    tellVoyage(run, day, "invaded", transport, { at: `${run.isGroup(joined) ? "group" : "country"}: ${joined}` });
  }
  if (opened) {
    tellVoyage(run, day, "invaded", transport, { at: `${run.isGroup(opened) ? "group" : "country"}: ${opened}`, opened: true });
    if (battle) tellAttack(run, battle, transport.owner, opened, day);
  }
  // Nowhere to fight there (its own side's ground with no battle on it, or no room for another battlefield): they go home.
  if (!battle || landed === 0) return end("returned", "returned", { why: "no-landing" });
  const at = cityNear(run, lng, lat, 120) || transport.to.name || `region: ${battle.arena.names[battle.arena.region[Math.max(0, Math.floor(battle.place.toCell(lng, lat)[1]) * battle.arena.cols + Math.floor(battle.place.toCell(lng, lat)[0]))]] ?? ""}`;
  const side = sideOfName(battle, transport.owner);
  battle.log.push({ d: date, k: hostile ? "landed" : "reinforced", s: side, at });
  battle.planKey = "";
  run.transports[index] = { ...transport, status: "landed", ended: date, at: [lng, lat], battlefield: battle.name, warId: war.id };
  tellVoyage(run, day, hostile ? "landed" : "reinforced", transport, { at, battlefield: battle, landed });
};

// The transporters at the run's beginning: one that ended before it has been
// told and shown, and is let go; one that was ordered sets out today.
const beginTransports = (run) => {
  const first = run.dateOf(0);
  run.transports = normalizeTransports(run.input.transports).filter((transport) => !TRANSPORT_ENDED.includes(transport.status) || (transport.ended && compareGameDates(transport.ended, first) > 0));
  // (Nothing sets out in a run no day passes in: such a run only reads the world.)
  if (run.days <= 0) return;
  for (let index = 0; index < run.transports.length; index += 1) if (run.transports[index].status === "ordered") departTransport(run, index, 0);
};

// An airlift's day over what it flew over: each that found it over its enemies'
// ground (transports.js airliftIntercepts) is a hit, told where and by whom.
// True when nothing is left of it.
const airliftDay = (run, index, before, moved, war, mine, day, options) => {
  const grid = worldGridOf(run);
  const seen = airliftIntercepts(moved, {
    over: stretchOf(moved.way, before.gone, moved.gone, options),
    holderAt: (lng, lat) => (grid ? holderAtPoint(run, grid, war, lng, lat) : ""),
    // (Nobody rises against what nobody is at war with.)
    enemy: (name) => war.peace !== true && warSide(war, name) === 1 - mine,
    units: run.input.units,
    era: run.era,
    worthOf: (name) => airWorth(run.militaryOf(name)),
    roll: (what) => transportChance(run.seed, moved.id, day, `airlift|${what}`),
    ...options,
  });
  const date = run.dateOf(day);
  let left = moved;
  for (const [n, finder] of seen.found.entries()) {
    const hit = struck(left, transportChance(run.seed, moved.id, day, `airlift|hurt|${n}`), date);
    const near = cityNear(run, finder.at[0], finder.at[1], 250);
    tellVoyage(run, day, hit.transport.status === "lost" ? "lost" : "intercepted", left, { by: finder.by, with: finder.with, lost: hit.lost, at: near, where: finder.at });
    left = hit.transport;
    if (left.status === "lost") break;
  }
  run.transports[index] = left;
  return left.status === "lost";
};

// A day of every transporter under way: it goes on along its way, whoever can
// reach it may catch it, and at the end of its way it puts its troops down.
const moveTransports = (run, day) => {
  const map = run.input.map ?? {};
  const options = measureOptions(map);
  const date = run.dateOf(day);
  for (let index = 0; index < run.transports.length; index += 1) {
    const before = run.transports[index];
    if (before.status !== "moving") continue;
    // (One that set out today has its first day's sailing tomorrow.)
    if (before.departed === date) continue;
    // (One that set out in peace to attack sails on in peace: nobody is at war with it yet.)
    const war = transportWar(run, before) ?? (sailsInPeace(before) ? peaceOf(before.owner, asArrayOf(before.attacks)) : null);
    if (!war) {
      run.transports[index] = { ...before, status: "returned", ended: date };
      tellVoyage(run, day, "returned", before);
      continue;
    }
    const { transport: moved, arrived } = moveOn(before, options);
    run.transports[index] = moved;
    const mine = warSide(war, moved.owner);
    // An airlift is caught only over its enemies' ground, as an air strike is (transports.js airliftIntercepts).
    if (moved.medium === "air") {
      if (airliftDay(run, index, before, moved, war, mine, day, options)) continue;
      if (arrived) landTransport(run, index, day);
      continue;
    }
    // Caught on the day's stretch, at the middle of it.
    const middle = placeAlong(moved.way, (before.gone + moved.gone) / 2, options);
    const grid = worldGridOf(run);
    const risk = interceptionOf(moved, middle ? [middle.lng, middle.lat] : moved.at, {
      units: run.input.units,
      // (Nobody hunts what nobody is at war with.)
      enemy: (name) => war.peace !== true && warSide(war, name) === 1 - mine,
      ally: (name) => warSide(war, name) === mine,
      grid,
      holderOf: (id) => holderIn(run, war, id),
      ...options,
    });
    if (risk.chance > 0 && transportChance(run.seed, moved.id, day, "caught") < risk.chance) {
      const hit = struck(moved, transportChance(run.seed, moved.id, day, "hurt"), date);
      run.transports[index] = hit.transport;
      const near = middle ? cityNear(run, middle.lng, middle.lat, 250) : "";
      tellVoyage(run, day, hit.transport.status === "lost" ? "lost" : "intercepted", moved, { by: risk.by, with: risk.with, lost: hit.lost, at: near, where: middle ? [Math.round(middle.lng * 1000) / 1000, Math.round(middle.lat * 1000) / 1000] : null });
      if (hit.transport.status === "lost") continue;
    }
    if (arrived) landTransport(run, index, day);
  }
};

// ---- the run -------------------------------------------------------------------

// Whether a run that was given no shapes can do without them: no war moment
// that could open a battlefield, no landing where none is.
const mustHaveRegions = (run) => run.moments.some(({ moment }) => {
  if (moment.type === "war") return ["start", "join-a", "join-b", "resume"].includes(moment.op);
  if (moment.type !== "order") return false;
  // An order for a country's forces at home that have no record yet opens one (home.js).
  const home = HOME.exec(String(moment.battlefield ?? ""));
  if (home) return !normalizeBattlefields(run.input.battlefields).some((record) => record.home && record.status !== "closed" && foldBattlefieldName(record.name) === foldBattlefieldName(homeName(home[1])));
  // An order for a border that has no battlefield yet opens one.
  const border = BORDER.exec(String(moment.battlefield ?? ""));
  if (border) {
    const names = [`${clean(border[1])} / ${clean(border[2])} border`, `${clean(border[2])} / ${clean(border[1])} border`].map(foldBattlefieldName);
    return !normalizeBattlefields(run.input.battlefields).some((record) => record.status !== "closed" && names.includes(foldBattlefieldName(record.name)));
  }
  if (moment.order !== "land") return false;
  const wanted = foldBattlefieldName(moment.battlefield);
  return !normalizeBattlefields(run.input.battlefields).some((record) => record.status !== "closed" && foldBattlefieldName(record.name) === wanted);
});

const begin = (run) => {
  const { input } = run;
  const map = input.map ?? {};
  const regions = regionsOf(run);
  const listKey = `regions|${clean(map.key)}`;
  if (regions) {
    run.regionIds = regions.map((region) => clean(region?.id)).filter(Boolean);
    if (run.cache && clean(map.key)) run.cache.set(listKey, run.regionIds);
  } else {
    run.regionIds = run.cache?.get(listKey) ?? null;
    if (mustHaveRegions(run)) throw REGIONS_NEEDED;
  }

  // A closed battlefield has been through its one more run: it is not carried on.
  for (const record of normalizeBattlefields(input.battlefields)) {
    if (record.status === "closed" || !record.field) continue;
    const arena = arenaFor(run.cache, map, record.frame, input.regionTypes);
    if (!arena) throw REGIONS_NEEDED;
    run.battles.push(loadBattle(run, record, arena));
  }
  for (const battle of run.battles) {
    syncWithWar(run, battle);
    reconcile(battle, run);
    setRadii(battle);
  }
  for (const battle of run.battles) {
    if (battle.closing) continue;
    if (battle.status === "active") absorbUnits(battle, run);
    // (And those of a country's forces at home that have come near it: home.js.)
    battle.handedHome = battle.status === "active" ? bringHome(run, battle, 0) : null;
    setRadii(battle);
    paintGround(battle, run);
    keepStart(battle);
    readSieges(battle);
    findPockets(battle);
    startRecorder(battle, run, 0);
    // (An order written onto the record for a city beyond the frame's edge, by a general in the war room: the frame holds it first.)
    if (battle.status === "active") for (const order of battle.orders.slice()) if (order.objective) holdObjective(run, battle, order.objective, 0);
    assignStanding(run, battle);
    homeOrders(run, battle, battle.handedHome, 0);
    battle.handedHome = null;
    markAttacks(run, battle);
  }
  // A formation still marked as committed to a battlefield that is gone, or
  // that does not know it, is given back to the world.
  for (const unit of Array.isArray(input.units) ? input.units : []) {
    const committed = clean(unit?.committedTo);
    if (!committed || !clean(unit.id)) continue;
    const battle = run.battles.find((entry) => foldBattlefieldName(entry.name) === foldBattlefieldName(committed));
    if (!battle || !battle.named.some((entry) => entry.unitId === clean(unit.id))) run.unitChanges.push({ unitId: clean(unit.id), committedTo: "" });
  }
  for (const battle of run.battles.slice()) {
    if (battle.closing) {
      keepStart(battle);
      closeBattle(run, battle, 0);
    } else recordDay(battle, 0, run.days === 0);
  }
  // Troops built up in peace sent into another country's land from the war room: the war beginning, there and then.
  for (const battle of run.battles.slice()) attackFromStanding(run, battle);
  for (const war of run.wars.values()) examineWar(run, war, 0);
  if (run.braked) run.notes.push({ kind: "tempo" });
  // Transporters that were ordered set out: their troops leave the battlefields
  // they stood on. (Before the first day's moments: whoever a transporter is
  // bound for is known before the story names the day it is brought in.)
  beginTransports(run);

  for (const battle of run.battles) battle.touched = false;
  // The troops a deployment drawn in the war room calls up come in first, as the run begins.
  callUpDeployed(run);
  applyMoments(run, 0);
  // What a moment of the first day did is part of the state the run begins from.
  for (const battle of run.battles) {
    if (battle.touched && battle.status !== "closed" && battle.recorded === 0) recordDay(battle, 0, run.days === 0);
  }
  // Every troop is under one of its side's generals from the first day.
  for (const battle of run.battles) if (battle.status !== "closed") assignCommands(battle);
};

// Puts each standing order of a battle that was carried over to the troops it
// is for: the ones the record says were serving it, or failing that those
// that stand in its sector. The ways are found afresh from where they stand.
const assignStanding = (run, battle) => {
  if (battle.status === "closed" || battle.orders.length === 0) return;
  const today = prepare(battle, 0);
  // Those for a body of troops picked out come last, so that they stand
  // whatever the stretch of line those troops are on was told; and such an
  // order is for those troops alone, never for a sector in their place.
  const turns = battle.orders.map((order, index) => index).sort((a, b) => (battle.orders[a].chosen ? 1 : 0) - (battle.orders[b].chosen ? 1 : 0) || a - b);
  for (const index of turns) {
    const order = battle.orders[index];
    const picked = [];
    if (battle.served) battle.troops[order.s].forEach((troop, at) => { if (troop.serves === index) picked.push(at); });
    if (order.chosen && picked.length === 0) continue;
    assignOrder(battle, run, order, { ...today, date: run.dateOf(0), run }, { picked: picked.length > 0 ? picked : null, lagless: order.age > 0 });
  }
};

// EXPERIMENT, in the lab (mind/policy.js createTroopPolicy): a trained staff
// may order a side's troops one by one, as bodies of them it names: { order,
// picked, way } each, `order` "hold", "dig in" or "advance" (straight out from
// where they stand, or along `way`, points as stored). What it ordered last
// time is over, and nothing stands for a stretch of the side's line any more:
// its troops do what it gave each of them. A body sent on to where it was
// going already sets off without waiting.
const REST_KM = 20;
const restAim = [0, 0];
const orderTroopsByMind = (run, battle, side, bodies, day, today, lead) => {
  const date = run.dateOf(day);
  const troops = battle.troops[side];
  const endOf = (order) => (!order || order.mark !== MIND_MARK ? "" : Array.isArray(order.way) && order.way.length > 0 ? order.way[order.way.length - 1].join(",") : "out");
  const was = troops.map((troop) => (isLive(troop) ? endOf(standingOf(battle, troop)) : ""));
  battle.orders = battle.orders.filter((order) => order.s !== side || (order.chosen && order.mark !== MIND_MARK));
  for (const body of bodies) {
    const picked = (Array.isArray(body?.picked) ? body.picked : []).filter((index) => troops[index] && isLive(troops[index]));
    if (picked.length === 0) continue;
    if (body.order === "hold" || body.order === "dig in") {
      assignOrder(battle, run, { s: side, sector: "all", order: body.order, since: date, age: 0 }, { ...today, date, run }, { picked });
      continue;
    }
    // A rest (Wars and Fronts Pt.2): each pulls back REST_KM from where it stands, into its own ground, and
    // out of the fighting it recovers (fatigue.js).
    if (body.order === "rest") {
      const order = { s: side, sector: "all", order: "fall back", since: date, age: 0, chosen: true, mark: MIND_MARK, ...(lead ? { by: lead } : {}) };
      battle.orders.push(order);
      for (const index of picked) {
        const troop = troops[index];
        let target = null;
        if (battle.toSide && downhill(battle.field, battle.toSide[1 - side], troop.x, troop.y, restAim)) {
          const cells = REST_KM / battle.place.kmAt(troop.y);
          target = { x: troop.x - restAim[0] * cells, y: troop.y - restAim[1] * cells };
        }
        if (troop.dug) troop.state = STATE_HOLDING;
        troop.dug = false;
        troop.order = { kind: "fallback", standing: order, target, since: day, day, gone: 0 };
        troop.fallback = null;
      }
      continue;
    }
    const way = Array.isArray(body.way) && body.way.length > 0 ? body.way.map((point) => [Number(point[0]), Number(point[1])]) : null;
    const order = { s: side, sector: "all", order: "advance", since: date, age: 0, chosen: true, mark: MIND_MARK, ...(lead ? { by: lead } : {}), ...(way ? { way } : {}) };
    battle.orders.push(order);
    const end = endOf(order);
    assignOrder(battle, run, order, { ...today, date, run }, { picked, lagless: picked.every((index) => was[index] === end) });
  }
  battle.ordersChanged += 1;
  battle.touched = true;
  battle.planKey = "";
};

// A staff of the run's own asked what it orders: as steps the run may be stopped between, where it thinks in them
// (mind/planner.js `steps`), else at once.
function* askOwnStaff(policy, battle, side, context, run) {
  if (typeof policy.steps === "function") return yield* policy.steps(battle, side, context, run);
  return policy(battle, side, context, run);
}

// The staff of each side nobody plays looks at how it stands and decides what
// it does (staff.js): on a battle's first day of a run and every
// STAFF_REVIEW_DAYS after. Before the day is fought, and after whatever the
// story ordered for that day or before it: an order of the story's is left
// alone, and the staff's own is replaced only when it would decide otherwise.
// A STAFF CALLS UP TROOPS (constants.js STAFF_CALL_UP_*): a side nobody plays, at most once in
// STAFF_CALL_UP_DAYS, drafts from its first country's men what its need calls for (staff.js callUpNeed) of the
// formations that country's strength raises there, less what it is short of and times the reserves the game's
// difficulty gives it, as an order for more troops of the whole line is drafted (reinforceOnFront: held to the men
// it has and the room the line has). True when any came. What it came to is kept on the battle (brief.carry.mobilised)
// so that the next run waits its days too.
const staffCallUp = (run, battle, side, day) => {
  // (A run may be told to leave the numbers to the story: a test of something else is.)
  if (run.input?.callUps === false) return false;
  battle.mobilised ??= ["", ""];
  const last = battle.mobilised[side];
  const since = last ? diffGameDays(last, run.dateOf(day)) : null;
  if (since !== null && since >= 0 && since < STAFF_CALL_UP_DAYS) return false;
  const owner = battle.sides[side].findIndex((member, at) => !battle.gone[side].has(at));
  if (owner < 0) return false;
  const lead = battle.sides[side][owner];
  const usual = Math.max(troopsLeast(run.troops), Math.round(troopsWanted(memberWeights(battle, run, side)[owner] ?? 0, battle.effort[side], run.troops)));
  const need = callUpNeed(battle, side, usual);
  if (!(need.share > 0)) return false;
  const reserves = Number(battle.edge?.[side]?.reserves) || 1;
  // (Never past STAFF_CALL_UP_CEILING times that army on the battlefield, with what the difficulty gives it.)
  const ceiling = Math.floor(usual * STAFF_CALL_UP_CEILING * reserves) - liveCount(battle.troops[side]);
  const count = Math.min(ceiling, Math.floor(usual * need.share * (1 - run.shortageOf(lead)) * reserves));
  if (count < 1) return false;
  const before = battle.troops[side].length;
  const said = run.notes.length;
  reinforceOnFront(run, battle, { side: lead, sector: "all", given: true, count, staff: need.why }, day);
  run.notes.length = said;
  battle.mobilised[side] = run.dateOf(day);
  const came = battle.troops[side].length - before;
  (run.staffCalls ??= []).push({ d: run.dateOf(day), battlefield: battle.name, side: lead, why: need.why, asked: count, came });
  return came > 0;
};

function* reviewStaff(run, battle, day, regular = true) {
  // (A run may be told to leave every side to its orders: the engine's own tests of other things are.)
  if (run.input?.staff === false) return;
  const war = run.wars.get(battle.warId);
  if (!war || war.status !== "active") return;
  let today = null;
  // A war begun on a border that was fortified in peace: both sides stand
  // dug in or holding, as the peace left them, and a war in which nobody moves
  // is not one. The side that began it attacks along the whole line from its
  // first day, unless a person plays it or the story has ordered it already.
  const begun = battle.begun === true;
  battle.begun = false;
  if (begun) {
    const side = battle.swap ? HOLDER_SIDE_B : HOLDER_SIDE_A;
    const peaceful = battle.orders.filter((order) => order.s === side && !order.chosen).every((order) => !isAttackWord(order.order) && order.since !== run.dateOf(day));
    if (!battle.away[side] && !sideIsPlayed(battle, side, run.input?.players) && peaceful && liveCount(battle.troops[side]) > 0) {
      today = prepare(battle, day);
      const lead = battle.sides[side].find((member, at) => !battle.gone[side].has(at)) ?? "";
      battle.orders = battle.orders.filter((order) => order.s !== side || order.chosen);
      const order = setStandingOrder(battle, side, { sector: "all", order: "advance", since: run.dateOf(day), age: 0, by: lead, mark: STAFF_MARK });
      assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run });
      battle.touched = true;
      battle.planKey = "";
      battle.log.push({ d: run.dateOf(day), k: "offensive", s: side, at: "the whole line" });
      battle.begunBy = side;
    }
  }
  // A war a person's own country began, on its battlefield's first day: when nobody has given that side any order
  // (the story's or the person's own), its troops go over to the attack along the whole line, as the side that
  // begins a war does. "When a front is deployed in the first time skip even if you skip a year the front doesnt do
  // anything" (the owner, 2026-10-14): nobody but that person leads their side, and they cannot until the skip has
  // landed. From then on the side is theirs to order, as ever.
  const opener = battle.swap ? HOLDER_SIDE_B : HOLDER_SIDE_A;
  const opening = battle.openedDate ? diffGameDays(battle.openedDate, run.dateOf(day)) : null;
  if (!begun && battle.openedFor !== true && opening !== null && opening <= 1 && !battle.away[opener] && sideIsPlayed(battle, opener, run.input?.players)
    && !battle.orders.some((order) => order.s === opener) && liveCount(battle.troops[opener]) > 0) {
    battle.openedFor = true;
    today = today ?? prepare(battle, day);
    const lead = battle.sides[opener].find((member, at) => !battle.gone[opener].has(at)) ?? "";
    const order = setStandingOrder(battle, opener, { sector: "all", order: "advance", since: run.dateOf(day), age: 0, by: lead, mark: STAFF_MARK });
    assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run });
    battle.touched = true;
    battle.planKey = "";
    battle.log.push({ d: run.dateOf(day), k: "offensive", s: opener, at: "the whole line" });
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // A side nobody plays calls up fresh troops when it needs them, whatever its orders (staffCallUp).
    if (regular && !battle.away[side] && !sideIsPlayed(battle, side, run.input?.players) && staffCallUp(run, battle, side, day)) today = null;
    // (The side that has just gone over to the attack is left to it until the staff next looks.)
    if (begun && battle.begunBy === side) continue;
    if (battle.away[side] || sideIsPlayed(battle, side, run.input?.players) || !staffMayOrder(battle, side)) continue;
    if (liveCount(battle.troops[side]) === 0) continue;
    // A staff of the run's own is asked on the engine's days, or every day if it looks often (mind/planner.js).
    const policy = typeof run.input?.staffPolicy === "function" ? run.input.staffPolicy : null;
    const asks = policy !== null && (regular || policy.often === true);
    // The engine's own staff, with the newer mechanics, watches every day for a breakthrough to answer
    // (staff.js breakthroughAnswer): the day it sees one, and every BREAKTHROUGH_LOOK_DAYS while it lasts. (Not for
    // a side a staff of the run's own leads: what it said when it last looked stands until it next does.)
    const ledByOwn = policy !== null && !asks && battle.ledByOwn?.[side] === true;
    const answer = anyMechanic(run.mech) && !ledByOwn ? breakthroughAnswer(battle, side) : null;
    const answering = battle.answering?.[side] ?? -1;
    // (Told afresh only once those it sent have got where they were sent, or stopped: an order given again is set
    // off again, and one given again every few days never gets going.)
    const idle = () => !battle.troops[side].some((troop) => isLive(troop) && troop.order && !troop.order.done && troop.order.standing?.mark === MIND_MARK);
    const answers = answer !== null && (answering < 0 || regular || (battle.daysRun - answering >= BREAKTHROUGH_LOOK_DAYS && idle()));
    if (!regular && !asks && !answers) continue;
    today = today ?? prepare(battle, day);
    const context = {
      // (The first side of a war is the one that began it.)
      began: battleSide(battle, side) === 0,
      today,
      key: `${run.seed}|${battle.name}|${side}|${run.dateOf(day)}`,
    };
    // EXPERIMENT, in the lab (mind/policy.js): a run may be handed a staff of
    // its own, a trained network, asked first. `undefined` from it leaves the
    // side to the staff the engine has.
    const own = asks ? (yield* askOwnStaff(policy, battle, side, { ...context, regular }, run)) : undefined;
    // What its wings are sent to do over the battle (air.js AIR_MISSIONS), whatever it says of its troops.
    if (own && typeof own.air === "string") setAirMission(battle, side, own.air);
    // What its plan is and where it aims (mind/planner.js), for the record: the other side may come to know it.
    if (own && typeof own.plan === "string") noteStaffPlan(run, battle, side, own, day);
    if (asks) {
      battle.ledByOwn ??= [false, false];
      battle.ledByOwn[side] = own !== undefined;
    }
    // (One may keep what it ordered.)
    if (own && own.keep === true) continue;
    const lead = battle.sides[side].find((member, at) => !battle.gone[side].has(at)) ?? "";
    if (own === undefined && answers) {
      battle.answering ??= [-1, -1];
      battle.answering[side] = battle.daysRun;
      if (answering < 0) battle.log.push({ d: run.dateOf(day), k: "counter", s: side, at: describePoint(battle.arena, answer.at.x, answer.at.y) });
      orderTroopsByMind(run, battle, side, answer.bodies, day, today, lead);
      continue;
    }
    // (Between the engine's own looks only a staff of the run's own decides; and what the staff ordered against a
    // breakthrough stands while the breakthrough does, and is over with it.)
    if (own === undefined && (!regular || answer)) continue;
    if (own === undefined && answering >= 0) {
      battle.answering[side] = -1;
      battle.orders = battle.orders.filter((order) => order.s !== side || order.mark !== MIND_MARK);
    }
    const decided = own === undefined ? staffDecision(battle, side, context) : own;
    if (!decided) continue;
    // (Or it orders the side's troops one by one.)
    if (Array.isArray(decided.troops)) {
      orderTroopsByMind(run, battle, side, decided.troops, day, today, lead);
      continue;
    }
    // Such a staff may call up fresh formations too (reinforceOnFront): as many as a draft usually brings,
    // within what a side may be brought to and the men its country has. One refused says nothing.
    if (decided.draft === true && lead) {
      const said = run.notes.length;
      reinforceOnFront(run, battle, { side: lead, sector: decided.sector, given: true }, day);
      run.notes.length = said;
      today = prepare(battle, day);
    }
    const wanted = `${decided.order}|${fold(decided.sector)}`;
    const stands = staffStanding(battle, side);
    // To hold is what a side with no order does: nothing is written for it, unless the staff had it attacking.
    if (stands === wanted || (decided.order === "hold" && stands === "" && !battle.orders.some((order) => order.s === side && !order.chosen))) continue;
    // What the staff had the side doing before is over, and so is an order of the story's that has
    // stood too long to be left alone (staffMayOrder): the line is the staff's to order afresh.
    battle.orders = battle.orders.filter((order) => order.s !== side || order.chosen);
    const order = setStandingOrder(battle, side, { sector: decided.sector, order: decided.order, since: run.dateOf(day), age: 0, by: lead, mark: STAFF_MARK });
    assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run });
    battle.touched = true;
    battle.planKey = "";
    // Going over to the attack is something to tell.
    if (decided.order === "advance" && !stands.startsWith("advance")) battle.log.push({ d: run.dateOf(day), k: "offensive", s: side, at: decided.sector === "all" ? "the whole line" : decided.sector });
  }
}

function* stepDay(run) {
  const day = run.day + 1;
  for (let index = 0; index < run.battles.length; index += 1) {
    const battle = run.battles[index];
    if (battle.status === "active") {
      // Whoever was sent into a country outside the war and has come to it
      // brings it in before the day is fought: its land is ground from today.
      invadeWhereSent(run, battle, day);
      // A side that withdrew and whose orders no longer say so (the war room sent it back) is back.
      if (battle.away[0] || battle.away[1]) comeBack(run, battle, day);
      // The levies owed come in (muster.js), and the morning: what the day makes of every troop, before its staff looks (dawn.js).
      musterDay(run, battle, day);
      dawn(run, battle, day);
      // The staff looks every STAFF_REVIEW_DAYS; a staff of a run's own that looks more often
      // (`often` on it: mind/planner.js) is asked every day, and the engine's own staff only on its days.
      const regular = battle.begun || battle.daysRun === 0 || battle.daysRun % STAFF_REVIEW_DAYS === 0;
      // (With the newer mechanics the staff watches for a breakthrough every day too: staff.js breakthroughAnswer.)
      if (regular || run.input?.staffPolicy?.often === true || anyMechanic(run.mech)) yield* reviewStaff(run, battle, day, regular);
      run.steps += simulateDay(battle, run, day);
      // Whoever was told to withdraw and has got clear is gone from the battlefield.
      withdrawWhoLeft(run, battle, day);
      battle.daysRun += 1;
    } else if (battle.status === "standing") {
      // A border built up in peace: its levies come in and its troops march to it; nothing is fought (march.js).
      if (run.mech.marching) peaceDay(run, battle, day);
      standDay(battle);
    }
    if (battle.closing && battle.status !== "closed") closeBattle(run, battle, day);
  }
  // The day's sailing: whoever arrives is on the ground from this evening.
  moveTransports(run, day);
  applyMoments(run, day);
  for (const battle of run.battles) {
    if (battle.status !== "closed" && battle.recorded !== day) recordDay(battle, day, day >= run.days);
    // Whoever came today (reserves, a landing, a formation taken in) is put under a general.
    if (battle.status !== "closed") assignCommands(battle);
  }
  run.day = day;
}

// A region that changed hands on a battle, by name: { name?, cities?, capital? }, the towns in it the larger first
// (three at most), and whether one of them is a capital. Nothing for a region with no name of its own.
const FLIP_CITIES_MOST = 3;
const flipPlaces = (battle, regionId) => {
  const arena = battle?.arena;
  const index = arena?.indexOf?.get(regionId);
  if (index === undefined || !arena.names[index] || arena.names[index] === arena.ids[index]) return {};
  const towns = arena.cities.filter((city) => city.cell >= 0 && arena.region[city.cell] === index)
    .sort((a, b) => (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || b.population - a.population || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    name: arena.names[index],
    ...(towns.length ? { cities: towns.slice(0, FLIP_CITIES_MOST).map((city) => city.name) } : {}),
    ...(towns.some((city) => city.capital) ? { capital: true } : {}),
  };
};

// The result of a run as it stands after the days simulated so far.
const snapshot = (run) => {
  const day = run.day;
  // (With what became of the air wings that flew over the battlefields: air.js.)
  const changes = [...run.unitChanges, ...wingChanges(run)].map(({ committedTo, ...change }) => ({ ...change, committedTo: typeof committedTo === "string" ? committedTo : committedTo.name }));
  const records = run.battles.map((battle) => saveBattle(battle, run, day, changes, buildBrief(battle, battle.openedDay > 0 ? battle.openedDate : run.dateOf(0))));
  const open = records.filter((record) => record.status !== "closed").slice(0, MAX_BATTLEFIELDS);
  const closed = records.filter((record) => record.status === "closed").slice(-MAX_CLOSED_BATTLEFIELDS);
  return {
    battlefields: [...open, ...closed],
    // (A take by a country's force says whose it is, and on whose land: day.js settleRegions.)
    // (And what the region is called, with its towns, the larger first: what an event of the story must name to
    // carry it, Game/AI/frontTurn.js attachFrontFlips. Never its id, which nobody reads.)
    flips: run.flips.map(({ day: on, date, battlefield, regionId, from, to, kind, owner, land }) => ({ day: on, date, battlefield: battlefield.name, regionId, from, to, kind, ...(owner ? { owner, land } : {}), ...flipPlaces(battlefield, regionId) })),
    // The countries troops were sent into, each with the war it is in from
    // that day and the side of it (0 for its first, 1 for its second).
    joins: run.joins.map(({ day: on, date, battlefield, warId, name, side, by }) => ({ day: on, date, battlefield: battlefield.name, warId, name, side, by })),
    // The wars that began with an attack during the run: who attacked whom, and from what day.
    starts: run.starts.map((start) => ({ ...start })),
    unitChanges: changes,
    // The transporters as the days leave them, and what became of each on the way.
    transports: run.transports.map((transport) => ({ ...transport })),
    voyages: run.voyages.map(({ battlefield, ...voyage }) => (battlefield ? { ...voyage, battlefield: battlefield.name } : voyage)),
    notes: run.notes.map((note) => (note.battlefield && typeof note.battlefield === "object" ? { ...note, battlefield: note.battlefield.name } : { ...note })),
    // What the days of this run added to each battlefield's log, all of it and
    // in the order it happened: a record keeps only the last few entries.
    // A town that changed hands says how large it is, for whoever has to
    // choose which of many to tell.
    news: run.battles.flatMap((battle) => battle.log.slice(battle.logFrom).map((entry) => {
      const told = { ...entry, battlefield: battle.name };
      if (entry.k !== "city") return told;
      const city = battle.arena.cities.find((candidate) => `city: ${candidate.name}` === entry.at);
      return city ? { ...told, size: Math.max(0, Number(city.population) || 0), ...(city.capital ? { capital: true } : {}) } : told;
    })),
    // What recruitment drew from each country's people and what came home to them, in men (manpower.js).
    manpower: manpowerReport(run),
    // How much each country's formations advanced, which its war resources pay for (runtime/warResources.js).
    ...(run.mech.supply ? { effort: [...run.effort.values()].map(({ name, advanced, troopDays, warDays }) => ({ name, advanced, troopDays, warDays })) } : {}),
    // What the weather and being cut off took from each country, besides the fighting (attrition.js).
    ...(run.mech.attrition ? { attrition: attritionReport(run, day) } : {}),
    // What the fighting did to the scenario's walls: their breaches and wear (walls.js).
    ...(run.lines && run.lines.some((line) => line.changed) ? { fortifications: linesChanged(run) } : {}),
    stats: { days: day, steps: run.steps },
    // What the staffs of the sides nobody plays called up, and why (staffCallUp): for the log.
    ...(run.staffCalls?.length ? { staffCalls: run.staffCalls.map((call) => ({ ...call })) } : {}),
  };
};

// ---- rehearsal (mind/planner.js) ------------------------------------------------
// A staff that looks ahead tries orders out on a COPY of a battle, days ahead,
// before it gives any: "make it the stockfish of Open historia" (the owner,
// 2026-10-14). The copy shares only what a day never changes (the map: arena,
// place, frame, and how things stood when the run began); everything else is its own. It is
// fought on a stand-in run that keeps the regions it changes hands over to
// itself, writes no flips, notes or news anyone reads, never grows its frame
// and calls on no staff: nothing of the real run or the real battle is touched.
// (Whose home each cell is changes as regions are taken whole: each copy has its own.)
const SHARED_BATTLE_KEYS = Object.freeze(["arena", "place", "frame", "recorder", "watch", "startPhi", "startHolders", "mindHomes", "mendOf", "wallsFor", "wallRun"]);

// (A copy's days are recorded nowhere.)
const SILENT_RECORDER = Object.freeze({ record: () => {}, shown: () => {}, finish: () => null });

export const rehearsal = (run, battle) => {
  // (A key ending in For or Run is what something was last worked out for, kept by its identity: shared too.)
  const shared = Object.keys(battle).filter((key) => SHARED_BATTLE_KEYS.includes(key) || /(For|Run)$/.test(key));
  const bare = { ...battle };
  for (const key of shared) delete bare[key];
  bare.field = { ...battle.field };
  delete bare.field.arena;
  const copy = structuredClone(bare);
  for (const key of shared) copy[key] = battle[key];
  copy.field.arena = battle.field.arena;
  copy.watch = null;
  copy.recorder = SILENT_RECORDER;
  copy.mendOf = null;
  copy.grown = 6;
  const controllers = new Map();
  const groups = new Map();
  const forces = new Map();
  const stub = Object.create(run);
  Object.assign(stub, {
    battles: [copy],
    flips: [],
    notes: [],
    joins: [],
    starts: [],
    unitChanges: [],
    // (What its staffs call up is its own to count: staffCallUp.)
    staffCalls: [],
    taken: new Set(run.taken),
    manpower: structuredClone(run.manpower),
    effort: new Map(),
    mendLeft: run.mendLeft ? new Map(run.mendLeft) : run.mendLeft,
    wings: run.wings ? new Map([...run.wings].map(([id, wing]) => [id, { ...wing }])) : run.wings,
    airOver: new Map(),
    airDay: -1,
    lines: Array.isArray(run.lines) ? structuredClone(run.lines) : run.lines,
    steps: 0,
    braked: false,
    flipsLeft: Infinity,
    controllerOf: (id) => (controllers.has(id) ? controllers.get(id) : run.controllerOf(id)),
    setController: (id, who) => { controllers.set(id, who); },
    groupOf: (id) => (groups.has(id) ? groups.get(id) : run.groupOf(id)),
    setGroup: (id, who) => { groups.set(id, who); },
    // (A force it founds is its own too.)
    isGroup: (name) => forces.has(fold(name)) || run.isGroup(name),
    groupOwnerOf: (name) => (forces.has(fold(name)) ? forces.get(fold(name)) : run.groupOwnerOf(name)),
    foundForce: (name, owner) => { forces.set(fold(name), clean(owner)); },
    regionChanged: () => {},
    spendFlip: () => {},
    input: { ...run.input, watch: null, staffPolicy: null },
  });
  // Its walls are worn on its own lines (walls.js wearWall wears those of battle.wallRun): the copy's first day
  // begins after the morning that sets them, and it wore and broke the real walls. Found 2026-10-15, when a skip's
  // second run, its staff's looks had again rather than rehearsed, came out otherwise than the first.
  if (copy.wallRun) copy.wallRun = stub;
  return { run: stub, battle: copy };
};

// What a side's wings are sent to do over a battle (air.js AIR_MISSIONS); anything else is no change.
const setAirMission = (battle, side, mission) => {
  if (!AIR_MISSIONS.includes(mission)) return;
  battle.airMission = Array.isArray(battle.airMission) ? battle.airMission : ["support", "support"];
  battle.airMission[side] = mission;
};

// What a staff of the run's own said its plan is, and where most of those it sent forward are going (mind/planner.js),
// kept on the battle as its record keeps it (battle.js, brief.carry.staff): its side's own, which the other side's
// agents and aircraft may find out (GameUI/warRoom.jsx).
const noteStaffPlan = (run, battle, side, said, day) => {
  const aim = Array.isArray(said.aim) && said.aim.length === 2 ? battle.place.toCell(Number(said.aim[0]), Number(said.aim[1])) : null;
  const at = aim && Number.isFinite(aim[0]) && Number.isFinite(aim[1]) ? describePoint(battle.arena, aim[0], aim[1]) : "";
  let sent = 0;
  for (const body of Array.isArray(said.troops) ? said.troops : []) if (body.order === "advance" && Array.isArray(body.picked)) sent += body.picked.length;
  battle.staffPlans = Array.isArray(battle.staffPlans) ? battle.staffPlans : [null, null];
  battle.staffPlans[side] = { plan: said.plan, ...(at ? { at } : {}), since: run.dateOf(day), n: sent };
};

// Gives a rehearsal's side orders, troop by troop, as a staff of the run's own does ({ order, picked, way } bodies),
// and, with `air`, what its wings are sent to do.
export const rehearseOrders = (rehearsed, side, bodies, day, { air = null } = {}) => {
  const { run, battle } = rehearsed;
  if (typeof air === "string") setAirMission(battle, side, air);
  if (!Array.isArray(bodies) || bodies.length === 0 || liveCount(battle.troops[side]) === 0) return;
  const today = prepare(battle, day);
  const lead = battle.sides[side].find((member, at) => !battle.gone[side].has(at)) ?? "";
  orderTroopsByMind(run, battle, side, bodies, day, today, lead);
};

// Fights a rehearsal's next day, from its morning (the levies owed coming in, and dawn.js) unless the copy was
// made after it: a staff looks after the morning, so the first day of a rehearsal it makes is `morning: false`.
// False once the battle there is over.
export const rehearseDay = (rehearsed, day, { morning = true } = {}) => {
  const { run, battle } = rehearsed;
  if (battle.status !== "active" || battle.closing) return false;
  if (morning) {
    musterDay(run, battle, day);
    dawn(run, battle, day);
  }
  run.steps += simulateDay(battle, run, day);
  battle.daysRun += 1;
  return !battle.closing;
};

// ---- rehearsals on other cores (mind/planner.js, mind/rehearsers.js) ------------
// "do the multi-core rehearsals too" (the owner, 2026-10-16). A staff's plans,
// each fought out on a copy of the battle one after another, are most of what a
// war's turn takes. Other cores fight them as well, together: each is sent the
// battle and the run as they stand, as data (rehearsalPacket), rebuilds the
// same two (rehearsalBase) and makes its copies of those exactly as here. The
// same orders on the same battle come out the same to the last digit wherever
// they are fought. What a copy is asked and was not told (a region or a
// country its tables lack) it says it missed, and that plan is fought here.
//
// What is not data is said by name: the battle's projector (its place, and
// what was worked out for it) and the run itself (what its walls were worn
// on). The run's readers of the world become tables: whose each of the
// battle's regions is, and each country's figures, for every country the
// battle could ask about.
const PLACE_MARK = "\u0000place";
const RUN_MARK = "\u0000run";
// (Never sent: what every copy is given afresh (rehearsal above), the arenas kept, the map's shapes.)
const RUN_LEFT_OUT = new Set(["input", "battles", "cache", "landRegions", "airOver", "flips", "notes", "joins", "starts", "unitChanges"]);
const INPUT_LEFT_OUT = new Set(["arenas", "battlefields", "staffPolicy", "watch", "rehearsers"]);
const BATTLE_LEFT_OUT = new Set(["recorder", "watch", "mendOf"]);
// The readers asked of a region (by its id); every other is asked of a country (by its name).
const REGION_READERS = Object.freeze(["controllerOf", "sovereignOf"]);

export const rehearsalPacket = (run, battle) => {
  const books = {};
  for (const key of Object.keys(run)) if (!RUN_LEFT_OUT.has(key) && typeof run[key] !== "function") books[key] = run[key];
  const input = {};
  const readers = [];
  for (const [key, value] of Object.entries(run.input ?? {})) {
    if (INPUT_LEFT_OUT.has(key)) continue;
    if (typeof value === "function") readers.push([key, value]);
    else input[key] = key === "map" && value && typeof value === "object" ? { ...value, regions: null } : value;
  }
  // Every region of the battle's, and every country it could ask about.
  const ids = battle.arena.ids.filter((id) => typeof id === "string" && id);
  const names = new Set();
  const add = (name) => {
    const text = clean(name);
    if (text) names.add(text);
  };
  for (const list of battle.sides) list.forEach(add);
  for (const war of run.wars.values()) for (const list of war.sides) list.forEach(add);
  for (const id of ids) {
    add(run.controllerOf(id));
    add(run.sovereignOf(id));
    add(run.groupOf(id));
  }
  for (const unit of Array.isArray(run.input?.units) ? run.input.units : []) {
    add(unit?.ownerCode);
    add(unit?.owner);
  }
  for (const list of [run.transports, run.lines, run.wings ? [...run.wings.values()] : []]) for (const item of Array.isArray(list) ? list : []) add(item?.owner);
  const tables = {};
  for (const [key, reader] of readers) {
    const table = new Map();
    for (const asked of REGION_READERS.includes(key) ? ids : names) table.set(asked, reader(asked));
    tables[key] = table;
  }
  const lookups = {};
  for (const [key, kept] of Object.entries(run.lookups ?? {})) lookups[key] = [...kept];
  const bare = {};
  for (const key of Object.keys(battle)) {
    const value = battle[key];
    bare[key] = value === battle.place ? PLACE_MARK : value === run ? RUN_MARK : BATTLE_LEFT_OUT.has(key) ? null : value;
  }
  return { books, input, tables, lookups, battle: bare };
};

// The battle and the run a packet was made of, rebuilt (from a copy of it: it is made over): { run, battle, missed },
// missed.count the times a copy was asked what its tables did not have.
export const rehearsalBase = (packet) => {
  const missed = { count: 0 };
  const input = { ...packet.input };
  for (const [key, table] of Object.entries(packet.tables ?? {})) {
    input[key] = (asked) => {
      if (table.has(asked)) return table.get(asked);
      missed.count += 1;
      return undefined;
    };
  }
  const run = createRun(input);
  for (const [key, entries] of Object.entries(packet.lookups ?? {})) for (const [asked, value] of entries) run.lookups[key]?.set(asked, value);
  Object.assign(run, packet.books);
  const battle = packet.battle;
  const place = projectorOf(battle.frame);
  for (const key of Object.keys(battle)) {
    if (battle[key] === PLACE_MARK) battle[key] = place;
    else if (battle[key] === RUN_MARK) battle[key] = run;
  }
  run.battles = [battle];
  return { run, battle, missed };
};

export const createFrontRun = (input) => {
  let run = null;
  let needsRegions = false;
  // The work of a run, with the one thing it may stop for: shapes it was not given.
  const work = (task) => {
    if (needsRegions) return;
    try {
      task();
    } catch (error) {
      if (error !== REGIONS_NEEDED) throw error;
      needsRegions = true;
    }
  };
  work(() => {
    run = createRun(input ?? {});
    begin(run);
  });
  // The days as steps a caller may stop between: between any two a staff of the run's own may be thinking
  // (mind/planner.js), and Game/AI/frontTurn.js runFrontTurn lets the page draw there.
  function* daySteps(maxDays = Infinity) {
    if (needsRegions) return;
    try {
      for (let done = 0; done < maxDays && run.day < run.days; done += 1) yield* stepDay(run);
    } catch (error) {
      if (error !== REGIONS_NEEDED) throw error;
      needsRegions = true;
    }
  }
  const finished = () => needsRegions || run.day >= run.days;
  const advance = (maxDays = Infinity) => {
    const steps = daySteps(maxDays);
    for (let step = steps.next(); !step.done; step = steps.next()) { /* taken one after another */ }
    return finished();
  };
  return {
    // Simulates up to `maxDays` more days; true when the run is finished.
    advance,
    // The same, as steps (a generator); then finished() says whether the run is.
    steps: daySteps,
    finished,
    // The result as it stands now, without ending the run: what a run cut here would give.
    snapshot: () => (needsRegions ? { needsRegions: true } : snapshot(run)),
    finish: () => {
      advance();
      return needsRegions ? { needsRegions: true } : snapshot(run);
    },
  };
};

export const runFronts = (input) => createFrontRun(input).finish();
