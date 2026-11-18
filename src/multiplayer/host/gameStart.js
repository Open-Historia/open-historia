/*! Open Historia — a shared game's start, finished by its host's engine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/multiplayer/host/gameStart.test.js
//
// A new game is finished the first time its player enters it, before its first
// skip (GameUI/time.jsx): its backstory, the scenario's own pre-history or one
// written from its "World Before Round One" briefing, puts the events before
// the start on the timeline and the wars and treaties already true on the
// books (gameplay.js maybeGeneratePregameHistory); then the fronts the
// scenario begins with are built into battlefields (maybeOpenScenarioFronts).
// In a shared game no page may write the game (rule 1), so the page leaves
// both alone, and the engine never did them: a game shared straight away, from
// the menu, began its first round with no backstory and no fronts, for good
// (the gap audit of 2026-11-18).
//
// So the host's engine finishes the start itself when it opens the game, before
// anyone joins: the same calls single player makes, once, on the host's own
// AI. A scenario's own pre-history asks nothing; only one made before
// scenarios kept a pre-history asks one request for it, as single player does
// (rule 3: no request is added to a round). A game already started has nothing
// left to do, and the calls say so themselves. The fronts wait while the
// pre-history is still to be written, as single player's do, since it writes
// the wars they are fought in; ones that could not be built yet are tried
// again before each round, which asks nothing.
//
// What could not be done is said to the host, not passed over: the game opens
// without it, and opening it again tries again.

import { prehistoryHasContent } from "../../runtime/scenarioPrehistory.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// Whether a game's scenario pre-history is still to be written: a fresh game
// (round 1, nothing on the timeline, no turn yet) whose scenario keeps one, as
// single player's Events panel tells (time.jsx, the fronts' effect).
export const backstoryPending = ({ world, game, events } = {}) => {
  const fresh = (Number(game?.round) || 1) === 1 && list(events).length === 0 && list(world?.simulationHistory).length === 0;
  return fresh && prehistoryHasContent(world?.prehistory);
};

const reasonOf = (error) => clean(error?.message || error).slice(0, 240) || "no reason was given";

// `backstory()` and `fronts()` are the game's own (gameplay.js); `read()` the
// game's documents. Resolves with what could not be done, in the host's words
// ([] when everything was), and never rejects.
export const finishGameStart = async ({ backstory = null, fronts = null, read = async () => ({}), log = () => {} } = {}) => {
  const problems = [];
  if (typeof backstory === "function") {
    try {
      await backstory();
    } catch (error) {
      const why = reasonOf(error);
      log("the game's backstory could not be written", why);
      problems.push(`The game's backstory could not be written (${why}). It opens without it; share it again to try once more.`);
    }
  }
  if (typeof fronts === "function") {
    try {
      if (backstoryPending(await read())) return problems;
      // "later": something else was at work on the game, or its map could not
      // be read; tried again before each round.
      if ((await fronts()) === "later") log("the scenario's opening fronts could not be built yet", "tried again before the next round");
    } catch (error) {
      const why = reasonOf(error);
      log("the scenario's opening fronts could not be built", why);
      problems.push(`The scenario's opening fronts could not be built (${why}). They are tried again before each round.`);
    }
  }
  return problems;
};
