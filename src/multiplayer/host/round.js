/*! Open Historia — the multiplayer round: planning, countdown, resolution © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The user's rule for a round: "round length is customisable for server host;
// when 2/3 of players ready up it starts count down for the round to end
// (countdown is custom for server host)". So:
//
//   lobby → planning → countdown → resolving → revealing → planning → …
//
// - Planning lasts at most the host's round length.
// - When the host's share of the players (2/3 by default) are ready, the
//   countdown starts; if readiness drops below the share it stops again.
// - Everyone ready ends the round at once; so does the round's deadline.
// - A minimum planning time can hold the countdown off at the very start of a
//   round, so a round is never over before anyone has read it.
// - A player idle for longer than the AFK limit counts as ready, if the host
//   turned that on, so one absent player never holds the game.
// - The host can pause (deadlines stop) and resume.
//
// Only human players who are here count. A seat played by the AI, or whose
// player is away, is left out of the share, so leavers never block a round.
//
// Pure, with an injected clock and timers, so the tests step time exactly.

export const DEFAULT_ROUND_SETTINGS = Object.freeze({
  roundMinutes: 20,
  readyThreshold: 2 / 3,
  countdownSeconds: 60,
  minPlanningSeconds: 0,
  afkSeconds: 0, // 0: an idle player is never counted ready
  revealSeconds: 90,
});

const clampSettings = (settings) => {
  const merged = { ...DEFAULT_ROUND_SETTINGS, ...settings };
  const number = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback);
  return {
    roundMinutes: number(merged.roundMinutes, 1, 7 * 24 * 60, DEFAULT_ROUND_SETTINGS.roundMinutes),
    readyThreshold: number(merged.readyThreshold, 0.5, 1, DEFAULT_ROUND_SETTINGS.readyThreshold),
    countdownSeconds: number(merged.countdownSeconds, 0, 3600, DEFAULT_ROUND_SETTINGS.countdownSeconds),
    minPlanningSeconds: number(merged.minPlanningSeconds, 0, 3600, 0),
    afkSeconds: number(merged.afkSeconds, 0, 24 * 3600, 0),
    revealSeconds: number(merged.revealSeconds, 5, 3600, DEFAULT_ROUND_SETTINGS.revealSeconds),
  };
};

// How many of `count` players make the share: 2/3 of 3 is 2, of 4 is 3.
export const readyNeeded = (count, threshold) => (count <= 0 ? 0 : Math.max(1, Math.ceil(count * threshold - 1e-9)));

export const createRoundMachine = ({
  settings: initialSettings = {},
  now = () => Date.now(),
  timers = globalThis,
  onChange = () => {},
  onResolve = async () => {},
} = {}) => {
  let settings = clampSettings(initialSettings);
  let phase = "lobby";
  let round = 0;
  let planningEnds = 0;
  let countdownEnds = 0;
  let planningStarted = 0;
  let revealEnds = 0;
  let paused = null; // { remaining: { planning, countdown, reveal } } while paused
  let timer = null;
  const present = new Set();
  const ready = new Set();
  const lastActive = new Map();
  const revealed = new Set();

  const counted = () => [...present];
  const isReady = (seat) => {
    if (ready.has(seat)) return true;
    if (!settings.afkSeconds) return false;
    const last = lastActive.get(seat) ?? planningStarted;
    return now() - Math.max(last, planningStarted) >= settings.afkSeconds * 1000;
  };
  const readyCount = () => counted().filter(isReady).length;

  const deadline = () => {
    if (phase === "planning") return planningEnds;
    if (phase === "countdown") return countdownEnds;
    if (phase === "revealing") return revealEnds;
    return 0;
  };

  const snapshot = () => ({
    phase,
    round,
    paused: Boolean(paused),
    deadline: paused ? 0 : deadline(),
    remainingMs: paused ? paused.remaining[phase] ?? 0 : Math.max(0, deadline() - now()),
    ready: counted().filter(isReady),
    counted: counted(),
    needed: readyNeeded(counted().length, settings.readyThreshold),
    settings: { ...settings },
  });

  const emit = () => onChange(snapshot());

  const arm = () => {
    timers.clearTimeout(timer);
    timer = null;
    if (paused || !["planning", "countdown", "revealing"].includes(phase)) return;
    // Wake at the next deadline, and also when an idle player would turn
    // ready or the minimum planning time would run out, whichever is first.
    const moments = [deadline()];
    if (phase === "planning" && settings.minPlanningSeconds) moments.push(planningStarted + settings.minPlanningSeconds * 1000);
    if (settings.afkSeconds && (phase === "planning" || phase === "countdown")) {
      for (const seat of counted()) {
        if (!ready.has(seat)) moments.push(Math.max(lastActive.get(seat) ?? planningStarted, planningStarted) + settings.afkSeconds * 1000);
      }
    }
    const next = Math.min(...moments.filter((moment) => moment > now()));
    if (Number.isFinite(next)) timer = timers.setTimeout(evaluate, Math.max(0, next - now()));
  };

  const resolve = () => {
    phase = "resolving";
    timers.clearTimeout(timer);
    // Who has read the round through is counted from here: a player is sent
    // the round's events as the last step of resolving it, and one with little
    // to read may say so before the phase is announced.
    revealed.clear();
    emit();
    Promise.resolve()
      .then(() => onResolve({ round }))
      .then(
        () => {
          phase = "revealing";
          revealEnds = now() + settings.revealSeconds * 1000;
          emit();
          evaluate();
        },
        () => {
          // A round that could not be resolved goes back to planning, with the
          // orders still queued, rather than skipping ahead.
          startPlanning({ sameRound: true });
        },
      );
  };

  const startPlanning = ({ sameRound = false } = {}) => {
    if (!sameRound) round += 1;
    phase = "planning";
    planningStarted = now();
    planningEnds = planningStarted + settings.roundMinutes * 60 * 1000;
    countdownEnds = 0;
    ready.clear();
    emit();
    arm();
  };

  function evaluate() {
    if (paused) return;
    const t = now();
    if (phase === "revealing") {
      if (t >= revealEnds || (present.size > 0 && [...present].every((seat) => revealed.has(seat)))) startPlanning();
      else arm();
      return;
    }
    if (phase !== "planning" && phase !== "countdown") return;
    const total = counted().length;
    const readyNow = readyCount();
    const needed = readyNeeded(total, settings.readyThreshold);
    const planningOver = t >= planningEnds;
    const minimumMet = t >= planningStarted + settings.minPlanningSeconds * 1000;
    if (planningOver || (total > 0 && readyNow === total && minimumMet)) return resolve();
    if (phase === "countdown") {
      if (t >= countdownEnds) return resolve();
      if (readyNow < needed) {
        phase = "planning";
        countdownEnds = 0;
        emit();
      }
    } else if (total > 0 && readyNow >= needed && minimumMet) {
      phase = "countdown";
      countdownEnds = Math.min(t + settings.countdownSeconds * 1000, planningEnds);
      emit();
      if (countdownEnds <= t) return resolve();
    }
    arm();
    return undefined;
  }

  return {
    // The players who count: humans who are here. Called whenever a player
    // joins, leaves, is taken over by the AI or comes back.
    setPlayers(seats) {
      const next = new Set(seats);
      for (const seat of [...present]) if (!next.has(seat)) {
        present.delete(seat);
        ready.delete(seat);
        revealed.delete(seat);
      }
      for (const seat of next) present.add(seat);
      emit();
      evaluate();
    },
    setReady(seat, value) {
      if (!present.has(seat) || (phase !== "planning" && phase !== "countdown")) return false;
      if (value) ready.add(seat);
      else ready.delete(seat);
      lastActive.set(seat, now());
      emit();
      evaluate();
      return true;
    },
    // Anything the player does counts as being here (for the AFK rule).
    touch(seat) {
      if (present.has(seat)) lastActive.set(seat, now());
    },
    // A player's client finished showing the round's events.
    revealedBy(seat) {
      if (!["resolving", "revealing"].includes(phase) || !present.has(seat)) return;
      revealed.add(seat);
      if (phase === "revealing") evaluate();
    },
    start() {
      if (phase !== "lobby") return;
      startPlanning();
    },
    // The host ends planning now (a host control, and the lone-player case).
    resolveNow() {
      if (phase === "planning" || phase === "countdown") resolve();
    },
    pause() {
      if (paused || !["planning", "countdown", "revealing"].includes(phase)) return;
      paused = { remaining: { planning: Math.max(0, planningEnds - now()), countdown: Math.max(0, countdownEnds - now()), revealing: Math.max(0, revealEnds - now()) } };
      timers.clearTimeout(timer);
      emit();
    },
    resume() {
      if (!paused) return;
      const t = now();
      planningEnds = t + paused.remaining.planning;
      if (phase === "countdown") countdownEnds = t + paused.remaining.countdown;
      if (phase === "revealing") revealEnds = t + paused.remaining.revealing;
      paused = null;
      emit();
      evaluate();
    },
    configure(next) {
      settings = clampSettings({ ...settings, ...next });
      emit();
      evaluate();
    },
    status: snapshot,
    stop() {
      timers.clearTimeout(timer);
      timer = null;
    },
  };
};
