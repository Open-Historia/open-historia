/*! Open Historia — hosting a multiplayer game: one token, many players © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host listens on its room's topic (signaling/nostr.js) and answers every
// offer made with the invite token, up to the number of seats. Each answer is
// signed with the host key the token pins, so a player can tell the real host
// from anyone else who holds the token.
//
// Once a data channel opens, the first thing the player must send is a hello:
// its device key, a signature by that key over both ends' DTLS fingerprints
// (which binds the device to this very connection, so a hello cannot be lifted
// from one connection into another), and a proof derived from the token. The
// device key is who the player is: a device that comes back takes up the same
// place it left, and one that connects twice replaces its older connection.
//
// After that every message is rate-limited, parsed safely and checked against
// the schemas. A malformed one is dropped and counts a strike; enough strikes
// and the player is removed. Nothing a player sends reaches the game unchecked.

import { deriveRoomKeys } from "../invite.js";
import { fromBase64Url, equalBytes, randomBytes, toHex } from "../bytes.js";
import { signFields, verifyFields } from "../identity.js";
import { createDecoder, encodeMessage } from "../protocol/codec.js";
import { validate } from "../protocol/validate.js";
import { createNostrChannel } from "../signaling/nostr.js";
import { createPeer } from "../transport/peer.js";
import { PROTOCOL_VERSION, SIGNAL, createMessageSchema, isFresh, signed } from "./messages.js";

const DEFAULT_LIMITS = Object.freeze({
  offersPerMinute: 30,
  offersPerDevicePerMinute: 10,
  messagesPerSecond: 30,
  messageBurst: 60,
  strikesToRemove: 5,
  pendingTimeoutMs: 30_000,
  helloTimeoutMs: 10_000,
  beaconIntervalMs: 15_000,
  pingIntervalMs: 15_000,
  answerCacheMs: 60_000,
});

const sameProof = (a, b) => {
  try {
    return equalBytes(fromBase64Url(a), fromBase64Url(b));
  } catch {
    return false;
  }
};

export const createHostSession = ({
  invite,
  host,
  room,
  appMessages = {},
  channelFactory = (options) => createNostrChannel(options),
  peerFactory = (options) => createPeer(options),
  peerOptions = {},
  isBanned = () => false,
  onJoin = () => {},
  onLeave = () => {},
  onMessage = () => {},
  onStatus = () => {},
  log = () => {},
  now = () => Date.now(),
  timers = globalThis,
  limits: limitOverrides = {},
} = {}) => {
  if (host?.id !== invite?.hostKey) throw new Error("The invite token was made for another host key.");
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const schema = createMessageSchema(appMessages);
  const roomInfo = { name: String(room?.name ?? "Open Historia"), seats: Math.max(1, Math.min(64, Number(room?.seats) || 8)), version: String(room?.version ?? "") };

  let currentInvite = invite;
  let keys = deriveRoomKeys(invite);
  let channel = null;
  let running = false;
  let beaconTimer = null;
  let pingTimer = null;
  let pingCounter = 0;
  const players = new Map();
  const byDevice = new Map();
  const pending = new Map();
  const answered = new Map();
  const banned = new Set();
  const offerLog = [];
  const deviceOffers = new Map();

  const seated = () => [...players.values()].filter((player) => player.status === "connected").length;
  const publicPlayer = (player) => ({ id: player.id, name: player.name, device: player.device, status: player.status, rttMs: player.rttMs ?? null });

  const report = () => onStatus({
    relays: channel?.status() ?? { connected: 0, total: 0 },
    players: [...players.values()].map(publicPlayer),
    pending: pending.size,
    token: currentInvite.token,
  });

  const signPayload = (kind, payload) => {
    const [label, fields] = signed[kind](currentInvite.roomId, payload);
    return { ...payload, sig: signFields(host, label, fields) };
  };

  const publishBeacon = () => {
    if (!running) return;
    channel?.publish(signPayload("beacon", {
      t: "beacon", v: PROTOCOL_VERSION, name: roomInfo.name,
      open: Math.max(0, roomInfo.seats - seated()), seats: roomInfo.seats, version: roomInfo.version, ts: now(),
    }));
  };

  const deny = (session, reason) => {
    channel?.publish(signPayload("deny", { t: "deny", v: PROTOCOL_VERSION, session, reason, ts: now() }));
  };

  const withinRate = (device) => {
    const cutoff = now() - 60_000;
    while (offerLog.length && offerLog[0] < cutoff) offerLog.shift();
    if (offerLog.length >= limits.offersPerMinute) return false;
    const mine = (deviceOffers.get(device) ?? []).filter((at) => at >= cutoff);
    if (mine.length >= limits.offersPerDevicePerMinute) return false;
    offerLog.push(now());
    mine.push(now());
    deviceOffers.set(device, mine);
    return true;
  };

  const sendTo = (peer, message) => {
    const frames = encodeMessage(message);
    if (frames.length === 1) return peer.send(frames[0]);
    peer.sendAll(frames);
    return true;
  };

  const dropPending = (session) => {
    const entry = pending.get(session);
    if (!entry) return;
    pending.delete(session);
    timers.clearTimeout(entry.timer);
    entry.peer?.close();
    report();
  };

  // The reason goes out first and the connection closes a moment later: a
  // channel closed at once can drop what was just sent to it.
  const removePlayer = (player, reason, { closeWith } = {}) => {
    const peer = player.peer;
    player.peer = null;
    player.status = "gone";
    if (closeWith && peer?.open) {
      sendTo(peer, closeWith);
      timers.setTimeout(() => peer.close(), 150);
    } else {
      peer?.close();
    }
    players.delete(player.id);
    if (byDevice.get(player.device) === player.id) byDevice.delete(player.device);
    onLeave(publicPlayer(player), reason);
    publishBeacon();
    report();
  };

  const strike = (player, why) => {
    player.strikes += 1;
    log(`player ${player.name}: ${why} (strike ${player.strikes})`);
    if (player.strikes >= limits.strikesToRemove) {
      removePlayer(player, "misbehaving", { closeWith: { t: "reject", v: PROTOCOL_VERSION, reason: "misbehaving" } });
    }
  };

  // A token bucket per player: a burst is allowed, a stream is not.
  const allowMessage = (player) => {
    const elapsed = (now() - player.bucketAt) / 1000;
    player.bucketAt = now();
    player.tokens = Math.min(limits.messageBurst, player.tokens + elapsed * limits.messagesPerSecond);
    if (player.tokens < 1) return false;
    player.tokens -= 1;
    return true;
  };

  const handleHello = (entry, frame) => {
    const reject = (reason) => {
      sendTo(entry.peer, { t: "reject", v: PROTOCOL_VERSION, reason });
      log(`joiner ${entry.name}: refused (${reason})`);
      timers.setTimeout(() => dropPending(entry.session), 50);
    };
    const decoded = entry.decoder.feed(frame);
    if (decoded.pending) return;
    if (decoded.error) return reject("bad-hello");
    const checked = validate(schema, decoded.message);
    if (!checked.ok || checked.value.t !== "hello") return reject("bad-hello");
    const hello = checked.value;
    const { local: hostFingerprint, remote: playerFingerprint } = entry.peer.fingerprints();
    const [label, fields] = signed.hello(currentInvite.roomId, { session: entry.session, hostFingerprint, playerFingerprint });
    if (hello.session !== entry.session || hello.device !== entry.device || !hostFingerprint || !playerFingerprint
      || !verifyFields(hello.device, label, fields, hello.sig)
      || !sameProof(hello.proof, keys.joinProof([entry.session, hostFingerprint, playerFingerprint, hello.device]))) {
      return reject("bad-hello");
    }
    if (hello.version !== roomInfo.version) return reject("version");
    if (banned.has(hello.device) || isBanned(hello.device)) return reject("banned");

    const knownId = byDevice.get(hello.device);
    const known = knownId ? players.get(knownId) : null;
    if (!known && seated() >= roomInfo.seats) return reject("full");

    timers.clearTimeout(entry.timer);
    pending.delete(entry.session);
    let player = known;
    const resumed = Boolean(known);
    if (known) {
      // The same device again: its new connection replaces the old one.
      if (known.peer && known.peer !== entry.peer) {
        const old = known.peer;
        known.peer = null;
        sendTo(old, { t: "reject", v: PROTOCOL_VERSION, reason: "replaced" });
        timers.setTimeout(() => old.close(), 50);
      }
    } else {
      player = { id: toHex(randomBytes(8)), device: hello.device, strikes: 0 };
      players.set(player.id, player);
      byDevice.set(hello.device, player.id);
    }
    Object.assign(player, {
      name: hello.name, peer: entry.peer, decoder: entry.decoder, session: entry.session,
      status: "connected", tokens: limits.messageBurst, bucketAt: now(), lastSeen: now(),
    });
    entry.bind(player);
    sendTo(player.peer, { t: "welcome", v: PROTOCOL_VERSION, player: player.id, room: { name: roomInfo.name, seats: roomInfo.seats } });
    log(`player ${player.name} ${resumed ? "is back" : "joined"}`);
    onJoin(publicPlayer(player), { resumed });
    publishBeacon();
    report();
  };

  const handleMessage = (player, frame) => {
    if (player.status !== "connected") return;
    if (!allowMessage(player)) return strike(player, "too many messages");
    const decoded = player.decoder.feed(frame);
    if (decoded.pending) return;
    if (decoded.error) return strike(player, decoded.error);
    const checked = validate(schema, decoded.message);
    if (!checked.ok) return strike(player, `an invalid message (${checked.error})`);
    const message = checked.value;
    player.lastSeen = now();
    switch (message.t) {
      case "ping":
        return sendTo(player.peer, { t: "pong", n: message.n });
      case "pong":
        if (player.pingSent && message.n === player.pingN) player.rttMs = now() - player.pingSent;
        return undefined;
      case "bye":
        return removePlayer(player, "left");
      case "hello":
      case "welcome":
      case "reject":
        return strike(player, `a ${message.t} out of place`);
      default:
        return onMessage(publicPlayer(player), message);
    }
  };

  const handleOffer = async (offer) => {
    if (!isFresh(offer.ts, now())) return;
    const cached = answered.get(offer.session);
    if (cached && cached.expires > now()) {
      // The joiner may have missed our answer: send the same one again.
      channel?.publish(cached.payload);
      return;
    }
    if (pending.has(offer.session)) return;
    if (!withinRate(offer.device)) return log("an offer over the rate limit was ignored");
    if (banned.has(offer.device) || isBanned(offer.device)) return deny(offer.session, "banned");
    if (offer.version !== roomInfo.version) return deny(offer.session, "version");
    if (!byDevice.has(offer.device) && seated() + pending.size >= roomInfo.seats) return deny(offer.session, "full");

    let bound = null;
    const entry = {
      session: offer.session,
      device: offer.device,
      name: offer.name,
      decoder: createDecoder(),
      bind: (player) => { bound = player; },
      timer: timers.setTimeout(() => {
        if (pending.get(offer.session) === entry) {
          log(`joiner ${offer.name}: never finished joining`);
          dropPending(offer.session);
        }
      }, limits.pendingTimeoutMs),
    };
    entry.peer = peerFactory({
      ...peerOptions,
      timers,
      onOpen: () => {
        timers.clearTimeout(entry.timer);
        entry.timer = timers.setTimeout(() => {
          if (pending.get(offer.session) === entry) {
            sendTo(entry.peer, { t: "reject", v: PROTOCOL_VERSION, reason: "timeout" });
            dropPending(offer.session);
          }
        }, limits.helloTimeoutMs);
      },
      onMessage: (frame) => (bound ? handleMessage(bound, frame) : handleHello(entry, frame)),
      onClose: (reason) => {
        if (pending.get(offer.session) === entry) return dropPending(offer.session);
        if (bound && bound.peer === entry.peer && players.get(bound.id) === bound && bound.status === "connected") {
          bound.status = "away";
          onLeave(publicPlayer(bound), reason);
          publishBeacon();
          report();
        }
        return undefined;
      },
    });
    pending.set(offer.session, entry);
    report();
    try {
      const sdp = await entry.peer.answerOffer(offer.sdp);
      if (pending.get(offer.session) !== entry || !running) return;
      const payload = signPayload("answer", { t: "answer", v: PROTOCOL_VERSION, session: offer.session, sdp, ts: now() });
      answered.set(offer.session, { payload, expires: now() + limits.answerCacheMs });
      for (const [session, cache] of answered) if (cache.expires < now()) answered.delete(session);
      channel?.publish(payload);
    } catch (error) {
      log(`could not answer ${offer.name}: ${error?.message || error}`);
      dropPending(offer.session);
      deny(offer.session, "busy");
    }
  };

  const onPayload = (payload) => {
    const checked = validate(SIGNAL, payload);
    if (!checked.ok) return log(`a malformed signaling message (${checked.error})`);
    if (checked.value.t === "offer") handleOffer(checked.value);
    return undefined;
  };

  const openChannel = () => {
    channel = channelFactory({ topic: keys.topic, key: keys.signalKey, onPayload, onStatus: report, log, now, timers });
  };

  return {
    start() {
      if (running) return;
      running = true;
      openChannel();
      publishBeacon();
      beaconTimer = timers.setInterval(publishBeacon, limits.beaconIntervalMs);
      pingTimer = timers.setInterval(() => {
        pingCounter = (pingCounter + 1) % 2 ** 31;
        for (const player of players.values()) {
          if (player.status !== "connected") continue;
          player.pingN = pingCounter;
          player.pingSent = now();
          sendTo(player.peer, { t: "ping", n: pingCounter });
        }
      }, limits.pingIntervalMs);
      report();
    },

    // One player, or everyone connected (except whoever `except` names).
    send(playerId, message) {
      const player = players.get(playerId);
      if (!player || player.status !== "connected") return false;
      return sendTo(player.peer, message);
    },
    broadcast(message, { except = null } = {}) {
      let count = 0;
      for (const player of players.values()) {
        if (player.status !== "connected" || player.id === except) continue;
        if (sendTo(player.peer, message)) count += 1;
      }
      return count;
    },

    kick(playerId, { ban = false } = {}) {
      const player = players.get(playerId);
      if (!player) return false;
      if (ban) banned.add(player.device);
      if (player.status === "connected") removePlayer(player, "kicked", { closeWith: { t: "reject", v: PROTOCOL_VERSION, reason: ban ? "banned" : "kicked" } });
      else removePlayer(player, "kicked");
      return true;
    },

    // A new token for the same game. Whoever held the old one can no longer
    // reach the host; everyone already connected stays.
    rotate(nextInvite) {
      if (nextInvite?.hostKey !== host.id) throw new Error("The new token was made for another host key.");
      currentInvite = nextInvite;
      keys = deriveRoomKeys(nextInvite);
      answered.clear();
      if (running) {
        channel?.close();
        openChannel();
        publishBeacon();
      }
      report();
    },

    setRoom({ name, seats } = {}) {
      if (name !== undefined) roomInfo.name = String(name);
      if (seats !== undefined) roomInfo.seats = Math.max(1, Math.min(64, Number(seats) || roomInfo.seats));
      publishBeacon();
      report();
    },

    players: () => [...players.values()].map(publicPlayer),

    stop() {
      if (!running) return;
      running = false;
      timers.clearInterval(beaconTimer);
      timers.clearInterval(pingTimer);
      for (const player of [...players.values()]) {
        if (player.status === "connected") sendTo(player.peer, { t: "bye", reason: "closed" });
        const peer = player.peer;
        timers.setTimeout(() => peer?.close(), 50);
      }
      for (const session of [...pending.keys()]) dropPending(session);
      channel?.close();
      channel = null;
      report();
    },
  };
};
