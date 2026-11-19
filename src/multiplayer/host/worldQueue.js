/*! Open Historia — the one order a shared game's changes are applied in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every change to a shared game is one entry here, applied one at a time, in
// the order it came: a player's request, an AI government's answer being
// written, an institution's business, a seat taken or left, and the round's
// own time skip, which is an entry like any other and simply a long one.
//
// So nothing is ever applied between a round's reading of the world and its
// saving of it. Before, the skip read the world, worked for a minute or more,
// then saved what it had read: a player joining or leaving, a fortified line,
// a peace accepted in a chat or a letter between people written meanwhile was
// overwritten, after an "ok". The handlers each checked "is a round being
// resolved?" on their way in, and refused; whatever was already under way
// when the round began was not checked again. Whatever arrives while a round
// is resolved now waits here and is applied straight after it, as the next
// round's.
//
// An entry that needs the AI does its thinking outside, and only its writing
// is an entry (engineMain.js tableTurn): a model's minute never holds up the
// other players' requests.
//
// Runtime-free, so the host's tests drive it as the engine does.

// `label`: an identifier for what an entry is ("round", "who-plays-what", a
// request's type), for the host's log; never words a player reads.
//
// An entry may name whose it is (`owner`: a player's device, for the requests
// it sent). The host counts what each one has waiting (waitingOf), so that one
// player cannot fill the one queue every other player and the round wait in
// (host/seatBounds.js), and drops what a player it let go still had waiting
// (drop): before, a kicked or banned player's backlog still ran, under the
// country it no longer played, and the kick's own cleaning waited behind it
// (the review of 2026-11-18, security S2).
export const DROPPED = "dropped";

// One entry at a time, always. An entry that runs long held every entry behind
// it, silently: the owner's "Start the game" waited behind one and nothing
// happened, with nothing said (2026-11-18). For a while the queue then passed
// over an entry after three minutes and applied what waited behind it; the
// entry passed over still held the game's lock and its place in the game's
// write chain, and two entries wrote at once (a request's write was marked as
// another's: the review of 2026-11-19, F1 and F2). Never again: the next entry
// begins when the one before it has ended, whatever happens.
//
// What makes an entry run long is removed where it is (an entry never waits on
// the game's lock, the queue is the lock; slow work is done before the entry,
// and only its commit is in it: gameplay.js statsWrite, engineMain.js). What
// is left is said and bounded:
//   - an entry that has run SLOW_MS is said (`onSlow`, every SLOW_MS while it
//     runs: what it is, for how long, and how many wait behind it), for the
//     host's log and the host's screen; the round, long by nature (`long`
//     labels), is said as `long`, which is no problem: the round bar says what
//     it does, and it has its own cancel and its own bounds on a silent AI
//     (host/round.js);
//   - an entry that has run ENTRY_MOST_MS fails: its promise rejects with
//     OVERDUE (the requester is answered with that reason), `onOverdue` tells
//     the host, and the entry's `signal` is aborted, so whatever it would still
//     write is refused (guardedStore). What waits behind it still waits until
//     it has ended: nothing is ever written beside it.
export const SLOW_MS = 20_000;
export const ENTRY_MOST_MS = 120_000;
export const OVERDUE = "overdue";
export const OVERDUE_WORDS = "The host's game took too long to apply this, and stopped: it was not applied.";
const LONG_LABELS = Object.freeze(["round"]);

export const createWorldQueue = ({
  onSettled = () => {},
  onSlow = () => {},
  onOverdue = () => {},
  slowMs = SLOW_MS,
  mostMs = ENTRY_MOST_MS,
  long = LONG_LABELS,
  timers = globalThis,
  now = () => Date.now(),
} = {}) => {
  let tail = Promise.resolve();
  let running = "";
  let runningSince = 0;
  let overdue = false;
  let waiting = 0;
  // owner → the entries of theirs still waiting, each { dropped }.
  const owned = new Map();
  const longLabels = new Set(long);

  // Applies `fn({ signal })` when its turn comes; resolves or rejects with what
  // it did. An entry that fails does not stop the ones after it. One dropped
  // while it waited rejects, its error's `code` DROPPED and its message the
  // reason, without being applied. One that runs past ENTRY_MOST_MS rejects
  // with `code` OVERDUE, and `signal` is aborted with that error.
  const run = (label, fn, { owner = "" } = {}) => {
    waiting += 1;
    const ticket = { dropped: "" };
    if (owner) {
      if (!owned.has(owner)) owned.set(owner, new Set());
      owned.get(owner).add(ticket);
    }
    // The queue moves on when the entry's work has ended: never before.
    let release = () => {};
    const released = new Promise((resolve) => { release = resolve; });
    const entry = tail.then(() => {
      waiting -= 1;
      if (owner) {
        owned.get(owner)?.delete(ticket);
        if (!owned.get(owner)?.size) owned.delete(owner);
      }
      if (ticket.dropped) {
        release();
        throw Object.assign(new Error(ticket.dropped), { code: DROPPED });
      }
      const name = String(label || "a change");
      const isLong = longLabels.has(name);
      const started = now();
      const controller = new AbortController();
      let ended = false;
      let late = () => {};
      const lateness = new Promise((_resolve, reject) => { late = reject; });
      running = name;
      runningSince = started;
      overdue = false;
      const watch = timers.setInterval(() => {
        if (ended) return;
        const ms = now() - started;
        try { onSlow({ label: name, ms, waiting, long: isLong }); } catch { /* the watch never breaks the queue */ }
        if (isLong || overdue || ms < mostMs) return;
        overdue = true;
        const reason = Object.assign(new Error(OVERDUE_WORDS), { code: OVERDUE });
        try { onOverdue({ label: name, ms, waiting }); } catch { /* as above */ }
        controller.abort(reason);
        late(reason);
      }, slowMs);
      const work = Promise.resolve().then(() => fn({ signal: controller.signal }));
      void work.then(() => {}, () => {}).then(() => {
        ended = true;
        timers.clearInterval(watch);
        running = "";
        runningSince = 0;
        overdue = false;
        try { onSettled(name); } catch { /* as above */ }
        release();
      });
      return Promise.race([work, lateness]);
    });
    tail = released;
    return entry;
  };

  return {
    run,
    // How many entries of `owner`'s are waiting (the one being applied not among them).
    waitingOf: (owner) => owned.get(owner)?.size ?? 0,
    // Every entry of `owner`'s still waiting is not applied: each rejects with
    // `reason` when its turn comes. Returns how many there were.
    drop(owner, reason = "This was not applied.") {
      const tickets = owned.get(owner);
      if (!tickets) return 0;
      for (const ticket of tickets) ticket.dropped = String(reason);
      return tickets.size;
    },
    // What is being applied now ("" for nothing), and how many wait behind it.
    get running() {
      return running;
    },
    // Whether the entry being applied has run past its bound (and been failed).
    get overdue() {
      return overdue;
    },
    // How long the entry being applied has run, in ms (0 for none).
    runningFor: () => (running ? Math.max(0, now() - runningSince) : 0),
    get waiting() {
      return waiting;
    },
    // Settles once everything asked so far has been applied.
    settled: () => tail,
  };
};

// The store an entry writes through, refusing a write while the entry being
// applied is overdue: it was failed, its requester told it was not applied,
// and nothing of it may land after that. Reads, and the session's own record
// (no document of the game, written outside the entries), pass as ever.
const UNGUARDED = new Set(["read", "readShared", "writeShared"]);
export const guardedStore = (store, isOverdue) => {
  const guarded = { ...store };
  for (const [key, value] of Object.entries(store ?? {})) {
    if (typeof value !== "function" || UNGUARDED.has(key)) continue;
    guarded[key] = (...args) => (isOverdue()
      ? Promise.reject(Object.assign(new Error(OVERDUE_WORDS), { code: OVERDUE }))
      : value(...args));
  }
  return guarded;
};
