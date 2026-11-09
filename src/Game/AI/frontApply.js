/*! Open Historia — a turn's land war: the game's side of the front engine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// frontTurn.js is the turn's side of the conversation with the front engine
// and knows nothing of the game: it is handed a world, the events and a way to
// read the map. This is where the game hands them over, and the only file
// gameplay.js calls for any of it:
//
//   forecastTurnFronts   a turn about to be asked for: the engine is run over
//                        the days it will cover, under the orders that already
//                        stand, so that the story is written knowing how the
//                        war went (the [Fronts] block tells it). No request.
//   applyTurnFronts      a turn being applied (applySimulationResult): the engine
//                        is run over the days the turn covers and its changes of
//                        hands are put on the turn's events. After a forecast it
//                        is the same run again, with the answer's orders put at
//                        its end for the next period to carry out
//   withFrontUnits       the formations that went onto a battlefield or came back
//   frontsLiveBlock      the [Fronts] block of a time skip's prompt
//   frontPowers,         the old stand-ins for a front (a counter raised for a
//   withoutFrontPowers,  power with none, the territory Director's marks) keep
//   frontRegionTest      clear of the powers and the regions a battlefield has
//
// Every one of them does nothing, and reads nothing, in a game whose fronts are
// switched off (frontsGate.js).

import { noteReceipt } from "../../runtime/applicationReceipt.js";
import { JSON_URLS, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { citiesFollowing, cityPopulationKey, cityPopulationOverridesByTileName, countryPopulationMoves, effectiveCityPopulation } from "../../runtime/cityPopulation.js";
import { frontCitiesOf, readFrontCities } from "../../runtime/frontCities.js";
import { MAX_UNITS_GLOBAL, MAX_UNITS_PER_POLITY } from "../../runtime/gameState.js";
import { buildSeasBlock } from "./navalPrompt.js";
import { budgetUnderBlockade, gdpUnderBlockade, withTurnBlockades } from "../../runtime/naval/blockade.js";
import { arenaFor } from "../../runtime/fronts/arena.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { othersOnWay } from "../../runtime/fronts/invade.js";
import { gameDateYear } from "../../runtime/gameDates.js";
import { yearInEra } from "../../runtime/unitMotion.js";
import { eraSettingOf, warSettingsOf, warfareOf } from "../../runtime/warSettings.js";
import { normalizeBattlefields } from "../../runtime/fronts/record.js";
import { homeName } from "../../runtime/fronts/home.js";
import { EMBARK_PORTS_MOST, TRANSPORT_START_FAILS, departuresFor, isUnderWay, normalizeTransports } from "../../runtime/fronts/transports.js";
import { AIR_CITY_GDP, airStrikesBlock, normalizeAirStrikes, withTurnAirStrikes } from "../../runtime/fronts/airStrike.js";
import { findWay } from "../../runtime/fronts/wayfinder.js";
import { buildWorldGrid, measureOptions, worldSheetKey } from "../../runtime/fronts/worldGrid.js";
import { regionLocatorOf } from "../../runtime/regionLocator.js";
import { waterTypeIds } from "../../runtime/regionTypes.js";
import { chartOf } from "../../runtime/warRoomChart.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { getActiveWorldDirection, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { normalizeDifficulty } from "../../runtime/difficulty.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { engineMapOf, worldMeasureOf } from "../../../server/mapDistance.js";
import { stolenPlansBlock, turnPlanned, warRoomIntel } from "./frontPlans.js";
import { battlefieldPowers, buildFrontsBlock } from "./frontPrompt.js";
import { buildScenarioFronts, scenarioFrontsPending } from "./frontScenario.js";
import { airOn, frontsOn, frontsPace, naviesOn, strategyNetOn } from "./frontsGate.js";
import { labStaffPolicy, trainedStaffPolicy } from "../../runtime/fronts/mind/trained.js";
import { applyFrontUnitChanges, battlefieldRegionTest, engineRegionsOf, frontWorldReaders, runTurnFronts, stripFrontOps } from "./frontTurn.js";
import { applyWarUpdates, eventNarratesHardCombat } from "./nativeWarLedger.js";
import { filterToRenderedRegions } from "./promptContext.js";
import { territoryTempoAllowance } from "./worldDirection.js";
import { fightOffPage, offPageAvailable } from "./frontWorkerClient.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- the map, as the engine is told it -------------------------------------------

// The ground under each battlefield (runtime/fronts/arena.js), drawn once from
// the map's shapes and kept while the same map is being played: a war that is
// already being fought then needs no shapes read at all. Another campaign's
// map, or the same one with a region or a city's name changed, is another key,
// and what was kept for the last one is let go.
let kept = { key: "", arenas: new globalThis.Map() };
const arenasFor = (key) => {
  if (kept.key !== key) kept = { key, arenas: new globalThis.Map() };
  return kept.arenas;
};

const hashOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// (The cities of the map as the engine is given them are runtime/frontCities.js's.)
export { frontCitiesOf, readFrontCities };

// What the engine needs of the map besides its shapes: each region's name and
// who held it before any override, the cities, the structures, and a key that
// names this map. Read from what the game already keeps in hand (the compact
// region catalog, the cities file); the shapes themselves are read only when
// the engine asks for them.
const readFrontMap = async (world, game, campaignId) => {
  const [catalogRows, citiesGeojson] = await Promise.all([
    loadRegionCatalog().catch(() => []),
    readJson(JSON_URLS.citiesGeojson, { defaultValue: null }).catch(() => null),
  ]);
  const catalog = filterToRenderedRegions(catalogRows, world);
  const baseOwners = new globalThis.Map();
  const names = new globalThis.Map();
  const regionIds = [];
  for (const row of catalog) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    regionIds.push(id);
    baseOwners.set(id, clean(row.owner ?? row.country));
    names.set(id, clean(row.name) || id);
  }
  const renames = isRecord(world?.cityRenames) ? world.cityRenames : {};
  const cities = frontCitiesOf(citiesGeojson, world, game);
  // What an assault may be sent at besides a city: the structures of the map,
  // by name and place. (The engine finds a formation among the units it is given.)
  const structures = asArray(world?.markers)
    .map((marker) => ({ name: clean(marker?.name), kind: clean(marker?.kind), owner: clean(marker?.ownerCode), lng: Number(marker?.lng), lat: Number(marker?.lat) }))
    .filter((entry) => entry.name && Number.isFinite(entry.lng) && Number.isFinite(entry.lat));
  // How the map measures (server/mapDistance.js): nothing for plain Mercator,
  // a flat sheet's scale for a freeform map, a world projection's table and its
  // scale line otherwise. Part of the key, so a map measured anew is a new sheet.
  const measure = worldMeasureOf(world);
  const key = [
    clean(campaignId) || "game",
    regionIds.length,
    hashOf(regionIds.join("\u0002")),
    hashOf([...names.values()].join("\u0002")),
    cities.length,
    hashOf(JSON.stringify(renames)),
    ...(measure.plain ? [] : [hashOf(measure.key)]),
  ].join(":");
  return {
    baseOwners,
    names,
    regionIds,
    // A flat sheet is a map with no globe behind it: its scale line (the
    // Workshop's Projection panel) says how many kilometres its degree is.
    map: { key, cities, structures, ...engineMapOf(measure) },
  };
};

// The wars as each record of the turn's war ledger leaves them, one stage a
// record: what tells the engine on which day a war began, was joined, froze or
// ended. The ledger's own merge, a record at a time, so a record it refuses
// moves nothing here either. It reads only the wars, so they are all it is given.
const warStagesOf = ({ wars, updates, events, stopDate, round }) => {
  const stages = [asArray(wars)];
  for (const update of asArray(updates)) {
    try {
      stages.push(applyWarUpdates({ world: { wars: stages.at(-1) }, updates: [update], events, stopDate, round, limit: Infinity }).wars);
    } catch (error) {
      console.warn("[fronts] a war record could not be read for the battlefields; they follow the wars as they stood.", error);
    }
  }
  return stages;
};

// How many regions each country holds now, counted on the map itself (every
  // region it draws, by who the world says holds it, else who it was drawn as):
  // Map of a name in lower case to the count. For what a war has cost a country
  // of its own ground (warAndPeace.js). From the world alone when the map
  // cannot be read.
export const regionHoldingsOf = async (world, game, campaignId) => {
  const held = new globalThis.Map();
  const add = (name) => {
    const key = fold(name);
    if (key) held.set(key, (held.get(key) ?? 0) + 1);
  };
  try {
    const front = await readFrontMap(world, game, campaignId);
    const readers = frontWorldReaders(world, { baseOwners: front.baseOwners, groups: false });
    for (const id of front.regionIds) add(readers.controllerOf(id));
    // (Every region of the map counted: a country with none holds no land at all.)
    if (held.size > 0) return Object.assign(held, { complete: true });
  } catch (error) {
    console.warn("[peace] the map's regions could not be counted; the world's own list is used.", error);
  }
  for (const holder of Object.values(world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object" ? world.regionOwnershipOverrides : {})) add(holder);
  return held;
};

// ---- a turn being applied --------------------------------------------------------------

// The world a turn's run is to find: as it stands, with the plans of the turn
// written onto its battlefields where a war is being fought. A world with no
// such battlefield is handed back untouched and the map's cities are not read.
// (A transporter under way is fighting to come: where it lands a battlefield opens.)
const onBattlefields = (world) => asArray(world?.battlefields).some((row) => row?.status === "active");
// (Or an air strike the war room ordered waits to be flown: runtime/fronts/airStrike.js.)
const fighting = (world) => onBattlefields(world) || asArray(world?.transports).some(isUnderWay) || (airOn() && asArray(world?.airStrikeOrders).length > 0);
const plannedWorld = async (world, game) => {
  if (!onBattlefields(world)) return world;
  try {
    return turnPlanned({ world, game, cities: await readFrontCities(world, game), espionage: isActiveFeatureEnabled("espionage") });
  } catch (error) {
    console.warn("[fronts] the turn's plans could not be read; the battlefields are run as they stand.", error);
    return world;
  }
};

const pauseFor = (signal) => async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new DOMException("Timeline jump cancelled.", "AbortError"));
};

// What the engine is given of a turn besides its events: the same for the run
// made before the story is asked for and for the one that applies it, so that
// the second is the first again.
const turnRunInput = ({ world, game, campaignId, loadRegions, signal, round, fromDate }) => {
  let front = null;
  const direction = getActiveWorldDirection();
  return {
    createFrontRun,
    regionTypes: asArray(world?.regionTypes),
    groups: isActiveFeatureEnabled("groups"),
    readMap: async () => {
      front = await readFrontMap(world, game, campaignId);
      return { map: front.map, baseOwners: front.baseOwners, regionIds: front.regionIds, arenas: arenasFor(front.map.key) };
    },
    loadRegions: typeof loadRegions === "function"
      ? async () => engineRegionsOf(await loadRegions(), { nameOf: (id) => front?.names.get(id) })
      : null,
    // The same shapes for a run fought away from the page, which reads the file itself (frontWorkerCore.js).
    regionsFile: typeof loadRegions?.file === "function"
      ? async () => ({ url: await loadRegions.file(), names: [...(front?.names ?? [])] })
      : null,
    pause: pauseFor(signal),
    pace: frontsPace(),
    tempoAllowance: (days) => (direction?.territoryTempo > 0 ? territoryTempoAllowance(direction.territoryTempo, Math.max(1, days)) : null),
    // (The same, as data, for a run fought away from the page: frontWorkerCore.js.)
    tempo: direction?.territoryTempo > 0 ? direction.territoryTempo : 0,
    // The same turn of the same campaign is the same run, whoever applies it and how often.
    seed: `${clean(campaignId)}|${round}|${fromDate}`,
    // What a fleet the war at sea commissions is held to (runtime/naval/engine.js).
    unitCaps: { perCountry: MAX_UNITS_PER_POLITY, world: MAX_UNITS_GLOBAL },
    // EXPERIMENT, in the lab: the trained staff, when its switch is on and one is shipped (runtime/fronts/mind/trained.js).
    // (A side the scenario's designer meant its war to lose is led by a plainer commander: runtime/warOutcomes.js.)
    // (And the commander a side fighting a person is given by the game's difficulty: trained.js COMMANDER_OF_DIFFICULTY.)
    ...(strategyNetOn() && trainedStaffPolicy() ? { staffPolicy: labStaffPolicy({ outcomes: warSettingsOf(world).outcomes, difficulty: normalizeDifficulty(game?.difficulty), players: humanCountriesOf(game) }) } : {}),
    // (The same, as data, for a run fought away from the page, where the staff is made again: frontWorkerCore.js.)
    ...(strategyNetOn() && trainedStaffPolicy() ? { staffConfig: { outcomes: warSettingsOf(world).outcomes, difficulty: normalizeDifficulty(game?.difficulty), players: humanCountriesOf(game) } } : {}),
    // The era the scenario set, if it set one (runtime/warSettings.js).
    era: eraSettingOf(world),
    // Which of the engine's newer mechanics it has on: all of them unless it turned one off.
    // (With no air units in the scenario, the Wars feature, no wing flies over a battlefield.)
    mechanics: airOn() ? warSettingsOf(world).mechanics : { ...warSettingsOf(world).mechanics, air: false },
    // The Wars feature's other parts: fleets at sea, and what flies.
    naval: naviesOn(),
    air: airOn(),
    // How its wars' troops stand where nobody deploys them otherwise: along fronts, or as swarms (runtime/fronts/swarms.js).
    warfare: warfareOf(world, fromDate),
    // The men a counter stands for and the share of people who can fight, where it set them.
    menEach: warSettingsOf(world).menPerCounter,
    manpowerShare: warSettingsOf(world).manpowerShare,
    // When the game began: its wars that began after it muster their levies.
    gameBegan: clean(game?.startDate),
    // The campaign's own seed for its weather: the same spell of it whichever turn it straddles.
    climateSeed: clean(campaignId),
    players: humanCountriesOf(game),
    // The difficulty weighs the land war for whoever fights a person's country (runtime/fronts/handicap.js).
    difficulty: normalizeDifficulty(game?.difficulty),
  };
};

// A turn's land war is fought away from the page where the browser can (frontWorkerCore.js): the same run, and the
// page draws on through it, however long the staff that looks ahead thinks. Where it cannot (no workers, as in the
// tests; something in it that is not data; a worker that failed) it is fought here, as ever.
const runFrontsWhere = async (args, signal = null) => {
  if (offPageAvailable()) {
    try {
      return await fightOffPage(args, { signal });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      console.warn("[fronts] the land war could not be fought away from the page; it is fought here.", error);
    }
  }
  return runTurnFronts(args);
};

// ---- the period, fought before its story is written -------------------------------------

// What a period's fighting reads of the world besides its battlefields, wars,
// transports and formations: the scenario's rules for its wars, its terrain,
// fortified lines, climate zones and water that freezes, and every country's
// and group's military figures.
const warGroundOf = (world) => [
  world?.warSettings ?? null,
  world?.terrainAreas ?? null,
  world?.fortifications ?? null,
  world?.climateZones ?? null,
  world?.freezingRegions ?? null,
  world?.frozenRegions ?? null,
  ...["polityOverrides", "groups", "countryStats"].map((field) => Object.entries(world?.[field] && typeof world[field] === "object" ? world[field] : {})
    .filter(([, record]) => record?.military)
    .map(([key, record]) => [key, record?.name ?? "", record.military])),
];

// The last period worked out, kept while the same turn is being asked for: a
// request that is retried, or asked of the next model on the list, finds it done.
let foreseen = { key: "", value: null };

// Runs the front engine over the days a turn is ABOUT to cover, under the
// orders that already stand (the campaign's, and what was ordered in the war
// room), before the story of those days is asked for. Nothing is written: the
// world is the caller's own and stays as it is. It is the period as it goes IF
// NO PLAYER ORDERS ANYTHING NEW in it. A player's action of the turn may do
// just that: the skip's model then calls a function with the order
// (frontOrderFunction.js) and the period is fought again here with it
// (`given`), each such order from the day it was given.
//   world, game    the turn's world and game as they were read for it
//   toDate         the date the turn is to land on
//   requestedDays  how long the skip is, where the calendar cannot be counted
//   loadRegions    reads the map's regions file, should the engine need it
//   given          the orders players' actions gave, as readGivenOrders reads them
// Returns { fromDate, toDate, days, battlefields, news, flips, given? }: the
// battlefields as the period leaves them and what happened on them, or null
// when there is nothing to tell (fronts off, no battlefield being fought, no
// whole day to run, or the map could not be read). Then the turn is asked for
// as it always was and the engine runs after it.
export const forecastTurnFronts = async ({ world = {}, game = {}, campaignId = "", toDate = "", requestedDays = 0, loadRegions = null, signal = null, given = [] } = {}) => {
  if (!frontsOn() || !fighting(world)) return null;
  const fromDate = clean(game?.gameDate);
  const target = clean(toDate) || fromDate;
  const round = (Number(game?.round) || 1) + 1;
  try {
    const planned = await plannedWorld(world, game);
    const key = [
      clean(campaignId), round, fromDate, target, Number(requestedDays) || 0, frontsPace(),
      hashOf(JSON.stringify(asArray(planned?.battlefields))),
      hashOf(JSON.stringify(asArray(world?.wars))),
      hashOf(JSON.stringify(asArray(world?.transports))),
      hashOf(JSON.stringify(asArray(world?.units).map((unit) => [unit?.id, unit?.type, unit?.committedTo, unit?.lng, unit?.lat, unit?.strength]))),
      hashOf(JSON.stringify(asArray(given))),
      // And the air strikes waiting to be flown as it begins.
      hashOf(JSON.stringify(asArray(world?.airStrikeOrders))),
      // How the scenario's wars are fought, the ground and the weather they are
      // fought in, and each country's military figures (Wars and Fronts Pt.2).
      hashOf(JSON.stringify(warGroundOf(world))),
    ].join("|");
    if (foreseen.key === key) return foreseen.value;
    const startedAt = Date.now();
    const run = await runFrontsWhere({
      ...turnRunInput({ world, game, campaignId, loadRegions, signal, round, fromDate }),
      world: planned,
      events: [],
      frontOrders: asArray(given),
      warStages: [asArray(world?.wars)],
      fromDate,
      toDate: target,
      requestedDays,
    }, signal);
    const days = Number(run?.stats?.days) || 0;
    const value = run?.battlefields && days > 0
      ? { fromDate, toDate: target, days, battlefields: run.battlefields, news: asArray(run.news), flips: asArray(run.flips), transports: asArray(run.transports), voyages: asArray(run.voyages), sea: run.sea ?? null, airStrikes: asArray(run.airStrikes), ...(asArray(given).length ? { given: asArray(given) } : {}) }
      : null;
    foreseen = { key, value };
    if (value) {
      const told = `the period's land war worked out before its story: ${days} day${days === 1 ? "" : "s"}, ${value.flips.length} region${value.flips.length === 1 ? "" : "s"} changed hands, ${value.news.length} thing${value.news.length === 1 ? "" : "s"} to tell (${Date.now() - startedAt} ms).`;
      console.info(`[OH fronts] ${told}`);
      logDebugEvent("turn", `Fronts: ${told}`, { battlefields: value.battlefields.map((record) => record.name) }, { verbose: true });
    }
    return value;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    console.warn("[fronts] the period could not be fought before its story; the turn is asked for as it stands and the engine runs after it.", error);
    return null;
  }
};

// Runs the front engine over a turn that is about to be applied.
//   events        the turn's events as the world will receive them
//   frontOrders   the orders that survived with them (nativeFrontLedger.js)
//   warUpdates    the turn's war ledger records, as the ledger will merge them
//   loadRegions   reads the map's regions file (gameplay.js createRenderedRegionsReader)
//   foretold      true when the turn was asked for with its period already
//                 fought and told (forecastTurnFronts): the run is that one
//                 again, and the answer's orders are for the period after
//   givenOrders   the orders players' actions gave through the skip's function
//                 (frontOrderFunction.js), which the period was fought again
//                 with: carried out from the day each was given
// Returns null when fronts are off. Otherwise { events, battlefields,
// unitChanges, ... }: the events with what an earlier apply's run added taken
// out and this run's changes of hands put on, the battlefields to write (null
// to leave them as they are) and the formations that changed. What the engine
// could not do as it was told goes on `receipt`. It never fails a turn: if the
// engine cannot be run, the turn goes on without it and the battlefields stand.
export const applyTurnFronts = async ({
  baseGame = {},
  baseWorld = {},
  campaignId = "",
  events = [],
  foretold = false,
  frontOrders = [],
  givenOrders = [],
  loadRegions = null,
  nextGame = {},
  receipt = null,
  requestedDays = 0,
  signal = null,
  strikePlaces = null,
  warUpdates = [],
} = {}) => {
  if (!frontsOn()) return null;
  const startedAt = Date.now();
  const fromDate = clean(baseGame?.gameDate);
  const toDate = clean(nextGame?.gameDate) || fromDate;
  const round = Number(nextGame?.round) || (Number(baseGame?.round) || 1) + 1;
  try {
    // The map is read only once there is a war, a battlefield or an order to
    // run on: a turn of peace costs nothing here.
    const run = await runFrontsWhere({
      ...turnRunInput({ world: baseWorld, game: baseGame, campaignId, loadRegions, signal, round, fromDate }),
      // With the turn's plans on its battlefields (frontPlans.js): the Board's
      // operations sent, and a side warned by its agents dug in.
      world: await plannedWorld(baseWorld, baseGame),
      events,
      frontOrders: [...asArray(givenOrders).filter((order) => order?.now === true), ...asArray(frontOrders)],
      warStages: warStagesOf({ wars: baseWorld?.wars, updates: warUpdates, events, stopDate: toDate, round }),
      fromDate,
      toDate,
      requestedDays,
      narratesCombat: eventNarratesHardCombat,
      foretold: foretold === true,
      strikePlaces,
    }, signal);
    for (const note of run.notes) noteReceipt(receipt, note.kind, note.text);
    if (run.stats) {
      const open = asArray(run.battlefields).filter((record) => record.status !== "closed");
      const troops = open.reduce((sum, record) => sum + asArray(record.brief?.strength).reduce((count, side) => count + (Number(side?.n) || 0), 0), 0);
      const told = `${open.length} battlefield${open.length === 1 ? "" : "s"} open with ${troops} formation${troops === 1 ? "" : "s"} standing; `
        + `${run.flips.length} region${run.flips.length === 1 ? "" : "s"} changed hands over ${run.stats.days} day${run.stats.days === 1 ? "" : "s"} (${Date.now() - startedAt} ms).`;
      console.info(`[OH fronts] ${told}`);
      logDebugEvent("turn", `Fronts: ${told}`, {
        battlefields: open.map((record) => record.name),
        flips: run.flips.length,
        unitChanges: run.unitChanges.length,
        notes: run.notes.length,
      }, { verbose: true });
    }
    return run;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    console.warn("[fronts] the front engine could not be run for this turn; the turn goes on without it and the battlefields stand as they were.", error);
    logDebugEvent("turn", "Fronts: the engine could not be run for this turn; the battlefields stand as they were.", error, { problem: true });
    return { events: stripFrontOps(events), battlefields: null, unitChanges: [], notes: [], flips: [], stats: null, news: [], joins: [], starts: [], transports: null, voyages: [], strikes: [], airStrikes: null };
  }
};

// ---- cities follow their country --------------------------------------------------------

// A world whose cities have followed their countries' populations (runtime/
// cityPopulation.js): those of every country whose people have moved enough
// since its cities last followed are moved by the same share. Which country a
// city is in is read from the map, on the sheet of the whole of it that the
// fronts draw (runtime/fronts/worldGrid.js), and the map's shapes are read
// for that only on a turn when some country is due and the sheet has not been
// drawn in this sitting. No request is made. The same world when nothing is due.
//   baseWorld   the world before the turn: a city whose figure the turn's own
//               events changed is left at what they say
export const citiesFollowCountries = async ({ world = {}, baseWorld = null, game = {}, campaignId = "", loadRegions = null } = {}) => {
  try {
    const moves = countryPopulationMoves(world?.countryStats, world?.cityPopulationBasis);
    const noted = JSON.stringify(moves.basis) !== JSON.stringify(isRecord(world?.cityPopulationBasis) ? world.cityPopulationBasis : {});
    if (moves.due.length === 0) return noted ? { ...world, cityPopulationBasis: moves.basis } : world;
    const [front, citiesGeojson] = await Promise.all([
      readFrontMap(world, game, campaignId),
      readJson(JSON_URLS.citiesGeojson, { defaultValue: null }).catch(() => null),
    ]);
    const kept = arenasFor(front.map.key);
    const water = waterTypeIds(world?.regionTypes);
    const sheet = worldSheetKey(front.map.key, water);
    let grid = kept.get(sheet) ?? null;
    if (!grid) {
      const shapes = typeof loadRegions === "function" ? await loadRegions() : null;
      const regions = shapes ? engineRegionsOf(shapes, { nameOf: (id) => front.names.get(id) }) : null;
      // (The map could not be read: nothing is moved and nothing is noted, so it is tried again next turn.)
      if (asArray(regions).length === 0) return world;
      grid = buildWorldGrid(regions, { ...measureOptions(front.map), water });
      if (grid) kept.set(sheet, grid);
    }
    if (!grid) return world;
    const readers = frontWorldReaders(world, { baseOwners: front.baseOwners, groups: false });
    const date = clean(game?.gameDate || game?.startDate);
    const renames = isRecord(world?.cityRenames) ? world.cityRenames : {};
    const set = cityPopulationOverridesByTileName(world?.cityPopulations, renames);
    const dueNames = new Set(moves.due.map((entry) => fold(entry.name)));
    const cities = [];
    for (const feature of asArray(citiesGeojson?.features)) {
      const props = isRecord(feature?.properties) ? feature.properties : {};
      const point = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
      const tileName = clean(props.city || props.name);
      if (!tileName || !Array.isArray(point)) continue;
      const cell = grid.cellOf(Number(point[0]), Number(point[1]));
      const mark = cell >= 0 ? grid.region[cell] : 0;
      const holder = mark ? clean(readers.controllerOf(grid.ids[mark])) : "";
      if (!holder || !dueNames.has(fold(holder))) continue;
      cities.push({
        name: clean(renames[tileName.toLowerCase()]) || tileName,
        population: effectiveCityPopulation(props, { date, cityPopulations: set, name: tileName }),
        holder,
      });
    }
    // What this turn's own events set stays what they said.
    const before = isRecord(baseWorld?.cityPopulations) ? baseWorld.cityPopulations : {};
    const now = isRecord(world?.cityPopulations) ? world.cityPopulations : {};
    const skip = new Set(Object.keys(now).filter((key) => Number(now[key]) !== Number(before[key])).map(cityPopulationKey));
    const followed = citiesFollowing({ cityPopulations: now, cities, due: moves.due, skip });
    return { ...world, cityPopulations: followed.cityPopulations, cityPopulationBasis: moves.basis };
  } catch (error) {
    console.warn("[stats] the cities could not follow their countries' populations this turn; they stay as they are.", error);
    return world;
  }
};

// ---- the men troops are raised from ---------------------------------------------------

// A world with what a turn's recruitment cost its countries taken off their
// populations (runtime/fronts/manpower.js): the men drawn for the formations
// raised, drafted and sent to make good losses, less the men who came home. A
// country with no sheet of statistics has no population to take them from and
// is left as it is. The same world when the run charged nobody.
//   patch   (world, name, { population: { total } }) => writes it (gameState.js applyCountryStatPatchToWorld)
export const withFrontManpower = (world, fronts, patch) => {
  const ledger = asArray(fronts?.manpower).filter((entry) => clean(entry?.name) && (Number(entry.drawn) > 0 || Number(entry.returned) > 0));
  if (ledger.length === 0 || typeof patch !== "function" || !world || typeof world.countryStats !== "object" || !world.countryStats) return world;
  const next = { ...world, countryStats: { ...world.countryStats } };
  const keys = new Map(Object.keys(next.countryStats).map((key) => [fold(key), key]));
  let changed = false;
  for (const entry of ledger) {
    const key = keys.get(fold(entry.name));
    const total = Number(next.countryStats[key]?.population?.total);
    if (!key || !(total > 0)) continue;
    const after = Math.max(1, Math.round(total - (Number(entry.drawn) || 0) + (Number(entry.returned) || 0)));
    if (after === total) continue;
    patch(next, key, { population: { total: after } });
    changed = true;
  }
  return changed ? next : world;
};

// A world with what the period's blockades cost the countries they were laid
// on taken off their economies (runtime/naval/blockade.js): a share of its GDP
// by how hard the blockade pressed and how long the period was, and what each
// of its people has with it; and points off its budget's balance. A country
// with neither on its sheet has none to take it from and is left as it is. The
// same world when nobody was blockaded.
//   patch   (world, name, { economy: { gdp, budgetBalance } }) => writes it (gameState.js applyCountryStatPatchToWorld)
export const withBlockadeEconomy = (world, fronts, patch) => {
  const days = Number(fronts?.sea?.days);
  const laid = asArray(fronts?.sea?.blockades).filter((entry) => clean(entry?.country) && Number(entry.pressure) > 0);
  if (laid.length === 0 || !(days > 0) || typeof patch !== "function" || !world || typeof world.countryStats !== "object" || !world.countryStats) return world;
  const next = { ...world, countryStats: { ...world.countryStats } };
  const keys = new Map(Object.keys(next.countryStats).map((key) => [fold(key), key]));
  let changed = false;
  for (const entry of laid) {
    const key = keys.get(fold(entry.country));
    const economy = key ? next.countryStats[key]?.economy : null;
    if (!economy) continue;
    const gdp = Number(economy.gdp);
    const after = gdp > 0 ? Math.max(1, Math.round(gdpUnderBlockade(gdp, entry.pressure, days))) : null;
    const head = Number(economy.gdpPerCapita);
    const balance = economy.budgetBalance === null || economy.budgetBalance === undefined || economy.budgetBalance === "" ? NaN : Number(economy.budgetBalance);
    const balanceAfter = Number.isFinite(balance) ? Math.round(budgetUnderBlockade(balance, entry.pressure, days) * 100) / 100 : null;
    const write = {
      ...(after !== null && after < gdp ? { gdp: after, ...(head > 0 ? { gdpPerCapita: Math.round(((head * after) / gdp) * 100) / 100 } : {}) } : {}),
      ...(balanceAfter !== null && balanceAfter < balance ? { budgetBalance: balanceAfter } : {}),
    };
    if (Object.keys(write).length === 0) continue;
    patch(next, key, { economy: write });
    changed = true;
  }
  return changed ? next : world;
};

// A world with what the war room's air strikes did written into it (runtime/fronts/airStrike.js): each kept as it
// went, for the war room, the war stats and the map; those that waited cleared; a structure struck damaged or
// destroyed; a city struck, its people killed and its country's economy hurt. (The air units worn are the turn's
// unit changes, withFrontUnits; the troops hit, the battlefields'; its country's weariness, warAndPeace.js.) The
// same world when no strike was flown, or the land war's run was not made.
//   round, date   the turn's round, and the date the strikes were flown on
//   patch         (world, name, { population } | { economy }) => writes it (gameState.js applyCountryStatPatchToWorld)
export const withAirStrikes = (world, fronts, { round = 0, date = "", patch = null } = {}) => {
  if (!world || !Array.isArray(fronts?.airStrikes)) return world;
  const flown = normalizeAirStrikes(fronts.airStrikes).map((strike) => ({ ...strike, round, date: clean(date) || strike.date }));
  let next = { ...world, airStrikeOrders: [], airStrikes: withTurnAirStrikes(world.airStrikes, flown, round) };
  const struck = new Map(flown.filter((strike) => strike.kind === "structure" && strike.marker && strike.status).map((strike) => [strike.marker, strike.status]));
  if (struck.size > 0) {
    next.markers = asArray(next.markers).map((marker) => (struck.has(clean(marker?.id)) && clean(marker?.status) !== struck.get(clean(marker.id))
      ? { ...marker, status: struck.get(clean(marker.id)), updatedDate: clean(date) || clean(marker.updatedDate) }
      : marker));
  }
  const cities = flown.filter((strike) => strike.kind === "city" && strike.power > 0 && strike.country);
  if (cities.length === 0 || typeof patch !== "function" || !next.countryStats || typeof next.countryStats !== "object") return next;
  next = { ...next, countryStats: { ...next.countryStats } };
  const keys = new Map(Object.keys(next.countryStats).map((key) => [fold(key), key]));
  for (const strike of cities) {
    const key = keys.get(fold(strike.country));
    const sheet = key ? next.countryStats[key] : null;
    if (!sheet) continue;
    const total = Number(sheet.population?.total);
    if (strike.dead > 0 && total > 0) patch(next, key, { population: { total: Math.max(1, Math.round(total - strike.dead)) } });
    const economy = next.countryStats[key]?.economy;
    const gdp = Number(economy?.gdp);
    if (gdp > 0) {
      const after = Math.max(1, Math.round(gdp * (1 - (AIR_CITY_GDP * Math.min(100, strike.power)) / 100)));
      const head = Number(economy.gdpPerCapita);
      if (after < gdp) patch(next, key, { economy: { gdp: after, ...(head > 0 ? { gdpPerCapita: Math.round(((head * after) / gdp) * 100) / 100 } : {}) } });
    }
  }
  return next;
};

// The world's blockades after a turn (runtime/naval/blockade.js withTurnBlockades):
// those the period pressed, each with the days it has now stood. [] when the
// sea was not fought.
export const turnBlockades = (world, fronts) => withTurnBlockades(world?.blockades, fronts?.sea?.blockades, fronts?.sea?.fromDate);

// ---- a country troops were sent into --------------------------------------------------

// The countries a turn's troops were sent into (runtime/fronts/invade.js), as
// records for the war ledger: each joins the side of its war that its
// attackers are not on, on the day they came to it. The ledger's own merge
// takes them (nativeWarLedger.js applyWarUpdates): one the story wrote too is
// simply the same record twice. [] with nothing of the kind.
export const frontWarJoins = (fronts) => asArray(fronts?.joins)
  .filter((join) => clean(join?.warId) && clean(join?.name))
  .map((join) => ({
    id: clean(join.warId),
    op: join.side === 0 ? "join-a" : "join-b",
    actors: [clean(join.name)],
    opponents: [],
    eventIds: [],
    baselineDate: clean(join.date),
  }));

// The wars that began in a turn because one country sent its troops at
// another it was at peace with (runtime/fronts/engine.js attackOpensWar): an
// attack across their border, an order aimed at a place the other holds, a
// transporter put down on its land. Each is a `start` for the war ledger, by
// the id the battlefields already carry, dated by the day the troops went in.
// A war the story opened itself in the same answer is not among them: the
// engine took that one for its own. [] with nothing of the kind.
export const frontWarStarts = (fronts) => asArray(fronts?.starts)
  .filter((start) => clean(start?.warId) && clean(start?.attacker) && clean(start?.defender))
  .map((start) => ({
    id: clean(start.warId),
    op: "start",
    actors: [clean(start.attacker)],
    opponents: [clean(start.defender)],
    eventIds: [],
    baselineDate: clean(start.date),
    note: `${clean(start.attacker)} attacked ${clean(start.defender)}, with which it had been at peace`,
  }));

// What sending troops along the routes drawn on a battlefield would attack:
// for each order that is a route, the countries outside the war it goes well
// into, read from the same ground the engine reads them from. The war room
// asks as soon as a route is drawn, so that the player is told before time
// passes. A Map from the order's place in the record's list to the names;
// empty when no route attacks anybody, or the ground could not be read.
//   loadRegions   reads the map's regions file, should the ground of this
//                 battlefield not have been drawn yet in this sitting
export const routesIntoOthers = async ({ world = {}, game = {}, campaignId = "", record = null, loadRegions = null } = {}) => {
  const found = new globalThis.Map();
  // The routes whose orders do not say yet: what the engine has read is on the
  // order already, and the plan carries it. (A route under way with nothing on
  // its order is read too: it may have been drawn before the engine read routes.)
  const routes = asArray(record?.orders).map((order, index) => ({ order, index }))
    .filter(({ order }) => order?.chosen === true && asArray(order.way).length > 0 && asArray(order.attacks).length === 0);
  if (!frontsOn() || !record?.frame || routes.length === 0) return found;
  try {
    const front = await readFrontMap(world, game, campaignId);
    const arenas = arenasFor(front.map.key);
    const regionTypes = asArray(world?.regionTypes);
    let arena = arenaFor(arenas, { ...front.map, regions: null }, record.frame, regionTypes);
    if (!arena) {
      // The ground of this frame has not been drawn in this sitting: the map's shapes are read for it, once.
      const shapes = typeof loadRegions === "function" ? await loadRegions() : null;
      const regions = shapes ? engineRegionsOf(shapes, { nameOf: (id) => front.names.get(id) }) : null;
      if (asArray(regions).length === 0) return found;
      arena = arenaFor(arenas, { ...front.map, regions }, record.frame, regionTypes);
    }
    if (!arena) return found;
    const readers = frontWorldReaders(world, { baseOwners: front.baseOwners, groups: isActiveFeatureEnabled("groups") });
    const members = new Set(asArray(record.sides).flat().map(fold));
    const inWar = (name) => members.has(fold(name));
    // (As the engine reads it: a country's force holds for its country, runtime/fronts/engine.js holderIn.)
    const holderOf = (id) => {
      const group = clean(readers.groupAreas?.[id]);
      if (group && inWar(group)) return group;
      const owner = group ? clean(readers.groupOwnerOf(group)) : "";
      return owner && inWar(owner) ? owner : clean(readers.controllerOf(id));
    };
    const place = projectorOf(record.frame);
    const under = asArray(record.brief?.carry?.under);
    // The sides of every other battlefield being fought.
    const elsewhere = asArray(world?.battlefields)
      .filter((other) => other && other.status === "active" && other.field && fold(other.name) !== fold(record.name))
      .map((other) => asArray(other.sides).map((members) => asArray(members).map(fold)));
    for (const { order, index } of routes) {
      const troops = decodeTroops(record.troops?.[order.s]);
      let x = 0;
      let y = 0;
      let count = 0;
      asArray(under[order.s]).forEach((serves, troop) => {
        if (serves !== index || !(troops[troop]?.strength > 0)) return;
        x += troops[troop].x;
        y += troops[troop].y;
        count += 1;
      });
      const route = order.way.map(([lng, lat]) => place.toCell(lng, lat));
      // (A country its sender already fights on another battlefield is attacked by nobody new:
      // troops sent into its land go over to that battlefield, engine.js handOver.)
      const sender = fold(order.by) || fold(record.sides?.[order.s]?.[0]);
      const names = othersOnWay({ arena, place, way: count > 0 ? [[x / count, y / count], ...route] : route, holderOf, inWar })
        .filter((name) => !elsewhere.some((sides) => sides.some((members, side) => members.includes(sender) && sides[1 - side].includes(fold(name)))));
      if (names.length > 0) found.set(index, names);
    }
  } catch (error) {
    console.warn("[fronts] what a route goes into could not be read; the engine says when the route is put to its troops.", error);
  }
  return found;
};

// The way each of the world's transporters that has not set out would take,
// found on the same sheet and by the same search the engine uses when it does
// set out (runtime/fronts/wayfinder.js), so that the war room can show it
// before time passes. Only those whose troops are on a battlefield: the ones
// deployed there. No request is made, and the map's shapes are read only when
// the sheet has not been drawn in this sitting.
// Returns { [id]: { way, km, days, landing, from } | { error, from } }.
export const transportWaysFor = async ({ world = {}, game = {}, campaignId = "", loadRegions = null } = {}) => {
  const found = {};
  const ordered = normalizeTransports(world?.transports).filter((entry) => entry.status === "ordered" && entry.embark && Number.isFinite(entry.to.lng));
  if (!frontsOn() || ordered.length === 0) return found;
  try {
    const front = await readFrontMap(world, game, campaignId);
    const kept = arenasFor(front.map.key);
    const water = waterTypeIds(world?.regionTypes);
    const sheet = worldSheetKey(front.map.key, water);
    let grid = kept.get(sheet) ?? null;
    if (!grid) {
      const shapes = typeof loadRegions === "function" ? await loadRegions() : null;
      const regions = shapes ? engineRegionsOf(shapes, { nameOf: (id) => front.names.get(id) }) : null;
      if (asArray(regions).length === 0) return found;
      grid = buildWorldGrid(regions, { ...measureOptions(front.map), water });
      if (grid) kept.set(sheet, grid);
    }
    if (!grid) return found;
    const readers = frontWorldReaders(world, { baseOwners: front.baseOwners, groups: isActiveFeatureEnabled("groups") });
    const records = normalizeBattlefields(world?.battlefields);
    const year = yearInEra(gameDateYear(clean(game?.gameDate)), eraSettingOf(world));
    for (const transport of ordered) {
      const record = records.find((entry) => fold(entry.name) === fold(transport.embark.battlefield));
      if (!record?.frame) continue;
      // Its war's two sides as the ledger has them, or failing that the battlefield's. (Troops taken from their
      // country's forces at home, which are no war's, serve the first war their country is fighting: engine.js transportWar.)
      const fought = (entry) => clean(entry?.status) === "active" && [...asArray(entry?.sideA), ...asArray(entry?.sideB)].some((name) => fold(name) === fold(transport.owner));
      const war = asArray(world?.wars).find((entry) => clean(entry?.id) === (transport.warId || record.warId) && fought(entry))
        ?? (record.home ? asArray(world?.wars).find(fought) : asArray(world?.wars).find((entry) => clean(entry?.id) === record.warId));
      const sides = (war ? [asArray(war.sideA), asArray(war.sideB)] : record.sides).map((members) => members.map(fold));
      const mine = sides[0].includes(fold(transport.owner)) ? 0 : sides[1].includes(fold(transport.owner)) ? 1 : -1;
      if (mine < 0) continue;
      const holderOf = (id) => {
        const group = clean(readers.groupAreas?.[id]);
        const inWar = (name) => sides.some((members) => members.includes(fold(name)));
        if (group && inWar(group)) return group;
        const owner = group ? clean(readers.groupOwnerOf(group)) : "";
        return owner && inWar(owner) ? owner : clean(readers.controllerOf(id));
      };
      const troops = decodeTroops(record.troops?.[transport.embark.side]);
      let x = 0;
      let y = 0;
      let count = 0;
      for (const index of transport.embark.troops) {
        if (!(troops[index]?.strength > 0)) continue;
        x += troops[index].x;
        y += troops[index].y;
        count += 1;
      }
      if (count === 0) continue;
      const [lng, lat] = projectorOf(record.frame).toLngLat(x / count, y / count);
      const near = [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
      const wayFrom = (start) => findWay(grid, {
        medium: transport.medium,
        from: start,
        to: [transport.to.lng, transport.to.lat],
        holderOf,
        friendly: (name) => sides[mine].includes(fold(name)),
        hostile: (name) => sides[1 - mine].includes(fold(name)),
        year,
      });
      // From where they stand, or as the engine sends them where no way begins there: overland to a city of
      // their country's that one does begin from (runtime/fronts/transports.js departuresFor).
      let from = near;
      let way = wayFrom(near);
      if (TRANSPORT_START_FAILS.includes(way.error)) {
        const holderAt = (at, of) => {
          const cell = grid.cellOf(at, of);
          const mark = cell >= 0 ? grid.region[cell] : 0;
          return mark ? holderOf(grid.ids[mark]) : "";
        };
        const ports = departuresFor({ cities: front.map.cities, holderAt, owner: transport.owner, to: transport.to, near, km: grid.km, most: EMBARK_PORTS_MOST });
        for (const port of ports) {
          const tried = wayFrom([port.lng, port.lat]);
          if (tried.error) continue;
          way = tried;
          from = [Math.round(port.lng * 1000) / 1000, Math.round(port.lat * 1000) / 1000];
          break;
        }
      }
      found[transport.id] = way.error
        ? { error: way.error, from }
        : { way: way.way, km: way.km, days: Math.max(1, Math.ceil(way.km / Math.max(1, transport.speed))), landing: way.landing, arrived: way.arrived, from };
    }
  } catch (error) {
    console.warn("[fronts] the ways of the transporters that have not set out could not be found; each is found when it sets out.", error);
  }
  return found;
};

// What the war room's fortified lines and fleets are held to on the map
// (runtime/warRoomChart.js): where the sea is and whose the ground is, on the
// same sheet the transporters sail on and the fleets fight on, kept with it
// once drawn; whose the ground is to the kilometre, from the regions' own
// shapes (runtime/regionLocator.js), kept with the sheet. The page and a shared
// game's host each read it for themselves. No request is made. null when the
// map could not be read.
const locators = new WeakMap();
export const warRoomChartFor = async ({ world = {}, game = {}, campaignId = "", loadRegions = null } = {}) => {
  try {
    const front = await readFrontMap(world, game, campaignId);
    const kept = arenasFor(front.map.key);
    const water = waterTypeIds(world?.regionTypes);
    const sheet = worldSheetKey(front.map.key, water);
    let grid = kept.get(sheet) ?? null;
    let locate = grid ? locators.get(grid) ?? null : null;
    if (!grid || !locate) {
      const shapes = typeof loadRegions === "function" ? await loadRegions() : null;
      const regions = shapes ? engineRegionsOf(shapes, { nameOf: (id) => front.names.get(id) }) : null;
      if (asArray(regions).length === 0) return null;
      if (!grid) {
        grid = buildWorldGrid(regions, { ...measureOptions(front.map), water });
        if (grid) kept.set(sheet, grid);
      }
      if (!grid) return null;
      locate = regionLocatorOf(regions, { water, flat: front.map.flat === true });
      locators.set(grid, locate);
    }
    const readers = frontWorldReaders(world, { baseOwners: front.baseOwners, groups: isActiveFeatureEnabled("groups") });
    return chartOf({ grid, controllerOf: readers.controllerOf, groupOf: (id) => clean(readers.groupAreas?.[id]), locate });
  } catch (error) {
    console.warn("[fronts] the war room could not read the map for its fortified lines and fleets; they wait until it can.", error);
    return null;
  }
};

// Builds a new game's battlefields from the fronts its scenario begins with
// (frontScenario.js), on the game's own map. No model is asked anything.
// Null with fronts off or none to build; otherwise what buildScenarioFronts
// returns, its `battlefields` null when the map could not be read.
export const openScenarioFronts = async ({ world = {}, game = {}, campaignId = "", loadRegions = null } = {}) => {
  if (!frontsOn() || !scenarioFrontsPending(world)) return null;
  let front = null;
  return buildScenarioFronts({
    world,
    game,
    createFrontRun,
    regionTypes: asArray(world?.regionTypes),
    groups: isActiveFeatureEnabled("groups"),
    readMap: async () => {
      front = await readFrontMap(world, game, campaignId);
      return { map: front.map, baseOwners: front.baseOwners, regionIds: front.regionIds, arenas: arenasFor(front.map.key) };
    },
    loadRegions: typeof loadRegions === "function"
      ? async () => engineRegionsOf(await loadRegions(), { nameOf: (id) => front?.names.get(id) })
      : null,
    // (Its fronts' troops stand as the scenario's wars are fought, where a front does not say: runtime/fronts/swarms.js.)
    warfare: warfareOf(world, clean(game?.gameDate || game?.startDate)),
    pace: frontsPace(),
    seed: `${clean(campaignId)}|1|${clean(game?.gameDate || game?.startDate)}`,
    players: humanCountriesOf(game),
    difficulty: normalizeDifficulty(game?.difficulty),
  });
};
export { scenarioFrontsPending };

// The world's formations after a turn's run: the ones that went onto a
// battlefield carry its name, the ones that came back stand where their troops
// stood, and a formation on a battlefield keeps no standing order of its own,
// since the engine is what moves it now.
export const withFrontUnits = (world, fronts) => {
  // (A fleet the war at sea commissioned for a country that had none is one of the world's formations from now.)
  const commissioned = asArray(fronts?.sea?.commissioned).filter((unit) => clean(unit?.id) && !asArray(world?.units).some((entry) => clean(entry?.id) === clean(unit.id)));
  if (!fronts || (asArray(fronts.unitChanges).length === 0 && commissioned.length === 0)) return world;
  const units = [...applyFrontUnitChanges(world?.units, fronts.unitChanges), ...commissioned.map((unit) => ({ ...unit }))];
  const committed = new Set(units.filter((unit) => clean(unit?.committedTo)).map((unit) => unit.id));
  return {
    ...world,
    units,
    pendingUnitOrders: asArray(world?.pendingUnitOrders).filter((order) => !committed.has(order?.unitId)),
  };
};

// ---- the prompt -------------------------------------------------------------------------

// The [Fronts] block of a time skip's live records; "" with fronts off, so the
// prompt is then exactly what it was. `foreseen` is what forecastTurnFronts
// gave for the turn, when it gave anything: the block then tells the
// battlefields as the period leaves them and what happened on them.
// `options.orderLines: false` where the prompt states how an order line is
// written elsewhere (frontPrompt.js FRONT_ORDER_LINES_BLOCK).
export const frontsLiveBlock = (world, game, foreseen = null, options = {}) => [landBlock(world, game, foreseen, options), seasLiveBlock(world, game, foreseen), airStrikesLiveBlock(foreseen)].filter(Boolean).join("\n\n");
// The war room's air strikes as the period's run flew them (runtime/fronts/airStrike.js): "" when none flew, or the
// period was not fought before the story (they are flown when the turn is applied all the same, and told the next).
export const airStrikesLiveBlock = (foreseen = null) => (frontsOn() && airOn() ? airStrikesBlock(foreseen?.airStrikes) : "");

// What the skip is told of the war at sea (navalPrompt.js), after the land's:
// the period's battles where the period was fought beforehand, else the fleets
// of the countries at war as they stand. "" with fronts off or no such fleet.
export const seasLiveBlock = (world, game, foreseen = null) => (frontsOn() && naviesOn()
  ? buildSeasBlock({ sea: foreseen?.sea ?? null, units: world?.units, wars: world?.wars, players: humanCountriesOf(game), date: clean(game?.gameDate || game?.startDate), blockades: world?.blockades, era: eraSettingOf(world) })
  : "");

const landBlock = (world, game, foreseen = null, { orderLines = true } = {}) => (frontsOn()
  ? buildFrontsBlock({ battlefields: world?.battlefields, players: humanCountriesOf(game), period: foreseen, transports: world?.transports, difficulty: normalizeDifficulty(game?.difficulty), orderFunction: foreseen?.orderFunction === true, orderLines })
  : "");

// The battlefields of a period fought again with a player's orders, with no
// rules above them: what the skip's function answers (frontOrderFunction.js).
export const frontsListBlock = (world, game, foreseen) => (frontsOn() && foreseen
  ? buildFrontsBlock({ battlefields: world?.battlefields, players: humanCountriesOf(game), period: foreseen, transports: world?.transports, listOnly: true })
  : "");

// What the simulator is told of the plans agents have carried off from the
// people playing (frontPlans.js stolenPlansBlock); "" when there is nothing of
// the kind, so that the prompt is then exactly what it was.
export const frontPlansBlock = async (world, game) => {
  if (!frontsOn() || !isActiveFeatureEnabled("espionage") || asArray(world?.spies).length === 0 || !fighting(world)) return "";
  try {
    return stolenPlansBlock({ world, game, cities: await readFrontCities(world, game) });
  } catch {
    return "";
  }
};

// What the player's generals are told of the other side's intentions on one
// battlefield: what the player's agents and Board have of them, in words.
export const warRoomIntelText = ({ world, game, record, side, cities }) => warRoomIntel({
  world, game, record, side, cities, espionage: isActiveFeatureEnabled("espionage"),
}).lines.join("; ");

// ---- the old stand-ins --------------------------------------------------------------------

// The countries and groups the engine is fielding on a battlefield: none of
// them is "at war with nobody on the map". [] with fronts off.
export const frontPowers = (world) => (frontsOn() ? battlefieldPowers(world?.battlefields) : []);

// The powers the unit Director would have a counter raised for, less the ones
// a battlefield already fields (nativeUnitDirector.js missingCombatantSpawns).
export const withoutFrontPowers = (missing, world) => {
  const fielded = new Set(frontPowers(world).map(fold));
  return fielded.size ? asArray(missing).filter((entry) => !fielded.has(fold(entry?.power))) : missing;
};

// The test the territory Director takes for "this region is on a battlefield"
// (frontTurn.js battlefieldRegionTest), from the map's own catalog of regions.
// null with fronts off, or with no battlefield open.
export const frontRegionTest = async (world) => {
  if (!frontsOn() || asArray(world?.battlefields).length === 0) return null;
  const rows = filterToRenderedRegions(await loadRegionCatalog().catch(() => []), world);
  const baseOwners = new globalThis.Map(rows.map((row) => [String(row?.id ?? "").trim(), clean(row?.owner ?? row?.country)]));
  return battlefieldRegionTest({
    battlefields: world.battlefields,
    rows,
    readers: frontWorldReaders(world, { baseOwners, groups: isActiveFeatureEnabled("groups") }),
  });
};
