/*! Open Historia — content-node trust + verified fetch © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Fetches heavy content (map pmtiles) from the vetted node swarm and verifies
// EVERY byte against the content manifest's SHA-256 before trusting it. Integrity
// comes from the hash, not from trusting the node — a malicious or broken node
// can at worst force a retry, never deliver tampered bytes. Falls back through
// the node list to the canonical origin, so a node outage is invisible.
//
// Web build only (dynamically imported behind import.meta.env.VITE_OH_WEB from
// assets.js), so none of this ships in the local download.

import { fetchSignedJson } from "./trust.js";

// The signed node directory is served live by the registry Worker (it changes as
// the admin accepts/pauses/bans nodes), so point at it via VITE_OH_DIRECTORY_URL
// at build time. The content manifest ships with the build, so it defaults to
// same-origin. Both are signature-verified regardless of where they're served.
const DIRECTORY_URL = import.meta.env.VITE_OH_DIRECTORY_URL || "/node-directory.json";
const MANIFEST_URL = import.meta.env.VITE_OH_MANIFEST_URL || "/content-manifest.json";

let directoryPromise = null;
let manifestPromise = null;

// Both the content manifest (asset→hash) and the node directory MUST be validly
// signed by the pinned root key, or we don't use nodes at all. This is what makes
// an untrusted swarm safe: an attacker who swaps a hash or injects a node can't
// produce a valid signature, so the client ignores it and uses the origin.
const loadSigned = async (url, empty) => {
  const { valid, data, reason } = await fetchSignedJson(url);
  if (!valid) {
    if (reason !== "unsigned" && reason !== "missing-doc") {
      console.warn(`Rejecting ${url}: ${reason} — using canonical origin instead.`);
    }
    return empty;
  }
  return data;
};

const loadDirectory = () => {
  if (!directoryPromise) directoryPromise = loadSigned(DIRECTORY_URL, { nodes: [] });
  return directoryPromise;
};

const loadManifest = () => {
  if (!manifestPromise) manifestPromise = loadSigned(MANIFEST_URL, { assets: {} });
  return manifestPromise;
};

const sha256Hex = async (buffer) => {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// Map a pmtiles fetch URL (/api/runtime/pmtiles/countries or /assets/countries.pmtiles)
// to a content-manifest asset id (countries.pmtiles).
const assetIdFromUrl = (url) => {
  const runtime = /\/api\/runtime\/pmtiles\/([a-z0-9-]+)/i.exec(url);
  if (runtime) return `${runtime[1]}.pmtiles`;
  const asset = /\/assets\/([a-z0-9._-]+\.pmtiles)/i.exec(url);
  if (asset) return asset[1];
  return null;
};

// Order candidate nodes for an asset. A per-asset rotation (hash of the id) spreads
// load across the swarm without any per-request randomness.
const orderedContentNodes = (nodes, assetId) => {
  const usable = (nodes ?? []).filter((n) => n && n.url && (!n.caps || n.caps.includes("content")));
  if (usable.length <= 1) return usable;
  let seed = 0;
  for (const ch of assetId) seed = (seed + ch.charCodeAt(0)) % usable.length;
  return [...usable.slice(seed), ...usable.slice(0, seed)];
};

// Try to fetch `url`'s asset from the node swarm, verifying the SHA-256. Returns a
// verified ArrayBuffer, or null so the caller falls back to the canonical origin
// (no nodes listed, unknown asset, or every node failed/served tampered bytes).
export const fetchVerifiedBuffer = async (url, { signal } = {}) => {
  const assetId = assetIdFromUrl(url);
  if (!assetId) return null;

  const [manifest, directory] = await Promise.all([loadManifest(), loadDirectory()]);
  const expected = manifest?.assets?.[assetId];
  if (!expected?.sha256) return null;

  const nodes = orderedContentNodes(directory?.nodes, assetId);
  for (const node of nodes) {
    try {
      const response = await fetch(`${node.url.replace(/\/$/, "")}/oh/v1/content/${expected.sha256}`, {
        signal,
        cache: "force-cache",
      });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (expected.bytes && buffer.byteLength !== expected.bytes) continue; // wrong size → skip
      if ((await sha256Hex(buffer)) !== expected.sha256) {
        console.warn(`content node ${node.id ?? node.url} served tampered ${assetId} — skipping`);
        continue;
      }
      return buffer; // verified
    } catch {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      // network error → try the next node
    }
  }
  return null;
};
