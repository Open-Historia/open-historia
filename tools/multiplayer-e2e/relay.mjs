/*! Open Historia — the end-to-end run's local signaling relay © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A minimal NIP-01 relay on /relay (EVENT / REQ / CLOSE, tag and kind filters,
// no storage), so the browser tabs find each other through the game's real
// Nostr signaling code (src/multiplayer/signaling/) with nothing leaving this
// machine.
import http from "node:http";
import { WebSocketServer } from "ws";

const matches = (filter, event) => {
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false;
  if (Number.isInteger(filter.since) && event.created_at < filter.since) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    if (!event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1]))) return false;
  }
  return true;
};

export const startRelay = (port = 0) => new Promise((resolve) => {
  const stats = { events: 0, sockets: 0 };
  const server = http.createServer((req, res) => res.writeHead(404).end("not found"));
  const wss = new WebSocketServer({ server, path: "/relay" });
  const sockets = new Set();
  wss.on("connection", (socket) => {
    stats.sockets += 1;
    socket.subscriptions = new Map();
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      const [type, ...rest] = message;
      if (type === "REQ") {
        socket.subscriptions.set(rest[0], rest[1]);
        socket.send(JSON.stringify(["EOSE", rest[0]]));
      } else if (type === "CLOSE") {
        socket.subscriptions.delete(rest[0]);
      } else if (type === "EVENT") {
        const event = rest[0];
        stats.events += 1;
        socket.send(JSON.stringify(["OK", event.id, true, ""]));
        for (const other of sockets) {
          for (const [id, filter] of other.subscriptions) {
            if (matches(filter, event)) other.send(JSON.stringify(["EVENT", id, event]));
          }
        }
      }
    });
  });
  server.listen(port, "127.0.0.1", () => resolve({ port: server.address().port, stats, close: () => { wss.close(); server.close(); } }));
});
