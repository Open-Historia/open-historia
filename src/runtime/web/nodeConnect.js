/*! Open Historia — web-mode node connection manager © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Picks the best content node for this player (lowest latency + free capacity)
// from the signed directory, "connects" to it (a heartbeat that counts toward the
// node's live user count until they leave), and makes content fetches prefer it.
// Falls back to the origin proxy when no node is available. Web build only.

import { loadDirectoryNodes, setPreferredNode } from "./contentTrust.js";

let connected = null; // { url, id, region, latency, users, max } | { origin: true } | null
let heartbeatTimer = null;
const clean = (u) => String(u || "").replace(/\/$/, "");

// Probe one node's live status and measure round-trip latency.
const probe = async (node) => {
  const base = clean(node.url);
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  try {
    const r = await fetch(`${base}/oh/v1/status`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const status = await r.json();
    return { url: base, latency: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0), status };
  } catch {
    return null; // offline / timed out — skip
  }
};

// Best = reachable + active + not full, lowest latency.
export const selectBestNode = async () => {
  const nodes = await loadDirectoryNodes();
  if (!nodes.length) return null;
  const probed = (await Promise.all(nodes.map(probe))).filter(Boolean);
  const usable = probed.filter((p) => p.status && p.status.status === "active" && !p.status.full);
  if (!usable.length) return null;
  usable.sort((a, b) => a.latency - b.latency);
  return usable[0];
};

const startHeartbeat = (url) => {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    // If our node goes draining/full/unreachable (e.g. its operator pressed the
    // dashboard's graceful shutdown), move to another node so play continues.
    try {
      const r = await fetch(`${url}/oh/v1/ping`, { cache: "no-store" });
      const s = r.ok ? await r.json().catch(() => null) : null;
      if (!s || s.status !== "active" || s.full) await connectBestNode();
    } catch { await connectBestNode(); }
  }, 20000);
  if (heartbeatTimer && typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
};

// Connect to the best node (or the origin fallback). Idempotent; safe to re-run.
export const connectBestNode = async () => {
  const best = await selectBestNode();
  if (!best) {
    clearInterval(heartbeatTimer);
    setPreferredNode(null);
    connected = { origin: true };
    return connected;
  }
  try { await fetch(`${best.url}/oh/v1/ping`, { cache: "no-store" }); } catch { /* count is best-effort */ }
  setPreferredNode(best.url);
  startHeartbeat(best.url);
  // Deliberately no operator name — nodes don't broadcast it and the UI shows
  // only the anonymous node id, so hosters stay private.
  connected = {
    url: best.url, id: best.status.id, region: best.status.region,
    latency: best.latency, users: best.status.currentUsers, max: best.status.maxUsers,
  };
  return connected;
};

export const getConnected = () => connected;
export const disconnect = () => { clearInterval(heartbeatTimer); setPreferredNode(null); connected = null; };
