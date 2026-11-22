/*! Open Historia - source-linked Project Finance player review. AGPL-3.0-or-later. */
import { readWorldState, readGameData, readEventsState, mutateWorldState } from "./gameState.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { isSharedMultiplayerSession } from "../multiplayer/client/sharedGameBridge.js";
import { isSimulationBusy, enterSimulation, endSimulation } from "../Game/AI/simulationStatus.js";
import { bookProjectFinance, eligibleFinanceSource, financeReviewStamp } from "./projectFinanceWorld.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";

const assertActiveSinglePlayerCampaign = (campaignId) => {
  if (!campaignId || getLibraryState().activeGameId !== campaignId || isSharedMultiplayerSession()) {
    throw new Error("Project Finance requires the same active single-player campaign.");
  }
};

const assertWorldReady = (world) => {
  if (world?.activeInteractive || unseenEvents.unseenFor(world).size) {
    throw new Error("Finish revealing the turn or interactive scene before reviewing financing.");
  }
  if (world?.projectFundingMode === "nonmonetary") {
    throw new Error("Project Finance is unavailable in non-monetary campaigns.");
  }
};

export const captureFinanceReview = async () => {
  const campaignId = getLibraryState().activeGameId;
  assertActiveSinglePlayerCampaign(campaignId);
  if (isSimulationBusy()) throw new Error("Finish the current simulation before reviewing financing.");

  const first = await readGameData({ force: true });
  const [world, events] = await Promise.all([readWorldState({ force: true }), readEventsState({ force: true })]);
  const game = await readGameData({ force: true });
  assertActiveSinglePlayerCampaign(campaignId);
  assertWorldReady(world);

  if (isSimulationBusy() || first.round !== game.round || first.country !== game.country || first.gameDate !== game.gameDate) {
    throw new Error("Campaign changed; reopen the finance review.");
  }
  const resolve = createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor = resolve(toCountryName(game.country));
  return {
    campaignId,
    game,
    world,
    actor,
    stamp: financeReviewStamp(world, game),
    events: events.filter((event) => eligibleFinanceSource(event, actor, resolve)),
  };
};

export const commitFinanceReview = async (review, command) => {
  assertActiveSinglePlayerCampaign(review.campaignId);
  if (isSimulationBusy()) throw new Error("Finish the current simulation before confirming financing.");
  // Acquire the same simulation lock as Stats and time advancement before
  // entering the canonical queue. No model call while holding either lock.
  await enterSimulation();
  try {
    assertActiveSinglePlayerCampaign(review.campaignId);
    return await mutateWorldState(async (world) => {
      assertActiveSinglePlayerCampaign(review.campaignId);
      assertWorldReady(world);
      const [game, events] = await Promise.all([readGameData({ force: true }), readEventsState({ force: true })]);
      assertActiveSinglePlayerCampaign(review.campaignId);
      assertWorldReady(world);
      return bookProjectFinance({
        world,
        game,
        events,
        command,
        expected: review.stamp,
        shared: isSharedMultiplayerSession(),
        unseen: unseenEvents.unseenFor(world).size > 0,
      });
    });
  } finally {
    endSimulation();
  }
};
