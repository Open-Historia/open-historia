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
// The War Room's rehearsal of the days ahead, and the next period thought through while the player reads (both fight
// a period ahead of time and write nothing).
export const warRoomRehearse = async (...args) => (await gameplay()).warRoomRehearse(...args);
export const prethinkFronts = async (...args) => (await gameplay()).prethinkFronts(...args);
export const simulateAutoJump = async (...args) => (await gameplay()).simulateAutoJump(...args);
export const retryPendingJumpSegment = async (...args) => (await gameplay()).retryPendingJumpSegment(...args);
export const retryPendingProjectsJump = async (...args) => (await gameplay()).retryPendingProjectsJump(...args);
export const retryPendingChecksJump = async (...args) => (await gameplay()).retryPendingChecksJump(...args);
export const retryHeldPlayerEvents = async (...args) => (await gameplay()).retryHeldPlayerEvents(...args);
export const heldSkipToRerun = async (...args) => (await gameplay()).heldSkipToRerun(...args);
export const applyParkedTurn = async (...args) => (await gameplay()).applyParkedTurn(...args);
export const loadParkedTurn = async (...args) => (await gameplay()).loadParkedTurn(...args);
export const discardKeptTurn = async (...args) => (await gameplay()).discardKeptTurn(...args);
// The only production entry point for a fresh game's backstory. The "Pre-game
// history" switch is read inside it, after the scenario's own record: off stops
// the request to the model, never a pre-history the scenario keeps.
export const maybeGeneratePregameHistory = async (...args) => (await gameplay()).maybeGeneratePregameHistory(...args);
// The fronts a scenario begins with, built when its game is first entered.
export const maybeOpenScenarioFronts = async (...args) => (await gameplay()).maybeOpenScenarioFronts(...args);
// A scenario's own pre-history, written in the Workshop: not the game being played.
export const generateScenarioPrehistory = async (...args) => (await gameplay()).generateScenarioPrehistory(...args);

// --- Rollback ---------------------------------------------------------------
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
// War and peace between turns (AI/warAndPeace.js): an offer of peace or a call
// to arms answered, or terms put to an enemy.
export const answerDiplomacy = async (...args) => (await gameplay()).answerDiplomacy(...args);
// What a leader's chat reply decided of peace with the player, carried out
// (AI/warAndPeace.js answerPeaceProposal).
export const answerPeaceInChat = async (...args) => (await gameplay()).answerPeaceInChat(...args);
export const advanceActiveInteractive = async (...args) => (await gameplay()).advanceActiveInteractive(...args);
export const rewindActiveInteractive = async (...args) => (await gameplay()).rewindActiveInteractive(...args);
export const endActiveInteractive = async (...args) => (await gameplay()).endActiveInteractive(...args);
export const setAsideActiveInteractive = async (...args) => (await gameplay()).setAsideActiveInteractive(...args);

// --- Chat and diplomacy -----------------------------------------------------
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
export const previewGameMasterRevision = async (...args) => (await gameplay()).previewGameMasterRevision(...args);
export const applyGameMasterPreview = async (...args) => (await gameplay()).applyGameMasterPreview(...args);
export const consolidateHistoryNow = async (...args) => (await gameplay()).consolidateHistoryNow(...args);

// --- Stats and intelligence -------------------------------------------------
export const ensureIntelligenceRated = async (...args) => (await gameplay()).ensureIntelligenceRated(...args);
// The figures of the countries the game needs and has none for, rated against the others (militaryRating.js).
export const ensureMilitaryFigures = async (...args) => (await gameplay()).ensureMilitaryFigures(...args);
export const readOpenedIntercepts = async (...args) => (await gameplay()).readOpenedIntercepts(...args);
export const generateCountryStatSheet = async (...args) => (await gameplay()).generateCountryStatSheet(...args);
// Settles with that reading's sheet (or null), or at once with null when none is running.
export const pendingCountryStatSheet = async (...args) => (await gameplay()).pendingCountryStatSheet(...args);
// A briefing on a country, in prose: asked with the player's own key from what
// the player's own screen holds, and written nowhere.
export const assessPoliticalLandscape = async (...args) => (await gameplay()).assessPoliticalLandscape(...args);
export const assessGoalProgress = async (...args) => (await gameplay()).assessGoalProgress(...args);
export const generateCountryStats = async (...args) => (await gameplay()).generateCountryStats(...args);
// Rostra's empty feed: one request for its first posts, written into the
// feed (gameplay.js generateRostraPosts).
export const generateRostraPosts = async (...args) => (await gameplay()).generateRostraPosts(...args);
// Rostra's Search: one request for what people in a place are posting
// (runtime/placeFeed.js). It writes nothing to the game: asked with the
// player's own key, kept on the player's own device.
export const generatePlaceFeed = async (...args) => (await gameplay()).generatePlaceFeed(...args);
// The war room: one request for what the player's generals answer
// (warRoomContext.js). It writes nothing itself: what they said and the orders
// they took are written by the caller through runtime/warRoomWrites.js.
export const generateWarRoomReply = async (...args) => (await gameplay()).generateWarRoomReply(...args);
// The war room: which routes drawn on a battlefield go into a country outside
// its war. Read from the map, with no request made and nothing written.
export const warRoomRouteAttacks = async (...args) => (await gameplay()).warRoomRouteAttacks(...args);
// The war room: the way each transporter deployed there would take. Read from
// the map, with no request made and nothing written.
export const warRoomTransportWays = async (...args) => (await gameplay()).warRoomTransportWays(...args);
// The war room: what its fortified lines and fleets are held to on the map
// (where the sea is, whose the ground). Read from the map, with no request made
// and nothing written.
export const warRoomChart = async (...args) => (await gameplay()).warRoomChart(...args);
