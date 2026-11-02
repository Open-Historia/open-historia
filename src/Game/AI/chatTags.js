/*! Open Historia — who a player's chat message tags © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player tags a member of a group conversation with @ and its name (the tag
// chips in GameUI/chat.jsx); the members tagged answer (gameplay.js
// runChatActionBatch). A tag is the member's whole, exact name: "@Niger" does
// not tag Nigeria, and "@Nigeria" does not tag Niger.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether the message tags this member.
export const chatMessageTags = (message, name) => {
  const tag = clean(name);
  if (typeof message !== "string" || !tag) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])@${escapeForRegExp(tag)}(?![\\p{L}\\p{N}])`, "iu").test(message);
};
