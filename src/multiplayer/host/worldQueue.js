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

// An entry that never ends held every entry behind it, silently: the owner's
// "Start the game" waited behind one and nothing happened, with nothing said
// (2026-11-18). An entry is a write, and a write takes seconds; the AI's
// thinking is done outside. So an entry that runs long is said (`onSlow`,
// every SLOW_MS while it runs: what it is and for how long, for the host's log
// and the host's screen), and one that has run GIVE_UP_MS no longer holds the
// queue: what waits behind it is applied (`onGaveUp`), and it settles when it
// settles. Whatever left it open (a write that waits on an entry queued behind
// itself, a lock whose holder waits on the queue, a held entry never let go)
// then costs minutes, said, and never the game. The round is a long entry by
// nature (`long` labels): it is said, never passed over; it has its own
// cancel and its own bounds on a silent AI (host/round.js).
export const SLOW_MS = 20_000;
export const GIVE_UP_MS = 180_000;
const LONG_LABELS = Object.freeze(["round"]);

export const createWorldQueue = ({
  onSettled = () => {},
  onSlow = () => {},
  onGaveUp = () => {},
  slowMs = SLOW_MS,
  giveUpMs = GIVE_UP_MS,
  long = LONG_LABELS,
  timers = globalThis,
  now = () => Date.now(),
} = {}) => {
  let tail = Promise.resolve();
  let running = "";
  let runningSince = 0;
  let waiting = 0;
  // owner → the entries of theirs still waiting, each { dropped }.
  const owned = new Map();
  const longLabels = new Set(long);

  // Applies `fn` when its turn comes; resolves or rejects with what it did.
  // An entry that fails does not stop the ones after it. One dropped while it
  // waited rejects, its error's `code` DROPPED and its message the reason,
  // without being applied.
  const run = (label, fn, { owner = "" } = {}) => {
    waiting += 1;
    const ticket = { dropped: "" };
    if (owner) {
      if (!owned.has(owner)) owned.set(owner, new Set());
      owned.get(owner).add(ticket);
    }
    // The queue moves on when the entry settles, or when it is given up on.
    let release = () => {};
    const released = new Promise((resolve) => { release = resolve; });
    const entry = tail.then(async () => {
      waiting -= 1;
      if (owner) {
        owned.get(owner)?.delete(ticket);
        if (!owned.get(owner)?.size) owned.delete(owner);
      }
      if (ticket.dropped) throw Object.assign(new Error(ticket.dropped), { code: DROPPED });
      const name = String(label || "a change");
      const started = now();
      let current = true;
      running = name;
      runningSince = started;
      const slow = timers.setInterval(() => {
        const ms = now() - started;
        try { onSlow({ label: name, ms, waiting }); } catch { /* the watch never breaks the queue */ }
        if (current && !longLabels.has(name) && ms >= giveUpMs) {
          current = false;
          running = "";
          runningSince = 0;
          try { onGaveUp({ label: name, ms, waiting }); } catch { /* as above */ }
          // Said once: what runs now is the entries behind it.
          timers.clearInterval(slow);
          release();
        }
      }, slowMs);
      try {
        return await fn();
      } finally {
        timers.clearInterval(slow);
        if (current) {
          running = "";
          runningSince = 0;
        }
        onSettled(label);
        release();
      }
    });
    entry.then(release, release);
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
    // How long the entry being applied has run, in ms (0 for none).
    runningFor: () => (running ? Math.max(0, now() - runningSince) : 0),
    get waiting() {
      return waiting;
    },
    // Settles once everything asked so far has been applied.
    settled: () => tail,
  };
};
