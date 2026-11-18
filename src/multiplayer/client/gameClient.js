/*! Open Historia — a player's side of a shared game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Whatever carries it (a WebRTC session opened with an invite token, or the host's
// own screen talking to its engine window), a player's side of a shared game is
// the same: keep the lobby and the round the host last sent, put each view the
// host sends into the page (client/remoteRuntime.js), and send requests
// (game/messages.js), each answered by the host's ack.
//
// Every message from the host has already been checked against its schema by
// the session (or the loopback) before it gets here.
//
// Runtime-free: `send` carries a request out, `applyView` hands a view to the
// page, time is injected.

import { randomBytes, toHex } from "../bytes.js";
import { PLAYER_REQUESTS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";

const NOTICES_KEPT = 20;
// How long a request waits for the host's answer. The host answers once it has
// applied it, and applies everything in one order (host/worldQueue.js), so one
// sent while a round is resolved waits for the round: minutes, with a slow
// model. A request is not given up on while the host is there, and goes again
// with the same id after a reconnect (`resend`); this is only for a host that
// is gone without a word.
export const REQUEST_WAIT_MS = 20 * 60 * 1000;

export const createGameClient = ({
  send,
  applyView = () => false,
  onChange = () => {},
  // With settings.payment "cycle": a request of the round the host sent this
  // device to pay for ({ t: "pay", job, round, call }), or the host's word that
  // it no longer waits for one ({ t: "payStop", job }) (client/roundPayer.js).
  onPay = () => {},
  now = () => Date.now(),
  timers = globalThis,
  requestTimeoutMs = REQUEST_WAIT_MS,
} = {}) => {
  let lobby = null;
  let round = null;
  let roundAt = 0;
  let notices = [];
  let closed = false;
  const pending = new Map(); // request id → { resolve, timer, message }

  const changed = () => onChange({ lobby, round, notices });

  const settle = (id, result) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    timers.clearTimeout(entry.timer);
    entry.resolve(result);
  };

  return {
    receive(message) {
      if (closed || !message || typeof message !== "object") return;
      switch (message.t) {
        case "lobby":
          lobby = message;
          changed();
          break;
        case "round":
          round = message;
          roundAt = now();
          changed();
          break;
        case "ack":
          settle(message.id, { ok: message.ok, error: message.error || "", ...(message.result ? { result: message.result } : {}) });
          break;
        case "notice":
          notices = [...notices, { ...message, at: now() }].slice(-NOTICES_KEPT);
          changed();
          break;
        case "view":
          applyView({ epoch: message.epoch, rev: message.rev, base: message.base, docs: message.docs, sums: message.sums });
          break;
        case "pay":
        case "payStop":
          onPay(message);
          break;
        default:
          break;
      }
    },

    // A request to the host; resolves { ok, error } when the host answers, or
    // with an error when it does not answer in time (`timeoutMs`, for the few
    // the host answers only once its own AI has: a stat sheet). Never rejects.
    request(t, fields = {}, { timeoutMs = requestTimeoutMs } = {}) {
      if (closed) return Promise.resolve({ ok: false, error: "Not connected to a shared game." });
      const id = toHex(randomBytes(8));
      const message = { t, id, ...fields };
      const schema = PLAYER_REQUESTS[t];
      const checked = schema ? validate(schema, message) : { ok: false, error: `unknown request ${t}` };
      if (!checked.ok) return Promise.resolve({ ok: false, error: checked.error });
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => settle(id, { ok: false, error: "The host did not answer." }), timeoutMs);
        pending.set(id, { resolve, timer, message: checked.value });
        try {
          // Not sent while the connection is down: it goes with `resend` once
          // the connection is back.
          send(checked.value);
        } catch (error) {
          settle(id, { ok: false, error: String(error?.message || error) });
        }
      });
    },

    // Every request not yet answered, again, with its own id: after a
    // reconnect. The host applies a request once whatever it is sent, and
    // answers one it has applied with the answer it gave (host/gameHost.js).
    resend() {
      if (closed) return 0;
      let sent = 0;
      for (const entry of pending.values()) {
        try {
          send(entry.message);
          sent += 1;
        } catch {
          // still down: the next reconnect sends it
        }
      }
      return sent;
    },

    // A word to the host that is not a request: nothing answers it (the
    // "viewed" message). Checked like any request; false if it was not sent.
    notify(message) {
      if (closed) return false;
      const schema = PLAYER_REQUESTS[message?.t];
      const checked = schema ? validate(schema, message) : { ok: false };
      if (!checked.ok) return false;
      try {
        send(checked.value);
        return true;
      } catch {
        return false;
      }
    },

    // Time left in the round's current phase, counted down from when the host
    // said it: a player's clock is never compared with the host's.
    remainingMs() {
      if (!round || round.paused) return round?.remainingMs ?? 0;
      return Math.max(0, round.remainingMs - (now() - roundAt));
    },

    get state() {
      return { lobby, round, notices };
    },

    close() {
      closed = true;
      for (const id of [...pending.keys()]) settle(id, { ok: false, error: "Left the shared game." });
    },
  };
};
