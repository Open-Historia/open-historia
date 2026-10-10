import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EMPTY_RESPONSE_BODY_NOTE,
  NO_RESPONSE_BODY_NOTE,
  TURN_RUNNING_NOTE,
  assertNoTurnRunning,
  beginSimulation,
  discardParkedTurn,
  discardPendingJumpSegment,
  discardPendingProjectsJump,
  endSimulation,
  getParkedTurn,
  getPendingJumpSegment,
  getPendingProjectsJump,
  isChatGenerationLikely,
  isResponseBodyNote,
  isSimulationBusy,
  parkFinishedTurn,
  setCampaignResolver,
  setPendingJumpSegment,
  setPendingProjectsJump,
  takeParkedTurn,
  setChatGenerationInFlight,
  subscribeChatGeneration,
} from "./simulationStatus.js";

test("the chat is told when a generation starts and stops, once per change", () => {
  const seen = [];
  const unsubscribe = subscribeChatGeneration((value) => seen.push(value));
  setChatGenerationInFlight(true);
  setChatGenerationInFlight(true);
  assert.equal(isChatGenerationLikely(), true);
  setChatGenerationInFlight(false);
  setChatGenerationInFlight(undefined);
  assert.deepEqual(seen, [true, false]);

  unsubscribe();
  setChatGenerationInFlight(true);
  assert.deepEqual(seen, [true, false]);
  setChatGenerationInFlight(false);
});

test("a listener that throws does not stop the others or the flag", () => {
  const seen = [];
  const dropBroken = subscribeChatGeneration(() => {
    throw new Error("broken listener");
  });
  const dropGood = subscribeChatGeneration((value) => seen.push(value));
  setChatGenerationInFlight(true);
  assert.equal(isChatGenerationLikely(), true);
  assert.deepEqual(seen, [true]);
  setChatGenerationInFlight(false);
  dropBroken();
  dropGood();
});

test("the chat panel subscribes instead of polling the flag on a timer", () => {
  const chat = fs.readFileSync(new URL("../GameUI/chat.jsx", import.meta.url), "utf8");
  assert.match(chat, /subscribeChatGeneration\(setIsGenerating\)/);
  assert.doesNotMatch(chat, /setInterval\(\(\) => setIsGenerating/);
});

test("a player's world edit is refused while a turn runs, with the reason, and allowed once it ends", () => {
  assert.doesNotThrow(() => assertNoTurnRunning());
  beginSimulation();
  try {
    assert.throws(() => assertNoTurnRunning(), (error) => error.message === TURN_RUNNING_NOTE);
  } finally {
    endSimulation();
  }
  assert.doesNotThrow(() => assertNoTurnRunning());
});

// ---- Holds belong to their campaign -----------------------------------------
let openCampaign = "";
const openIn = (campaignId) => {
  openCampaign = campaignId;
};

test("a jump held in one campaign keeps only that campaign busy, and is still there on the way back", () => {
  setCampaignResolver(() => openCampaign);
  try {
    openIn("game-a");
    setPendingJumpSegment({ context: { campaignId: "game-a" }, state: {}, message: "Segment 2 of 3 failed." });
    assert.equal(isSimulationBusy(), true);

    // The player opens another save: it plays as usual.
    openIn("game-b");
    assert.equal(isSimulationBusy(), false);
    assert.equal(getPendingJumpSegment(), null);
    assert.equal(discardPendingJumpSegment(), false, "a discard in B leaves A's hold alone");

    // Back in A, the hold and its message are there to rebuild the notice from.
    openIn("game-a");
    assert.equal(getPendingJumpSegment()?.message, "Segment 2 of 3 failed.");
    assert.equal(isSimulationBusy(), true);
    assert.equal(discardPendingJumpSegment(), true);
    assert.equal(isSimulationBusy(), false);
  } finally {
    setCampaignResolver(null);
  }
});

test("a turn held at the board is released for its own campaign only", () => {
  setCampaignResolver(() => openCampaign);
  try {
    openIn("game-a");
    setPendingProjectsJump({ applyArgs: { campaignId: "game-a" }, message: "held in A" });
    openIn("game-b");
    setPendingProjectsJump({ applyArgs: { campaignId: "game-b" }, message: "held in B" });
    assert.equal(getPendingProjectsJump()?.message, "held in B");
    // A's turn finishing its board while B is open releases A's, not B's.
    setPendingProjectsJump(null, "game-a");
    assert.equal(getPendingProjectsJump()?.message, "held in B");
    openIn("game-a");
    assert.equal(getPendingProjectsJump(), null);
    openIn("game-b");
    assert.equal(discardPendingProjectsJump(), true);
  } finally {
    setCampaignResolver(null);
  }
});

test("a turn finished while another campaign was open waits for its own, and is taken once", () => {
  setCampaignResolver(() => openCampaign);
  try {
    openIn("game-b");
    parkFinishedTurn({ campaignId: "game-a" });
    assert.equal(getParkedTurn(), null, "nothing parked without the apply to run again");
    parkFinishedTurn({ campaignId: "game-a", applyArgs: { round: 4 } });
    assert.equal(getParkedTurn(), null);
    assert.equal(isSimulationBusy(), false, "the save the player opened is not held up");

    openIn("game-a");
    assert.equal(isSimulationBusy(), true, "nothing else writes into A before it lands");
    assert.deepEqual(takeParkedTurn()?.applyArgs, { round: 4 });
    assert.equal(takeParkedTurn(), null);
    assert.equal(isSimulationBusy(), false);

    parkFinishedTurn({ campaignId: "game-a", applyArgs: {} });
    assert.equal(discardParkedTurn(), true);
    assert.equal(getParkedTurn(), null);
  } finally {
    setCampaignResolver(null);
  }
});

test("with no campaign known, a hold counts wherever it is asked about, as before", () => {
  setPendingJumpSegment({ context: { campaignId: "game-a" }, state: {} });
  assert.equal(isSimulationBusy(), true);
  assert.equal(discardPendingJumpSegment(), true);
  assert.equal(isSimulationBusy(), false);
});

test("both response-body notes are told apart from rejected model text", () => {
  assert.equal(isResponseBodyNote(NO_RESPONSE_BODY_NOTE), true);
  assert.equal(isResponseBodyNote(EMPTY_RESPONSE_BODY_NOTE), true);
  assert.notEqual(NO_RESPONSE_BODY_NOTE, EMPTY_RESPONSE_BODY_NOTE);
  assert.equal(isResponseBodyNote("{\"events\": ["), false);
  assert.equal(isResponseBodyNote(""), false);
  assert.equal(isResponseBodyNote(undefined), false);
});

