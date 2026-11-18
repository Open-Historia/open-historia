/*! Open Historia — the host's screen and its engine, on one machine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host runs its game in a hidden engine window (host/engineMain.js) and
// plays it from its ordinary window like any other player: the screen reads its
// own view and sends requests, and never touches the game itself. The two are
// the same app on the same origin, so they talk over a BroadcastChannel.
//
// Only the host's own pages share that origin, so this is not a network edge.
// Even so, every request is checked against the same closed schemas as a
// remote player's, and only the screen may send the host's controls.
//
//   screen → engine: hello { device, name } | request { message } | control { action, args } | bye | alive
//   engine → screen: message { message }    | status { status } | alive
//                    ai { recordId, taskKey, ok }   an AI call the engine made has finished
//                    log { entries }                what the engine wrote in its diagnostics log
//
// Each end says it is there every ALIVE_MS ("alive"), and takes the other for
// gone when it has heard nothing from it for GONE_MS: the engine treats a host's
// screen that went quiet as one that left (a page that crashed or froze says no
// bye), and the screen tells its player the engine window stopped. Before,
// neither could tell: the screen counted down to 0:00 against an engine that was
// not there, and the engine went on with nobody at the host's screen.
//
// The engine makes every AI call of a shared game, so the last two are how the
// host's own screen learns of them: its AI debug console reads the records the
// engine stored (the two windows share the app's storage), and its diagnostics
// log is the one log a bug report is made from.

import { HOST_MESSAGES, PLAYER_REQUESTS } from "../game/messages.js";
import { bool, json, list, literal, obj, str, union, validate } from "../protocol/validate.js";

export const LOOPBACK_CHANNEL = "oh-mp-host";
export const HOST_CONTROLS = Object.freeze(["open", "start", "pause", "resume", "resolveNow", "cancelRound", "replies", "seat", "kick", "rotate", "stop"]);
export const ALIVE_MS = 5_000;
export const GONE_MS = 20_000;

const REQUEST = union("t", PLAYER_REQUESTS);
const HOST_MESSAGE = union("t", HOST_MESSAGES);
const FROM_SCREEN = union("type", {
  hello: obj({ type: literal("hello"), device: str(64, { min: 1 }), name: str(40) }),
  request: obj({ type: literal("request"), message: json(16) }),
  control: obj({ type: literal("control"), action: str(16, { enum: HOST_CONTROLS }), args: json(8) }),
  bye: obj({ type: literal("bye") }),
  alive: obj({ type: literal("alive") }),
});
const LOG_ENTRY = obj({ category: str(40), message: str(8000), detail: str(8000), problem: bool() });
const FROM_ENGINE = union("type", {
  message: obj({ type: literal("message"), message: json(64) }),
  status: obj({ type: literal("status"), status: json(16) }),
  ai: obj({ type: literal("ai"), recordId: str(80, { min: 1 }), taskKey: str(80), ok: bool() }),
  log: obj({ type: literal("log"), entries: list(LOG_ENTRY, 100) }),
  alive: obj({ type: literal("alive") }),
});

const channelOf = (channelImpl) => new (channelImpl ?? globalThis.BroadcastChannel)(LOOPBACK_CHANNEL);

// What one window says is held to the schema the other reads it by: a message
// the other would drop is not sent, and is said here (each window's console
// reaches the diagnostics log). And a field left undefined is left out, as JSON
// leaves it, rather than the whole message refused there: the host's page
// coming back after a reload asked the engine to "open" with no settings to
// give, and the engine dropped the request without a word.
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

// A closed BroadcastChannel throws on postMessage; once an end is closed it
// goes quiet instead, so a late status or a parting word cannot crash it.
// `check: false`: a message already held to its schema by its maker (a view,
// which the host builds from its own documents and may be large).
const outbox = (channel, schema) => {
  let open = true;
  return {
    post: (data, { check = true } = {}) => {
      if (!open) return;
      if (check) {
        const checked = validate(schema, data);
        if (!checked.ok) {
          console.warn(`[loopback] a message the other window could not read was not sent (${data?.type}): ${checked.error}`);
          return;
        }
      }
      channel.postMessage(data);
    },
    close: () => {
      if (!open) return;
      open = false;
      channel.close();
    },
  };
};

// Says it is there every ALIVE_MS, and calls `check` each time. Never keeps
// a process alive on its own (tests, a closing window).
const heartbeat = (timers, beat) => {
  const timer = timers.setInterval(beat, ALIVE_MS);
  timer?.unref?.();
  return () => timers.clearInterval(timer);
};

// The engine's end: one player (the host's screen), its requests and its controls.
export const createLoopbackEngineSide = ({ channelImpl, onHello = () => {}, onRequest = () => {}, onControl = () => {}, onBye = () => {}, timers = globalThis, now = () => Date.now() } = {}) => {
  const channel = channelOf(channelImpl);
  // When the host's screen was last heard from; 0 while no screen has said hello.
  let screenHeard = 0;
  channel.onmessage = (event) => {
    const checked = validate(FROM_SCREEN, event.data);
    if (!checked.ok) return;
    const data = checked.value;
    if (data.type === "bye") {
      screenHeard = 0;
      onBye();
      return;
    }
    if (data.type === "hello" || screenHeard) screenHeard = now();
    if (data.type === "hello") onHello({ device: data.device, name: data.name });
    else if (data.type === "request") {
      const request = validate(REQUEST, data.message);
      if (request.ok) onRequest(request.value);
    } else if (data.type === "control") onControl(data.action, data.args ?? null);
  };
  const out = outbox(channel, FROM_ENGINE);
  const stopBeating = heartbeat(timers, () => {
    out.post({ type: "alive" });
    if (screenHeard && now() - screenHeard > GONE_MS) {
      screenHeard = 0;
      onBye();
    }
  });
  return {
    // The host held it to the players' schemas already (host/gameHost.js send).
    send: (message) => out.post({ type: "message", message }, { check: false }),
    status: (status) => out.post({ type: "status", status: plain(status) }),
    ai: ({ recordId, taskKey, ok } = {}) => out.post({ type: "ai", recordId: String(recordId ?? ""), taskKey: String(taskKey ?? "").slice(0, 80), ok: ok !== false }),
    log: (entries) => out.post({
      type: "log",
      entries: (Array.isArray(entries) ? entries : []).slice(0, 100).map((entry) => ({
        category: String(entry?.category ?? "app").slice(0, 40),
        message: String(entry?.message ?? "").slice(0, 8000),
        detail: String(entry?.detail ?? "").slice(0, 8000),
        problem: entry?.problem === true,
      })),
    }),
    close: () => {
      stopBeating();
      out.close();
    },
  };
};

// The screen's end: what the host sends it as a player, and the engine's status.
// `onGone`: the engine, heard from before, has said nothing for GONE_MS.
export const createLoopbackScreenSide = ({ channelImpl, onMessage = () => {}, onStatus = () => {}, onAi = () => {}, onLog = () => {}, onGone = () => {}, timers = globalThis, now = () => Date.now() } = {}) => {
  const channel = channelOf(channelImpl);
  // When the engine was last heard from (0: not yet), and whether it was said gone.
  let engineHeard = 0;
  let gone = false;
  channel.onmessage = (event) => {
    const checked = validate(FROM_ENGINE, event.data);
    if (!checked.ok) return;
    engineHeard = now();
    gone = false;
    if (checked.value.type === "alive") return;
    if (checked.value.type === "status") onStatus(checked.value.status);
    else if (checked.value.type === "ai") onAi({ recordId: checked.value.recordId, taskKey: checked.value.taskKey, ok: checked.value.ok });
    else if (checked.value.type === "log") onLog(checked.value.entries);
    else {
      const message = validate(HOST_MESSAGE, checked.value.message);
      if (message.ok) onMessage(message.value);
    }
  };
  const out = outbox(channel, FROM_SCREEN);
  const stopBeating = heartbeat(timers, () => {
    out.post({ type: "alive" });
    if (engineHeard && !gone && now() - engineHeard > GONE_MS) {
      gone = true;
      onGone();
    }
  });
  return {
    hello: (device, name) => out.post({ type: "hello", device, name: String(name ?? "").slice(0, 40) }),
    request: (message) => out.post({ type: "request", message }),
    control: (action, args = null) => out.post({ type: "control", action, args: plain(args) }),
    bye: () => out.post({ type: "bye" }),
    close: () => {
      stopBeating();
      out.close();
    },
  };
};
