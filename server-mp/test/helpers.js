/*! Open Historia — helpers for the public multiplayer server's tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A real server on a free port, in this process, and real ws clients against
// it: the tests go through the same sockets, handshake and HTTP a game would.
//
// Room signatures are made here by hand, from the documented recipe
// ("oh-mp/v1/room", roomId, ts, sha256 of the canonical JSON; Ed25519 by the
// host key), not with the server's own roomMessage, so a slip in the server's
// recipe fails the tests instead of agreeing with itself.

import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import WebSocket from "ws";
import { createServer } from "../src/server.js";
import { canonicalJson } from "../src/signatures.js";

export const ORIGIN = "http://app.paxhistoria";
export const VERSION = "0.0.51-alpha";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const until = async (check, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(10);
  }
  return check();
};

// A clock the test moves by hand.
export const manualClock = (start = Date.now()) => {
  const clock = { at: start, now: () => clock.at, advance: (ms) => { clock.at += ms; } };
  return clock;
};

export const startServer = async (options = {}, hooks = {}) => {
  const lines = [];
  const server = await createServer(
    { port: 0, allowedOrigins: [ORIGIN, "http://localhost:*"], ...options },
    { logWrite: (line) => lines.push(line), ...hooks },
  );
  return {
    ...server,
    lines,
    wsUrl: `ws://127.0.0.1:${server.port}/ws`,
    httpUrl: `http://127.0.0.1:${server.port}`,
  };
};

// A connected client with an inbox. next(match) resolves with the next
// message that matches (by predicate, or by type when given a string).
const wrap = (ws) => {
  const inbox = [];
  const waiters = [];
  // A refused or cut socket can report more than one error; connect() turns
  // the first into a rejection, and the rest must not go unhandled.
  ws.on("error", () => {});
  const closed = new Promise((resolve) => {
    ws.once("close", (code, reason) => {
      for (const waiter of waiters.splice(0)) waiter.reject(new Error(`closed (${code}) while waiting`));
      resolve({ code, reason: reason.toString() });
    });
  });
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const index = waiters.findIndex((waiter) => waiter.match(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const matcher = (match) => (typeof match === "string" ? (message) => message.t === match : match ?? (() => true));
  const next = (match, ms = 2000) => {
    const test = matcher(match);
    const index = inbox.findIndex(test);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        match: test,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error("timed out waiting for a message"));
      }, ms);
      waiters.push(waiter);
    });
  };
  const send = (message) => ws.send(typeof message === "string" || Buffer.isBuffer(message) ? message : JSON.stringify(message));
  // Every wait in these tests is bounded: a server that wrongly keeps a
  // socket open must fail a test, not hang the run.
  const closedWithin = (ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the socket was still open after ${ms} ms`)), ms);
    closed.then((info) => {
      clearTimeout(timer);
      resolve(info);
    });
  });
  return {
    ws,
    inbox,
    closedWithin,
    send,
    next,
    // Send, then wait for the reply of that type or an error.
    request: (message, type) => {
      const reply = next((incoming) => incoming.t === type || incoming.t === "error");
      send(message);
      return reply;
    },
    // Resolves with any message that arrives within `ms`, or null.
    quiet: async (ms = 150) => {
      await wait(ms);
      return inbox.shift() ?? null;
    },
    close: () => {
      ws.close();
      return closedWithin();
    },
  };
};

// Connect to /ws. Rejects with { status } when the upgrade is refused.
export const connect = (server, { origin = ORIGIN, headers = {}, path = "/ws" } = {}) => new Promise((resolve, reject) => {
  const url = `ws://127.0.0.1:${server.port}${path}`;
  const ws = new WebSocket(url, { headers, handshakeTimeout: 3000, ...(origin === null ? {} : { origin }) });
  const client = wrap(ws);
  ws.once("open", () => resolve(client));
  ws.once("unexpected-response", (request, response) => {
    reject(Object.assign(new Error(`upgrade refused: ${response.statusCode}`), { status: response.statusCode }));
    request.destroy();
  });
  ws.once("error", (error) => reject(error));
});

// A host key as the game has one: Ed25519, the public key as base64url.
export const hostIdentity = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const hostKey = publicKey.export({ format: "jwk" }).x;
  return { hostKey, privateKey };
};

export const randomHex = (bytes) => randomBytes(bytes).toString("hex");

// A room's id, from the recipe: the first 32 hex digits of the SHA-256 of
// "oh-mp/v1/room-id" \n hostKey \n nonce.
export const deriveRoomId = (hostKey, nonce) =>
  createHash("sha256").update(["oh-mp/v1/room-id", hostKey, nonce].join("\n"), "utf8").digest("hex").slice(0, 32);

// A room under `identity`'s key, its id derived from key and nonce unless the
// overrides name an id of their own.
export const makeRoom = (identity, overrides = {}) => {
  const hostKey = overrides.hostKey ?? identity.hostKey;
  const nonce = overrides.nonce ?? randomHex(16);
  return {
    roomId: deriveRoomId(hostKey, nonce),
    hostKey,
    nonce,
    name: "The Cold War, 1962",
    scenario: { id: "cold-war-1962", name: "Cold War", hash: "ab".repeat(32) },
    seats: 8,
    open: 6,
    round: { minutes: 30, readyThreshold: 0.66, countdownSeconds: 60 },
    payment: "host",
    fog: true,
    cheats: "off",
    language: "en",
    version: VERSION,
    password: false,
    visibility: "public",
    ...overrides,
  };
};

// The signature, from the recipe.
export const signRoom = (identity, room, ts) => {
  const digest = createHash("sha256").update(canonicalJson(room), "utf8").digest("hex");
  const message = Buffer.from(["oh-mp/v1/room", room.roomId, String(ts), digest].join("\n"), "utf8");
  return sign(null, message, identity.privateKey).toString("base64url");
};

export const hostMessage = (identity, room, ts = Date.now()) => ({ t: "host", v: 1, room, ts, sig: signRoom(identity, room, ts) });

// Register a room from a new connection; resolves with { client, room }.
export const hostRoom = async (server, identity = hostIdentity(), overrides = {}, { ts = Date.now(), connectOptions } = {}) => {
  const client = await connect(server, connectOptions);
  const room = makeRoom(identity, overrides);
  const reply = await client.request(hostMessage(identity, room, ts), "hosted");
  if (reply.t !== "hosted") throw new Error(`could not host: ${JSON.stringify(reply)}`);
  return { client, room, identity };
};

// An SDP of the shape a browser writes, with the candidate lines given (none
// by default). RELAY is what a relay-only browser writes; the others are what
// the server refuses once TURN is on.
export const sdpWith = (...candidates) => [
  "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0",
  ...candidates.map((candidate) => `a=candidate:${candidate}`),
  "a=ice-ufrag:x7Qf", "a=ice-pwd:0123456789abcdef01234567",
  "a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  "a=setup:actpass", "a=mid:0", "a=sctp-port:5000", "",
].join("\r\n");
export const CANDIDATES = Object.freeze({
  relay: "2361932024 1 udp 41885695 203.0.113.10 50000 typ relay raddr 0.0.0.0 rport 0 generation 0",
  relayNamingClient: "2361932024 1 udp 41885695 203.0.113.10 50000 typ relay raddr 198.51.100.7 rport 53211 generation 0",
  host: "1467250027 1 udp 2122260223 192.168.1.20 54321 typ host generation 0",
  srflx: "842163049 1 udp 1686052607 198.51.100.7 53211 typ srflx raddr 192.168.1.20 rport 54321 generation 0",
});
const SDP = sdpWith();

export const offerPayload = (session = randomHex(16), extra = {}) => ({
  t: "offer", v: 1, session, sdp: SDP, device: randomBytes(32).toString("base64url"),
  name: "Arkniem", version: VERSION, ts: Date.now(), ...extra,
});

// The server does not check an answer's or a deny's signature (the joiner
// does), so any well-formed one will do here.
export const answerPayload = (session, extra = {}) => ({
  t: "answer", v: 1, session, sdp: SDP, ts: Date.now(), sig: randomBytes(64).toString("base64url"), ...extra,
});

export const denyPayload = (session, reason = "full") => ({
  t: "deny", v: 1, session, reason, ts: Date.now(), sig: randomBytes(64).toString("base64url"),
});

// A plain HTTP request; resolves with { status, headers, body, json }.
export const httpRequest = (server, path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const request = http.request(`${server.httpUrl}${path}`, { method, headers, agent: false }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      resolve({ status: response.statusCode, headers: response.headers, body: text, json });
    });
  });
  request.on("error", reject);
  request.setTimeout(5000, () => request.destroy(new Error(`no answer to ${method} ${path}`)));
  if (body !== undefined) request.write(body);
  request.end();
});
