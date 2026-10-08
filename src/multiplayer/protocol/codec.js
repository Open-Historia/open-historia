/*! Open Historia — framing multiplayer messages over a data channel © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A data channel message has a size limit (it differs by browser; 64 KiB is
// safe everywhere), and some of what the host sends is far larger: a player's
// view of the world is megabytes. So a message travels as frames:
//
//   {"f":"m","d":<message>}                    the whole message, when small
//   {"f":"p","id":<hex>,"i":k,"n":N,"s":<text>}  part k of N of its JSON text
//
// Every frame is parsed with safeParse and checked; parts are reassembled under
// hard caps (how many messages may be half-arrived, how large one may grow,
// how long a part may wait), so a peer cannot make the other hold unbounded
// memory. What comes out is the message object, still unvalidated: the session
// checks it against the message schemas.

import { toHex, randomBytes } from "../bytes.js";
import { HEX_ID, int, literal, obj, safeParse, str, validate } from "./validate.js";

export const FRAME_LIMIT = 60 * 1024;
// What a part's text may take up inside its frame once JSON has escaped it.
const PART_BUDGET = FRAME_LIMIT - 256;
// Escaping at most doubles the message JSON's own text (a quote or backslash
// becomes two characters); a lone surrogate half becomes six. So no part holds
// fewer characters than this, which bounds how many parts a message can take.
const MIN_PART = Math.floor(PART_BUDGET / 6);
export const MESSAGE_LIMIT = 32 * 1024 * 1024;
const partsFor = (length) => Math.ceil(length / MIN_PART) + 1;

const PART = obj({
  f: literal("p"),
  id: HEX_ID(6),
  i: int(0, partsFor(MESSAGE_LIMIT) - 1),
  n: int(2, partsFor(MESSAGE_LIMIT)),
  s: str(PART_BUDGET, { min: 1 }),
});

// Consecutive slices of `text`, each as long as fits the budget once escaped.
const sliceForFrames = (text) => {
  const slices = [];
  let offset = 0;
  while (offset < text.length) {
    let size = Math.min(PART_BUDGET, text.length - offset);
    let slice = text.slice(offset, offset + size);
    let escaped = JSON.stringify(slice).length;
    while (escaped > PART_BUDGET) {
      size = Math.max(1, Math.floor((size * PART_BUDGET) / escaped) - 16);
      slice = text.slice(offset, offset + size);
      escaped = JSON.stringify(slice).length;
    }
    slices.push(slice);
    offset += size;
  }
  return slices;
};

// The frames one message travels as.
export const encodeMessage = (message) => {
  const whole = JSON.stringify({ f: "m", d: message });
  if (whole.length <= FRAME_LIMIT) return [whole];
  const text = JSON.stringify(message);
  if (text.length > MESSAGE_LIMIT) throw new RangeError(`A ${text.length}-character message is over the ${MESSAGE_LIMIT} limit.`);
  const id = toHex(randomBytes(6));
  const slices = sliceForFrames(text);
  return slices.map((slice, index) => JSON.stringify({ f: "p", id, i: index, n: slices.length, s: slice }));
};

// One decoder per peer. feed() takes a frame and returns
//   { message }           a whole message arrived
//   { pending: true }     a part was stored
//   { error }             the frame was dropped (the caller counts a strike)
export const createDecoder = ({
  maxAssemblies = 2,
  maxMessageLength = MESSAGE_LIMIT,
  partTimeoutMs = 60_000,
  now = () => Date.now(),
} = {}) => {
  const assemblies = new Map();

  const expire = () => {
    const cutoff = now() - partTimeoutMs;
    for (const [id, entry] of assemblies) if (entry.touched < cutoff) assemblies.delete(id);
  };

  const feed = (frame) => {
    if (typeof frame !== "string") return { error: "a frame that is not text" };
    if (frame.length > FRAME_LIMIT) return { error: "a frame over the size limit" };
    const parsed = safeParse(frame, { maxLength: FRAME_LIMIT, maxDepth: 40 });
    if (!parsed.ok) return { error: `an unreadable frame (${parsed.error})` };
    const value = parsed.value;
    if (value && value.f === "m" && Object.keys(value).length === 2 && "d" in value) return { message: value.d };
    const part = validate(PART, value);
    if (!part.ok) return { error: `a malformed frame (${part.error})` };

    expire();
    const { id, i, n, s } = part.value;
    if (i >= n) return { error: "a part numbered past its message" };
    let entry = assemblies.get(id);
    if (!entry) {
      if (n > partsFor(maxMessageLength)) return { error: "a message announced over the size limit" };
      if (assemblies.size >= maxAssemblies) return { error: "too many messages arriving at once" };
      entry = { n, parts: new Array(n), received: 0, length: 0, touched: now() };
      assemblies.set(id, entry);
    }
    if (entry.n !== n || entry.parts[i] !== undefined) {
      assemblies.delete(id);
      return { error: "a part that does not fit its message" };
    }
    entry.parts[i] = s;
    entry.received += 1;
    entry.length += s.length;
    entry.touched = now();
    if (entry.length > maxMessageLength) {
      assemblies.delete(id);
      return { error: "a message over the size limit" };
    }
    if (entry.received < entry.n) return { pending: true };

    assemblies.delete(id);
    const whole = safeParse(entry.parts.join(""), { maxLength: maxMessageLength, maxDepth: 40 });
    if (!whole.ok) return { error: `an unreadable message (${whole.error})` };
    return { message: whole.value };
  };

  return { feed, pending: () => assemblies.size, clear: () => assemblies.clear() };
};
