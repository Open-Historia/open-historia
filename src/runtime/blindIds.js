/*! Open Historia — ids that tell nothing but themselves © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An id the game makes for a record (an order, a letter, a thread, a vote, a
// document) is read by everyone who may see that record. In a shared game that
// is several people, and the id was made of the host's clock and one counter
// for everything the host made (`${prefix}-${time}-${count}`): two of a
// player's own ids, a minute apart, told it how many orders, letters, threads,
// votes and connections every other player had made in that minute (the fix
// agents' follow-ups of 2026-11-18, C7). The time said when, to the
// millisecond, a rival's line or order was taken, which its game date does not.
//
// So an id is random, and nothing else: unique, since 8 random bytes do not
// repeat in any game's lifetime, and in no order, since nothing the game does
// reads an id's order (a list keeps its own, and a tie broken by id is broken
// the same way every time for the same ids). The randomness is the platform's
// cryptographic source (crypto.getRandomValues, there in every place the game
// runs, the Android app's insecure origin included): Math.random's state can be
// worked out from enough of its outputs, and then the draws between two ids
// counted, which is the same leak again.
//
// Import-free, so the host's engine, the page and the node tests share it.

const HEX = (byte) => byte.toString(16).padStart(2, "0");

// `bytes` random bytes, as lower-case hex.
export const blindToken = (bytes = 8) => {
  const values = new Uint8Array(Math.max(1, Math.trunc(Number(bytes) || 8)));
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, HEX).join("");
};

// An id for a record: its kind, and a blind token ("order-3f9c0a1b7e2d4c58").
export const blindId = (prefix = "") => {
  const kind = String(prefix ?? "").trim();
  return kind ? `${kind}-${blindToken()}` : blindToken();
};

// A number in [0, 1) from the same source, for what draws from Math.random's
// shape (host/onlyOrdered.js opaqueId).
export const blindFraction = () => {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] / 4294967296;
};
