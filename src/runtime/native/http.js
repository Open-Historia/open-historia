/*! Open Historia — native HTTP for the endpoints a WebView cannot reach © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The desktop reaches a self-hosted model (Ollama, LM Studio on the LAN) through
// its own server's /api/ai/relay, because those backends send no CORS headers
// and a browser discards their replies. The Android app has no server — but it
// has Capacitor's HTTP plugin, which makes the request from the app process
// where CORS does not exist. This wraps it as a fetch-shaped call so
// Game/AI/main.jsx can use it exactly where the desktop uses the relay.
//
// What it cannot do: stream. The plugin returns the whole body at once, so an
// SSE reply arrives complete and the parsers see every event in one go — the
// answer is right, the advisor's typing effect is not there for LAN models.
//
// It cannot abort a request in flight either, so a Stop does not wait for it:
// the call rejects with the abort at once and the late reply is discarded.
// Otherwise a cancelled turn on a slow local model sat "generating" (and kept
// the app awake) until the model finished, up to the read timeout.
//
// And it fails the way fetch() does. The plugin rejects with its own error when
// the server cannot be reached (a LAN PC asleep, Ollama not running); fetch
// rejects with a TypeError, and that is what the Fallback list reads as "could
// not be reached", moving on to the next entry. The plugin's error, left as it
// was, failed the whole call instead.
import { nativePlugin } from "./bridge.js";

const READ_TIMEOUT_MS = 600000; // a long turn on a small local model
const CONNECT_TIMEOUT_MS = 15000;

export const nativeHttpAvailable = () => Boolean(nativePlugin("CapacitorHttp"));

const abortReason = (signal) => signal?.reason ?? new DOMException("The request was aborted.", "AbortError");

// Rejects when the signal aborts; never settles otherwise.
const whenAborted = (signal) => new Promise((_, reject) => {
  signal?.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
});

export const nativeHttpFetch = async (url, { method = "POST", headers = {}, payload, signal } = {}) => {
  if (signal?.aborted) throw abortReason(signal);
  const http = nativePlugin("CapacitorHttp");
  if (!http) throw new TypeError("Native HTTP is not available in this build.");
  const request = Promise.resolve().then(() => http.request({
    url,
    method,
    headers: { ...headers },
    ...(payload !== undefined ? { data: payload } : {}),
    responseType: "text",
    connectTimeout: CONNECT_TIMEOUT_MS,
    readTimeout: READ_TIMEOUT_MS,
  })).catch((error) => {
    // Aborted meanwhile: the abort below has already answered the caller.
    if (signal?.aborted) throw abortReason(signal);
    throw new TypeError(`Network request failed: ${error?.message || error}`, { cause: error });
  });
  // A reply that loses the race still settles; nothing is listening for it.
  request.catch(() => {});
  const response = await (signal ? Promise.race([request, whenAborted(signal)]) : request);
  const body = typeof response?.data === "string" ? response.data : JSON.stringify(response?.data ?? "");
  return new Response(body, {
    status: Number(response?.status) || 0,
    headers: response?.headers && typeof response.headers === "object" ? response.headers : {},
  });
};
