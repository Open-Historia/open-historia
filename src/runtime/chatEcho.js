/*! Open Historia — unprompted-note echo guard © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Why this exists: the idle-diplomacy note is generated from a one-line-per-chat
// SUMMARY, whose last entry for a thread is often the player's own message. Asked
// for an opening note, a model handed "China: France: We think you suck!" has
// repeated the player's line straight back as China's — the note is then appended
// to that very thread, so the player watches a country parrot them. The prompt
// already says never to repeat a note already visible; that is advice, and this is
// the check.
//
// Pure and dependency-free on purpose, like eventDedup.js: it is unit-tested
// directly, without the browser-only asset layer gameplay.js pulls in.

// Lowercased, punctuation and whitespace flattened, so "We think you suck!" and
// "we think you suck" collide while genuinely different sentences do not.
const norm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// True when `text` says the same thing as something already in the thread.
//
// Exact match after normalization, plus containment in EITHER direction, which is
// what catches the real failure: a model that echoes the player's line verbatim
// and then tacks on a clause. Anything shorter than a few characters is ignored —
// "ok" or "no" legitimately recur in a conversation and must not block a note.
export const echoesExistingMessage = (text, messages, { minLength = 12 } = {}) => {
  const candidate = norm(text);
  if (candidate.length < minLength) return false;
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const existing = norm(message?.text);
    if (existing.length < minLength) return false;
    return existing === candidate || existing.includes(candidate) || candidate.includes(existing);
  });
};

// The last few exchanges of one chat, rendered for a prompt: who said it and what
// they said, oldest first. The player is labelled by their polity name like every
// other speaker, so the model is never guessing which side a line came from —
// which is the ambiguity that produced the echo in the first place.
export const renderChatForPrompt = (chat, { messageLimit = 8 } = {}) => {
  const countries = (Array.isArray(chat?.countries) ? chat.countries : [])
    .map((country) => String(country?.name ?? "").trim())
    .filter(Boolean);
  const messages = (Array.isArray(chat?.messages) ? chat.messages : []).slice(-messageLimit);
  const lines = messages.map((message) => {
    const speaker = String(message?.speaker ?? "").trim() || (message?.role === "user" ? "the player" : "unknown");
    return `  ${speaker}: ${String(message?.text ?? "").trim()}`;
  });
  return [
    `With ${countries.join(", ") || "an unnamed polity"}:`,
    lines.length ? lines.join("\n") : "  (no messages yet)",
  ].join("\n");
};

// Every open conversation, most recently updated last, for the idle-diplomacy
// prompt. Capped so a long campaign cannot crowd out the rest of the prompt.
export const renderOpenChatsForPrompt = (chats, { limit = 5, messageLimit = 8 } = {}) => {
  const open = (Array.isArray(chats) ? chats : []).filter((chat) => chat?.status !== "closed");
  if (open.length === 0) return "There are no open conversations with the player.";
  return open.slice(-limit).map((chat) => renderChatForPrompt(chat, { messageLimit })).join("\n\n");
};
