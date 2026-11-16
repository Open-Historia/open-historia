/*! Open Historia — persisted diplomatic inbox activity ordering. */
// The in-game message date is history, not a sequence number: several letters
// may arrive on one day. A thread's ordinal advances only on real activity;
// old saves without ordinals retain a date-based, stable fallback ordering.
import { compareGameDatesNewestFirst, isGameDate } from "./gameDates.js";

export const chatActivityOrdinal = (chat) => {
  const n = chat?.activityOrdinal;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

export const nextChatActivityOrdinal = (chats) =>
  Math.max(0, ...(Array.isArray(chats) ? chats : []).map(chatActivityOrdinal)) + 1;

const lastValidMessageDay = (chat) => {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const time = String(messages[i]?.time || "").trim();
    if (isGameDate(time)) return time;
  }
  return "";
};

export const sortChatsForInbox = (chats) => (Array.isArray(chats) ? chats : [])
  .map((chat, index) => ({ chat, index, ordinal: chatActivityOrdinal(chat), day: lastValidMessageDay(chat) }))
  .sort((a, b) => {
    if (a.ordinal || b.ordinal) return b.ordinal - a.ordinal || a.index - b.index;
    if (!a.day && !b.day) return a.index - b.index;
    if (!a.day) return a.chat?.messages?.length ? 1 : -1;
    if (!b.day) return b.chat?.messages?.length ? -1 : 1;
    return compareGameDatesNewestFirst(a.day, b.day) || a.index - b.index;
  })
  .map(({ chat }) => chat);

// While a reader scrolls through older correspondence, retain the displayed
// row identities in their current positions. Updates still replace each row's
// content; newly arriving chats wait at the end until "Latest" is requested.
export const holdChatsInListOrder = (chats, previousIds) => {
  const rows = Array.isArray(chats) ? chats : [];
  const ids = Array.isArray(previousIds) ? previousIds.map(String) : [];
  const byId = new Map(rows.map((chat) => [String(chat?.id), chat]));
  const held = new Set(ids);
  return [
    ...ids.map((id) => byId.get(id)).filter(Boolean),
    ...rows.filter((chat) => !held.has(String(chat?.id))),
  ];
};

// Store subscriptions must detect new ordinals even when dates or message
// counts are unchanged (e.g. when another writer replays a same-day thread).
// Keep this a cheap projection: do not concatenate entire long correspondence.
export const chatInboxSignature = (chats) => (Array.isArray(chats) ? chats : [])
  .map((chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const last = messages.at(-1);
    return [
      chat?.id, chat?.status, chat?.title, messages.length,
      chatActivityOrdinal(chat), last?.id, last?.time, last?.text?.length,
      (chat?.countries || []).map((country) => country?.code || country?.name).join(","),
    ].join(":");
  })
  .join("|");

// Used only when the message count actually increases. Reactions, read flags,
// previews and storage refreshes must not reorder a conversation.
export const promoteChatActivity = (chats, id, messages) => {
  const list = Array.isArray(chats) ? chats : [];
  const index = list.findIndex((chat) => String(chat.id) === String(id));
  if (index < 0) return list;
  const original = list[index];
  const changed = Array.isArray(messages) && messages.length > (original.messages?.length ?? 0);
  const update = { ...original, messages: Array.isArray(messages) ? messages : original.messages,
    ...(changed ? { activityOrdinal: nextChatActivityOrdinal(list) } : {}) };
  const result = [...list];
  result[index] = update;
  return changed ? [update, ...result.slice(0, index), ...result.slice(index + 1)] : result;
};
