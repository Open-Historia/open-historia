/*! Open Historia — a player's orders in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An order a screen queues in a shared game is the host's to keep (the
// "order" request, game/messages.js). It went as its words alone: the host gave
// it a new id, so the screen that sent it could never find it again (an AI
// suggestion's card never said it was queued, and a second press queued it
// twice), an advisor's proposal could not be approved at all, and an order that
// opens a conversation lost whom it invites and its opening line. It now goes
// as the panel would have saved it.

import { ORDER_ID_MAX, ORDER_MAX_CHARS, ORDER_TITLE_MAX } from "../game/messages.js";
import { SAY_RECIPIENTS_MAX } from "./sharedThreads.js";

const ORDER_SOURCES = new Set(["manual", "suggested", "advisor"]);
const text = (value) => (typeof value === "string" ? value.trim() : "");

// The "order" request for an order as the page made it (runtime/gameState.js
// normalizeActionEntry): its own id, title and source, and a conversation it
// opens. `typed`: the words, when the order has none of its own.
//
// The words go whole. They were cut to the request's limit (ORDER_MAX_CHARS)
// without a word, and the screen cleared its box once the host took what was
// left: the rest of the order was gone. One longer than a request carries is
// refused, in words, and stays in its box (client/gameClient.js); the box holds
// the same limit (`maxLength`). A title is the order's label, cut as the game
// cuts one.
export const orderRequestFor = (action, typed = "") => {
  const words = text(action?.text) || text(action?.title) || text(typed);
  const id = text(action?.id);
  const title = text(action?.title);
  const chat = action?.kind === "chat";
  return {
    text: words,
    ...(id ? { ref: id.slice(0, ORDER_ID_MAX) } : {}),
    ...(title ? { title: title.slice(0, ORDER_TITLE_MAX) } : {}),
    ...(ORDER_SOURCES.has(action?.source) ? { source: action.source } : {}),
    ...(chat ? {
      kind: "chat",
      invitees: (Array.isArray(action.invitees) ? action.invitees : []).map(text).filter(Boolean).slice(0, SAY_RECIPIENTS_MAX),
      chatStarter: text(action.chatStarter),
    } : {}),
  };
};

// The "reword" request for a queued order the player edited (GameUI/actions.jsx):
// the order by its id, and the parts given, each held to what the request
// takes. The host changes the order as single player does (runtime/actionEdit.js
// rewordAction), so a part not given stays as it was and a typed order's title
// follows its words. Null for an order with no id: there is nothing to name.
export const rewordRequestFor = (action, { title, text: words, chatStarter } = {}) => {
  const order = text(action?.id).slice(0, ORDER_ID_MAX);
  if (!order) return null;
  const named = text(title).slice(0, ORDER_TITLE_MAX);
  const body = text(words);
  const opening = action?.kind === "chat" ? text(chatStarter) : "";
  return {
    order,
    ...(named ? { title: named } : {}),
    ...(body ? { text: body } : {}),
    ...(opening ? { chatStarter: opening } : {}),
  };
};
