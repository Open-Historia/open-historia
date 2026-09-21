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

let modulePromise = null;

const gameplay = () => {
  if (!modulePromise) modulePromise = import("./gameplay.js");
  return modulePromise;
};

export const prefetchGameplay = () => {
  // Deliberately swallowed: a warm-up that fails must not surface as an error.
  // The real call retries the import and reports properly.
  gameplay().catch(() => {});
};

// --- Timeline ---------------------------------------------------------------
export const simulateTimelineJump = async (...args) => (await gameplay()).simulateTimelineJump(...args);
export const simulateAutoJump = async (...args) => (await gameplay()).simulateAutoJump(...args);
export const retryPendingJumpSegment = async (...args) => (await gameplay()).retryPendingJumpSegment(...args);
export const retryPendingProjectsJump = async (...args) => (await gameplay()).retryPendingProjectsJump(...args);
export const maybeGeneratePregameHistory = async (...args) => (await gameplay()).maybeGeneratePregameHistory(...args);

// --- Rollback ---------------------------------------------------------------
export const loadRollbackSnapshots = async (...args) => (await gameplay()).loadRollbackSnapshots(...args);
export const rollBackToSnapshot = async (...args) => (await gameplay()).rollBackToSnapshot(...args);
// Intervene: stop the last turn after the events revealed so far (intervene.js).
export const canInterveneInLastTurn = async (...args) => (await gameplay()).canInterveneInLastTurn(...args);
export const interveneAfterEvent = async (...args) => (await gameplay()).interveneAfterEvent(...args);

// --- Interactive events -----------------------------------------------------
// A moment played out as a scene (GameUI/interactive.jsx): offered now and then
// by a time skip (runtime/interactiveOffer.js), taken up or let pass by the
// player, played beat by beat, taken back (interactiveRewind.js), ended into
// the record or set aside.
export const createInteractive = async (...args) => (await gameplay()).createInteractive(...args);
export const declineInteractiveOffer = async (...args) => (await gameplay()).declineInteractiveOffer(...args);
export const advanceActiveInteractive = async (...args) => (await gameplay()).advanceActiveInteractive(...args);
export const rewindActiveInteractive = async (...args) => (await gameplay()).rewindActiveInteractive(...args);
export const endActiveInteractive = async (...args) => (await gameplay()).endActiveInteractive(...args);
export const setAsideActiveInteractive = async (...args) => (await gameplay()).setAsideActiveInteractive(...args);

// --- Chat and diplomacy -----------------------------------------------------
export const chooseNextDiplomaticSpeaker = async (...args) => (await gameplay()).chooseNextDiplomaticSpeaker(...args);
// One request acts for every AI participant in a thread (AI/chatActions.js).
export const runChatActionBatch = async (...args) => (await gameplay()).runChatActionBatch(...args);
export const checkDemandReply = async (...args) => (await gameplay()).checkDemandReply(...args);
export const ensureCountryAssessed = async (...args) => (await gameplay()).ensureCountryAssessed(...args);
export const processPendingEventOutreach = async (...args) => (await gameplay()).processPendingEventOutreach(...args);

// --- Actions ----------------------------------------------------------------
export const generateActionSuggestions = async (...args) => (await gameplay()).generateActionSuggestions(...args);
export const refinePlayerAction = async (...args) => (await gameplay()).refinePlayerAction(...args);

// --- Game master (cheats panel, itself already lazy) -------------------------
export const previewGameMasterCommand = async (...args) => (await gameplay()).previewGameMasterCommand(...args);
export const applyGameMasterPreview = async (...args) => (await gameplay()).applyGameMasterPreview(...args);
export const consolidateHistoryNow = async (...args) => (await gameplay()).consolidateHistoryNow(...args);

// --- Stats and intelligence -------------------------------------------------
export const ensureIntelligenceRated = async (...args) => (await gameplay()).ensureIntelligenceRated(...args);
export const readOpenedIntercepts = async (...args) => (await gameplay()).readOpenedIntercepts(...args);
export const generateCountryStatSheet = async (...args) => (await gameplay()).generateCountryStatSheet(...args);
export const generateCountryStats = async (...args) => (await gameplay()).generateCountryStats(...args);
