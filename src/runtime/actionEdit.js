/*! Open Historia — a queued order given other words © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A queued order can be given other words: by the player, with Edit in the
// Actions panel (GameUI/actions.jsx), by the advisor, whose proposal the player
// approves (GameUI/advisorBlocks.js planAdvisorActionEdits), and in a shared
// game by the host, which keeps every player's orders (the "reword" request,
// multiplayer/host/gameHost.js). All three change an order here, so an order
// reads the same however it was changed.
//
// An order keeps everything that is not its words: its id, its place in the
// queue, where it came from, a troop order's way back on the map (unitRevert),
// whom a conversation it opens invites, an overdue mark. What was only DERIVED
// from its words when it was queued follows the new words:
//   - `rawInput`, the words as the player gave them, which the event and
//     archive lookups read before `text` (AI/relatedEvents.js, chatArchive.js).
//     Left as it was, an edited order was looked up by words it no longer had;
//   - the title of an order that has none of its own: a typed order's title is
//     its words, whole (the Actions panel) or cut short (the shared game's
//     host, gameState.js normalizeActionEntry), and kept, it named the old
//     order. It is made from the new words the same way it was made from the
//     old. A title of its own (an AI suggestion's, the advisor's) is kept
//     unless a new one is given.
// Nothing else is drawn from an order's words when it is queued: a typed order
// is queued as typed, and Improve only rewrites the words in the box before
// they are sent. So there is nothing to work out again from the new words, and
// nothing here reads them for meaning.
//
// Import-free, so the host and the tests use it without the runtime.

// How an order with no title of its own is titled: its words, cut at 64
// characters (gameState.js normalizeActionEntry, the host's "order").
export const titleFromWords = (words) => {
  const text = typeof words === "string" ? words.trim() : "";
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
};

const clean = (value) => (typeof value === "string" ? value.trim() : "");

// Whether the order's title is its own rather than its words cut short.
export const hasOwnTitle = (action) => {
  const title = clean(action?.title);
  if (!title) return false;
  const words = [clean(action?.text), clean(action?.rawInput)].filter(Boolean);
  return !words.some((text) => title === text || title === titleFromWords(text));
};

// Whether a title made from the order's words took them whole.
const wholeWordsTitle = (action) => {
  const title = clean(action?.title);
  return [clean(action?.text), clean(action?.rawInput)].includes(title);
};

// The order with other words. `title`, `text` and `chatStarter` (the opening
// line of a conversation the order opens) are each changed only when given;
// an empty one leaves that part as it was. A new opening line is for an order
// that opens a conversation only. Returns the order itself when nothing
// changed.
export const rewordAction = (action, { title, text, chatStarter } = {}) => {
  if (!action || typeof action !== "object") return action;
  const words = clean(text);
  const named = clean(title);
  const opening = action.kind === "chat" ? clean(chatStarter) : "";
  const next = { ...action };
  if (words) {
    next.text = words;
    next.rawInput = words;
  }
  if (named) next.title = named;
  else if (words && !hasOwnTitle(action)) next.title = wholeWordsTitle(action) ? words : titleFromWords(words);
  if (opening) next.chatStarter = opening;
  const changed = ["text", "rawInput", "title", "chatStarter"].some((key) => next[key] !== action[key]);
  return changed ? next : action;
};

// Why an order cannot be edited now, in the player's words, or "" when it can.
//   - one a time skip already carried out keeps its outcome;
//   - while a time skip runs, the orders it is carrying out are in its hands:
//     words changed then would be marked carried out with the old ones' outcome;
//   - in a shared game an order is changed through the host, while the host
//     takes changes at once: not while it resolves a round (the request would
//     wait for the round, and the order be carried out as it was), nor before
//     the game has begun. `roundPhase` is the host's round's (host/round.js).
export const ORDER_CARRIED_OUT_NOTE = "A time skip carried this order out, so it can no longer be edited.";
export const ORDER_EDIT_TURN_NOTE = "A time skip is running. Orders can be edited once it ends.";
export const ORDER_EDIT_ROUND_NOTE = "The round is being resolved. Orders can be edited once it lands.";

const ROUND_PHASES_TAKING_ORDERS = new Set(["planning", "countdown", "revealing"]);
export const roundTakesOrderChanges = (phase) => ROUND_PHASES_TAKING_ORDERS.has(clean(phase));

export const orderEditBlock = (action, { turnRunning = false, sharedGame = false, roundPhase = "" } = {}) => {
  if (clean(action?.status || "planned") !== "planned") return ORDER_CARRIED_OUT_NOTE;
  if (sharedGame) return roundTakesOrderChanges(roundPhase) ? "" : ORDER_EDIT_ROUND_NOTE;
  return turnRunning ? ORDER_EDIT_TURN_NOTE : "";
};
