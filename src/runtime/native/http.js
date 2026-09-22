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
// answer is right, the advisor's typing effect is not there for LAN models. It
// cannot abort a request in flight either; the caller's signal is honoured only
// before the request leaves.
import { nativePlugin } from "./bridge.js";

const READ_TIMEOUT_MS = 600000; // a long turn on a small local model
const CONNECT_TIMEOUT_MS = 15000;

export const nativeHttpAvailable = () => Boolean(nativePlugin("CapacitorHttp"));

export const nativeHttpFetch = async (url, { method = "POST", headers = {}, payload, signal } = {}) => {
  if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
  const http = nativePlugin("CapacitorHttp");
  if (!http) throw new TypeError("Native HTTP is not available in this build.");
  const response = await http.request({
    url,
    method,
    headers: { ...headers },
    ...(payload !== undefined ? { data: payload } : {}),
    responseType: "text",
    connectTimeout: CONNECT_TIMEOUT_MS,
    readTimeout: READ_TIMEOUT_MS,
  });
  const body = typeof response?.data === "string" ? response.data : JSON.stringify(response?.data ?? "");
  return new Response(body, {
    status: Number(response?.status) || 0,
    headers: response?.headers && typeof response.headers === "object" ? response.headers : {},
  });
};
