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
//   lost          gave up ({ reason }): see below
//   invalid       the token itself is wrong ({ message })
//   left          we left
//
// Every state comes with what is known so far: { room, heard, failures }.
// `heard` is true once anything signed by the host has arrived (its beacon or
// an answer), and `failures` counts connections the host answered that then
// never opened. A screen that shows only "finding" for all of this cannot tell
// a wrong code from two networks that will not connect, so nothing here waits
// without an end, and each end has its own reason:
//   host-not-found  nothing from the host at all: a wrong or old code, a
//                   lobby that is closed, or relays neither side shares
//   no-answer       the host has been heard, but answers no offer
//                   (findTimeoutMs of offering with no answer)
//   cannot-connect  the host answers, and the connection never opens
//                   (maxConnectFailures in a row): the two networks will not
//                   connect directly (transport/peer.js)
//   no-welcome      the connection opens and the host never lets us in
//   host-closed     the host closed the game
//   gave-up         a player who was in could not get back

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
  // Something the host sent that this build cannot read ({ error }): dropped,
  // and said, because a lobby that never arrives looks like a host never found.
  onProblem = () => {},
  log = () => {},
  now = () => Date.now(),
  timers = globalThis,
  offerIntervalMs = 5000,
  findTimeoutMs = 90_000,
  // From the host's answer to an open connection. A browser gives up on its
  // own after about half a minute; this is for one that never says so.
  connectTimeoutMs = 45_000,
  joinTimeoutMs = 20_000,
  maxReconnects = 20,
  // Answered connections that may fail to open, one after another, before a
  // player who was never in is told the two computers cannot reach each other.
  maxConnectFailures = 3,
  maxJoinFailures = 3,
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
  let findArmed = false;
  let heard = false;
  let connectFailures = 0;
  let joinFailures = 0;

  const known = (extra = {}) => ({ room, heard, failures: connectFailures, ...extra });
  const setState = (next, detail = {}) => {
    state = next;
    onState(next, known(detail));
  };
  const hearHost = () => {
    if (heard) return;
    heard = true;
    log("the host's lobby is there");
    // The same state again, now with `heard`: a screen can say so.
    if (state === "finding") onState(state, known());
  };

  const finished = () => ["rejected", "lost", "invalid", "left"].includes(state);

  // The wait for the host to answer an offer. It runs from the start of the
  // joining, stops when an answer comes (the connection then has limits of its
  // own: connectionFailed, the join timer) and runs anew when the offering
  // starts again, so no stretch of offering into silence is without an end.
  // A player who was in keeps trying for as long as their screen is open.
  const stopFindTimer = () => {
    timers.clearTimeout(findTimer);
    findArmed = false;
  };
  const armFindTimer = () => {
    stopFindTimer();
    if (player) return;
    findArmed = true;
    findTimer = timers.setTimeout(() => {
      findArmed = false;
      if (finished() || player) return;
      giveUp("lost", { reason: heard ? "no-answer" : "host-not-found" });
    }, findTimeoutMs);
  };

  const endAttempt = () => {
    if (!attempt) return;
    timers.clearInterval(attempt.offerTimer);
    timers.clearTimeout(attempt.joinTimer);
    timers.clearTimeout(attempt.connectTimer);
    const peer = attempt.peer;
    attempt = null;
    peer?.close();
  };

  // A connection the host answered never opened. For a player who was never
  // in, a few of these in a row is the answer: these two networks do not
  // connect directly, and trying for ten more minutes says nothing new.
  const connectionFailed = (why) => {
    connectFailures += 1;
    log(`the host answered, but the connection did not open (${why}); ${connectFailures} time(s) in a row`);
    if (!player && connectFailures >= maxConnectFailures) return giveUp("lost", { reason: "cannot-connect" });
    setState(player ? "reconnecting" : "finding");
    return scheduleRetry();
  };

  const giveUp = (next, detail) => {
    endAttempt();
    timers.clearTimeout(retryTimer);
    stopFindTimer();
    channel?.close();
    channel = null;
    setState(next, detail);
  };

  const scheduleRetry = () => {
    if (finished()) return;
    if (reconnects >= maxReconnects) return giveUp("lost", { reason: "gave-up" });
    const delay = RETRY_DELAYS[Math.min(reconnects, RETRY_DELAYS.length - 1)];
    reconnects += 1;
    if (!findArmed) armFindTimer();
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
    if (decoded.error) {
      log(`the host sent ${decoded.error}`);
      return onProblem({ error: decoded.error });
    }
    const checked = validate(schema, decoded.message);
    if (!checked.ok) {
      log(`the host sent a message this build cannot read (${checked.error})`);
      return onProblem({ error: checked.error, type: String(decoded.message?.t ?? "").slice(0, 24) });
    }
    const message = checked.value;
    switch (message.t) {
      case "welcome":
        timers.clearTimeout(current.joinTimer);
        player = message.player;
        room = { ...(room ?? {}), name: message.room.name, seats: message.room.seats };
        reconnects = 0;
        connectFailures = 0;
        joinFailures = 0;
        stopFindTimer();
        log("the host let us in");
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
    setState("joining");
    current.joinTimer = timers.setTimeout(() => {
      if (attempt === current && state === "joining") {
        joinFailures += 1;
        log(`connected, but the host did not let us in; ${joinFailures} time(s) in a row`);
        endAttempt();
        if (!player && joinFailures >= maxJoinFailures) return giveUp("lost", { reason: "no-welcome" });
        scheduleRetry();
      }
      return undefined;
    }, joinTimeoutMs);
  };

  async function startAttempt() {
    if (finished()) return;
    endAttempt();
    const current = { session: toHex(randomBytes(16)), decoder: createDecoder(), answered: false, opened: false };
    attempt = current;
    setState(player ? "reconnecting" : "finding");
    current.peer = peerFactory({
      ...peerOptions,
      timers,
      onOpen: () => {
        if (attempt !== current) return;
        current.opened = true;
        timers.clearTimeout(current.connectTimer);
        connectFailures = 0;
        log("connected to the host's computer");
        sendHello(current);
      },
      onMessage: (frame) => handleFrame(current, frame),
      onClose: (reason) => {
        if (attempt !== current || finished()) return;
        attempt = null;
        timers.clearInterval(current.offerTimer);
        timers.clearTimeout(current.joinTimer);
        timers.clearTimeout(current.connectTimer);
        // Answered, and it never opened: not a dropped connection.
        if (current.answered && !current.opened) return connectionFailed(reason);
        log(`the connection closed (${reason})`);
        if (player) setState("reconnecting");
        return scheduleRetry();
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
      hearHost();
      return undefined;
    }
    const current = attempt;
    if (!current || message.session !== current.session) return undefined;
    if (message.t === "answer") {
      if (current.answered) return undefined;
      const [label, fields] = signed.answer(invite.roomId, message);
      if (!verifyFields(invite.hostKey, label, fields, message.sig)) return log("an answer not signed by this game's host was ignored");
      current.answered = true;
      stopFindTimer();
      hearHost();
      log("the host answered; connecting to its computer");
      timers.clearInterval(current.offerTimer);
      setState(player ? "reconnecting" : "connecting");
      current.connectTimer = timers.setTimeout(() => {
        if (attempt !== current || current.opened) return;
        endAttempt();
        connectionFailed("no connection in time");
      }, connectTimeoutMs);
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
      hearHost();
      log(`the host turned the offer away (${message.reason})`);
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
      armFindTimer();
      log("looking for the host on the relays");
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
        timers.clearTimeout(current.connectTimer);
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
