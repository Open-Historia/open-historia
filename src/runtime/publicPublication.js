/*! Open Historia - player-confirmed publication, no AI write path. AGPL-3.0-or-later. */
import { readGameData, readWorldState, readAdvisorMessages, mutateCanonicalTurnState } from "./gameState.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { isSharedMultiplayerSession } from "../multiplayer/client/sharedGameBridge.js";
import { isSimulationBusy, enterSimulation, endSimulation } from "../Game/AI/simulationStatus.js";
import { parseAdvisorReply } from "../Game/GameUI/advisorReply.js";
import {
  planPublicPublication,
  planPublicCancellation,
  findPublicDraftReply,
  publicIssuer,
  publicIssuerOptions,
  publicAudienceOptions,
  normalizePublicDraft,
} from "./publicCommunications.js";

const assertSinglePlayerReady = (campaignId, world) => {
  if (!campaignId || getLibraryState().activeGameId !== campaignId || isSharedMultiplayerSession()) {
    throw new Error("Public statements currently require the same single-player campaign.");
  }
  if (world.activeInteractive || unseenEvents.unseenFor(world).size) {
    throw new Error("Finish the current scene or event reveal first.");
  }
};

export const capturePublicReview = async () => {
  const campaignId = getLibraryState().activeGameId;
  if (isSimulationBusy()) throw new Error("Finish the current simulation first.");
  const game = await readGameData({ force: true });
  const world = await readWorldState({ force: true });
  const latest = await readGameData({ force: true });
  assertSinglePlayerReady(campaignId, world);
  if (isSimulationBusy() || latest.round !== game.round || latest.gameDate !== game.gameDate || latest.country !== game.country) {
    throw new Error("Campaign changed; reopen the statement.");
  }
  return {
    campaignId,
    expected: { country: game.country, date: game.gameDate, round: game.round },
    ...publicIssuer(world, game),
    ...publicIssuerOptions(world, game),
    ...publicAudienceOptions(world),
  };
};

export const commitPublicReview = async ({ review, draft, draftId, threadId, replyId, index = -1, confirmed }) => {
  if (!replyId) throw new Error("A saved advisor draft is required.");
  if (isSimulationBusy()) throw new Error("Finish the current simulation first.");
  await enterSimulation();
  try {
    return await mutateCanonicalTurnState(async (current) => {
      assertSinglePlayerReady(review.campaignId, current.world);
      const saved = findPublicDraftReply(await readAdvisorMessages({ force: true }), threadId, replyId);
      if (!parseAdvisorReply(saved.text).publicDrafts?.[index] || draftId !== `${replyId}:public:${index}`) {
        throw new Error("The saved advisor draft is no longer available.");
      }
      const selectedIssuerId = draft.issuerId || review.defaultIssuerId;
      const issuer = publicIssuer(current.world, current.game, selectedIssuerId);
      if (issuer.polity !== review.polity || issuer.issuer !== review.issuers.find((entry) => entry.id === selectedIssuerId)?.label) {
        throw new Error("Issuing government changed; reopen the statement.");
      }
      if (
        selectedIssuerId !== review.selectedIssuerId
        || !review.approvedDraft
        || JSON.stringify(normalizePublicDraft({ ...draft, issuerId: selectedIssuerId })) !== JSON.stringify(review.approvedDraft)
      ) {
        throw new Error("Confirm the exact statement again.");
      }
      const { kind, target } = draft.audience;
      if (kind === "foreign-public" || kind === "institution") {
        const fresh = publicAudienceOptions(current.world);
        const key = kind === "institution" ? "institutions" : "polities";
        const previousOption = review[key].find((row) => row.id === target);
        const currentOption = fresh[key].find((row) => row.id === target);
        if (!previousOption || !currentOption || previousOption.label !== currentOption.label) {
          throw new Error("The public audience changed; review the statement again.");
        }
      }
      return planPublicPublication({
        ...current,
        expected: review.expected,
        draft: { ...draft, issuerId: selectedIssuerId },
        draftId,
        confirmed,
      });
    }, { expectedGameId: review.campaignId });
  } finally {
    endSimulation();
  }
};

export const cancelPublicReview = async ({ campaignId, expected, draftId, threadId, replyId, index }) => {
  if (!replyId || isSimulationBusy()) throw new Error("Finish the current simulation before cancelling.");
  await enterSimulation();
  try {
    return await mutateCanonicalTurnState(async (current) => {
      assertSinglePlayerReady(campaignId, current.world);
      const saved = findPublicDraftReply(await readAdvisorMessages({ force: true }), threadId, replyId);
      if (!parseAdvisorReply(saved.text).publicDrafts?.[index] || draftId !== `${replyId}:public:${index}`) {
        throw new Error("The saved advisor draft is no longer available.");
      }
      return planPublicCancellation({ ...current, draftId, expected, confirmed: true });
    }, { expectedGameId: campaignId });
  } finally {
    endSimulation();
  }
};
