/*! Open Historia — a turn's land war, fought away from the page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/frontWorkerCore.test.js
//
// "The war engine in a background worker: this takes it off the page
// entirely" (the owner's list, 2026-10-16). The front engine and the staff that
// looks ahead (runtime/fronts/mind/planner.js) think for seconds a turn; fought
// here, in a Web Worker of its own (frontWorker.js), the page draws on whatever
// they do. What a run is given that is not data, it asks the page for by name
// (frontWorkerClient.js answers): the map's facts, its shapes, where a strike's
// places are. Everything else is the same run as on the page: the same code,
// the same input, the same war.
//
// The staff's memory of what it decided at each of its looks (trained.js) is
// kept here too, so that a skip's second run, as the turn is applied, has its
// first run's looks again, and a period thought through ahead of time (the War
// Room's rehearsal, the thinking done while the player reads: frontPrethink.js)
// is had again by the skip that fights it.
//
// Pure, and loads in plain Node: the tests run it with a page of their own.

import { createFrontRun } from "../../runtime/fronts/engine.js";
import { labStaffPolicy, trainedStaffPolicy } from "../../runtime/fronts/mind/trained.js";
import { engineRegionsOf, runTurnFronts } from "./frontTurn.js";
import { eventNarratesHardCombat } from "./nativeWarLedger.js";
import { territoryTempoAllowance } from "./worldDirection.js";

// The ground under each battlefield (runtime/fronts/arena.js), drawn once a map and kept while the same map is
// played: as the page keeps it (frontApply.js arenasFor), here for the runs fought here.
let kept = { key: "", arenas: new Map() };
const arenasFor = (key) => {
  if (kept.key !== key) kept = { key, arenas: new Map() };
  return kept.arenas;
};

// What of a run's input is not data, as data, and what the page answers for.
//   staff         { outcomes, difficulty, players }: the lab's staff (trained.js labStaffPolicy), or null for the
//                 engine's own
//   tempo         the world's direction's ceiling on territory a month (worldDirection.js), 0 for none
//   narrates      whether the turn's events are read for combat they tell of (nativeWarLedger.js)
//   strikes       which of the places of strikes the page may be asked for: "find", "origin", "seat"
//   readsMap      whether the page reads the map's facts (readMap); readsRegions, its shapes (loadRegions)
//   findsRegionsFile  whether the page can say where those shapes' file is (regionsFile), for them to be read here
export const AWAY_KEYS = Object.freeze(["staff", "tempo", "narrates", "strikes", "readsMap", "readsRegions", "findsRegionsFile"]);
// What a run is handed that is the page's own to do, and never sent.
export const PAGE_KEYS = Object.freeze(["createFrontRun", "readMap", "loadRegions", "regionsFile", "pause", "tempoAllowance", "staffPolicy", "narratesCombat", "strikePlaces", "arenas", "staffConfig", "tempo"]);

// A run's input as it is sent away: its data, and what is not said as data. (`staffConfig` and `tempo` are what
// frontApply.js turnRunInput adds beside the staff and the allowance it hands a run fought on the page.)
export const awayInputOf = (args = {}) => {
  const data = {};
  for (const [key, value] of Object.entries(args ?? {})) if (!PAGE_KEYS.includes(key) && typeof value !== "function") data[key] = value;
  const places = args?.strikePlaces;
  return {
    ...data,
    staff: typeof args?.staffPolicy === "function" && args?.staffConfig ? args.staffConfig : null,
    tempo: Number(args?.tempo) > 0 ? Number(args.tempo) : 0,
    narrates: typeof args?.narratesCombat === "function",
    strikes: ["find", "origin", "seat"].filter((name) => typeof places?.[name] === "function"),
    readsMap: typeof args?.readMap === "function",
    readsRegions: typeof args?.loadRegions === "function",
    findsRegionsFile: typeof args?.regionsFile === "function",
  };
};

// What the page answers, by name: (name, value) => its answer. The page's own side of a run fought away.
export const pageAnswersOf = (args = {}) => {
  const places = args?.strikePlaces;
  return async (name, value) => {
    if (name === "readMap") {
      const read = typeof args.readMap === "function" ? await args.readMap() : null;
      // (Its arenas are the page's: the run fought away keeps its own.)
      return read ? { map: read.map, baseOwners: read.baseOwners, regionIds: read.regionIds } : read;
    }
    if (name === "loadRegions") return typeof args.loadRegions === "function" ? args.loadRegions() : null;
    if (name === "regionsFile") return typeof args.regionsFile === "function" ? args.regionsFile() : null;
    if (name === "strike.find") return typeof places?.find === "function" ? places.find(value) : null;
    if (name === "strike.origin") return typeof places?.origin === "function" ? places.origin(value) : null;
    if (name === "strike.seat") return typeof places?.seat === "function" ? places.seat(value) : null;
    throw new Error(`the page was asked for "${name}", which it does not answer`);
  };
};

// The map's shapes read here from the file the page names ({ url, names }), as its loadRegions would give them. The
// page reading them itself and copying them across held it for about a second. Null where they cannot be read here.
const regionsReadHere = async (ask) => {
  try {
    const file = await ask("regionsFile");
    if (!file?.url || typeof fetch !== "function") return null;
    const response = await fetch(file.url, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const names = new Map(Array.isArray(file.names) ? file.names : []);
    const regions = engineRegionsOf(await response.json(), { nameOf: (id) => names.get(id) });
    return regions.length > 0 ? regions : null;
  } catch {
    return null;
  }
};

// The run fought here: `data` as awayInputOf gave it; `ask(name, value)` asks the page; `pause` is called between
// slices of the run (frontTurn.js runFrontTurn), and stops it by throwing; `rehearsers`, the cores its staff's plans
// may be fought on together (runtime/fronts/mind/rehearsers.js).
export const fightAway = (data = {}, { ask, pause = null, rehearsers = null } = {}) => {
  const { staff = null, tempo = 0, narrates = false, strikes = [], readsMap = false, readsRegions = false, findsRegionsFile = false, ...rest } = data ?? {};
  const asks = Array.isArray(strikes) ? strikes : [];
  return runTurnFronts({
    ...rest,
    createFrontRun,
    ...(readsMap ? {
      readMap: async () => {
        const read = await ask("readMap");
        return read ? { ...read, arenas: arenasFor(String(read.map?.key ?? "")) } : read;
      },
    } : {}),
    ...(readsRegions ? { loadRegions: async () => (findsRegionsFile ? await regionsReadHere(ask) : null) ?? ask("loadRegions") } : {}),
    ...(typeof pause === "function" ? { pause } : {}),
    ...(tempo > 0 ? { tempoAllowance: (days) => territoryTempoAllowance(tempo, Math.max(1, days)) } : {}),
    ...(staff && trainedStaffPolicy() ? { staffPolicy: labStaffPolicy(staff), ...(rehearsers ? { rehearsers } : {}) } : {}),
    ...(narrates ? { narratesCombat: eventNarratesHardCombat } : {}),
    ...(asks.length > 0 ? {
      strikePlaces: Object.fromEntries(asks.map((name) => [name, (value) => ask(`strike.${name}`, value)])),
    } : {}),
  });
};
