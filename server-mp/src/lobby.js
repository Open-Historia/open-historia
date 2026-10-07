/*! Open Historia — what a connection to the public multiplayer server may ask for © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The server has two jobs: a listing of public games, and a meeting place
// where a player's WebRTC offer reaches a game's host and the host's answer
// comes back. It never sees a game. Once the two ends are connected, through
// the TURN relay, everything goes between them, sealed with DTLS.
//
//   host     register or update this connection's room (signed by its host key)
//   unhost   take it down
//   list     one page of public rooms, filtered
//   signal   an offer to a room's host, or the host's answer or deny to one joiner
//   turn     short-lived TURN credentials for one connection: a host's, or a
//            joiner's for the room it is joining
//   ping     pong
//
// Who may do what:
//   - A room is changed only by the connection that registered it, only with
//     a fresh signature by the room's host key, and only under an id derived
//     from that key (rooms.js keeps the rest).
//   - An offer goes only to the room's host connection. An answer or a deny
//     goes only from it, only to the connection whose offer opened that
//     session, and only one per offer: a joiner cannot read another joiner's
//     answer, nobody but the host can send one, and the two cannot use the
//     relay as a pipe for anything but signaling.
//   - The server does not check the answer's signature. The joiner does,
//     against the host key it took from the listing. What that key is worth is
//     what the listing is worth: this server could list a room of its own and
//     answer as its host, but nobody else can take over a room that someone
//     else's key registered, or register one under its id.
//
// Each handler returns { reply } to send back, { error, strike } to refuse
// (strike: a correct client would never have sent it), or nothing.

import { createBucket, createBucketTable } from "./bucket.js";
import { isFresh } from "./schemas.js";
import { sdpProblem } from "./sdp.js";
import { roomIdFor, verifyRoom } from "./signatures.js";
import { turnCredentials } from "./turn.js";

const NOTHING = Object.freeze({});
const reply = (message) => ({ reply: message });
const refuse = (code, message, strike = false) => ({ error: { t: "error", code, message }, strike });
// Ids appear in the log by their first eight hex digits.
const short = (hex) => hex.slice(0, 8);

// `tables` holds the per-address buckets the server shares with its HTTP side
// (listings) or keeps for this protocol alone (turnJoins).
export const createLobby = ({ config, registry, now, timing, limits, log, deliver, tables }) => {
  // With TURN on, every connection is relay-only, and SDPs are held to it.
  const relayOnly = Boolean(config.turnSecret);

  // A budget that grows with the room: a host needs one TURN credential per
  // player connection (and again for each renewal), and its joiners one each.
  // Twice the seats, and two more, every credential lifetime.
  const seatBudget = (record, name, at) => {
    const burst = 2 * record.data.seats + 2;
    const rate = burst / config.turnTtlSeconds;
    record[name] ??= { burst, bucket: createBucket({ rate, burst, at }) };
    if (record[name].burst !== burst) {
      record[name].bucket.resize(at, { rate, burst });
      record[name].burst = burst;
    }
    return record[name].bucket;
  };

  // Joiner sessions live in two places: on the room (session → the joiner's
  // connection, for the host's answer to find) and on the joiner's connection
  // (for its cap, and to clean up when it closes). Maps keep insertion order,
  // so the first entry of either is the oldest, which is the one evicted.
  const forgetSession = (conn, key) => {
    const entry = conn.sessions.get(key);
    if (!entry) return;
    conn.sessions.delete(key);
    const record = registry.get(entry.roomId);
    if (record?.sessions.get(entry.session)?.conn === conn) record.sessions.delete(entry.session);
  };

  // The session's entry, renewed (or made) for another offer. `offers` counts
  // the offers it has carried, `credits` the ones the host has not yet
  // answered or denied.
  const rememberSession = (conn, record, session, held) => {
    const expires = now() + timing.sessionTtlMs;
    const entry = held ?? { conn, offers: 0, credits: 0 };
    entry.expires = expires;
    record.sessions.delete(session);
    record.sessions.set(session, entry);
    while (record.sessions.size > limits.sessionsPerRoom) {
      const [oldest, evicted] = record.sessions.entries().next().value;
      record.sessions.delete(oldest);
      evicted.conn.sessions.delete(`${record.id}:${oldest}`);
    }
    const key = `${record.id}:${session}`;
    conn.sessions.delete(key);
    conn.sessions.set(key, { roomId: record.id, session, expires });
    while (conn.sessions.size > limits.sessionsPerConnection) forgetSession(conn, conn.sessions.keys().next().value);
    return entry;
  };

  // Checking a signature is the costliest thing a client can ask of the
  // server, so room messages have a budget of their own (a host updates its
  // room when a player comes or goes, not many times a second), and every
  // check that does not need the signature comes before it.
  const host = (conn, { room, ts, sig }) => {
    const at = now();
    conn.hostBucket ??= createBucket({ rate: limits.hostMessagesPerSecond, burst: limits.hostMessageBurst, at });
    if (!conn.hostBucket.take(at)) {
      return refuse("rate-limited", `Too many room updates: at most ${limits.hostMessagesPerSecond} a second.`, true);
    }
    if (!isFresh(ts, at)) {
      return refuse("stale", `ts is more than 5 minutes from the server's clock (${at}): check this device's clock.`);
    }
    if (room.open > room.seats) return refuse("invalid", "open is more than seats.", true);
    if (room.roomId !== roomIdFor(room.hostKey, room.nonce)) {
      return refuse("invalid", "roomId is not the one derived from hostKey and nonce.", true);
    }
    if (conn.roomId !== null && conn.roomId !== room.roomId) {
      return refuse("one-room", "This connection already hosts a room: unhost it first.");
    }
    const request = { owner: conn, address: conn.address, room, ts };
    const refusal = registry.check(request);
    if (refusal) return refuse(refusal.code, refusal.message);
    if (!verifyRoom({ room, ts, sig })) return refuse("bad-signature", "The room is not signed by its host key.", true);
    const result = registry.register(request);
    if (!result.ok) return refuse(result.code, result.message);
    conn.roomId = room.roomId;
    if (result.how !== "updated") {
      log.info(`room.${result.how}`, { room: short(room.roomId), conn: conn.id, visibility: room.visibility, seats: room.seats });
    }
    return reply({ t: "hosted", roomId: room.roomId });
  };

  const unhost = (conn, { roomId }) => {
    if (conn.roomId !== roomId) return refuse("not-your-room", "This connection does not host that room.");
    registry.remove(roomId, "unhosted");
    conn.roomId = null;
    return reply({ t: "unhosted", roomId });
  };

  // A joiner's offer, on its way to the host.
  const offer = (conn, { roomId, payload }) => {
    if (payload.t !== "offer") return refuse("wrong-payload", "Only an offer goes to a host.", true);
    const problem = sdpProblem(payload.sdp, { relayOnly });
    if (problem) return refuse("bad-sdp", `The offer's SDP has ${problem}.`, true);
    const record = registry.get(roomId);
    if (!record) return refuse("unknown-room", "No room with that id is registered here.");
    if (record.owner === conn) return refuse("own-room", "A host cannot join its own room.");
    if (record.owner === null) return refuse("host-away", "The host is reconnecting: try again in a moment.");
    const at = now();
    const current = record.sessions.get(payload.session);
    const live = current && current.expires > at ? current : null;
    if (live && live.conn !== conn) return refuse("session-taken", "That session id belongs to another connection.");
    // A joiner repeats its offer until the host answers, a few times at most;
    // a session that goes on and on is a pipe, not a join.
    if (live && live.offers >= limits.offersPerSession) {
      return refuse("session-spent", `A session carries at most ${limits.offersPerSession} offers: start a new one.`, true);
    }
    // Three budgets, so that no one socket or address can use up a room: this
    // connection's offers into the room, its address's, and the room's as a
    // whole (the backstop against many addresses at once).
    let own = conn.offerBuckets.get(roomId);
    if (!own) {
      own = createBucket({ rate: limits.offersPerConnectionPerSecond, burst: limits.offerConnectionBurst, at });
      conn.offerBuckets.set(roomId, own);
    }
    record.offerAddresses ??= createBucketTable({ rate: limits.offersPerAddressPerSecond, burst: limits.offerAddressBurst, max: 4096 });
    const fromAddress = record.offerAddresses.get(conn.address, at);
    record.offers ??= createBucket({ rate: limits.offersPerSecond, burst: limits.offerBurst, at });
    if (!own.ready(at)) {
      return refuse("rate-limited", `Too many offers into this room: one every ${1 / limits.offersPerConnectionPerSecond} seconds at most.`, true);
    }
    if (!fromAddress.ready(at)) return refuse("busy", "Too many offers into this room from this address: try again in a moment.");
    if (!record.offers.ready(at)) return refuse("busy", "The room is getting too many offers: try again in a moment.");
    own.take(at);
    fromAddress.take(at);
    record.offers.take(at);
    const entry = rememberSession(conn, record, payload.session, live);
    if (!deliver(record.owner, { t: "signal", roomId, from: payload.session, payload })) {
      return refuse("busy", "The host is not keeping up: try again in a moment.");
    }
    entry.offers += 1;
    // One answer or deny may come back for each offer that went out.
    entry.credits += 1;
    if (entry.offers === 1) log.info("signal.offer", { room: short(roomId), conn: conn.id, session: short(payload.session) });
    return NOTHING;
  };

  // The host's answer or deny, on its way back to one joiner.
  const answer = (conn, { roomId, to, payload }) => {
    const record = registry.get(roomId);
    if (!record) return refuse("unknown-room", "No room with that id is registered here.");
    if (record.owner !== conn) return refuse("not-host", "Only the room's host connection can answer its joiners.");
    if (payload.t === "offer") return refuse("wrong-payload", "A host sends an answer or a deny.", true);
    if (payload.session !== to) return refuse("session-mismatch", "The payload is for another session.", true);
    if (payload.t === "answer") {
      const problem = sdpProblem(payload.sdp, { relayOnly });
      if (problem) return refuse("bad-sdp", `The answer's SDP has ${problem}.`, true);
    }
    const entry = record.sessions.get(to);
    if (!entry || entry.expires <= now()) return refuse("unknown-session", "No joiner is waiting on that session.");
    if (entry.credits < 1) return refuse("no-offer", "Every offer on that session has had its answer: one answer or deny per offer.", true);
    if (!deliver(entry.conn, { t: "signal", roomId, from: "host", payload })) {
      return refuse("busy", "That joiner is not keeping up.");
    }
    entry.credits -= 1;
    log.info(`signal.${payload.t}`, { room: short(roomId), session: short(to) });
    return NOTHING;
  };

  const credentials = (at) => reply(turnCredentials({
    secret: config.turnSecret, urls: config.turnUrls, ttlSeconds: config.turnTtlSeconds, now: at,
  }));

  // TURN credentials cover one connection each (coturn's user-quota is sized
  // to one connection's allocations), and they go only where a game needs
  // them, never to whoever asks:
  //   - a host, with no roomId, from the connection that hosts the room: one
  //     for each player connection it answers or renews, within a budget
  //     sized by its seats;
  //   - a joiner, naming the room it is joining, as long as that room has a
  //     host to answer: before its offer, since a relay-only offer must
  //     already hold its relay candidates. Limited per connection, per
  //     address, and per room (by its seats).
  // A credential lasts TURN_TTL_SECONDS. A connection that must outlive it
  // asks again the same way and restarts ICE with the new one.
  const turn = (conn, { roomId }) => {
    if (!config.turnSecret) return reply({ t: "turn", iceServers: [], ttl: 0 });
    const at = now();
    if (roomId === undefined) {
      const record = conn.roomId === null ? null : registry.get(conn.roomId);
      if (!record || record.owner !== conn) {
        return refuse("not-eligible", "Credentials without a roomId are for the connection that hosts a room; a joiner names the room it is joining.");
      }
      if (!seatBudget(record, "hostTurn", at).take(at)) {
        return refuse("busy", "This room has had as many TURN credentials as its seats need for now: try again in a moment.");
      }
      log.info("turn.issued", { conn: conn.id, room: short(record.id), role: "host" });
      return credentials(at);
    }
    const record = registry.get(roomId);
    if (!record) return refuse("unknown-room", "No room with that id is registered here.");
    if (record.owner === conn) return refuse("own-room", "A host asks for credentials without a roomId.");
    if (record.owner === null) return refuse("host-away", "The host is reconnecting: try again in a moment.");
    conn.turnBucket ??= createBucket({ rate: limits.turnPerSecond, burst: limits.turnBurst, at });
    const fromAddress = tables.turnJoins.get(conn.address, at);
    const forRoom = seatBudget(record, "joinerTurn", at);
    if (!conn.turnBucket.ready(at) || !fromAddress.ready(at)) {
      return refuse("rate-limited", "Too many TURN credentials asked for from here: try again in a moment.");
    }
    if (!forRoom.ready(at)) {
      return refuse("busy", "This room has handed out as many TURN credentials as its seats need for now: try again in a moment.");
    }
    conn.turnBucket.take(at);
    fromAddress.take(at);
    forRoom.take(at);
    log.info("turn.issued", { conn: conn.id, room: short(roomId), role: "joiner" });
    return credentials(at);
  };

  // A page of the listing, as the cached text that goes out (rooms.js). A
  // page is up to fifty rooms, so asking for pages has a budget of its own,
  // per connection and per address (shared with GET /api/rooms).
  const list = (conn, { filters = {}, page = 0 }) => {
    const at = now();
    conn.listBucket ??= createBucket({ rate: limits.listsPerSecond, burst: limits.listBurst, at });
    const fromAddress = tables.listings.get(conn.address, at);
    if (!conn.listBucket.ready(at) || !fromAddress.ready(at)) {
      return refuse("rate-limited", `Too many listings asked for: at most ${limits.listsPerSecond} a second.`);
    }
    conn.listBucket.take(at);
    fromAddress.take(at);
    return reply(registry.listingText(filters, page));
  };

  const handlers = {
    host,
    unhost,
    list,
    signal: (conn, message) => (message.to === "host" ? offer(conn, message) : answer(conn, message)),
    turn,
    ping: (conn, { n }) => reply({ t: "pong", n }),
  };

  return {
    // `message` is a validated CLIENT_MESSAGE, so its type is one of these.
    handle: (conn, message) => handlers[message.t](conn, message),

    // A connection closed: its room starts its grace, and its sessions go.
    closed(conn) {
      if (conn.roomId !== null) {
        if (registry.release(conn, conn.roomId)) {
          log.info("room.away", { room: short(conn.roomId), conn: conn.id, graceSeconds: Math.round(timing.graceMs / 1000) });
        }
        conn.roomId = null;
      }
      for (const key of [...conn.sessions.keys()]) forgetSession(conn, key);
    },

    // The server's heartbeat: expired sessions go from both sides, and
    // budgets that are full again are forgotten.
    sweep(connections) {
      const at = now();
      for (const record of registry.records()) {
        for (const [session, entry] of record.sessions) if (entry.expires <= at) record.sessions.delete(session);
        record.offerAddresses?.prune(at);
      }
      for (const conn of connections) {
        for (const [key, entry] of conn.sessions) {
          if (registry.get(entry.roomId)?.sessions.get(entry.session)?.conn !== conn) conn.sessions.delete(key);
        }
        for (const [roomId, bucket] of conn.offerBuckets) if (bucket.full(at)) conn.offerBuckets.delete(roomId);
      }
    },
  };
};
