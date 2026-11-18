/*! Open Historia — taking turns to pay for a shared game's rounds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's decision 14 ("build it now, option B"), a host setting stated in
// the lobby (host/settings.js payment "cycle"): the round's ONE AI request is
// made by each player's device in turn, on its own key. No key is ever sent:
//
//   - each device states, with no key, whether its AI can answer a round now
//     and the settings that decide what a round spends on its key (the
//     "canPay" request, Game/AI/roundCarrier.js payProfileOf);
//   - the host's engine builds the round's request under the paying device's
//     settings (roundCarrier.js carriedSkipRules), and when the payer is
//     another player every request of the round's skip is sent, as built, to
//     that player's device ("pay"), which carries it to its own AI and sends
//     back the raw answer ("paid"). A lookup the model asks for on the way is
//     answered from the host's own game ("payLookup"), and the device says its
//     model is still at work ("payAlive");
//   - the host's engine parses and applies that answer exactly as its own.
//
// The paying device sees that round's whole request, every player's orders and
// secrets included, and since its answer is the round's, it can change what
// happens that round: the lobby says both (multiplayer/costRules.js).
//
// Whose turn it is: the next seat, in the seat book's order, after the one
// whose turn was taken last, of those whose player is here (a seat whose
// player is connected) and whose device has said it can pay (the host's own
// always can: it was checked before the game was hosted); round the table
// again from the start. So everyone who can pays in turn, one who joins later
// takes their turn where their seat is, one who was away owes nothing for it,
// and a device with no AI that can answer is never asked (the review of
// 2026-11-18, cost 1: it was asked every round, failed every round, and kept the
// turn for ever).
//
// A turn is taken when its round lands, and when a round its payer was asked
// for fails or is cancelled: the payer's key spent what it spent, and the round
// waits, visibly, for the host to run it again (on the next payer) or pay it
// itself (decision 9; never a canned turn). A round the host takes on itself
// leaves the turn with the one it was: they were never asked. Who took the turn
// last is kept with the session.
//
// How long a payer is waited for: the engine's own deadline for a silent model
// ("Limit AI generation", stated in the lobby), which only the device's own word
// that its model is at work puts off (payAlive). A payer whose connection drops
// is waited for a while, and sent the request again when it is back; one the
// host lets go of fails the round at once.
//
// Runtime-free: messages go out through `send(device, message)`, time through
// `timers`, so it is tested under bare node.

import { HOST_MESSAGES } from "../game/messages.js";
import { safeParse, validate } from "../protocol/validate.js";
import { payProfileOf } from "../../Game/AI/roundCarrier.js";
import { blindToken } from "../../runtime/blindIds.js";

// How long a paying device that dropped is waited for before the round fails.
export const PAYER_GONE_MS = 60_000;
// A lookup asked while the host still answers that device's last.
export const LOOKUP_UNDER_WAY = "The host answers one lookup at a time: wait for the one asked already.";

// What the host says of a failure the paying device reported, by its kind:
// the host's own words, never the provider's, which go to every player. Whole
// sentences, so each can be put in another language's order.
export const PAY_FAILURE_WORDS = Object.freeze({
  none: (country) => `${country}'s device could not make the round's request: it has no AI that can make it now.`,
  spent: (country) => `${country}'s device could not make the round's request: its AI has used its allowance.`,
  unusable: (country) => `${country}'s device could not make the round's request: its AI cannot be used as it is set up.`,
  rateLimited: (country) => `${country}'s device could not make the round's request: its AI is rate limited.`,
  busy: (country) => `${country}'s device could not make the round's request: its AI is busy.`,
  unreachable: (country) => `${country}'s device could not make the round's request: its AI could not be reached.`,
  closed: (country) => `${country}'s device could not make the round's request: the connection to its AI closed before the answer was finished.`,
  tooBig: (country) => `${country}'s device could not make the round's request: its AI cannot take a request this size.`,
  refused: (country) => `${country}'s device could not make the round's request: its AI refused it.`,
  cancelled: (country) => `${country}'s device could not make the round's request: it was cancelled on that device.`,
  unsent: (country) => `${country}'s device could not send its answer to the round's request: it was too large.`,
  declined: (country) => `${country}'s device could not make the round's request: it does not take turns to pay in this game.`,
  other: (country) => `${country}'s device could not make the round's request: its AI did not answer.`,
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

// The error a payer's failure fails the round's request with: the host's words,
// and the kind, which the engine's task runner reads (roundCarrier.js callErrorOf).
const payerFailure = (country, failure) => {
  const kind = Object.prototype.hasOwnProperty.call(PAY_FAILURE_WORDS, failure?.kind) ? failure.kind : "other";
  return Object.assign(new Error(PAY_FAILURE_WORDS[kind](country)), {
    payFailure: { kind, busy: failure?.busy === true },
  });
};

export const createRoundPayers = ({
  send = () => {},
  // Whether a device has a connection open now.
  connected = () => true,
  // The device whose turn was taken last, as the session kept it.
  lastPayer = "",
  log = () => {},
  timers = globalThis,
} = {}) => {
  let last = clean(lastPayer);
  // The round the host took on itself.
  let hostRound = null;
  // The payer of the round being resolved: { device, country, round, instead, asked }.
  let current = null;
  // What each device said of paying (payProfileOf), by device.
  const stated = new Map();
  // A request on its way: job → { id, device, country, round, message, hooks, resolve, reject, gone, unlisten }.
  const jobs = new Map();

  const settle = (job) => {
    if (jobs.get(job.id) !== job) return false;
    jobs.delete(job.id);
    timers.clearTimeout(job.gone);
    job.unlisten();
    return true;
  };
  const fail = (job, error) => {
    if (settle(job)) job.reject(error instanceof Error ? error : new Error(String(error)));
  };
  // A device whose last connection closed: what it was asked fails, unless it
  // is back in time.
  const left = (device) => {
    for (const job of jobs.values()) {
      if (job.device !== device || job.gone) continue;
      job.gone = timers.setTimeout(() => {
        job.gone = null;
        if (connected(device)) return;
        fail(job, new Error(`${job.country}'s device left before it made the round's request.`));
      }, PAYER_GONE_MS);
    }
  };
  const waitingFor = (device, job) => {
    const waiting = jobs.get(clean(job));
    return waiting && waiting.device === device ? waiting : null;
  };
  const canPay = (device, host) => Boolean(device) && (device === host || stated.get(device)?.ready === true);

  return {
    // What a device says of paying (the "canPay" request). True when what every
    // screen shows of it changed: whether it takes its turn (the lobby's seat
    // `pays`, and who pays the round). Its settings are kept for the round to be
    // built under, and are no screen's business: every change of them sent every
    // player the lobby and the round again, so a device sending them over and
    // over had the host tell everyone at its pace (the follow-ups of 2026-11-18, C2).
    state(device, profile) {
      if (!clean(device)) return false;
      const next = payProfileOf(profile);
      const before = stated.get(device);
      stated.set(device, next);
      return (before?.ready === true) !== next.ready;
    },
    // Whether a device takes its turn: it said it can (the host's own always can).
    canPay,
    // What a device said, for the engine to build the round under its settings, or null.
    profileOf: (device) => stated.get(device) ?? null,
    // Who pays the round `round`: of `seats` (the seat book's, in its order,
    // each { country, device, here }), `host` being the host's device. {
    // device, country, instead } (`instead`: the host pays for one whose turn
    // it was), or null with nobody here who can.
    payerOf({ seats = [], host = "", round = 0 } = {}) {
      const table = list(seats).filter((seat) => clean(seat?.device) && clean(seat?.country));
      const able = (seat) => seat.here !== false && canPay(seat.device, host);
      if (hostRound !== null && hostRound === round) {
        const own = table.find((seat) => seat.device === host && seat.here !== false);
        if (own) return { device: own.device, country: clean(own.country), instead: true };
      }
      const after = table.findIndex((seat) => seat.device === last);
      const next = [...table.slice(after + 1), ...table.slice(0, after + 1)].find(able);
      return next ? { device: next.device, country: clean(next.country), instead: false } : null;
    },
    // The host pays round `round` itself.
    hostPays(round) {
      hostRound = round;
    },
    // The payer of the round now being resolved, or null when none is.
    begin(payer) {
      current = payer ? { device: payer.device, country: clean(payer.country), round: payer.round, instead: payer.instead === true, asked: false } : null;
    },
    paying: () => current,
    // A round `payer` paid has landed: the turn is taken, unless the host paid
    // in place of the one whose turn it was.
    landed(payer) {
      if (payer?.device && !payer.instead) last = payer.device;
      hostRound = null;
    },
    // A round that did not land (failed, cancelled): the turn of a payer whose
    // device was asked for it is taken all the same, and the round, run again,
    // is the next one's. True when the turn moved.
    missed(payer) {
      const asked = Boolean(payer?.device) && !payer.instead && current?.device === payer.device && current.asked === true;
      if (asked) last = payer.device;
      return asked;
    },
    // What carries a request of the round to `device`'s own AI, for the
    // engine (Game/AI/roundCarrier.js installRoundCarrier): `carry(call,
    // hooks)` resolves the device's answer ({ text, toolInput?, asText,
    // reasoning?, cut?, outputOnly? }), or rejects with why there is none.
    // `hooks` are roundCarrier.js carriedCall's: `execute(name, args, round)`
    // answers a lookup, `alive(round)` hears that the model is at work,
    // `onRequest(status)` each provider response; `signal` is the call's.
    // `signal` here is the round's: stopped, the device is told.
    carry({ device, country, round, signal = null }) {
      const who = clean(country) || "The paying player";
      return (call, { execute = null, alive = null, onRequest = null, signal: callSignal = null } = {}) => new Promise((resolve, reject) => {
        // Blind (runtime/blindIds.js): a count of every request carried, to every
        // payer, told each payer how many requests the others' rounds had made.
        const id = `pay-${round}-${blindToken(6)}`;
        const message = { t: "pay", job: id, round, call };
        const checked = validate(HOST_MESSAGES.pay, message);
        if (!checked.ok) {
          reject(new Error(`The round's request could not be sent to ${who}'s device (${checked.error}).`));
          return;
        }
        const job = {
          id, device, country: who, round, message: checked.value, hooks: { execute, alive, onRequest }, resolve, reject,
          gone: null, unlisten: () => {},
        };
        // Stopped (the round cancelled or the game stopped, or the engine's own
        // deadline for this call): the device is told it need not answer.
        const stopWith = (stopping) => () => {
          if (jobs.get(id) !== job) return;
          send(device, { t: "payStop", job: id });
          fail(job, stopping.reason ?? new Error("The round was stopped."));
        };
        const signals = [signal, callSignal].filter(Boolean);
        if (signals.some((each) => each.aborted)) {
          reject(signals.find((each) => each.aborted).reason ?? new Error("The round was stopped."));
          return;
        }
        const listeners = signals.map((each) => {
          const listener = stopWith(each);
          each.addEventListener?.("abort", listener, { once: true });
          return () => each.removeEventListener?.("abort", listener);
        });
        job.unlisten = () => listeners.forEach((undo) => undo());
        jobs.set(id, job);
        // This round's payer has been asked: from here, a round that does not land still takes its turn.
        if (current && current.device === device) current.asked = true;
        log("info", "a request of the round was sent to the paying player's device", { country: who, round, job: id, promptChars: call?.systemPrompt?.length ?? 0 });
        send(device, job.message);
        // Not here now: waited for, as one that drops is.
        if (!connected(device)) left(device);
      });
    },
    // The paying device's answer, or what kind of failure kept it from one: ""
    // when it was taken, or the refusal. Only from the device it was sent to, and once.
    answered(device, { job, answer = null, failure = null, statuses = [] } = {}) {
      const waiting = waitingFor(device, job);
      if (!waiting) return "That request is not waiting for an answer from your device.";
      // What the device's provider said to each request, as the engine hears its own.
      for (const status of list(statuses).slice(0, 32)) {
        try {
          waiting.hooks.onRequest?.(Number(status));
        } catch {
          // a listener must never cost the round its answer
        }
      }
      if (!answer) {
        const error = payerFailure(waiting.country, failure);
        log("warn", "the paying player's device could not make the round's request", { country: waiting.country, kind: error.payFailure.kind });
        fail(waiting, error);
        return "";
      }
      let toolInput = null;
      if (clean(answer.toolJson)) {
        const parsed = safeParse(String(answer.toolJson), { maxLength: answer.toolJson.length + 1, maxDepth: 64 });
        if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
          fail(waiting, new Error(`${waiting.country}'s device sent an answer that does not read (${parsed.error || "not an object"}).`));
          return "That answer does not read.";
        }
        toolInput = parsed.value;
      }
      if (!settle(waiting)) return "";
      waiting.resolve({
        text: String(answer.text ?? ""),
        ...(toolInput ? { toolInput } : {}),
        asText: answer.asText === true,
        ...(clean(answer.reasoning) ? { reasoning: String(answer.reasoning) } : {}),
        ...(answer.cut === true ? { cut: true } : {}),
        ...(answer.outputOnly === true ? { outputOnly: true } : {}),
      });
      return "";
    },
    // A lookup the paying device's model asked for, answered from the host's
    // own game with the function the engine's request declared it with. One at
    // a time, as the model's calls are answered on the device (toolTurns.js
    // answerLookupCalls waits for each): a device sending them all at once had
    // the host read its game for each at the same time, as many as the session
    // let through (the follow-ups of 2026-11-18, C2).
    async lookup(device, { job, name, args, round = 1 } = {}) {
      const waiting = waitingFor(device, job);
      if (!waiting) return "That request is not waiting for an answer from your device.";
      if (typeof waiting.hooks.execute !== "function") return "That request looks nothing up.";
      if (waiting.looking) return LOOKUP_UNDER_WAY;
      waiting.looking = true;
      try {
        const response = await waiting.hooks.execute(clean(name), args && typeof args === "object" && !Array.isArray(args) ? args : {}, round);
        return { error: "", result: { text: JSON.stringify(response ?? null) } };
      } finally {
        waiting.looking = false;
      }
    },
    // The paying device's model is at work on a request (`round`: a lookup round it began).
    alive(device, { job, round = 0 } = {}) {
      const waiting = waitingFor(device, job);
      if (!waiting) return false;
      try {
        waiting.hooks.alive?.(round);
      } catch {
        // a listener must never cost the round its answer
      }
      return true;
    },
    // A device back on a new connection: what it was asked, again.
    joined(device) {
      for (const job of jobs.values()) {
        if (job.device !== device) continue;
        timers.clearTimeout(job.gone);
        job.gone = null;
        send(device, job.message);
      }
    },
    left,
    // A device the host let go of (Kick, Ban): what it was asked fails now,
    // and it is told it need not answer. Before, a payer let go mid-round was
    // still connected, its answer was refused for having no seat, and the
    // round waited for ever (the review of 2026-11-18, cost 4).
    released(device) {
      for (const job of [...jobs.values()]) {
        if (job.device !== device) continue;
        send(device, { t: "payStop", job: job.id });
        fail(job, new Error(`${job.country}'s player was let go before their device made the round's request.`));
      }
    },
    // Who took the turn last, for the session record.
    record: () => last,
    // The game stopped: nothing is waited for.
    stop() {
      for (const job of [...jobs.values()]) {
        send(job.device, { t: "payStop", job: job.id });
        fail(job, new Error("The shared game was stopped."));
      }
    },
  };
};
