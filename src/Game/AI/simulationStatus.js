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

// A counter, not a boolean: independent generators overlap.
let activeSimulations = 0;

// A turn HELD for the player: generated, NOT written, waiting on Retry or
// Discard. One kind at a time in practice, keyed by kind so each retry finds
// its own. The kinds:
//   segment  one segment of a split jump did not come back; the ones before it
//            are in hand (gameplay.js runJumpSegments)
//   board    the Projects & Operations board did not update (applySimulationResult)
//   checks   a check after the events failed: the turn review, or with Save AI
//            requests off one of the separate checks (turnChecks.js)
// An error that holds a turn carries its kind as `heldKind`.
export const HELD_TURN = Object.freeze({ segment: "segment", board: "board", checks: "checks" });
const heldTurns = new Map();
const DISCARD_NOTES = Object.freeze({
  [HELD_TURN.segment]: "Held jump discarded; nothing was written and its finished segments are gone.",
  [HELD_TURN.board]: "Held turn discarded; the board was never updated and nothing was written.",
  [HELD_TURN.checks]: "Held turn discarded; a check after its events failed and nothing was written.",
});

// The idle chat poll is mid-generation ("someone might be typing").
let chatGenerationInFlight = false;
const chatGenerationListeners = new Set();

export const beginSimulation = () => {
  activeSimulations += 1;
};

export const endSimulation = () => {
  activeSimulations = Math.max(0, activeSimulations - 1);
};

export const getHeldTurn = (kind) => heldTurns.get(kind) ?? null;
export const holdTurn = (kind, value) => {
  if (value == null) heldTurns.delete(kind);
  else heldTurns.set(kind, value);
};

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

// A held jump counts as busy: the idle pulse checks this before it writes, so it
// cannot write into a world that is about to be replaced by the held turn.
export const isSimulationBusy = () => activeSimulations > 0 || heldTurns.size > 0;

export const isChatGenerationLikely = () => chatGenerationInFlight;

// A turn or a reply is being written right now. Unlike isSimulationBusy, a jump
// held for the player does not count: nothing runs until they answer. The
// Android app rests in the background on this (runtime/native/backgroundPause.js).
export const isGenerating = () => activeSimulations > 0 || chatGenerationInFlight;

// A retry takes its held turn out before the attempt, so a turn can never be
// applied twice. A Cancel must put it back: the notice stays up offering Retry,
// and without the turn behind it the next press found nothing ("There is no
// turn waiting…") and the turn was lost. A failure that holds the turn again
// holds it itself; anything else is an ordinary failure and the turn is gone.
export const attemptHeldTurn = async (kind, held, attempt, { signal = null, onCancel = null } = {}) => {
  heldTurns.delete(kind);
  try {
    return await attempt();
  } catch (error) {
    if (!error?.heldKind && (signal?.aborted || error?.name === "AbortError")) {
      onCancel?.();
      heldTurns.set(kind, held);
    }
    throw error;
  }
};

// Discards stay synchronous: time.jsx fires them next to a setState, and an
// async one would leave isSimulationBusy() true for a tick afterwards. Nothing
// was written either way, so there is nothing to undo.
export const discardHeldTurn = (kind) => {
  const had = heldTurns.delete(kind);
  if (had) logDebugEvent("turn", DISCARD_NOTES[kind] ?? "Held turn discarded; nothing was written.");
  return had;
};

// Every held turn, when a new one starts: its notice would offer buttons with
// nothing behind them.
export const discardHeldTurns = () => {
  for (const kind of [...heldTurns.keys()]) discardHeldTurn(kind);
};

// Compared by identity in a render path (time.jsx).
export const NO_RESPONSE_BODY_NOTE = "(no response body — the request failed before the model answered, so there was nothing to parse. See the failure reason above: a transport or HTTP error like this usually means the provider URL, API key or model name is wrong, not that the model misbehaved.)";
