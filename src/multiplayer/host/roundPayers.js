/*! Open Historia — taking turns to pay for a shared game's rounds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's decision 14 ("build it now, option B"), a host setting stated in
// the lobby (host/settings.js payment "cycle"): the round's ONE AI request is
// made by each player's device in turn, on its own key. No key is ever sent:
//
//   - the host's engine builds the round's request exactly as it always has
//     (gameplay.js simulateTimelineJump, through callAI);
//   - when the round's payer is another player, every request of the round's
//     skip is sent, as built, to that player's device (the "pay" message; the
//     call is cut out of callAI by Game/AI/roundCarrier.js), which only carries
//     it to its own AI and sends back the raw answer ("paid"). A lookup the
//     model asks for on the way is answered from the host's own game
//     ("payLookup"), as it would have been had the host asked;
//   - the host's engine parses and applies that answer exactly as its own.
//
// The paying device sees that round's whole request, every player's orders and
// secrets included: the lobby says so (multiplayer/costRules.js). The same rail
// as a reply written on a player's own device (client/ownReplies.js): the
// host's words go to a device, and words come back.
//
// Whose turn it is: the next seat, in the seat book's order, after the one
// whose device paid the last round that landed, of those whose player is here
// (a seat whose player is connected); round the table again from the start.
// So everyone pays in turn, one who joins later takes their turn where their
// seat is, and one who was away owes nothing for it. A round the host takes on
// itself (when a payer is away, or its AI failed) is the host's, and the
// player whose turn it was is still the next. Who paid last is kept with the
// session.
//
// A payer that fails says why, and the round fails with that: it waits,
// visibly, for the host to run it again or pay it itself (decision 9; never a
// canned turn). A payer whose connection drops is waited for a while, and sent
// the request again when it is back.
//
// Runtime-free: messages go out through `send(device, message)`, time through
// `now` and `timers`, so it is tested under bare node.

import { HOST_MESSAGES } from "../game/messages.js";
import { safeParse, validate } from "../protocol/validate.js";

// How long a paying device that dropped is waited for before the round fails.
export const PAYER_GONE_MS = 60_000;
// How often the engine is told the paying device is still there and working:
// the engine's own deadline for a model that stopped answering (gameplay.js
// runJsonTask, "Limit AI generation") counts silence, and a request carried to
// another device is silent here until its answer comes.
export const PAY_KEEPALIVE_MS = 15_000;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);

export const createRoundPayers = ({
  send = () => {},
  // Whether a device has a connection open now.
  connected = () => true,
  // The device that paid the last round that landed, as the session kept it.
  lastPayer = "",
  log = () => {},
  timers = globalThis,
} = {}) => {
  let last = clean(lastPayer);
  // The round the host took on itself.
  let hostRound = null;
  // The payer of the round being resolved: { device, country, round }.
  let current = null;
  // A request on its way: job → { id, device, country, round, message, execute, onActivity, onRequest, resolve, reject, gone, alive, unlisten }.
  const jobs = new Map();
  let sequence = 0;

  const settle = (job) => {
    if (jobs.get(job.id) !== job) return false;
    jobs.delete(job.id);
    timers.clearTimeout(job.gone);
    timers.clearInterval(job.alive);
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

  return {
    // Who pays the round `round`: of `seats` (the seat book's, in its order,
    // each { country, device, here }), `host` being the host's device. {
    // device, country, instead } (`instead`: the host pays for one whose turn
    // it was), or null with nobody here.
    payerOf({ seats = [], host = "", round = 0 } = {}) {
      const table = list(seats).filter((seat) => clean(seat?.device) && clean(seat?.country));
      const here = table.filter((seat) => seat.here !== false);
      if (!here.length) return null;
      if (hostRound !== null && hostRound === round) {
        const own = here.find((seat) => seat.device === host);
        if (own) return { device: own.device, country: clean(own.country), instead: true };
      }
      const after = table.findIndex((seat) => seat.device === last);
      const next = [...table.slice(after + 1), ...table.slice(0, after + 1)].find((seat) => seat.here !== false);
      return { device: next.device, country: clean(next.country), instead: false };
    },
    // The host pays round `round` itself.
    hostPays(round) {
      hostRound = round;
    },
    // The payer of the round now being resolved, or null when none is.
    begin(payer) {
      current = payer ? { device: payer.device, country: clean(payer.country), round: payer.round } : null;
    },
    paying: () => current,
    // A round `payer` paid has landed: the next turn is the next seat's, unless
    // the host paid in place of the one whose turn it was.
    landed(payer) {
      if (payer?.device && !payer.instead) last = payer.device;
      hostRound = null;
    },
    // What carries a request of the round to `device`'s own AI, for the
    // engine (Game/AI/roundCarrier.js installRoundCarrier): `carry(call, {
    // execute, onActivity, onRequest, signal })` resolves the answer as callAI
    // returns one ({ rawText, toolInput?, answeredAsText? }), or rejects with
    // why there is none; `onRequest` first hears the status of every provider
    // response the device took. `signal` is the round's: stopped, the device is
    // told.
    carry({ device, country, round, signal = null }) {
      const who = clean(country) || "The paying player";
      return (call, { execute = null, onActivity = null, onRequest = null, signal: callSignal = null } = {}) => new Promise((resolve, reject) => {
        sequence += 1;
        const id = `pay-${round}-${sequence.toString(36)}`;
        const message = { t: "pay", job: id, round, call };
        const checked = validate(HOST_MESSAGES.pay, message);
        if (!checked.ok) {
          reject(new Error(`The round's request could not be sent to ${who}'s device (${checked.error}).`));
          return;
        }
        const job = {
          id, device, country: who, round, message: checked.value, execute, onActivity, onRequest, resolve, reject,
          gone: null, alive: null, unlisten: () => {},
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
        job.alive = timers.setInterval(() => {
          if (connected(device)) onActivity?.();
        }, PAY_KEEPALIVE_MS);
        jobs.set(id, job);
        log("info", "a request of the round was sent to the paying player's device", { country: who, round, job: id, promptChars: call?.systemPrompt?.length ?? 0 });
        send(device, job.message);
        // Not here now: waited for, as one that drops is.
        if (!connected(device)) left(device);
      });
    },
    // The paying device's answer, or why it has none: "" when it was taken, or
    // the refusal. Only from the device it was sent to, and once.
    answered(device, { job, answer = null, error = "", statuses = [] } = {}) {
      const waiting = jobs.get(clean(job));
      if (!waiting || waiting.device !== device) return "That request is not waiting for an answer from your device.";
      // What the device's provider said to each request, as the engine hears its own.
      for (const status of list(statuses).slice(0, 32)) {
        try {
          waiting.onRequest?.(Number(status));
        } catch {
          // a listener must never cost the round its answer
        }
      }
      if (!answer) {
        const why = clean(error).slice(0, 280) || "it gave no answer";
        log("warn", "the paying player's device could not make the round's request", { country: waiting.country, error: why });
        fail(waiting, new Error(`${waiting.country}'s device could not make the round's request: ${why}`));
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
        rawText: String(answer.text ?? ""),
        ...(toolInput ? { toolInput } : {}),
        ...(answer.asText ? { answeredAsText: true } : {}),
      });
      return "";
    },
    // A lookup the paying device's model asked for, answered from the host's
    // own game with the function the engine's request declared it with.
    async lookup(device, { job, name, args } = {}) {
      const waiting = jobs.get(clean(job));
      if (!waiting || waiting.device !== device) return "That request is not waiting for an answer from your device.";
      if (typeof waiting.execute !== "function") return "That request looks nothing up.";
      waiting.onActivity?.();
      let response;
      try {
        response = await waiting.execute(clean(name), args && typeof args === "object" && !Array.isArray(args) ? args : {});
      } catch (error) {
        response = { error: clean(error?.message || error).slice(0, 300) || "The lookup failed." };
      }
      return { error: "", result: { text: JSON.stringify(response ?? null) } };
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
    // Who paid last, for the session record.
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
