/*! Open Historia — a player's diplomatic threads in a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game the host keeps every thread (host/gameHost.js "say"), so a
// thread a player's screen opens is nothing until its first line reaches the
// host: the host opens it then, for the player's own country, and the thread
// comes back in the player's next view. Until then the screen holds a PENDING
// thread of its own, which is never saved and never named to the host by its
// id. A thread the screen made up and named by its id was refused ("You are
// not in that conversation"): that was every thread a guest began from a
// country's panel, the map, the advisor or the War Room, since a guest has no
// thread of its own to fall back on.
//
// Import-free: plain data in and out, tested under bare node.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const nameOf = (country) => clean(typeof country === "object" && country ? country.name ?? country.code : country);

// The most countries one line may open a thread with (game/messages.js "say" `to`).
export const SAY_RECIPIENTS_MAX = 8;

// A thread with `countries` that the host has not opened yet.
export const pendingSharedThread = (countries, { now = Date.now } = {}) => ({
  id: `pending-${now()}`,
  countries: (Array.isArray(countries) ? countries : []).filter((country) => nameOf(country)),
  messages: [],
  status: "open",
  pendingShared: true,
});

export const isPendingSharedThread = (chat) => Boolean(chat?.pendingShared);

// What a line said in `chat` asks of the host: a pending thread is opened with
// its countries, any other is written into by its id.
export const sayRequestFor = (chat, text) => (isPendingSharedThread(chat)
  ? { thread: null, to: (Array.isArray(chat.countries) ? chat.countries : []).map(nameOf).filter(Boolean).slice(0, SAY_RECIPIENTS_MAX), text }
  : { thread: clean(chat?.id), to: [], text });

// The thread the host opened for a pending one, from the answer to its first
// line (the ack's `result`), or "" when the host did not say (a host from
// before it did).
export const openedThreadOf = (answer) => clean(answer?.result?.chatId);
