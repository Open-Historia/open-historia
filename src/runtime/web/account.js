/*! Open Historia — web-mode accounts + client crypto © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Client half of the accounts + sync feature (web build only). Handles the
// magic-link session, the per-account data key (DEK), and AES-256-GCM
// encrypt/decrypt of records before they leave the browser. The registry Worker
// only ever stores CIPHERTEXT and the DEK wrapped under the offline admin master
// key (recovery) + a Worker secret (cross-device delivery) — see registry/worker.js.

import { kvGet, kvPut, idbDelete, STORES } from "./idb.js";
import { bytesToBase64, base64ToBytes, sha256Hex } from "./util.js";

const ACCOUNT_URL = (import.meta.env.VITE_OH_ACCOUNT_URL || "").replace(/\/$/, "");

// Session lives in IndexedDB kv so it survives reloads. The DEK is cached here
// too (this device is already trusted once signed in); it is never uploaded.
const SESSION_KEY = "account:session";
const EMAIL_KEY = "account:email";
const DEK_KEY = "account:dek"; // base64 of the raw 32-byte AES key

let dekBytesCache = null;

// Announce a sign-in/out so other parts of the UI (e.g. the corner account
// widget) refresh immediately instead of showing a stale "signed out" state.
const emitAuth = (signedIn) => {
  try { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("oh:auth", { detail: { signedIn } })); }
  catch { /* non-browser context */ }
};

export const accountConfigured = () => Boolean(ACCOUNT_URL);

export const getSession = () => kvGet(SESSION_KEY, null);
export const getEmail = () => kvGet(EMAIL_KEY, null);
export const isSignedIn = async () => Boolean(await getSession());

const api = async (path, { method = "GET", body, session } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session}`;
  const r = await fetch(`${ACCOUNT_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
};

// Tell the registry which node we're playing on, so the admin can see who's
// connected where. This has to come from us: a node only ever sees IPs and never
// learns a player's identity. Signed-in only (a no-op when signed out, so anonymous
// players are never reported), and best-effort — presence is cosmetic. Pass null on
// disconnect to clear the row.
export const reportPresence = async (nodeId) => {
  if (!ACCOUNT_URL) return;
  const session = await getSession();
  if (!session) return;
  try { await api("/account/presence", { method: "POST", session, body: { nodeId: nodeId || null } }); }
  catch { /* never let presence break play */ }
};

// --- Sign-in flow (magic link) ---
export const requestMagicLink = async (email) => {
  const { status, data } = await api("/account/request", { method: "POST", body: { email } });
  if (status !== 200) throw new Error(data?.error || "Could not send the sign-in link.");
  return data; // { ok, devLink? }
};

// Redeem a magic token (from ?magic=… in the URL). Establishes the session and
// ensures this account has a DEK (generating one on first ever sign-in).
export const redeemMagicToken = async (token) => {
  const { status, data } = await api("/account/verify", { method: "POST", body: { token } });
  if (status !== 200) throw new Error(data?.error || "That sign-in link is invalid or expired.");
  await kvPut(SESSION_KEY, data.session);
  await kvPut(EMAIL_KEY, data.email);
  await ensureDek(data.session, data.hasKey);
  emitAuth(true);
  return data; // { email, session, hasKey }
};

// The OAuth client id for "Sign in with Google" (public — safe to ship). Empty
// string disables the Google button (e.g. a build without it configured).
export const googleClientId = () => (import.meta.env.VITE_OH_GOOGLE_CLIENT_ID || "").trim();

// Sign in with Google: hand the registry the Identity Services ID token, which it
// verifies server-side, and take back a session — then ensure the account's DEK,
// exactly as redeeming a magic link would. No email is ever sent.
export const signInWithGoogle = async (credential) => {
  const { status, data } = await api("/account/google", { method: "POST", body: { credential } });
  if (status !== 200) throw new Error(data?.error || "Google sign-in failed.");
  await kvPut(SESSION_KEY, data.session);
  await kvPut(EMAIL_KEY, data.email);
  await ensureDek(data.session, data.hasKey);
  emitAuth(true);
  return data; // { email, session, hasKey }
};

// Ensure the account's DEK is available on this device: pull it (existing
// account) or generate + register it (first sign-in ever).
const ensureDek = async (session, hasKey) => {
  if (hasKey) {
    const { status, data } = await api("/account/key", { session });
    if (status !== 200) throw new Error("Could not fetch your encryption key.");
    dekBytesCache = base64ToBytes(data.dek);
  } else {
    dekBytesCache = crypto.getRandomValues(new Uint8Array(32));
    const { status } = await api("/account/key", { method: "POST", session, body: { dek: bytesToBase64(dekBytesCache) } });
    if (status !== 200) throw new Error("Could not register your encryption key.");
  }
  await kvPut(DEK_KEY, bytesToBase64(dekBytesCache));
};

export const getDek = async () => {
  if (dekBytesCache) return dekBytesCache;
  const stored = await kvGet(DEK_KEY, null);
  if (stored) dekBytesCache = base64ToBytes(stored);
  return dekBytesCache;
};

export const signOut = async () => {
  dekBytesCache = null;
  await idbDelete(STORES.kv, SESSION_KEY);
  await idbDelete(STORES.kv, EMAIL_KEY);
  await idbDelete(STORES.kv, DEK_KEY);
  emitAuth(false);
};

// --- Record (de)serialization: preserve binary fields (covers/pmtiles bytes)
// that plain JSON would drop, so an encrypted blob round-trips a full record. ---
const encodeRecord = (obj) => JSON.stringify(obj, (_key, value) => {
  if (value instanceof Uint8Array) return { __u8: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) return { __u8: bytesToBase64(new Uint8Array(value)) };
  return value;
});
const decodeRecord = (str) => JSON.parse(str, (_key, value) => {
  if (value && typeof value === "object" && typeof value.__u8 === "string") return base64ToBytes(value.__u8);
  return value;
});

// Stable content hash of a record (over the same encoding encryptRecord signs),
// so the sync engine can cheaply tell whether a record changed since last push.
export const recordFingerprint = (obj) => sha256Hex(encodeRecord(obj));

// --- AES-256-GCM: encrypt a record to base64(iv||ciphertext); decrypt back. ---
const aesKey = async () => {
  const dek = await getDek();
  if (!dek) throw new Error("No encryption key on this device.");
  return crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};
export const encryptRecord = async (obj) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(encodeRecord(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return { ciphertext: bytesToBase64(out), sha256: await sha256Hex(encodeRecord(obj)) };
};
export const decryptRecord = async (ciphertextB64) => {
  const all = base64ToBytes(ciphertextB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(), all.slice(12));
  return decodeRecord(new TextDecoder().decode(pt));
};

// --- Sync transport (session-authed) ---
export const syncManifest = async () => {
  const { status, data } = await api("/sync/manifest", { session: await getSession() });
  if (status !== 200) throw new Error(data?.error || "sync manifest failed");
  return data.blobs || [];
};
export const syncGetBlob = async (id) => {
  const { status, data } = await api(`/sync/blob?id=${encodeURIComponent(id)}`, { session: await getSession() });
  if (status === 404) return null;
  if (status !== 200) throw new Error(data?.error || "sync get failed");
  return data; // { ciphertext, sha256, version, deleted }
};
export const syncPutBlob = async (id, ciphertext, sha256, baseVersion) => {
  const { status, data } = await api(`/sync/blob?id=${encodeURIComponent(id)}`, {
    method: "PUT", session: await getSession(), body: { ciphertext, sha256, baseVersion },
  });
  return { status, ...data }; // 200 {version} | 409 {conflict, current} | 413 {error}
};
export const syncDeleteBlob = async (id, baseVersion) => {
  const { status, data } = await api(`/sync/blob?id=${encodeURIComponent(id)}`, {
    method: "DELETE", session: await getSession(), body: { baseVersion },
  });
  return { status, ...data };
};
