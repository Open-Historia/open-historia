/*! Open Historia — how much one player can make the host do © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host does a shared game's work for every player: it applies their
// requests one at a time in its one queue (host/worldQueue.js), the round's
// time skip among them, keeps what they write, and asks its own AI on their
// behalf. Nothing bounded what ONE player could make it do (the review of
// 2026-11-18, security S2, S5, S8, S13):
//
//   - the session lets a player send thirty messages a second, each one valid
//     and each one a whole document rewritten and every player's view sent
//     again: a script sending its goal over and over filled the queue, the
//     round waited behind it, every other player's orders showed "waiting",
//     and a kick or a ban did not stop the backlog;
//   - a line to a new thread each time, a burst of party readings for one
//     country, every country's stat sheet at once: each a request on the
//     host's AI key, which a free tier spends in minutes, and then every round
//     failed for everyone;
//   - the advisor's conversations and the threads grew without end in
//     documents every request reads and the server holds to a size.
//
// So the host holds each player to these, every one a refusal with the host's
// reason (rule 10): what it has waiting in the queue (SEAT_WAITING_MOST) and
// how fast it may add to it or to the host's AI's thinking (QUEUE_RATE_PER_SECOND,
// QUEUE_BURST), and how fast it may send what the host answers at once
// (AT_ONCE_RATE_PER_SECOND, AT_ONCE_BURST): every request a device sends is
// held to one of the two, whichever door it comes by; what it may
// open and write a round (THREADS_PER_ROUND, LINES_PER_ROUND, FLAGS_PER_ROUND);
// how long its advisor's conversations may grow (ADVISOR_SEAT_BYTES_MOST);
// and its readings on the host's AI, one at a time (each country's once,
// whoever asks) and READINGS_WAITING_MOST at most. The host's own requests are
// its own computer's and are not held to them. What the host's AI answers each
// player a round is a number the host sets in the lobby (host/settings.js
// `answersPerRound`, `hostAnswers`; host/hostAnswers.js).
//
// In memory: an engine opened again counts afresh, which only ever gives a
// player one round's allowance twice.

// What one player may have waiting in the host's queue at once, and how many it
// may add a second (a burst of QUEUE_BURST, then QUEUE_RATE_PER_SECOND). The
// requests whose thinking is the host's AI's, outside the queue (a stat sheet,
// parties, ratings, an institution's business), are held to the same pace.
export const SEAT_WAITING_MOST = 32;
export const QUEUE_RATE_PER_SECOND = 2;
export const QUEUE_BURST = 40;
// And what a device may send of what the host answers at once, outside the
// queue: the round's own words (Ready, "I have read the round") and a paying
// device's ("canPay", "paid", "payLookup", "payAlive"). They were held to
// nothing but the session's thirty messages a second, judged by device and not
// by seat, and some make the host do work for it or tell every player (the
// follow-ups of 2026-11-18, C2). A paying device's own traffic is a handful a
// round and its lookups one at a time (host/roundPayers.js), well inside this.
// What a page says of a view ("viewed") is not counted: the host sends views at
// its own pace, and a word on one turned away would only have it sent again.
export const AT_ONCE_RATE_PER_SECOND = 10;
export const AT_ONCE_BURST = 60;
// What one player may open and write in a round: conversations, lines in them
// (and a conversation's renaming or its new members), and flag changes.
export const THREADS_PER_ROUND = 12;
export const LINES_PER_ROUND = 200;
export const FLAGS_PER_ROUND = 3;
// How long one player's advisor conversations may grow, in bytes as kept (the
// file every seat's are kept in is held to 64 MB by the server: seven guests'
// at this most leave the host's own conversation more than half of it).
export const ADVISOR_SEAT_BYTES_MOST = 4 * 1024 * 1024;
// Readings on the host's AI one player may have under way or waiting.
export const READINGS_WAITING_MOST = 6;

export const BOUND_REFUSALS = Object.freeze({
  waiting: `You have ${SEAT_WAITING_MOST} requests waiting for the host already: wait for them to be answered.`,
  rate: "Too many requests at once: wait a moment, then send it again.",
  threads: `You have opened ${THREADS_PER_ROUND} conversations this round: open another next round.`,
  lines: `You have written ${LINES_PER_ROUND} lines this round: write again next round.`,
  flags: `You have changed flags ${FLAGS_PER_ROUND} times this round: change it again next round.`,
  advisor: "Your advisor's conversations are as long as the host keeps for one player: clear one to go on.",
  readings: "The host is reading several countries for you already: open this one again when they are in.",
});
export const ROUND_LIMITS = Object.freeze({ threads: THREADS_PER_ROUND, lines: LINES_PER_ROUND, flags: FLAGS_PER_ROUND });

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();

export const createSeatBounds = ({ now = () => Date.now() } = {}) => {
  // A token bucket for each device: a burst is allowed, a stream is not.
  // Counts the request when it may be sent on.
  const bucketsOf = (burst, rate) => {
    // device → { tokens, at }
    const buckets = new Map();
    return (device) => {
      const at = now();
      const bucket = buckets.get(device) ?? { tokens: burst, at };
      bucket.tokens = Math.min(burst, bucket.tokens + ((at - bucket.at) / 1000) * rate);
      bucket.at = at;
      buckets.set(device, bucket);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    };
  };
  const queued = bucketsOf(QUEUE_BURST, QUEUE_RATE_PER_SECOND);
  const atOnce = bucketsOf(AT_ONCE_BURST, AT_ONCE_RATE_PER_SECOND);
  // `${kind}|${seat}` → { round, used }
  const counts = new Map();
  // seat → { tail, waiting }; and what is being read, by what, for everyone.
  const readers = new Map();
  const reading = new Map();

  return {
    // Whether `device` may add another entry to the queue now, or another
    // request the host's AI thinks about. Counts it when it may.
    admit: (device) => queued(device),
    // Whether `device` may send another of what the host answers at once.
    admitAtOnce: (device) => atOnce(device),
    // Whether `seat` has had all its `kind` (ROUND_LIMITS) in `round`.
    spent(kind, seat, round) {
      const entry = counts.get(`${kind}|${fold(seat)}`);
      return (entry && entry.round === round ? entry.used : 0) >= (ROUND_LIMITS[kind] ?? 0);
    },
    // One of `seat`'s `kind` in `round`, once it has been done: false when it
    // had had them all.
    take(kind, seat, round) {
      const key = `${kind}|${fold(seat)}`;
      const entry = counts.get(key);
      const used = entry && entry.round === round ? entry.used : 0;
      if (used >= (ROUND_LIMITS[kind] ?? 0)) return false;
      counts.set(key, { round, used: used + 1 });
      return true;
    },
    // A reading on the host's AI for `seat` (`key`: what, of which country):
    // the same reading already under way, for anyone, is that one; otherwise it
    // runs after the seat's earlier ones. null when the seat has `most`
    // (READINGS_WAITING_MOST) under way or waiting.
    read(seat, key, job, { most = READINGS_WAITING_MOST } = {}) {
      if (reading.has(key)) return reading.get(key);
      const who = fold(seat);
      const line = readers.get(who) ?? { tail: Promise.resolve(), waiting: 0 };
      if (line.waiting >= most) return null;
      line.waiting += 1;
      readers.set(who, line);
      const turn = line.tail.then(() => job());
      const settled = turn.then(() => {}, () => {});
      line.tail = settled;
      reading.set(key, turn);
      void settled.then(() => {
        line.waiting -= 1;
        if (reading.get(key) === turn) reading.delete(key);
        if (!line.waiting) readers.delete(who);
      });
      return turn;
    },
  };
};

// Whether a seat's advisor conversations, as a change would leave them
// (`next`), are past what the host keeps for one player, and longer than they
// were (`was`): a change that shortens them is always taken.
const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value ?? [])).length;
export const advisorPastBound = (was, next) => {
  const after = bytesOf(next);
  return after > ADVISOR_SEAT_BYTES_MOST && after > bytesOf(was);
};
