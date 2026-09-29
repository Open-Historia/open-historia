/*! Open Historia — spy intercepts at rest © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
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
// WebCrypto where it exists. The Android app's WebView is not a secure context
// and has no crypto.subtle, so there the same AES-GCM runs in pure JS
// (aesGcm.js) and the IV comes from sha256.js's pure SHA-256. Both paths produce
// the same bytes, so an intercept sealed on the desktop opens on the phone and
// the other way round.

import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm.js";
import { sha256HexPure } from "./sha256.js";

// Guarded: an insecure context may throw on the property access itself.
const subtle = () => {
  try {
    return globalThis.crypto?.subtle ?? null;
  } catch {
    return null;
  }
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((pair) => parseInt(pair, 16)));
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// 32 random bytes as hex. Minted once per game the first time a spy is used and
// kept in world.spySeal.
export const newSeal = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));

// Unique report ids keep AES-GCM labels unique even when an agent reports twice
// in the same game round.
export const newSpyReportId = () => `spy-report-${toHex(globalThis.crypto.getRandomValues(new Uint8Array(12)))}`;

export const isSeal = (value) => /^[0-9a-f]{64}$/i.test(String(value ?? ""));

const keyCache = new Map();
const importKey = async (webCrypto, seal) => {
  if (keyCache.has(seal)) return keyCache.get(seal);
  const key = await webCrypto.importKey("raw", fromHex(seal), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  keyCache.set(seal, key);
  return key;
};

// A deterministic 96-bit IV from a label (intercept id + message index): the
// same message always seals to the same bytes, so a re-save never churns the
// file, and the label is never reused for different plaintext under one key
// because an intercept id is minted per gather.
const ivFor = (label) => fromHex(sha256HexPure(String(label))).slice(0, 12);

export const sealText = async (seal, label, text) => {
  const iv = ivFor(label);
  const plain = encoder.encode(String(text ?? ""));
  const webCrypto = subtle();
  if (webCrypto) {
    try {
      const key = await importKey(webCrypto, seal);
      return toB64(new Uint8Array(await webCrypto.encrypt({ name: "AES-GCM", iv }, key, plain)));
    } catch {
      /* not usable after all (insecure context) — fall through */
    }
  }
  return toB64(aesGcmEncrypt(fromHex(seal), iv, plain));
};

export const openText = async (seal, label, cipher) => {
  const iv = ivFor(label);
  const sealed = fromB64(String(cipher ?? ""));
  const webCrypto = subtle();
  let key = null;
  if (webCrypto) {
    try {
      key = await importKey(webCrypto, seal);
    } catch {
      key = null;
    }
  }
  // A wrong seal or a tampered cipher throws on either path.
  if (key) return decoder.decode(await webCrypto.decrypt({ name: "AES-GCM", iv }, key, sealed));
  return decoder.decode(aesGcmDecrypt(fromHex(seal), iv, sealed));
};

// Whether this device can seal and reopen an intercept. Checked before an
// agent's report spends its AI request, so a report that could not be stored
// is never paid for.
export const spySealingWorks = async () => {
  const probe = "0".repeat(64);
  try {
    return (await openText(probe, "probe", await sealText(probe, "probe", "probe"))) === "probe";
  } catch {
    return false;
  }
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


// Political assessments use the same per-game seal as traffic, but a separate
// report-scoped label. They are opened only in memory before the knowledge layer
// decides what the player may see.
const politicalAssessmentLabel = (reportId) => `${String(reportId ?? "").trim() || "legacy-report"}:political-assessment`;

export const sealPoliticalAssessment = async (seal, reportId, assessment) => {
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return null;
  if (assessment.cipher && !assessment.summary && !assessment.findings) return { cipher: String(assessment.cipher) };
  return { cipher: await sealText(seal, politicalAssessmentLabel(reportId), JSON.stringify(assessment)) };
};

export const openPoliticalAssessment = async (seal, reportId, assessment) => {
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return null;
  if (!assessment.cipher) return assessment;
  try {
    const parsed = JSON.parse(await openText(seal, politicalAssessmentLabel(reportId), assessment.cipher));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return { summary: "[unreadable]", findings: [] };
  }
};
