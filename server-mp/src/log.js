/*! Open Historia — the public multiplayer server's log © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One line per event worth knowing about: a room hosted or gone, a connection
// opened, refused, struck or dropped, an offer passed on. Each line is
//
//   <ISO time> <level> <event> key=value key=value …
//
// What never goes in: an address, and anything a player wrote. Addresses are
// replaced by a tag, "#" and twelve hex digits of an HMAC-SHA-256 under a key
// made at start-up and never written anywhere. That is enough to see that one
// address is behind a run of refusals, and useless for learning which address
// it was: a plain hash of an IPv4 address is reversed by trying all four
// billion, a keyed one is not. The key changes at every restart, so tags do
// not link across restarts either. Room names, player names, SDP and the rest
// of every message stay out; rooms and sessions appear as an id prefix.
//
// Values are ids, codes and numbers, but they are quoted if they hold anything
// else, so nothing can start a line of its own.

import { createHmac, randomBytes } from "node:crypto";

const BARE = /^[A-Za-z0-9._:/#@+-]{1,120}$/;

const format = (value) => {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  return BARE.test(text) ? text : JSON.stringify(text.slice(0, 120));
};

export const createLogger = ({ write = (line) => process.stdout.write(`${line}\n`) } = {}) => {
  const key = randomBytes(32);
  const emit = (level, event, fields = {}) => {
    let line = `${new Date().toISOString()} ${level} ${event}`;
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      line += ` ${name}=${format(value)}`;
    }
    write(line);
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    // The tag an address is logged as.
    address: (address) => `#${createHmac("sha256", key).update(String(address)).digest("hex").slice(0, 12)}`,
  };
};
