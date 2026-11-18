/*! Open Historia — this device paying for a shared round, in its turn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// With the host's setting that players take turns to pay (host/settings.js
// payment "cycle", the owner's decision 14), the round's request is made by
// each player's device in turn, on its own AI key. When it is this device's
// turn the host sends it each request of the round, as the host's engine built
// it ("pay"); this carries it to this device's own AI (Game/AI/main.jsx
// carryRoundRequest) and sends the host the answer as it came ("paid"), or why
// there is none. A lookup the model asks for on the way is asked of the host,
// which answers it from its own game ("payLookup"). Nothing is written here,
// and no key is sent anywhere: the host applies the answer.
//
// Only in a game whose lobby says its players take turns to pay: a host that
// asks a device of a game it pays for itself is answered no.
//
// Import-free but for the message checks: the model, the host and the lobby
// are passed in, so this is tested under bare node.

import { safeParse } from "../protocol/validate.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// `ask(call, { execute, signal })` resolves this device's AI's answer as the
// host takes it ({ text, toolJson, asText }); `answer(fields)` and
// `lookup(fields)` send the host "paid" and "payLookup" and resolve its
// { ok, error, result }; `cycle()` says whether this game's players take turns.
//
// What it is doing, for the round bar: { job, round, status, error }
//   status "paying":  this device is asking its own AI;
//   status "failed":  it could not (`error`), and the host was told why.
export const createRoundPayer = ({
  ask,
  answer,
  lookup,
  cycle = () => true,
  log = () => {},
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
    const execute = async (name, args) => {
      const got = await lookup({ job, name: clean(name).slice(0, 80), args: args && typeof args === "object" && !Array.isArray(args) ? args : {} });
      if (!got?.ok) throw new Error(clean(got?.error) || "The host did not answer the lookup.");
      const parsed = safeParse(String(got.result?.text ?? "null"), { maxLength: 4 * 1024 * 1024, maxDepth: 64 });
      if (!parsed.ok) throw new Error("The host's answer to the lookup does not read.");
      return parsed.value;
    };
    // The status of each provider response, for the host's skip to read as its own.
    const statuses = [];
    const onRequest = (status) => {
      if (statuses.length < 32 && Number.isInteger(Number(status))) statuses.push(Math.max(0, Math.min(999, Number(status))));
    };
    try {
      const said = await ask(call, { execute, signal: controller.signal, onRequest });
      if (controller.signal.aborted || !mine()) return;
      const sent = await answer({ job, answer: said, statuses });
      if (!mine()) return;
      if (!sent?.ok) {
        const why = clean(sent?.error).slice(0, 280) || "The host did not take the answer.";
        log(`the host did not take this device's answer for round ${round}: ${why}`);
        put({ job, round, status: "failed", error: why });
        // An answer this device could not even send (over the size a request
        // may be) is still an answer the host waits for: it is told why.
        await answer({ job, error: `this device's answer could not be sent (${why})` }).catch(() => {});
        return;
      }
      put(null);
    } catch (error) {
      if (controller.signal.aborted || !mine()) return;
      const why = clean(error?.message || error).slice(0, 280) || "this device's AI did not answer";
      log(`this device could not make round ${round}'s request: ${why}`);
      put({ job, round, status: "failed", error: why });
      await answer({ job, error: why, statuses }).catch(() => {});
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
        void answer({ job, error: "This game's host pays for its rounds." }).catch(() => {});
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
