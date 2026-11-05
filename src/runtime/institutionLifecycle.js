/*! Open Historia Continuum — live institution lifecycle commit seam.
 * Provider reasoning happens elsewhere. This file performs only native,
 * journaled canonical mutations through the current Beta/Continuum turn seam.
 */

import {
  mutateCanonicalTurnState,
  normalizeChatEntry,
  normalizeChats,
  normalizeEvents,
  reconcileChatsForPlayer,
} from "./gameState.js";
import {
  advanceInstitutionLifecycleCore,
  applyInstitutionLifecycleChatBatchCore,
  applyInstitutionLifecycleCommandCore,
  applyInstitutionLifecycleImpactBatchCore,
  buildInstitutionLifecycleDecisionContext,
  institutionLifecycleCasesForPolity,
  institutionLifecycleConversationState,
  institutionPortfolioForPolity,
  ensureInstitutionLifecycleNegotiationChatCore,
} from "./institutionLifecycleCore.js";

export {
  advanceInstitutionLifecycleCore,
  applyInstitutionLifecycleChatBatchCore,
  applyInstitutionLifecycleCommandCore,
  applyInstitutionLifecycleImpactBatchCore,
  buildInstitutionLifecycleDecisionContext,
  institutionLifecycleCasesForPolity,
  institutionLifecycleConversationState,
  institutionPortfolioForPolity,
  ensureInstitutionLifecycleNegotiationChatCore,
};

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => Array.isArray(value) ? value : [];

export const commitInstitutionLifecycleCommand = async ({
  playerCountry = "", date = "", expectedGameId = "", command = {},
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    const player = playerCountry || game?.country || "";
    const moment = date || game?.gameDate || game?.startDate || "";
    result = applyInstitutionLifecycleCommandCore({
      world,
      chats: normalizeChats(chats),
      events: normalizeEvents(events),
      playerCountry: player,
      date: moment,
      command: { ...command, authority: command?.authority || "player" },
    });
    const nextChats = reconcileChatsForPlayer(normalizeChats(result.chats), result.world, player);
    return { world: result.world, chats: nextChats, events: normalizeEvents(result.events) };
  }, { expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institution lifecycle command was not committed.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world,
    chats: committedChats,
    events: committed.events || result.events,
    createdChat: result.createdChat
      ? list(committedChats).find((chat) => clean(chat?.id) === clean(result.createdChat?.id)) || result.createdChat
      : null,
  };
};


export const ensureInstitutionLifecycleNegotiationChat = async ({
  institutionId = "", caseIds = [], playerCountry = "", date = "", expectedGameId = "",
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, game }) => {
    const player = playerCountry || game?.country || "";
    const moment = date || game?.gameDate || game?.startDate || "";
    result = ensureInstitutionLifecycleNegotiationChatCore({
      world,
      chats: normalizeChats(chats),
      institutionId,
      caseIds,
      playerCountry: player,
      date: moment,
    });
    const nextChats = reconcileChatsForPlayer(normalizeChats(result.chats), result.world, player);
    result = { ...result, chats: nextChats };
    return { world: result.world, chats: nextChats };
  }, { expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institution lifecycle negotiation was not opened.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world || result.world,
    chats: committedChats,
    channel: list(committedChats).find((chat) => clean(chat?.id) === clean(result.channel?.id)) || result.channel || null,
  };
};

export const commitInstitutionLifecycleChatBatch = async ({
  chatId = "", institutionId = "", lifecycleCaseIds = [], playerCountry = "", date = "",
  chatEvents = [], lifecycleActions = [], cursors = null, expectedGameId = "",
} = {}) => {
  let result = null;
  const committed = await mutateCanonicalTurnState(({ world, chats, events, game }) => {
    const player = playerCountry || game?.country || "";
    const moment = date || game?.gameDate || game?.startDate || "";
    let nextChats = normalizeChats(chats).map((chat) => {
      if (clean(chat?.id) !== clean(chatId)) return chat;
      const mergedEvents = [...list(chat.events), ...list(chatEvents)];
      return normalizeChatEntry({
        ...chat,
        lifecycleInstitutionId: institutionId || chat.lifecycleInstitutionId,
        lifecycleCaseIds: lifecycleCaseIds?.length ? lifecycleCaseIds : chat.lifecycleCaseIds,
        events: mergedEvents,
      }) || chat;
    });
    result = applyInstitutionLifecycleChatBatchCore({
      world,
      chats: nextChats,
      events: normalizeEvents(events),
      playerCountry: player,
      date: moment,
      institutionId,
      lifecycleActions,
    });
    let nextWorld = result.world;
    if (cursors && typeof cursors === "object" && Object.keys(cursors).length) {
      nextWorld = { ...nextWorld, chatKnowledgeCursors: { ...(nextWorld.chatKnowledgeCursors || {}), ...cursors } };
    }
    nextChats = reconcileChatsForPlayer(normalizeChats(result.chats), nextWorld, player);
    result = { ...result, world: nextWorld, chats: nextChats };
    return { world: nextWorld, chats: nextChats, events: normalizeEvents(result.events) };
  }, { expectedGameId });
  if (!result || committed?.skipped) throw new Error("Institution lifecycle chat turn was not committed.");
  const committedChats = committed.chat || committed.chats || result.chats;
  return {
    ...result,
    world: committed.world,
    chats: committedChats,
    events: committed.events || result.events,
    channel: list(committedChats).find((chat) => clean(chat?.id) === clean(chatId)) || null,
  };
};
