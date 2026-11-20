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

// One entry at a time, always, and an entry that never ends holds nobody.
//
// The history. An entry that ran long held every entry behind it, silently:
// the owner's "Start the game" waited behind one and nothing happened, with
// nothing said (2026-11-18). For a while the queue then passed over an entry
// after three minutes and applied what waited behind it; the entry passed over
// still held the game's lock and its place in the game's write chain, and
// went on writing beside the next one (a request's write was marked as
// another's: the review of 2026-11-19, F1 and F2). So that was taken out, and
// an entry failed at its bound was refused its writes by a flag of the
// queue's ("is the entry being applied overdue?") while the queue waited for
// its work to end. Waiting bounded nothing: an entry whose work never ended (a
// save the game's server never answered, a promise nobody kept) held Start,
// every request and every seat for good. And the flag could not have let the
// queue go on: it said nothing of WHICH entry was writing, and was false again
// the moment the next one began.
//
// The rule now: each entry is given its own FENCE, and may change the game
// only through it. The queue moves on from an entry at its bound only once
// that entry can change nothing more, and the fence is what makes that true,
// by construction rather than by hope:
//   - every write an entry makes carries its own fence (the host's store for
//     an entry is made from it: fencedStore; the game's own writers take it as
//     `fence`: gameState.js mutate*), and the fence is checked again INSIDE the
//     game's one write chain, where the write's mutator runs: a write the
//     entry asked for before its bound, still waiting in that chain when the
//     bound passes, writes nothing (`write`);
//   - what the entry awaits is held by its fence (`hold`): once the entry is
//     let go, nothing it awaited ever comes back to it, so the rest of its
//     work, every message it would send and every change it would make in
//     memory, never runs;
//   - the fence closes when its entry ends, or at its bound; a fence is never
//     opened again, and every entry's is its own, so nothing that is let go
//     can ever pass for the entry that runs after it.
// What the pass-over lacked is exactly this: the entry passed over still held
// the one open slot every write was marked by, and its writes went to the
// same store as the next entry's, unchecked. Nothing of a fenced entry's can.
//
// One write may be past recall when the bound comes: one whose mutator ran
// while the entry lived, handed to the game's server and not yet answered
// (`committing`). The game writes one at a time, in the order asked
// (gameState.js enqueueCanonicalGenerationWrite), so it lands before anything
// the next entry writes, never beside it; its requester is told it may have
// been applied (OVERDUE_MAYBE_WORDS), as a request sent again would find.
//
// An entry whose work does not carry its fence through to every write (one
// that says so: `fenced: false`) is held as before: failed at its bound, with
// why, and the queue waits for its work to end.
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
//     OVERDUE (the requester is answered with that reason), its `signal` is
//     aborted (so what it waits on that listens ends sooner), its fence
//     closes, `onOverdue` tells the host, and the next entry runs. When its
//     work does end, or tries to write, it is said once (`onStale`), for the
//     host's log: nothing of it after its bound was applied.
export const SLOW_MS = 20_000;
export const ENTRY_MOST_MS = 120_000;
export const OVERDUE = "overdue";
export const OVERDUE_WORDS = "The host's game took too long to apply this, and stopped: it was not applied.";
export const OVERDUE_MAYBE_WORDS = "The host's game took too long to apply this, and stopped: part of it may have been saved just before.";
const LONG_LABELS = Object.freeze(["round"]);

const refusal = (words = OVERDUE_WORDS) => Object.assign(new Error(words), { code: OVERDUE });
const NEVER = new Promise(() => {});
const isThenable = (value) => Boolean(value) && typeof value.then === "function";

// An entry's fence (see above). `onLate()` is called once, the first time
// anything of the entry's comes back or asks to write after it was closed.
const createFence = ({ onLate = () => {} } = {}) => {
  let open = true;
  let lateSaid = false;
  let committing = 0;
  const closers = [];
  const runCloser = (fn) => {
    try { fn(); } catch { /* the fence never breaks the queue */ }
  };
  const late = () => {
    if (lateSaid) return;
    lateSaid = true;
    try { onLate(); } catch { /* the fence never breaks the queue */ }
  };
  const fence = {
    // Whether the entry may still change anything.
    get live() {
      return open;
    },
    // Whether a write of the entry's has been handed on (its mutator ran while
    // it lived) and has not yet come back.
    get committing() {
      return committing > 0;
    },
    // `fn()` once the fence closes (at once if it has): what the entry took
    // for itself (the game's simulation lock, gameplay.js statsWrite) is given
    // back when the entry is let go, whether or not its work ever comes back.
    onClose(fn) {
      if (open) closers.push(fn);
      else runCloser(fn);
    },
    // What the entry awaits: passed through while the entry lives; once it
    // has been let go, it never comes back (the work after it never runs).
    hold(value) {
      if (!open) {
        late();
        return NEVER;
      }
      return new Promise((resolve, reject) => {
        Promise.resolve(value).then(
          (result) => (open ? resolve(result) : late()),
          (error) => (open ? reject(error) : late()),
        );
      });
    },
    // `thunk()` run and held, only while the entry lives.
    call(thunk) {
      if (!open) return fence.hold(undefined);
      let value;
      try {
        value = thunk();
      } catch (error) {
        value = Promise.reject(error);
      }
      return fence.hold(value);
    },
    // For work that must be told (the game's own writers, whose `finally`
    // gives back what they took): passed through while the entry lives,
    // rejected with OVERDUE once it has been let go.
    through(value) {
      if (!open) {
        late();
        return Promise.reject(refusal());
      }
      return Promise.resolve(value).then(
        (result) => {
          if (open) return result;
          late();
          throw refusal();
        },
        (error) => {
          if (open) throw error;
          late();
          throw refusal();
        },
      );
    },
    // One write: `enqueue(mutator)` hands the store a mutator, which runs
    // `mutator` only while the entry lives and writes nothing (null) after;
    // what it returns while the entry lives is counted as being saved until
    // the write comes back (`committing`). Returns the write's own promise.
    write(enqueue, mutator) {
      let saving = false;
      const mark = (value) => {
        if (!open) {
          late();
          return null;
        }
        if (value !== null && value !== undefined && !saving) {
          saving = true;
          committing += 1;
        }
        return value;
      };
      const guarded = (...args) => {
        if (!open) {
          late();
          return null;
        }
        const out = mutator(...args);
        return isThenable(out) ? out.then(mark) : mark(out);
      };
      let pending;
      try {
        pending = Promise.resolve(enqueue(guarded));
      } catch (error) {
        pending = Promise.reject(error);
      }
      void pending.then(() => {}, () => {}).then(() => {
        if (saving) committing -= 1;
      });
      return pending;
    },
  };
  const close = () => {
    if (!open) return;
    open = false;
    for (const fn of closers.splice(0)) runCloser(fn);
  };
  return { fence, close };
};

export const createWorldQueue = ({
  onSettled = () => {},
  onSlow = () => {},
  onOverdue = () => {},
  onStale = () => {},
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

  // Applies `fn({ signal, fence })` when its turn comes; resolves or rejects
  // with what it did. An entry that fails does not stop the ones after it. One
  // dropped while it waited rejects, its error's `code` DROPPED and its message
  // the reason, without being applied. One that runs past ENTRY_MOST_MS
  // rejects with `code` OVERDUE, `signal` is aborted with that error, and its
  // fence closes; the next entry runs then, unless it said `fenced: false`
  // (it is waited for until its work ends).
  const run = (label, fn, { owner = "", fenced = true } = {}) => {
    waiting += 1;
    const ticket = { dropped: "" };
    if (owner) {
      if (!owned.has(owner)) owned.set(owner, new Set());
      owned.get(owner).add(ticket);
    }
    // The queue moves on when the entry has ended, or has been let go.
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
      let failed = false;
      let done = false;
      let staleSaid = false;
      // Said once of an entry let go: its work came back, or asked to write.
      const stale = () => {
        if (!failed || staleSaid) return;
        staleSaid = true;
        try { onStale({ label: name, ms: now() - started, passed: fenced }); } catch { /* the watch never breaks the queue */ }
      };
      const gate = createFence({ onLate: stale });
      let late = () => {};
      const lateness = new Promise((_resolve, reject) => { late = reject; });
      running = name;
      runningSince = started;
      overdue = false;
      // The entry is over for the queue: what waits behind it may run.
      const finish = () => {
        if (done) return;
        done = true;
        timers.clearInterval(watch);
        running = "";
        runningSince = 0;
        overdue = false;
        release();
      };
      const watch = timers.setInterval(() => {
        if (done) return;
        const ms = now() - started;
        try { onSlow({ label: name, ms, waiting, long: isLong }); } catch { /* the watch never breaks the queue */ }
        if (isLong || failed || ms < mostMs) return;
        failed = true;
        overdue = true;
        const reason = refusal(gate.fence.committing ? OVERDUE_MAYBE_WORDS : OVERDUE_WORDS);
        gate.close();
        controller.abort(reason);
        late(reason);
        try { onOverdue({ label: name, ms, waiting, passed: fenced }); } catch { /* as above */ }
        if (fenced) finish();
      }, slowMs);
      const work = Promise.resolve().then(() => fn({ signal: controller.signal, fence: gate.fence }));
      void work.then(() => {}, () => {}).then(() => {
        gate.close();
        if (failed) stale();
        if (done) return;
        finish();
        try { onSettled(name); } catch { /* as above */ }
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
    // Whether the entry being applied has run past its bound and is waited for
    // all the same (one that said `fenced: false`).
    get overdue() {
      return overdue;
    },
    // How long the entry being applied has run, in ms (0 for none).
    runningFor: () => (running ? Math.max(0, now() - runningSince) : 0),
    get waiting() {
      return waiting;
    },
    // Settles once everything asked so far has been applied, or let go.
    settled: () => tail,
  };
};

// The store an entry writes the game's documents through, made from its fence:
// each write's mutator runs only while the entry lives, and what the entry
// reads or writes is held by its fence (once it has been let go, nothing comes
// back to it). The session's own record (writeShared: no document of the
// game, written outside the entries) is not an entry's to write.
const READS = new Set(["read", "readShared"]);
const NOT_AN_ENTRYS = new Set(["writeShared"]);
export const fencedStore = (store, fence) => {
  const fenced = {};
  for (const [key, value] of Object.entries(store ?? {})) {
    if (typeof value !== "function" || NOT_AN_ENTRYS.has(key)) continue;
    fenced[key] = READS.has(key)
      ? (...args) => fence.call(() => value(...args))
      : (mutator, ...rest) => fence.call(() => (typeof mutator === "function"
        ? fence.write((guarded) => value(guarded, ...rest), mutator)
        : value(mutator, ...rest)));
  }
  return fenced;
};
