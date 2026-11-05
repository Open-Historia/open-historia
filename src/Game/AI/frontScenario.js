/*! Open Historia — the fronts a scenario begins with, built when its game is first opened © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario's author lists the fronts the game begins with
// (runtime/fronts/scenarioFronts.js). When a game made from the scenario is
// first opened they are built here: the front engine is run over no days at
// all, with the wars those fronts are fought in and the orders each side
// begins under, so that it opens the battlefields where the two sides' ground
// meets, raises the troops (as many as the author said, or as many as the
// sides' size gives) and stands them along the line. No model is asked
// anything.
//
// The engine is handed in, as the turn hands it (frontApply.js), so this is
// tested with the real one on a drawn map.

import { normalizeBattlefields } from "../../runtime/fronts/record.js";
import {
  SCENARIO_FRONTS_EVENT,
  normalizeScenarioFronts,
  scenarioFrontOrders,
  scenarioFrontWars,
  withScenarioGenerals,
} from "../../runtime/fronts/scenarioFronts.js";
import { runTurnFronts } from "./frontTurn.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Whether a world still has fronts of its scenario's to build.
export const scenarioFrontsPending = (world) => normalizeScenarioFronts(world?.scenarioFronts).length > 0;

// Builds a new game's battlefields from its scenario's fronts.
//   world, game      the game as it was made from the scenario
//   createFrontRun   the engine (runtime/fronts/engine.js)
//   the rest         what a turn's run is given of the map (frontTurn.js runTurnFronts)
// Returns null when the scenario has no fronts. Otherwise
//   { battlefields, wars, unitChanges, notes }
// `battlefields` is null when the engine could not be run (the map could not
// be read): nothing is to be written then, and the fronts are tried again the
// next time the game is opened. `wars` is the ledger with the wars the fronts
// are fought in written into it.
export const buildScenarioFronts = async ({ world = {}, game = {}, createFrontRun, ...map } = {}) => {
  const fronts = normalizeScenarioFronts(world?.scenarioFronts);
  if (fronts.length === 0) return null;
  const date = clean(game?.gameDate || game?.startDate);
  const wars = [...asArray(world?.wars), ...scenarioFrontWars(fronts, world?.wars, date)];
  const run = await runTurnFronts({
    ...map,
    createFrontRun,
    world: { ...world, wars },
    // The orders the sides begin under rest on one event of the first day.
    events: [{ id: SCENARIO_FRONTS_EVENT, date, title: "The fronts the scenario begins with", description: "", impacts: {} }],
    frontOrders: scenarioFrontOrders(fronts),
    warStages: [wars],
    fromDate: date,
    toDate: date,
    requestedDays: 0,
    authored: fronts,
  });
  if (!Array.isArray(run?.battlefields)) return { battlefields: null, wars, unitChanges: [], notes: asArray(run?.notes) };
  return {
    battlefields: withScenarioGenerals(normalizeBattlefields(run.battlefields), fronts),
    wars,
    unitChanges: asArray(run.unitChanges),
    notes: asArray(run.notes),
  };
};
