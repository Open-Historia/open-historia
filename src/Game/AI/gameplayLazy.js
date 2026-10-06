// Open Historia, lazy boundary in front of the AI simulation stack.
//
// gameplay.js statically pulls in nativeWorldDirector, gameplaySchemas,
// promptContext and the other native directors: roughly 25,000 lines that cannot
// run until the player takes a turn. Imported statically from the HUD it all
// landed in the eagerly-loaded entry chunk, and the `await import()` calls in
// main.jsx were no-ops for bundling because the module was already in the graph.
//
// Every wrapper here is async, so each is a real code-split point. The HUD
// imports these instead, and Rollup can move the stack into its own chunk.
//
// What must NOT come through here: anything the HUD needs synchronously. Those
// live in simulationStatus.js, which has no dependencies and stays eager.
//
// prefetchGameplay() warms the chunk after first world idle so the player's
// first turn does not also pay the download.

import { inSharedGame } from "../../multiplayer/client/sharedGameBridge.js";

let modulePromise = null;

const gameplay = () => {
  if (!modulePromise) modulePromise = import("./gameplay.js");
  return modulePromise;
};

// A page playing a shared game (multiplayer/) never runs the game itself: the
// host's engine does, and the page's screens send it requests instead. So
// everything here that writes the game refuses there, with a reason, rather
// than spending the player's AI key on a change the host would never accept.
// What only reads, or answers on the player's own screen (suggestions,
// wording an order, reading its own intercepts), still runs.
export class SharedGameRefusal extends Error {
  constructor() {
    super("In a shared game the host's computer runs the game; this is done there.");
    this.name = "SharedGameRefusal";
  }
}
const hostOnly = (run) => async (...args) => {
  if (inSharedGame()) throw new SharedGameRefusal();
  return run(...args);
};
// What a screen starts on its own, with nobody waiting on the answer (a first
// reading of a country when its panel opens, a rating of its services): there
// it is simply not done, and settles with nothing. A refusal nobody catches is
// a crash in the log for something the player never asked for.
const hostQuietly = (run) => async (...args) => (inSharedGame() ? null : run(...args));

export const prefetchGameplay = () => {
  // Deliberately swallowed: a warm-up that fails must not surface as an error.
  // The real call retries the import and reports properly.
  gameplay().catch(() => {});
};

// --- Timeline ---------------------------------------------------------------
export const simulateTimelineJump = hostOnly(async (...args) => (await gameplay()).simulateTimelineJump(...args));
export const simulateAutoJump = hostOnly(async (...args) => (await gameplay()).simulateAutoJump(...args));
export const retryPendingJumpSegment = hostOnly(async (...args) => (await gameplay()).retryPendingJumpSegment(...args));
export const retryPendingProjectsJump = hostOnly(async (...args) => (await gameplay()).retryPendingProjectsJump(...args));
export const applyParkedTurn = hostOnly(async (...args) => (await gameplay()).applyParkedTurn(...args));
// A kept skip is the host's, in the host's own store: a page playing a shared
// game is told there is none, and never takes one in or throws one away.
export const loadParkedTurn = hostQuietly(async (...args) => (await gameplay()).loadParkedTurn(...args));
export const discardKeptTurn = hostOnly(async (...args) => (await gameplay()).discardKeptTurn(...args));
export const maybeGeneratePregameHistory = hostQuietly(async (...args) => (await gameplay()).maybeGeneratePregameHistory(...args));
// A scenario's own pre-history, written in the Workshop: not the game being played.
export const generateScenarioPrehistory = async (...args) => (await gameplay()).generateScenarioPrehistory(...args);

// --- Rollback ---------------------------------------------------------------
export const rollBackToSnapshot = hostOnly(async (...args) => (await gameplay()).rollBackToSnapshot(...args));
// Intervene: stop the last turn after the events revealed so far (intervene.js).
export const canInterveneInLastTurn = async (...args) => (await gameplay()).canInterveneInLastTurn(...args);
export const interveneAfterEvent = hostOnly(async (...args) => (await gameplay()).interveneAfterEvent(...args));

// --- Interactive events -----------------------------------------------------
// A moment played out as a scene (GameUI/interactive.jsx): offered now and then
// by a time skip (runtime/interactiveOffer.js), taken up or let pass by the
// player, played beat by beat, taken back (interactiveRewind.js), ended into
// the record or set aside.
export const createInteractive = hostOnly(async (...args) => (await gameplay()).createInteractive(...args));
export const declineInteractiveOffer = hostOnly(async (...args) => (await gameplay()).declineInteractiveOffer(...args));
export const advanceActiveInteractive = hostOnly(async (...args) => (await gameplay()).advanceActiveInteractive(...args));
export const rewindActiveInteractive = hostOnly(async (...args) => (await gameplay()).rewindActiveInteractive(...args));
export const endActiveInteractive = hostOnly(async (...args) => (await gameplay()).endActiveInteractive(...args));
export const setAsideActiveInteractive = hostOnly(async (...args) => (await gameplay()).setAsideActiveInteractive(...args));

// --- Chat and diplomacy -----------------------------------------------------
// One request acts for every AI participant in a thread (AI/chatActions.js).
export const runChatActionBatch = hostOnly(async (...args) => (await gameplay()).runChatActionBatch(...args));
export const checkDemandReply = hostQuietly(async (...args) => (await gameplay()).checkDemandReply(...args));
export const ensureCountryAssessed = hostQuietly(async (...args) => (await gameplay()).ensureCountryAssessed(...args));
export const processPendingEventOutreach = hostOnly(async (...args) => (await gameplay()).processPendingEventOutreach(...args));

// --- Actions ----------------------------------------------------------------
export const generateActionSuggestions = async (...args) => (await gameplay()).generateActionSuggestions(...args);
export const refinePlayerAction = async (...args) => (await gameplay()).refinePlayerAction(...args);

// --- Game master (cheats panel, itself already lazy) -------------------------
export const previewGameMasterCommand = hostOnly(async (...args) => (await gameplay()).previewGameMasterCommand(...args));
export const applyGameMasterPreview = hostOnly(async (...args) => (await gameplay()).applyGameMasterPreview(...args));
export const consolidateHistoryNow = hostOnly(async (...args) => (await gameplay()).consolidateHistoryNow(...args));

// --- Stats and intelligence -------------------------------------------------
export const ensureIntelligenceRated = hostQuietly(async (...args) => (await gameplay()).ensureIntelligenceRated(...args));
export const readOpenedIntercepts = async (...args) => (await gameplay()).readOpenedIntercepts(...args);
export const generateCountryStatSheet = hostOnly(async (...args) => (await gameplay()).generateCountryStatSheet(...args));
// Settles with that reading's sheet (or null), or at once with null when none is running.
export const pendingCountryStatSheet = async (...args) => (await gameplay()).pendingCountryStatSheet(...args);
export const generateCountryStats = hostOnly(async (...args) => (await gameplay()).generateCountryStats(...args));
