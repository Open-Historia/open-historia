/*! Open Historia — finding the host through public Nostr relays © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Before two machines can open a WebRTC connection they have to swap an offer
// and an answer, and until the game has its own signaling server those travel
// through public Nostr relays. A relay is a WebSocket server that passes signed
// events to whoever subscribed to them; for the "ephemeral" kinds
// (20000-29999) it keeps nothing. We publish to several at once, so one being
// down or slow changes nothing.
//
// What a relay sees: a throwaway public key per session, a topic that means
// nothing without the invite token (invite.js), sealed bodies, and the IP
// address of each device that connects to it. What it cannot do: read a body,
// or write one the room would accept, because every body is sealed with the
// room's key (XChaCha20-Poly1305, the topic as associated data). The payloads
// carry their own timestamps and the session layer checks them, so a relay
// that replays old events achieves nothing either.
//
// NIP-01 in brief: a client sends ["REQ", subscription, filter] to subscribe,
// ["EVENT", event] to publish and ["CLOSE", subscription] to stop; a relay
// answers ["EVENT", subscription, event], ["EOSE", subscription],
// ["OK", id, accepted, message], ["NOTICE", text] and ["CLOSED", subscription,
// text]. An event is { id, pubkey, created_at, kind, tags, content, sig }: id
// is the SHA-256 of [0, pubkey, created_at, kind, tags, content] as compact
// JSON, sig a BIP-340 Schnorr signature of the id.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, fromBase64Url, fromHex, fromUtf8, randomBytes, toBase64Url, toHex, utf8 } from "../bytes.js";
import { int, list, obj, safeParse, str, validate } from "../protocol/validate.js";

// Relays that pass ephemeral events without payment or sign-in. Any subset
// being up is enough; the list is a setting, not a dependency.
export const DEFAULT_RELAYS = Object.freeze([
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.nostr.net",
]);

// Ephemeral: passed on, never stored.
export const SIGNAL_KIND = 25121;
const TOPIC_TAG = "x";
const FRAME_LIMIT = 64 * 1024;
const CONTENT_LIMIT = 32 * 1024;
const PAYLOAD_LIMIT = 24 * 1024;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 30_000];
// How long nothing is published to a relay that refused an event for
// publishing too much. A host that went on regardless had a public relay's
// "rate-limited" turn into "banned: too many rate-limit violations" fourteen
// seconds later. The relay is still listened to, and the others carry what is
// said: any one of them is enough.
const QUIET_AFTER_RATE_LIMIT_MS = 60_000;
const QUIET_AFTER_BAN_MS = 15 * 60_000;

const HEX64 = str(64, { min: 64, pattern: /^[0-9a-f]+$/ });
const EVENT = obj({
  id: HEX64,
  pubkey: HEX64,
  created_at: int(0, 2 ** 40),
  kind: int(0, 65535),
  tags: list(list(str(256), 4), 8),
  content: str(CONTENT_LIMIT),
  sig: str(128, { min: 128, pattern: /^[0-9a-f]+$/ }),
});

const eventId = ({ pubkey, created_at: createdAt, kind, tags, content }) =>
  toHex(sha256(utf8(JSON.stringify([0, pubkey, createdAt, kind, tags, content]))));

const seal = (key, topic, payload) => {
  const nonce = randomBytes(24);
  const sealed = xchacha20poly1305(key, nonce, utf8(topic)).encrypt(utf8(JSON.stringify(payload)));
  return toBase64Url(concatBytes(nonce, sealed));
};

const open = (key, topic, content) => {
  const bytes = fromBase64Url(content);
  if (bytes.length < 24 + 16) throw new Error("too short");
  return fromUtf8(xchacha20poly1305(key, bytes.subarray(0, 24), utf8(topic)).decrypt(bytes.subarray(24)));
};

// A relay pool listening on one room's topic.
//   onPayload(payload, { relay, at })   a sealed body that opened, parsed but
//                                       not yet checked against any schema
//   onStatus({ connected, total })      relays currently open
export const createNostrChannel = ({
  topic,
  key,
  relays = DEFAULT_RELAYS,
  WebSocketImpl = globalThis.WebSocket,
  onPayload = () => {},
  onStatus = () => {},
  log = () => {},
  now = () => Date.now(),
  maxEventsPerSecond = 40,
  // How far back a subscription reaches, in seconds. A relay compares it with
  // the SENDER's clock (an event's created_at), so a listener whose clock is
  // ahead of a sender's hears nothing from it until the difference has gone
  // by: thirty seconds was less than two computers are commonly out by (a
  // host's ran 24 seconds slow). The same five minutes the session allows a
  // signed message (session/messages.js CLOCK_SKEW_MS); the payloads carry
  // their own times, and those are what is checked.
  reachBackSeconds = 300,
  timers = globalThis,
} = {}) => {
  if (!/^[0-9a-f]{32}$/.test(String(topic))) throw new TypeError("A signaling topic is 32 hex characters.");
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new TypeError("A signaling key is 32 bytes.");
  if (typeof WebSocketImpl !== "function") throw new Error("This device has no WebSocket to reach the relays with.");

  const secret = schnorr.utils.randomSecretKey();
  const pubkey = toHex(schnorr.getPublicKey(secret));
  const subscription = toHex(randomBytes(8));
  const seen = new Set();
  const seenOrder = [];
  const sockets = new Map();
  let closed = false;
  let windowStart = 0;
  let windowCount = 0;

  const remember = (id) => {
    seen.add(id);
    seenOrder.push(id);
    if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
  };

  const report = () => {
    const connected = [...sockets.values()].filter((entry) => entry.open).length;
    onStatus({ connected, total: relays.length });
  };

  const quieten = (entry, said) => {
    const ms = /^\s*(banned|blocked)\b/i.test(said) ? QUIET_AFTER_BAN_MS : /^\s*rate-limited\b/i.test(said) ? QUIET_AFTER_RATE_LIMIT_MS : 0;
    if (!ms || now() + ms <= (entry.quietUntil ?? 0)) return;
    entry.quietUntil = now() + ms;
    log(`relay ${entry.url}: nothing more is published to it for ${Math.round(ms / 60_000)} min`);
  };

  const handleEvent = (url, event) => {
    // The same event from another relay: every relay passes it, and it was
    // checked when it first came. Not counted as a burst, or a full lobby's
    // offers, five relays over, crowd out the answer a joiner is waiting for.
    if (typeof event?.id === "string" && seen.has(event.id)) return;
    // Bursts from a relay (or from someone who holds the token) are cut here,
    // before anything costly is done with them.
    const second = Math.floor(now() / 1000);
    if (second !== windowStart) {
      windowStart = second;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > maxEventsPerSecond) return;

    const checked = validate(EVENT, event);
    if (!checked.ok) return log(`relay ${url}: a malformed event (${checked.error})`);
    const value = checked.value;
    if (value.kind !== SIGNAL_KIND) return;
    if (!value.tags.some((tag) => tag[0] === TOPIC_TAG && tag[1] === topic)) return;
    if (value.pubkey === pubkey || seen.has(value.id)) return;
    if (eventId(value) !== value.id) return log(`relay ${url}: an event whose id does not match it`);
    let valid = false;
    try {
      valid = schnorr.verify(fromHex(value.sig), fromHex(value.id), fromHex(value.pubkey));
    } catch {
      valid = false;
    }
    if (!valid) return log(`relay ${url}: an event with a bad signature`);
    remember(value.id);
    let text;
    try {
      text = open(key, topic, value.content);
    } catch {
      return; // not sealed with this room's key
    }
    const parsed = safeParse(text, { maxLength: PAYLOAD_LIMIT, maxDepth: 8 });
    if (!parsed.ok) return log(`relay ${url}: an unreadable body (${parsed.error})`);
    onPayload(parsed.value, { relay: url, at: value.created_at });
  };

  const connect = (url) => {
    if (closed) return;
    const entry = sockets.get(url) ?? { url, open: false, attempts: 0, socket: null, timer: null, queue: [] };
    sockets.set(url, entry);
    let socket;
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      log(`relay ${url}: could not connect (${error?.message || error})`);
      return retry(entry);
    }
    entry.socket = socket;
    socket.onopen = () => {
      if (closed) return socket.close();
      entry.open = true;
      entry.attempts = 0;
      socket.send(JSON.stringify(["REQ", subscription, {
        kinds: [SIGNAL_KIND],
        [`#${TOPIC_TAG}`]: [topic],
        since: Math.floor(now() / 1000) - reachBackSeconds,
      }]));
      for (const frame of entry.queue.splice(0)) socket.send(frame);
      report();
    };
    socket.onmessage = (message) => {
      const text = typeof message?.data === "string" ? message.data : "";
      if (!text || text.length > FRAME_LIMIT) return;
      const parsed = safeParse(text, { maxLength: FRAME_LIMIT, maxDepth: 8 });
      if (!parsed.ok || !Array.isArray(parsed.value)) return;
      const [type, ...rest] = parsed.value;
      if (type === "EVENT" && rest[0] === subscription) handleEvent(url, rest[1]);
      else if (type === "OK" && rest[1] === false) {
        const said = String(rest[2] ?? "").slice(0, 120);
        log(`relay ${url} refused an event: ${said}`);
        quieten(entry, said);
      }
      else if (type === "NOTICE" || type === "CLOSED") log(`relay ${url}: ${String(rest.at(-1) ?? "").slice(0, 120)}`);
    };
    socket.onclose = () => {
      const wasOpen = entry.open;
      entry.open = false;
      entry.socket = null;
      if (wasOpen) report();
      retry(entry);
    };
    socket.onerror = () => {
      // onclose follows and does the retrying
    };
  };

  const retry = (entry) => {
    if (closed) return;
    const delay = RECONNECT_DELAYS[Math.min(entry.attempts, RECONNECT_DELAYS.length - 1)];
    entry.attempts += 1;
    timers.clearTimeout(entry.timer);
    entry.timer = timers.setTimeout(() => connect(entry.url), delay);
  };

  // Publish a payload to every relay (queued for any still connecting).
  // Returns how many relays it went to directly.
  const publish = (payload) => {
    if (closed) return 0;
    const event = {
      pubkey,
      created_at: Math.floor(now() / 1000),
      kind: SIGNAL_KIND,
      tags: [[TOPIC_TAG, topic]],
      content: seal(key, topic, payload),
    };
    event.id = eventId(event);
    event.sig = toHex(schnorr.sign(fromHex(event.id), secret));
    const frame = JSON.stringify(["EVENT", event]);
    let sent = 0;
    // Relays that asked us to slow down are passed over (quieten), unless
    // every relay that is open has: then saying it anyway is all there is.
    const quiet = (entry) => (entry.quietUntil ?? 0) > now();
    const open = [...sockets.values()].filter((entry) => entry.open && entry.socket);
    const allQuiet = open.length > 0 && open.every(quiet);
    for (const entry of sockets.values()) {
      if (quiet(entry) && !allQuiet) continue;
      if (entry.open && entry.socket) {
        entry.socket.send(frame);
        sent += 1;
      } else if (entry.queue.length < 20) {
        entry.queue.push(frame);
      }
    }
    return sent;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    for (const entry of sockets.values()) {
      timers.clearTimeout(entry.timer);
      try {
        if (entry.open) entry.socket?.send(JSON.stringify(["CLOSE", subscription]));
        entry.socket?.close();
      } catch {
        // already gone
      }
    }
    sockets.clear();
    report();
  };

  for (const url of relays) connect(url);

  return {
    publish,
    close,
    pubkey,
    status: () => ({ connected: [...sockets.values()].filter((entry) => entry.open).length, total: relays.length }),
  };
};
