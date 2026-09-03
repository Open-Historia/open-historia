/*! Open Historia — spy intercepts at rest © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// An intercept is stored ENCRYPTED. Redaction happens at render time from the
// player's intelligence stat, which means the whole text has to be on the device
// — and if it sat there as plain JSON, opening intercepts.json (or the network
// tab, or React devtools) would hand over every censored word. So each message is
// sealed with AES-GCM under a random per-game key, and only ever decrypted in
// memory by the code that needs it: the renderer (which then redacts before
// anything reaches the DOM) and the jump prompt (which the player never sees).
//
// This is obfuscation with a real cipher, not a security boundary: the key lives
// in the same save the player owns, and a determined person can extract it. The
// bar is "cannot be read by copying the text or opening the file", which it
// clears — and for a single-player game that is the honest and sufficient bar.
//
// WebCrypto only, so the same file runs in the browser and in Node's test
// runner without a dependency.

const subtle = () => globalThis.crypto?.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((pair) => parseInt(pair, 16)));
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// 32 random bytes as hex. Minted once per game the first time a spy is used and
// kept in world.spySeal.
export const newSeal = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));

export const isSeal = (value) => /^[0-9a-f]{64}$/i.test(String(value ?? ""));

const keyCache = new Map();
const importKey = async (seal) => {
  if (keyCache.has(seal)) return keyCache.get(seal);
  const key = await subtle().importKey("raw", fromHex(seal), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  keyCache.set(seal, key);
  return key;
};

// A deterministic 96-bit IV from a label (intercept id + message index): the
// same message always seals to the same bytes, so a re-save never churns the
// file, and the label is never reused for different plaintext under one key
// because an intercept id is minted per gather.
const ivFor = async (label) => new Uint8Array(await subtle().digest("SHA-256", encoder.encode(String(label)))).slice(0, 12);

export const sealText = async (seal, label, text) => {
  const key = await importKey(seal);
  const iv = await ivFor(label);
  const bytes = await subtle().encrypt({ name: "AES-GCM", iv }, key, encoder.encode(String(text ?? "")));
  return toB64(new Uint8Array(bytes));
};

export const openText = async (seal, label, cipher) => {
  const key = await importKey(seal);
  const iv = await ivFor(label);
  const bytes = await subtle().decrypt({ name: "AES-GCM", iv }, key, fromB64(String(cipher ?? "")));
  return decoder.decode(bytes);
};

// Seals every message of an exchange in place of its text. Messages already
// sealed (no text, a cipher) pass through.
export const sealExchange = async (seal, exchange) => ({
  ...exchange,
  messages: await Promise.all((exchange?.messages ?? []).map(async (message, index) => {
    if (message?.cipher && !message?.text) return message;
    const { text, ...rest } = message ?? {};
    return { ...rest, cipher: await sealText(seal, `${exchange.id}:${index}`, text) };
  })),
});

// The inverse, for the renderer and the prompt. A message that will not open
// (wrong seal, tampered file) comes back as a marked blank rather than throwing,
// so one bad record cannot take the whole tab down.
export const openExchange = async (seal, exchange) => ({
  ...exchange,
  messages: await Promise.all((exchange?.messages ?? []).map(async (message, index) => {
    if (message?.text) return message;
    try {
      return { ...message, text: await openText(seal, `${exchange.id}:${index}`, message?.cipher) };
    } catch {
      return { ...message, text: "[unreadable]" };
    }
  })),
});
