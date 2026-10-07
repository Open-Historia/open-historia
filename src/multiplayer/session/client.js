/*! Open Historia — joining a multiplayer game with an invite token © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A player pastes the token; this does the rest. It listens on the room's
// topic, publishes a WebRTC offer (again every few seconds, until the host
// answers), and accepts only an answer signed by the host key the token pins:
// anyone else holding the token can knock, but cannot answer as the host.
// When the data channel opens it sends its hello, and it is in once the host
// says welcome. If the connection drops it tries again by itself, with a new
// offer, and comes back as the same player: the device key is who it is.
//
// States (onState):
//   finding       listening for the host, offering to connect
//   connecting    the host answered; the connection is opening
//   joining       connected; hello sent, waiting to be let in
//   connected     in the game
//   reconnecting  the connection dropped; trying again
//   rejected      the host turned us away ({ reason })
//   lost          gave up reconnecting, or never found the host
//   invalid       the token itself is wrong ({ message })
//   left          we left

import { deriveRoomKeys, parseInvite } from "../invite.js";
import { randomBytes, toHex } from "../bytes.js";
import { signFields, verifyFields } from "../identity.js";
import { createDecoder, encodeMessage } from "../protocol/codec.js";
import { validate } from "../protocol/validate.js";
import { createNostrChannel } from "../signaling/nostr.js";
import { createPeer } from "../transport/peer.js";
import { PROTOCOL_VERSION, SIGNAL, createMessageSchema, isFresh, signed } from "./messages.js";

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15_000];

export const createClientSession = ({
  token,
  device,
  name,
  version,
  appMessages = {},
  channelFactory = (options) => createNostrChannel(options),
  peerFactory = (options) => createPeer(options),
  peerOptions = {},
  onState = () => {},
  onRoom = () => {},
  onMessage = () => {},
  log = () => {},
  now = () => Date.now(),
  timers = globalThis,
  offerIntervalMs = 5000,
  findTimeoutMs = 90_000,
  joinTimeoutMs = 20_000,
  maxReconnects = 20,
} = {}) => {
  const schema = createMessageSchema(appMessages);
  let invite = null;
  let keys = null;
  let channel = null;
  let state = "idle";
  let attempt = null;
  let player = null;
  let room = null;
  let reconnects = 0;
  let retryTimer = null;
  let findTimer = null;

  const setState = (next, detail = {}) => {
    state = next;
    onState(next, detail);
  };

  const finished = () => ["rejected", "lost", "invalid", "left"].includes(state);

  const endAttempt = () => {
    if (!attempt) return;
    timers.clearInterval(attempt.offerTimer);
    timers.clearTimeout(attempt.joinTimer);
    const peer = attempt.peer;
    attempt = null;
    peer?.close();
  };

  const giveUp = (next, detail) => {
    endAttempt();
    timers.clearTimeout(retryTimer);
    timers.clearTimeout(findTimer);
    channel?.close();
    channel = null;
    setState(next, detail);
  };

  const scheduleRetry = () => {
    if (finished()) return;
    if (reconnects >= maxReconnects) return giveUp("lost", { reason: "gave-up" });
    const delay = RETRY_DELAYS[Math.min(reconnects, RETRY_DELAYS.length - 1)];
    reconnects += 1;
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(startAttempt, delay);
    return undefined;
  };

  const sendNow = (message) => {
    if (!attempt?.peer) return false;
    const frames = encodeMessage(message);
    if (frames.length === 1) return attempt.peer.send(frames[0]);
    attempt.peer.sendAll(frames);
    return true;
  };

  const handleFrame = (current, frame) => {
    if (attempt !== current) return;
    const decoded = current.decoder.feed(frame);
    if (decoded.pending) return;
    if (decoded.error) return log(`the host sent ${decoded.error}`);
    const checked = validate(schema, decoded.message);
    if (!checked.ok) return log(`the host sent an invalid message (${checked.error})`);
    const message = checked.value;
    switch (message.t) {
      case "welcome":
        timers.clearTimeout(current.joinTimer);
        player = message.player;
        room = { ...(room ?? {}), name: message.room.name, seats: message.room.seats };
        reconnects = 0;
        timers.clearTimeout(findTimer);
        setState("connected", { player, room });
        return undefined;
      case "reject":
        // "replaced": this device joined again from another window, which
        // now holds the place; trying again here would only take it back.
        return giveUp("rejected", { reason: message.reason });
      case "bye":
        return giveUp(message.reason === "closed" ? "lost" : "rejected", { reason: message.reason === "closed" ? "host-closed" : message.reason });
      case "ping":
        sendNow({ t: "pong", n: message.n });
        return undefined;
      case "pong":
      case "hello":
        return undefined;
      default:
        if (state === "connected") onMessage(message);
        return undefined;
    }
  };

  const sendHello = (current) => {
    const { local: playerFingerprint, remote: hostFingerprint } = current.peer.fingerprints();
    const [label, fields] = signed.hello(invite.roomId, { session: current.session, hostFingerprint, playerFingerprint });
    sendNow({
      t: "hello", v: PROTOCOL_VERSION, session: current.session, device: device.id, name, version,
      proof: keys.joinProof([current.session, hostFingerprint, playerFingerprint, device.id]),
      sig: signFields(device, label, fields),
    });
    setState("joining", { room });
    current.joinTimer = timers.setTimeout(() => {
      if (attempt === current && state === "joining") {
        log("the host did not let us in; trying again");
        endAttempt();
        scheduleRetry();
      }
    }, joinTimeoutMs);
  };

  async function startAttempt() {
    if (finished()) return;
    endAttempt();
    const current = { session: toHex(randomBytes(16)), decoder: createDecoder(), answered: false };
    attempt = current;
    setState(player ? "reconnecting" : "finding", { room });
    current.peer = peerFactory({
      ...peerOptions,
      timers,
      onOpen: () => {
        if (attempt === current) sendHello(current);
      },
      onMessage: (frame) => handleFrame(current, frame),
      onClose: (reason) => {
        if (attempt !== current || finished()) return;
        log(`the connection closed (${reason})`);
        attempt = null;
        timers.clearInterval(current.offerTimer);
        timers.clearTimeout(current.joinTimer);
        if (player) setState("reconnecting", { room });
        scheduleRetry();
      },
    });
    try {
      current.offer = {
        t: "offer", v: PROTOCOL_VERSION, session: current.session, sdp: await current.peer.createOffer(),
        device: device.id, name, version, ts: now(),
      };
    } catch (error) {
      log(`could not make an offer: ${error?.message || error}`);
      if (attempt === current) {
        endAttempt();
        scheduleRetry();
      }
      return;
    }
    if (attempt !== current) return;
    const offerAgain = () => {
      if (attempt !== current || current.answered) return;
      channel?.publish({ ...current.offer, ts: now() });
    };
    offerAgain();
    current.offerTimer = timers.setInterval(offerAgain, offerIntervalMs);
  }

  const onPayload = async (payload) => {
    const checked = validate(SIGNAL, payload);
    if (!checked.ok) return log(`a malformed signaling message (${checked.error})`);
    const message = checked.value;
    if (!isFresh(message.ts, now())) return undefined;
    if (message.t === "beacon") {
      const [label, fields] = signed.beacon(invite.roomId, message);
      if (!verifyFields(invite.hostKey, label, fields, message.sig)) return log("a beacon not signed by this game's host");
      room = { name: message.name, open: message.open, seats: message.seats, version: message.version };
      onRoom(room);
      return undefined;
    }
    const current = attempt;
    if (!current || message.session !== current.session) return undefined;
    if (message.t === "answer") {
      if (current.answered) return undefined;
      const [label, fields] = signed.answer(invite.roomId, message);
      if (!verifyFields(invite.hostKey, label, fields, message.sig)) return log("an answer not signed by this game's host was ignored");
      current.answered = true;
      timers.clearInterval(current.offerTimer);
      setState(player ? "reconnecting" : "connecting", { room });
      try {
        await current.peer.acceptAnswer(message.sdp);
      } catch (error) {
        log(`the host's answer could not be used: ${error?.message || error}`);
        if (attempt === current) {
          endAttempt();
          scheduleRetry();
        }
      }
      return undefined;
    }
    if (message.t === "deny") {
      const [label, fields] = signed.deny(invite.roomId, message);
      if (!verifyFields(invite.hostKey, label, fields, message.sig)) return undefined;
      if (message.reason === "busy") {
        endAttempt();
        return scheduleRetry();
      }
      return giveUp("rejected", { reason: message.reason });
    }
    return undefined;
  };

  return {
    connect() {
      try {
        invite = parseInvite(token);
      } catch (error) {
        setState("invalid", { message: error.message });
        return;
      }
      keys = deriveRoomKeys(invite);
      channel = channelFactory({ topic: keys.topic, key: keys.signalKey, onPayload, log, now, timers });
      findTimer = timers.setTimeout(() => {
        if (state === "finding") giveUp("lost", { reason: "host-not-found" });
      }, findTimeoutMs);
      startAttempt();
    },

    send(message) {
      if (state !== "connected") return false;
      return sendNow(message);
    },

    leave() {
      if (finished()) return;
      if (state === "connected") sendNow({ t: "bye", reason: "left" });
      const current = attempt;
      attempt = null;
      if (current) {
        timers.clearInterval(current.offerTimer);
        timers.clearTimeout(current.joinTimer);
        // A moment for the goodbye to go out before the connection closes.
        timers.setTimeout(() => current.peer?.close(), 50);
      }
      giveUp("left", {});
    },

    get state() {
      return state;
    },
    get player() {
      return player;
    },
    get room() {
      return room;
    },
    get roomId() {
      return invite?.roomId ?? null;
    },
  };
};
