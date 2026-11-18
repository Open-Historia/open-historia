/*! Open Historia — this device paying for a shared round, in its turn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// With the host's setting that players take turns to pay (host/settings.js
// payment "cycle", the owner's decision 14), the round's request is made by
// each player's device in turn, on its own AI key. When it is this device's
// turn the host sends it each request of the round, as the host's engine built
// it ("pay"); this carries it to this device's own AI (Game/AI/main.jsx
// carryRoundRequest) and sends the host the answer as it came ("paid"), or the
// kind of failure that kept it from one. On the way it asks the host for each
// lookup the model wants ("payLookup"), which the host answers from its own
// game, and tells the host its model is still at work ("payAlive"): an answer
// arriving, at most every PAYER_ALIVE_MS, and at once when a lookup round
// begins, which the host counts into the round's budget. Nothing is written
// here, and no key is sent anywhere: the host applies the answer.
//
// Only in a game whose lobby says its players take turns to pay: a host that
// asks a device of a game it pays for itself is answered no.
//
// Import-free but for the message checks: the model, the host and the lobby
// are passed in, so this is tested under bare node.

import { safeParse } from "../protocol/validate.js";

// How often, at most, the host is told this device's model is still writing.
export const PAYER_ALIVE_MS = 10_000;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// `ask(call, hooks)` resolves this device's AI's answer as the host takes it
// ({ text, toolJson, asText, reasoning?, cut?, outputOnly? }), or rejects with
// an error whose `payFailure` says its kind (Game/AI/roundCarrier.js
// failureOf); `answer(fields)` and `lookup(fields)` send the host "paid" and
// "payLookup" and resolve its { ok, error, result }; `alive(fields)` sends
// "payAlive", which nothing answers; `cycle()` says whether this game's players
// take turns.
//
// What it is doing, for the round bar: { job, round, status, error }
//   status "paying":  this device is asking its own AI;
//   status "failed":  it could not (`error`, in this device's own words), and
//                     the host was told what kind of failure it was.
export const createRoundPayer = ({
  ask,
  answer,
  lookup,
  alive = () => {},
  cycle = () => true,
  log = () => {},
  now = Date.now,
} = {}) => {
  let current = null;
  const listeners = new Set();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const put = (next) => {
    current = next;
    changed();
  };

  const run = async (job, round, call, controller) => {
    const mine = () => current?.job === job;
    // A lookup the model asked for, answered by the host from its own game.
    const execute = async (name, args, lookupRound = 1) => {
      const got = await lookup({
        job,
        name: clean(name).slice(0, 80),
        args: args && typeof args === "object" && !Array.isArray(args) ? args : {},
        round: Math.max(1, Math.min(16, Math.trunc(Number(lookupRound) || 1))),
      });
      if (!got?.ok) throw new Error(clean(got?.error) || "The host did not answer the lookup.");
      const parsed = safeParse(String(got.result?.text ?? "null"), { maxLength: 4 * 1024 * 1024, maxDepth: 64 });
      if (!parsed.ok) throw new Error("The host's answer to the lookup does not read.");
      return parsed.value;
    };
    // That the model is at work: told the host at most every PAYER_ALIVE_MS,
    // and at once for a lookup round begun.
    let toldAt = -Infinity;
    const tell = (lookupRound = 0) => {
      if (controller.signal.aborted || !mine()) return;
      const at = now();
      if (!lookupRound && at - toldAt < PAYER_ALIVE_MS) return;
      toldAt = at;
      try {
        alive({ t: "payAlive", job, round: Math.max(0, Math.min(16, Math.trunc(Number(lookupRound) || 0))) });
      } catch {
        // the host's own deadline then says the rest
      }
    };
    // The status of each provider response, for the host's skip to read as its own.
    const statuses = [];
    const onRequest = (status) => {
      if (statuses.length < 32 && Number.isInteger(Number(status))) statuses.push(Math.max(0, Math.min(999, Number(status))));
    };
    try {
      const said = await ask(call, { execute, signal: controller.signal, onRequest, onActivity: () => tell(0), onRound: (begun) => tell(begun) });
      if (controller.signal.aborted || !mine()) return;
      const sent = await answer({ job, answer: said, statuses });
      if (!mine()) return;
      if (!sent?.ok) {
        const why = clean(sent?.error).slice(0, 280) || "The host did not take the answer.";
        log(`the host did not take this device's answer for round ${round}: ${why}`);
        put({ job, round, status: "failed", error: why });
        // An answer this device could not even send (over the size a request
        // may be) is still an answer the host waits for: it is told so.
        await answer({ job, failure: { kind: "unsent", busy: false }, statuses }).catch(() => {});
        return;
      }
      put(null);
    } catch (error) {
      if (controller.signal.aborted || !mine()) return;
      const why = clean(error?.message || error).slice(0, 280) || "this device's AI did not answer";
      log(`this device could not make round ${round}'s request: ${why}`);
      put({ job, round, status: "failed", error: why });
      // The kind alone: the provider's own words stay on this device.
      const failure = error?.payFailure && typeof error.payFailure === "object"
        ? { kind: clean(error.payFailure.kind) || "other", busy: error.payFailure.busy === true }
        : { kind: "other", busy: false };
      await answer({ job, failure, statuses }).catch(() => {});
    }
  };

  let controller = null;
  return {
    // The host's "pay" or "payStop".
    receive(message) {
      if (message?.t === "payStop") {
        if (current?.job !== message.job) return;
        controller?.abort();
        put(null);
        return;
      }
      if (message?.t !== "pay") return;
      const { job, round, call } = message;
      // The same request again (sent once more after a reconnect): the one under way answers it.
      if (current?.job === job && current.status === "paying") return;
      if (!cycle()) {
        void answer({ job, failure: { kind: "declined", busy: false } }).catch(() => {});
        return;
      }
      controller?.abort();
      controller = new AbortController();
      put({ job, round, status: "paying", error: "" });
      void run(job, round, call, controller);
    },
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Leaving the game: nothing goes on being asked.
    close() {
      controller?.abort();
      put(null);
    },
  };
};
