// Open Historia, the bits of the AI stack the HUD needs SYNCHRONOUSLY.
//
// Everything else lives behind gameplayLazy.js. These cannot: a promise is no
// use to a render path or an 800ms poll, so importing them from gameplay.js is
// what kept 600 KB of simulation in the entry chunk. Nothing here may import
// anything that pulls it back in. debugLog.js is a leaf and is already loaded.
//
// This file OWNS the turn state rather than mirroring it, so a new write site
// that forgets to update it is a ReferenceError rather than silent drift.
import { logDebugEvent } from "../../runtime/debugLog.js";
import { campaignChanged } from "../../runtime/campaignGuard.js";

// A counter, not a boolean: independent generators overlap.
let activeSimulations = 0;

// A jump held on a failed segment, a turn held at the Projects board, and a
// finished turn parked because another campaign was open when it was ready to
// be written. Each belongs to the campaign it was generated for, one of each
// kind per campaign, keyed by the campaign's id ("" when it could not tell).
// A hold is only this campaign's business: it keeps THIS campaign busy and
// shows its notice here, and another campaign opened meanwhile plays as usual.
const pendingJumpSegments = new Map();
const pendingProjectsJumps = new Map();
const parkedTurns = new Map();

// Which campaign is open. gameplay.js supplies it (it reads the library), so
// this file stays a leaf. Until it does, every hold counts wherever it is asked
// about, which is how holds behaved before they knew their campaign.
let currentCampaign = () => "";
export const setCampaignResolver = (resolve) => {
  currentCampaign = typeof resolve === "function" ? resolve : () => "";
};

const campaignOfHold = (value) => String(
  value?.campaignId ?? value?.context?.campaignId ?? value?.applyArgs?.campaignId ?? "",
).trim();

// The hold of the open campaign. An unknown id on either side is "cannot tell",
// as in campaignGuard.js, and counts.
const heldHere = (holds) => {
  const current = currentCampaign();
  for (const [campaignId, hold] of holds) {
    if (!campaignChanged(campaignId, current)) return hold;
  }
  return null;
};

const releaseHere = (holds) => {
  const current = currentCampaign();
  let had = false;
  for (const campaignId of [...holds.keys()]) {
    if (campaignChanged(campaignId, current)) continue;
    holds.delete(campaignId);
    had = true;
  }
  return had;
};

// Setting null releases the hold of `campaignId`, or of the open campaign.
const setHold = (holds, value, campaignId) => {
  if (value == null) {
    if (campaignId === undefined) releaseHere(holds);
    else holds.delete(String(campaignId ?? "").trim());
    return;
  }
  holds.set(String(campaignId ?? campaignOfHold(value)).trim(), value);
};

// The idle chat poll is mid-generation ("someone might be typing").
let chatGenerationInFlight = false;
const chatGenerationListeners = new Set();

export const beginSimulation = () => {
  activeSimulations += 1;
};

export const endSimulation = () => {
  activeSimulations = Math.max(0, activeSimulations - 1);
};

export const getPendingJumpSegment = () => heldHere(pendingJumpSegments);
export const setPendingJumpSegment = (value, campaignId) => {
  setHold(pendingJumpSegments, value, campaignId);
};

export const getPendingProjectsJump = () => heldHere(pendingProjectsJumps);
export const setPendingProjectsJump = (value, campaignId) => {
  setHold(pendingProjectsJumps, value, campaignId);
};

// A finished turn whose campaign was not open when it was ready to be written
// (gameplay.js finishTimelineJump): { campaignId, applyArgs }, the arguments of
// the apply that was refused. Also stored with its campaign (AI/parkedTurn.js),
// and taken back in from there after a restart (gameplay.js loadParkedTurn).
// Offered when that campaign is next opened, and applied or discarded by the
// player (gameplay.js applyParkedTurn and discardKeptTurn, called by time.jsx).
export const getParkedTurn = () => heldHere(parkedTurns);
export const parkFinishedTurn = (value) => {
  if (value?.applyArgs && typeof value.applyArgs === "object") parkedTurns.set(campaignOfHold(value), value);
};
// Takes the open campaign's parked turn off the shelf, so it is applied once.
export const takeParkedTurn = () => {
  const parked = heldHere(parkedTurns);
  if (parked) parkedTurns.delete(campaignOfHold(parked));
  return parked;
};

// Said in the Timeline when a kept turn is dropped because its campaign has
// moved on since the skip read it (gameplay.js loadParkedTurn, applyParkedTurn).
export const PARKED_TURN_STALE_NOTE = "The time skip that finished while another campaign was open was discarded, because this campaign has moved on since that skip began. Run the skip again.";


export const setChatGenerationInFlight = (inFlight) => {
  const next = inFlight === true;
  if (next === chatGenerationInFlight) return;
  chatGenerationInFlight = next;
  for (const listener of chatGenerationListeners) {
    try {
      listener(next);
    } catch {
      // A listener's failure is its own; the flag is already set.
    }
  }
};

// The chat's typing badge and banner are told when the flag changes, rather
// than reading it on an 800 ms timer for the whole session (menu included).
// Returns the unsubscribe.
export const subscribeChatGeneration = (listener) => {
  chatGenerationListeners.add(listener);
  return () => {
    chatGenerationListeners.delete(listener);
  };
};

export const hasPendingJumpSegment = () => heldHere(pendingJumpSegments) !== null;
export const hasPendingProjectsJump = () => heldHere(pendingProjectsJumps) !== null;

// A held jump counts as busy: the idle pulse checks this before it writes, so it
// cannot write into a world that is about to be replaced by the held turn. Only
// the open campaign's holds count.
export const isSimulationBusy = () => activeSimulations > 0
  || heldHere(pendingProjectsJumps) !== null
  || heldHere(pendingJumpSegments) !== null
  || heldHere(parkedTurns) !== null;

// What a player's edit to the world says instead of saving while a turn runs or
// waits: the turn writes back the world it read when it started, so the edit
// would be gone the moment the turn lands. Worded like the standing goal's lock
// (GameUI/actions.jsx). Orders are not locked: the turn reads them again before
// it writes (runtime/turnCommit.js).
export const TURN_RUNNING_NOTE = "A turn is running. This can be changed once it ends.";

export const assertNoTurnRunning = () => {
  if (isSimulationBusy()) throw new Error(TURN_RUNNING_NOTE);
};

export const isChatGenerationLikely = () => chatGenerationInFlight;

// A turn or a reply is being written right now. Unlike isSimulationBusy, a jump
// held for the player does not count: nothing runs until they answer. The
// Android app rests in the background on this (runtime/native/backgroundPause.js).
export const isGenerating = () => activeSimulations > 0 || chatGenerationInFlight;

// Both discards stay synchronous: time.jsx fires them next to a setState, and an
// async one would leave isSimulationBusy() true for a tick afterwards. Nothing
// was written either way, so there is nothing to undo.
export const discardPendingJumpSegment = () => {
  const had = releaseHere(pendingJumpSegments);
  if (had) logDebugEvent("turn", "Held jump discarded; nothing was written and its finished segments are gone.");
  return had;
};

export const discardPendingProjectsJump = () => {
  const had = releaseHere(pendingProjectsJumps);
  if (had) logDebugEvent("turn", "Held turn discarded; the board was never updated and nothing was written.");
  return had;
};

export const discardParkedTurn = () => {
  const had = releaseHere(parkedTurns);
  if (had) logDebugEvent("turn", "Parked turn discarded; it was never written.");
  return had;
};

// Written into a fallback's rawResponse when there is no model output to show
// (gameplay.js), and compared by identity in a render path (time.jsx) so the
// debug report labels its section honestly rather than matching on the wording.
export const NO_RESPONSE_BODY_NOTE = "(no response body — the request failed before the model answered, so there was nothing to parse. See the failure reason above: a transport or HTTP error like this usually means the provider URL, API key or model name is wrong, not that the model misbehaved.)";
export const EMPTY_RESPONSE_BODY_NOTE = "(the provider returned an empty response body — the request succeeded but the model produced no text)";

// True when a fallback's rawResponse is one of the notes above rather than
// model text that failed to parse or validate.
export const isResponseBodyNote = (rawResponse) =>
  rawResponse === NO_RESPONSE_BODY_NOTE || rawResponse === EMPTY_RESPONSE_BODY_NOTE;
