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

// The longest id of an advisor's drafted letter a line may carry (game/messages.js "say" `fromDraft`).
export const SAY_FROM_DRAFT_MAX = 160;

// What a line said in `chat` asks of the host: a pending thread is opened with
// its countries, any other is written into by its id. `fromDraft`: the id of
// the advisor's drafted letter the line was sent from (GameUI/advisorDrafts.js),
// which the host keeps on the line.
export const sayRequestFor = (chat, text, { fromDraft = "" } = {}) => {
  const draft = clean(fromDraft).slice(0, SAY_FROM_DRAFT_MAX);
  return {
    ...(isPendingSharedThread(chat)
      ? { thread: null, to: (Array.isArray(chat.countries) ? chat.countries : []).map(nameOf).filter(Boolean).slice(0, SAY_RECIPIENTS_MAX), text }
      : { thread: clean(chat?.id), to: [], text }),
    ...(draft ? { fromDraft: draft } : {}),
  };
};

// The thread the host opened for a pending one, from the answer to its first
// line (the ack's `result`), or "" when the host did not say (a host from
// before it did).
export const openedThreadOf = (answer) => clean(answer?.result?.chatId);

// What the screen does once the host has answered a line said in `chat`. The
// composer stays shut from the line until this answer (and, for a pending
// thread the host opened, until the thread itself arrives): a second line typed
// before the ack opened a second thread on the host, and every further one
// another.
// - "refused": say `error`; the composer opens again.
// - "said": a thread the host keeps took it; the composer opens again.
// - "follow": a pending thread the host opened as `thread`; wait for it in the view.
// - "leave": a pending thread the host did not name (a host from before it did);
//   back to the list, where it arrives.
export const afterSharedSay = (chat, answer) => {
  if (!answer?.ok) return { kind: "refused", error: clean(answer?.error) };
  if (!isPendingSharedThread(chat)) return { kind: "said" };
  const thread = openedThreadOf(answer);
  return thread ? { kind: "follow", thread } : { kind: "leave" };
};

// How long a pending thread waits for the host's view to bring the thread it
// opened before the screen gives up on it and goes back to the list.
export const SHARED_THREAD_FOLLOW_MS = 20_000;

// A thread to follow, from the ack that named it.
export const followSharedThread = (thread, { now = Date.now, waitMs = SHARED_THREAD_FOLLOW_MS } = {}) => (clean(thread)
  ? { thread: clean(thread), until: now() + waitMs }
  : null);

// One step of following `follow` ({ thread, until }) while `activeChat` is on
// screen and `chats` are the threads the view holds:
// - "none": nothing to follow;
// - "drop": the player left the pending thread; stop following;
// - "open": the view holds it; open `chat`;
// - "wait": not there yet; look again within `delayMs` (sooner when the view changes);
// - "late": it never came in time; back to the list with a word why.
export const sharedFollowStep = (follow, { activeChat, chats = [], now = Date.now } = {}) => {
  if (!follow?.thread) return { kind: "none" };
  if (!isPendingSharedThread(activeChat)) return { kind: "drop" };
  const chat = (Array.isArray(chats) ? chats : []).find((entry) => entry != null && clean(entry.id) === follow.thread);
  if (chat) return { kind: "open", chat };
  const delayMs = Number(follow.until) - now();
  return delayMs > 0 ? { kind: "wait", delayMs } : { kind: "late" };
};
