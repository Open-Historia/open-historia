/*! Open Historia — in-memory Nostr relays for multiplayer tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Tests only. A WebSocket class whose sockets reach in-memory relays that
// speak the NIP-01 subset real ones do: they check each event's id and
// signature the way a relay does (so a serialization mistake fails here as it
// would against the real thing), answer OK, and pass events to matching
// subscriptions. A relay can be taken down and brought back.

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex, utf8 } from "../bytes.js";

const later = (fn) => setTimeout(fn, 0);

const matches = (filter, event) => {
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false;
  if (Number.isInteger(filter.since) && event.created_at < filter.since) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const name = key.slice(1);
    if (!event.tags.some((tag) => tag[0] === name && values.includes(tag[1]))) return false;
  }
  return true;
};

export const createFakeRelayNetwork = ({ verify = true } = {}) => {
  const relays = new Map();
  const relayFor = (url) => {
    if (!relays.has(url)) relays.set(url, { url, up: true, sockets: new Set(), events: [], tamper: null, refusing: "", refused: 0 });
    return relays.get(url);
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.subscriptions = new Map();
      this.relay = relayFor(url);
      later(() => {
        if (!this.relay.up) {
          this.readyState = 3;
          this.onclose?.({});
          return;
        }
        this.readyState = 1;
        this.relay.sockets.add(this);
        this.onopen?.({});
      });
    }

    deliver(frame) {
      later(() => {
        if (this.readyState === 1) this.onmessage?.({ data: frame });
      });
    }

    send(text) {
      if (this.readyState !== 1) throw new Error("socket not open");
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        this.deliver(JSON.stringify(["NOTICE", "invalid JSON"]));
        return;
      }
      const [type, ...rest] = message;
      if (type === "REQ") {
        const [id, filter] = rest;
        this.subscriptions.set(id, filter);
        this.deliver(JSON.stringify(["EOSE", id]));
      } else if (type === "CLOSE") {
        this.subscriptions.delete(rest[0]);
      } else if (type === "EVENT") {
        const event = rest[0];
        const id = toHex(sha256(utf8(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))));
        const signed = (() => {
          try {
            return schnorr.verify(fromHex(event.sig), fromHex(id), fromHex(event.pubkey));
          } catch {
            return false;
          }
        })();
        if (verify && (id !== event.id || !signed)) {
          this.deliver(JSON.stringify(["OK", event.id, false, "invalid: bad id or signature"]));
          return;
        }
        if (this.relay.refusing) {
          this.relay.refused += 1;
          this.deliver(JSON.stringify(["OK", event.id, false, this.relay.refusing]));
          return;
        }
        this.deliver(JSON.stringify(["OK", event.id, true, ""]));
        this.relay.events.push(event);
        const outgoing = this.relay.tamper ? this.relay.tamper(event) : event;
        for (const socket of this.relay.sockets) {
          for (const [subscription, filter] of socket.subscriptions) {
            if (matches(filter, event)) socket.deliver(JSON.stringify(["EVENT", subscription, outgoing]));
          }
        }
      }
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.relay.sockets.delete(this);
      later(() => this.onclose?.({}));
    }
  }

  return {
    WebSocket: FakeWebSocket,
    relays,
    // Take a relay down: its sockets close, and new ones fail until up().
    down: (url) => {
      const relay = relayFor(url);
      relay.up = false;
      for (const socket of [...relay.sockets]) socket.close();
    },
    up: (url) => {
      relayFor(url).up = true;
    },
    // Send raw text to every socket subscribed on a relay, as a hostile or
    // broken relay might.
    inject: (url, frame) => {
      for (const socket of relayFor(url).sockets) socket.deliver(frame);
    },
    // Refuse every event published to a relay with these words (as a relay
    // that limits how much one address may publish does), or "" to stop.
    refuse: (url, words) => {
      relayFor(url).refusing = String(words ?? "");
    },
    // Rewrite events as a relay passes them on.
    tamper: (url, fn) => {
      relayFor(url).tamper = fn;
    },
  };
};

export const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
