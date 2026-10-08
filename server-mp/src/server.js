/*! Open Historia — the public multiplayer server: signaling and the public listing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One process, two doors:
//
//   HTTP  GET /healthz        { ok: true }, for the container's health check
//         GET /api/rooms?…    the public listing, for a page that only browses
//   WS    /ws                 JSON text frames: the protocol in lobby.js
//
// Everything else is a 404. It is written to face the open internet (behind
// Caddy for TLS), so every door is narrow:
//   - At the upgrade: the path, the Origin (ALLOWED_ORIGINS), a request rate
//     per address, sockets per address (MAX_CONNECTIONS_PER_IP), per IPv6 /48
//     and in all (MAX_CONNECTIONS), and the process's memory (MAX_MEMORY_MB).
//     A refusal is a bare HTTP status, before any socket exists.
//   - Per socket: messages of at most 64 KiB in at most 4 frames (a bigger or
//     more broken-up one closes the socket before it is ever buffered whole:
//     1009 for its size; a thousand tiny fragments held open would otherwise
//     cost far more memory than their bytes), 20 messages a second with bursts
//     of 40, text only, parsed with safeParse and checked against the closed
//     schemas. Each message a correct client would never send is answered
//     with an error and counts a strike; the fifth strike closes the socket
//     (1008).
//   - Every 30 seconds the server pings each socket and drops those that did
//     not answer the last ping. It closes a socket that has said nothing in
//     its first 30 seconds, one that has sat idle for ten minutes without
//     hosting a room or waiting on a host, and a host's that has said nothing
//     for an hour.
//   - What waits to be sent is bounded per socket and for the whole server: a
//     socket that stops reading its replies is dropped, a message relayed to a
//     peer that is not reading is refused to its sender, and when the server
//     as a whole has too much queued, a big reply becomes a short "busy".
//   - HTTP requests have no body, a short URL and short timeouts, and share
//     the per-address request rate with the upgrades.
//
// Run: node src/server.js (settings from the environment, config.js).

import http from "node:http";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createBucket, createBucketTable } from "./bucket.js";
import { ConfigError, createOriginCheck, loadConfig, resolveConfig } from "./config.js";
import { createLobby } from "./lobby.js";
import { createLogger } from "./log.js";
import { NETWORK_SHARE, addressKey, clientAddress, networkKey } from "./net.js";
import { createRoomRegistry } from "./rooms.js";
import { CLIENT_MESSAGE, isKnownType, parseListingQuery } from "./schemas.js";
import { safeParse, validate } from "./validate.js";

export const FRAME_LIMIT = 64 * 1024;
const JSON_DEPTH = 8;

export const DEFAULT_TIMING = Object.freeze({
  heartbeatMs: 30_000,
  // How long a room outlives its host's connection (rooms.js).
  graceMs: 30_000,
  // How long a joiner's offer keeps its session open for the host's answer.
  sessionTtlMs: 2 * 60_000,
  // A socket must say something this soon after it opens.
  firstMessageMs: 30_000,
  // A socket that hosts nothing and waits on no host is closed after this long
  // without a message; a host's socket after hostIdleMs.
  idleMs: 10 * 60_000,
  hostIdleMs: 60 * 60_000,
  // How often the server re-counts what all its sockets have queued to send.
  outboundRecountMs: 1000,
});

export const DEFAULT_LIMITS = Object.freeze({
  messagesPerSecond: 20,
  messageBurst: 40,
  strikes: 5,
  // Room registrations and updates per socket: each costs a signature check.
  hostMessagesPerSecond: 2,
  hostMessageBurst: 10,
  // HTTP requests and upgrades, per address.
  requestsPerSecond: 10,
  requestBurst: 30,
  // Offers into one room: from one socket, from one address, and from
  // everyone together (lobby.js). A joiner repeats its offer every five
  // seconds or so; a session carries at most offersPerSession of them.
  offersPerConnectionPerSecond: 0.5,
  offerConnectionBurst: 4,
  offersPerAddressPerSecond: 1,
  offerAddressBurst: 8,
  offersPerSecond: 10,
  offerBurst: 40,
  offersPerSession: 24,
  sessionsPerConnection: 8,
  sessionsPerRoom: 256,
  // A joiner's TURN credentials, per socket and per address (the room's own
  // budget is sized by its seats, in lobby.js).
  turnPerSecond: 1 / 20,
  turnBurst: 3,
  turnAddressPerSecond: 1 / 10,
  turnAddressBurst: 6,
  // Listing pages, per socket and per address (sockets and HTTP together).
  listsPerSecond: 1,
  listBurst: 5,
  listsAddressPerSecond: 3,
  listAddressBurst: 15,
  // Bytes a socket may have queued: its own replies, then relays to it; and
  // what the whole server may have queued.
  bufferedBytes: 256 * 1024,
  relayBufferedBytes: 64 * 1024,
  outboundBytes: 16 * 1024 * 1024,
  urlLength: 2048,
  requestTimeoutMs: 15_000,
});

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
});

// `body` is an object, or JSON text already made (a cached listing page).
const sendJson = (res, status, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(text);
};

const errorMessage = (code, message) => ({ t: "error", code, message });
const BUSY = JSON.stringify(errorMessage("busy", "The server is busy: ask again in a moment."));

const pathOf = (url) => {
  try {
    return new URL(url ?? "", "http://server.invalid").pathname;
  } catch {
    return "";
  }
};

// Start a server. `options` are the settings (config.js: loadConfig's output,
// or any subset of DEFAULTS). `hooks` are for tests: a clock (now), shorter
// timings, other limits, where log lines go (logWrite), and the process's
// memory as the server sees it (memory). Resolves once it is listening, with
// the port it got (options.port 0 means any free one).
export const createServer = async (options = {}, hooks = {}) => {
  const config = resolveConfig(options);
  const now = hooks.now ?? (() => Date.now());
  const memory = hooks.memory ?? (() => process.memoryUsage.rss());
  const timing = { ...DEFAULT_TIMING, ...hooks.timing };
  const limits = { ...DEFAULT_LIMITS, ...hooks.limits };
  const log = createLogger({ write: hooks.logWrite });
  const originAllowed = createOriginCheck(config.allowedOrigins);
  const anyOrigin = config.allowedOrigins.length === 0;
  const memoryLimit = config.maxMemoryMb * 1024 * 1024;

  const connections = new Set();
  const socketsByAddress = new Map();
  const socketsByNetwork = new Map();
  let socketCount = 0;
  let closing = false;
  // Bytes queued to send across every socket: re-counted every second from
  // the sockets themselves, and raised by each send in between, so it can be
  // too high for a moment but never drifts.
  let outbound = 0;

  const tables = {
    requests: createBucketTable({ rate: limits.requestsPerSecond, burst: limits.requestBurst }),
    turnJoins: createBucketTable({ rate: limits.turnAddressPerSecond, burst: limits.turnAddressBurst }),
    listings: createBucketTable({ rate: limits.listsAddressPerSecond, burst: limits.listAddressBurst }),
  };

  const registry = createRoomRegistry({
    maxRooms: config.maxRooms,
    maxRoomsPerIp: config.maxRoomsPerIp,
    graceMs: timing.graceMs,
    now,
    onRemoved: (record, reason) => log.info("room.removed", { room: record.id.slice(0, 8), reason }),
  });

  // A timer that must not keep the process alive on its own.
  const later = (ms, task) => {
    const timer = setTimeout(task, ms);
    timer.unref?.();
    return timer;
  };

  // Each socket is closed once: asked to close cleanly, then cut a second
  // later; or cut at once when it is dead or not reading. After either,
  // nothing it still sends is read, counted or answered.
  const closeSocket = (conn, code, reason) => {
    if (conn.closing) return;
    conn.closing = true;
    conn.ws.close(code, reason);
    later(1000, () => conn.ws.terminate());
  };
  const dropSocket = (conn, reason) => {
    if (conn.closing) return;
    conn.closing = true;
    log.info("conn.dropped", { conn: conn.id, reason });
    conn.ws.terminate();
  };

  // `message` is an object, or JSON text already made (a cached listing).
  const send = (conn, message, { relayed = false } = {}) => {
    const ws = conn.ws;
    if (conn.closing || ws.readyState !== WebSocket.OPEN) return false;
    let text = typeof message === "string" ? message : JSON.stringify(message);
    let size = Buffer.byteLength(text);
    if (relayed) {
      if (ws.bufferedAmount + size > limits.relayBufferedBytes || outbound + size > limits.outboundBytes) return false;
    } else {
      // A big reply (a listing page) waits for a better moment when the
      // server as a whole has too much queued; small ones always go.
      if (outbound + size > limits.outboundBytes && size > BUSY.length) {
        text = BUSY;
        size = BUSY.length;
      }
      if (ws.bufferedAmount + size > limits.bufferedBytes) {
        dropSocket(conn, "not-reading");
        return false;
      }
    }
    outbound += size;
    ws.send(text);
    return true;
  };

  const lobby = createLobby({
    config, registry, now, timing, limits, log, tables,
    deliver: (conn, message) => send(conn, message, { relayed: true }),
  });

  const strike = (conn, code) => {
    if (conn.closing) return;
    conn.strikes += 1;
    log.info("conn.strike", { conn: conn.id, code, strikes: conn.strikes });
    if (conn.strikes >= limits.strikes) {
      log.info("conn.dropped", { conn: conn.id, reason: "strikes" });
      closeSocket(conn, 1008, "Too many invalid messages.");
    }
  };

  // The error goes out before any close, so the client learns why.
  const refuse = (conn, error, strikes) => {
    send(conn, error);
    if (strikes) strike(conn, error.code);
  };

  const onMessage = (conn, data, isBinary) => {
    // After a close has been sent the socket may still deliver what was
    // already on its way; none of it is read.
    if (conn.closing || conn.ws.readyState !== WebSocket.OPEN) return;
    const at = now();
    conn.messages += 1;
    conn.lastMessageAt = at;
    if (!conn.bucket.take(at)) {
      return refuse(conn, errorMessage("rate-limited", `Too many messages: at most ${limits.messagesPerSecond} a second.`), true);
    }
    if (isBinary) return refuse(conn, errorMessage("bad-frame", "Messages are JSON text frames."), true);
    const parsed = safeParse(data.toString("utf8"), { maxLength: FRAME_LIMIT, maxDepth: JSON_DEPTH });
    if (!parsed.ok) return refuse(conn, errorMessage("bad-json", `Not a message: ${parsed.error}.`), true);
    if (!isKnownType(parsed.value)) return refuse(conn, errorMessage("unknown-type", "Unknown message type."), true);
    const checked = validate(CLIENT_MESSAGE, parsed.value);
    if (!checked.ok) return refuse(conn, errorMessage("invalid", `Invalid ${parsed.value.t}: ${checked.error}.`), true);
    const result = lobby.handle(conn, checked.value);
    if (result.error) return refuse(conn, result.error, result.strike);
    if (result.reply) send(conn, result.reply);
    return undefined;
  };

  const onConnection = (ws, address) => {
    const at = now();
    const conn = {
      id: randomBytes(4).toString("hex"),
      ws,
      address,
      openedAt: at,
      lastMessageAt: at,
      messages: 0,
      roomId: null,
      sessions: new Map(),
      // Offer budgets, by the room offered to (lobby.js).
      offerBuckets: new Map(),
      strikes: 0,
      alive: true,
      closing: false,
      bucket: createBucket({ rate: limits.messagesPerSecond, burst: limits.messageBurst, at }),
    };
    connections.add(conn);
    log.info("conn.open", { conn: conn.id, ip: log.address(address) });
    ws.on("pong", () => {
      conn.alive = true;
    });
    // ws answers pings by itself; a flood of them still costs a token each,
    // and none is counted once the socket is closing.
    ws.on("ping", () => {
      if (conn.closing || ws.readyState !== WebSocket.OPEN) return;
      if (!conn.bucket.take(now())) strike(conn, "rate-limited");
    });
    ws.on("message", (data, isBinary) => {
      try {
        onMessage(conn, data, isBinary);
      } catch (error) {
        // A bug must cost one socket, not the server.
        log.warn("conn.bug", { conn: conn.id, error: error?.name ?? "Error" });
        closeSocket(conn, 1011, "Internal error.");
      }
    });
    // ws reports protocol violations (an oversized or over-fragmented message,
    // bad UTF-8) here and then closes the socket itself.
    ws.on("error", (error) => log.info("conn.error", { conn: conn.id, code: error?.code ?? "error" }));
    ws.on("close", (code) => {
      conn.closing = true;
      connections.delete(conn);
      lobby.closed(conn);
      log.info("conn.close", { conn: conn.id, code, seconds: Math.round((now() - conn.openedAt) / 1000) });
    });
  };

  const cors = (origin) => {
    if (anyOrigin) return { "Access-Control-Allow-Origin": "*" };
    if (typeof origin === "string" && originAllowed(origin)) return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    return null;
  };

  const onRequest = (req, res) => {
    const key = addressKey(clientAddress(req, config.trustProxy));
    const at = now();
    if (closing) return sendJson(res, 503, errorMessage("closing", "The server is restarting."), { Connection: "close" });
    if (!tables.requests.get(key, at).take(at)) {
      return sendJson(res, 429, errorMessage("rate-limited", "Too many requests."), { "Retry-After": "1" });
    }
    if ((req.url ?? "").length > limits.urlLength) return sendJson(res, 414, errorMessage("too-long", "The URL is too long."));
    // Nothing here takes a body, so none is read: one that is announced ends
    // the connection instead.
    if (Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined) {
      return sendJson(res, 413, errorMessage("too-large", "Requests here have no body."), { Connection: "close" });
    }
    let url;
    try {
      url = new URL(req.url ?? "", "http://server.invalid");
    } catch {
      return sendJson(res, 400, errorMessage("bad-url", "Not a URL."));
    }
    const { method } = req;
    if (url.pathname === "/healthz" && (method === "GET" || method === "HEAD")) return sendJson(res, 200, { ok: true });
    if (url.pathname === "/api/rooms") {
      const allowed = cors(req.headers.origin);
      if (method === "OPTIONS") {
        if (!allowed) return sendJson(res, 403, errorMessage("origin", "This origin may not read the listing."), { Vary: "Origin" });
        res.writeHead(204, { ...SECURITY_HEADERS, ...allowed, "Access-Control-Allow-Methods": "GET, HEAD", "Access-Control-Max-Age": "600" });
        return res.end();
      }
      if (method === "GET" || method === "HEAD") {
        // A page from an origin not on the list still gets the listing (it is
        // public, and curl could read it), but no CORS header, so the browser
        // keeps it from that page.
        const headers = allowed ?? { Vary: "Origin" };
        const query = parseListingQuery(url.searchParams);
        if (!query.ok) return sendJson(res, 400, errorMessage("invalid", `Invalid listing query: ${query.error}.`), headers);
        if (!tables.listings.get(key, at).take(at)) {
          return sendJson(res, 429, errorMessage("rate-limited", "Too many listings asked for."), { ...headers, "Retry-After": "1" });
        }
        return sendJson(res, 200, registry.listingText(query.filters, query.page), headers);
      }
    }
    return sendJson(res, 404, errorMessage("not-found", "Not found."));
  };

  const httpServer = http.createServer({
    maxHeaderSize: 8 * 1024,
    requestTimeout: limits.requestTimeoutMs,
    headersTimeout: Math.min(10_000, limits.requestTimeoutMs),
    connectionsCheckingInterval: Math.min(30_000, limits.requestTimeoutMs),
  }, onRequest);
  httpServer.keepAliveTimeout = 5_000;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: FRAME_LIMIT,
    // ws would hold up to 16384 fragments of an unfinished message, each a
    // buffer with its own overhead (about 1.8 MB for one-byte fragments), and
    // no message event, so no limit here, fires until it is finished.
    // Signaling messages are never sent in pieces; four is plenty.
    maxFragments: 4,
    // Compression would let a small frame inflate into a large message, and
    // costs memory per socket; signaling does not need it.
    perMessageDeflate: false,
    clientTracking: false,
  });

  const refuseUpgrade = (socket, status, reason, key) => {
    log.info("upgrade.refused", { status, reason, ip: log.address(key) });
    socket.once("finish", () => socket.destroy());
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  const count = (map, key, delta) => {
    const next = (map.get(key) ?? 0) + delta;
    if (next > 0) map.set(key, next);
    else map.delete(key);
  };

  httpServer.on("upgrade", (req, socket, head) => {
    // A reset mid-handshake must not become an uncaught error.
    socket.on("error", () => {});
    const key = addressKey(clientAddress(req, config.trustProxy));
    const network = networkKey(key);
    const at = now();
    if (closing) return refuseUpgrade(socket, 503, "closing", key);
    if (pathOf(req.url) !== "/ws") return refuseUpgrade(socket, 404, "path", key);
    if (!tables.requests.get(key, at).take(at)) return refuseUpgrade(socket, 429, "rate", key);
    if (!originAllowed(req.headers.origin)) return refuseUpgrade(socket, 403, "origin", key);
    if (socketCount >= config.maxConnections) return refuseUpgrade(socket, 503, "full", key);
    if (memory() > memoryLimit) return refuseUpgrade(socket, 503, "memory", key);
    if ((socketsByAddress.get(key) ?? 0) >= config.maxConnectionsPerIp) return refuseUpgrade(socket, 429, "per-ip", key);
    if (network && (socketsByNetwork.get(network) ?? 0) >= config.maxConnectionsPerIp * NETWORK_SHARE) {
      return refuseUpgrade(socket, 429, "per-network", key);
    }
    // Counted now, not once the handshake completes, so a burst of upgrades
    // cannot all pass the check before any of them is counted. Released when
    // the socket closes, however it closes (a failed handshake included).
    socketCount += 1;
    count(socketsByAddress, key, 1);
    if (network) count(socketsByNetwork, network, 1);
    socket.once("close", () => {
      socketCount -= 1;
      count(socketsByAddress, key, -1);
      if (network) count(socketsByNetwork, network, -1);
    });
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, key));
    return undefined;
  });

  // Why a socket should be closed for saying too little, or null.
  const idleReason = (conn, at) => {
    if (conn.messages === 0) return at - conn.openedAt >= timing.firstMessageMs ? "first-message" : null;
    const quiet = at - conn.lastMessageAt;
    if (conn.roomId !== null) return quiet >= timing.hostIdleMs ? "host-idle" : null;
    return conn.sessions.size === 0 && quiet >= timing.idleMs ? "idle" : null;
  };

  const heartbeat = setInterval(() => {
    const at = now();
    lobby.sweep(connections);
    for (const conn of connections) {
      const ws = conn.ws;
      if (conn.closing || ws.readyState !== WebSocket.OPEN) continue;
      if (!conn.alive) {
        dropSocket(conn, "no-pong");
        continue;
      }
      const idle = idleReason(conn, at);
      if (idle) {
        log.info("conn.dropped", { conn: conn.id, reason: idle });
        closeSocket(conn, 1000, "Idle.");
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
    for (const table of Object.values(tables)) table.prune(at);
    if (memory() > memoryLimit) log.warn("server.memory", { mb: Math.round(memory() / 1048576), limitMb: config.maxMemoryMb });
  }, timing.heartbeatMs);

  const recount = setInterval(() => {
    let total = 0;
    for (const conn of connections) total += conn.ws.bufferedAmount;
    outbound = total;
  }, timing.outboundRecountMs);
  recount.unref?.();

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  }).catch((error) => {
    clearInterval(heartbeat);
    clearInterval(recount);
    throw error;
  });
  httpServer.on("error", (error) => log.warn("server.error", { code: error?.code ?? "error" }));

  const { port } = httpServer.address();
  log.info("server.start", {
    host: config.host,
    port,
    turn: config.turnSecret ? "on" : "off",
    origins: anyOrigin ? "any" : config.allowedOrigins.length,
    trustProxy: config.trustProxy,
    maxRooms: config.maxRooms,
  });
  // Any origin is right for a server on loopback during development; on any
  // other address it lets every web page in the world use this server through
  // its visitors' browsers.
  if (anyOrigin && !["127.0.0.1", "::1", "localhost"].includes(config.host)) {
    log.warn("server.any-origin", { hint: "set ALLOWED_ORIGINS" });
  }

  let closed = null;
  const close = () => {
    closed ??= new Promise((resolve) => {
      closing = true;
      clearInterval(heartbeat);
      clearInterval(recount);
      for (const conn of connections) closeSocket(conn, 1001, "Server restarting.");
      registry.close();
      wss.close();
      httpServer.close(() => {
        log.info("server.stop", { port });
        resolve();
      });
      httpServer.closeIdleConnections();
    });
    return closed;
  };

  return { port, close };
};

// Run as a program: node src/server.js. Compared as real paths, because Node
// names the entry module by its real path: started through a symlink (or, on
// Windows, a short 8.3 path), the command line and the module would otherwise
// disagree, and the server would quietly never start.
const runAsProgram = () => {
  try {
    const real = (path) => realpathSync.native(path);
    return Boolean(process.argv[1]) && real(resolvePath(process.argv[1])) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (runAsProgram()) {
  const fatal = (message) => {
    process.stderr.write(`open-historia-mp-server: ${message}\n`);
    process.exit(1);
  };
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    fatal(error.message);
  }
  const server = await createServer(config).catch((error) => fatal(`could not start: ${error?.message ?? error}`));
  const stop = () => {
    // Sockets get a moment to close cleanly; the process does not wait for ever.
    setTimeout(() => process.exit(1), 5000).unref();
    server.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
