/*! Open Historia — the conversation the player has open © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The diplomatic thread on screen in the Diplomacy panel (GameUI/chat.jsx), or
// "" when none is. A time skip reads it so that the conversation the player is
// in the middle of is never put away among the older ones
// (Game/AI/chatArchive.js), however long ago its last word was.
//
// The last thread shown stays named after the panel closes: a player who
// closes the panel and skips is still in that conversation.

let openId = "";

export const setOpenConversation = (chatId) => {
  const id = String(chatId ?? "").trim();
  if (id) openId = id;
};

export const openConversationId = () => openId;

// Tests, and a game switched (the last game's thread means nothing in this one).
export const clearOpenConversation = () => {
  openId = "";
};
