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

export const createGameClient = ({
  send,
  applyView = () => false,
  onChange = () => {},
  now = () => Date.now(),
  timers = globalThis,
  requestTimeoutMs = 30_000,
} = {}) => {
  let lobby = null;
  let round = null;
  let roundAt = 0;
  let notices = [];
  let closed = false;
  const pending = new Map(); // request id → { resolve, timer }

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
          settle(message.id, { ok: message.ok, error: message.error || "" });
          break;
        case "notice":
          notices = [...notices, { ...message, at: now() }].slice(-NOTICES_KEPT);
          changed();
          break;
        case "view":
          applyView({ rev: message.rev, docs: message.docs });
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
        pending.set(id, { resolve, timer });
        try {
          send(checked.value);
        } catch (error) {
          settle(id, { ok: false, error: String(error?.message || error) });
        }
      });
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
