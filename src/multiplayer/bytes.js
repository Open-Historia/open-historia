/*! Open Historia — bytes and text for the multiplayer wire © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The small conversions every part of the wire needs: UTF-8, hex, base64url,
// joining, comparing and random bytes. Import-light and free of DOM, so the
// node tests use exactly what the game uses. Random bytes come from
// crypto.getRandomValues, which (unlike crypto.subtle) is there in every place
// the game runs, the Android app's insecure origin included.

export const utf8 = (text) => new TextEncoder().encode(String(text ?? ""));
export const fromUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export const concatBytes = (...parts) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

// Same length and same bytes, in time that does not depend on where they
// first differ.
export const equalBytes = (a, b) => {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

const HEX = /^(?:[0-9a-f]{2})*$/;
export const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const fromHex = (text) => {
  const value = String(text ?? "");
  if (!HEX.test(value)) throw new TypeError("Not lower-case hex.");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

// base64url without padding (RFC 4648 §5): what tokens and keys travel as.
const BASE64URL = /^[A-Za-z0-9_-]*$/;
export const toBase64Url = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromBase64Url = (text) => {
  const value = String(text ?? "");
  if (!BASE64URL.test(value) || value.length % 4 === 1) throw new TypeError("Not base64url.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
