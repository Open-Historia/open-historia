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
//   screen → engine: hello { device, name } | request { message } | control { action, args } | bye
//   engine → screen: message { message }    | status { status }
//                    ai { recordId, taskKey, ok }   an AI call the engine made has finished
//                    log { entries }                what the engine wrote in its diagnostics log
//
// The engine makes every AI call of a shared game, so the last two are how the
// host's own screen learns of them: its AI debug console reads the records the
// engine stored (the two windows share the app's storage), and its diagnostics
// log is the one log a bug report is made from.

import { HOST_MESSAGES, PLAYER_REQUESTS } from "../game/messages.js";
import { bool, json, list, literal, obj, str, union, validate } from "../protocol/validate.js";

export const LOOPBACK_CHANNEL = "oh-mp-host";
export const HOST_CONTROLS = Object.freeze(["open", "start", "pause", "resume", "resolveNow", "kick", "rotate", "stop"]);

const REQUEST = union("t", PLAYER_REQUESTS);
const HOST_MESSAGE = union("t", HOST_MESSAGES);
const FROM_SCREEN = union("type", {
  hello: obj({ type: literal("hello"), device: str(64, { min: 1 }), name: str(40) }),
  request: obj({ type: literal("request"), message: json(16) }),
  control: obj({ type: literal("control"), action: str(16, { enum: HOST_CONTROLS }), args: json(8) }),
  bye: obj({ type: literal("bye") }),
});
const LOG_ENTRY = obj({ category: str(40), message: str(8000), detail: str(8000), problem: bool() });
const FROM_ENGINE = union("type", {
  message: obj({ type: literal("message"), message: json(64) }),
  status: obj({ type: literal("status"), status: json(16) }),
  ai: obj({ type: literal("ai"), recordId: str(80, { min: 1 }), taskKey: str(80), ok: bool() }),
  log: obj({ type: literal("log"), entries: list(LOG_ENTRY, 100) }),
});

const channelOf = (channelImpl) => new (channelImpl ?? globalThis.BroadcastChannel)(LOOPBACK_CHANNEL);

// A closed BroadcastChannel throws on postMessage; once an end is closed it
// goes quiet instead, so a late status or a parting word cannot crash it.
const outbox = (channel) => {
  let open = true;
  return {
    post: (data) => {
      if (open) channel.postMessage(data);
    },
    close: () => {
      if (!open) return;
      open = false;
      channel.close();
    },
  };
};

// The engine's end: one player (the host's screen), its requests and its controls.
export const createLoopbackEngineSide = ({ channelImpl, onHello = () => {}, onRequest = () => {}, onControl = () => {}, onBye = () => {} } = {}) => {
  const channel = channelOf(channelImpl);
  channel.onmessage = (event) => {
    const checked = validate(FROM_SCREEN, event.data);
    if (!checked.ok) return;
    const data = checked.value;
    if (data.type === "hello") onHello({ device: data.device, name: data.name });
    else if (data.type === "request") {
      const request = validate(REQUEST, data.message);
      if (request.ok) onRequest(request.value);
    } else if (data.type === "control") onControl(data.action, data.args ?? null);
    else onBye();
  };
  const out = outbox(channel);
  return {
    send: (message) => out.post({ type: "message", message }),
    status: (status) => out.post({ type: "status", status }),
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
    close: out.close,
  };
};

// The screen's end: what the host sends it as a player, and the engine's status.
export const createLoopbackScreenSide = ({ channelImpl, onMessage = () => {}, onStatus = () => {}, onAi = () => {}, onLog = () => {} } = {}) => {
  const channel = channelOf(channelImpl);
  channel.onmessage = (event) => {
    const checked = validate(FROM_ENGINE, event.data);
    if (!checked.ok) return;
    if (checked.value.type === "status") onStatus(checked.value.status);
    else if (checked.value.type === "ai") onAi({ recordId: checked.value.recordId, taskKey: checked.value.taskKey, ok: checked.value.ok });
    else if (checked.value.type === "log") onLog(checked.value.entries);
    else {
      const message = validate(HOST_MESSAGE, checked.value.message);
      if (message.ok) onMessage(message.value);
    }
  };
  const out = outbox(channel);
  return {
    hello: (device, name) => out.post({ type: "hello", device, name: String(name ?? "").slice(0, 40) }),
    request: (message) => out.post({ type: "request", message }),
    control: (action, args = null) => out.post({ type: "control", action, args }),
    bye: () => out.post({ type: "bye" }),
    close: out.close,
  };
};
