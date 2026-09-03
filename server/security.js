/*! Open Historia — server security helpers. Pure, dependency-light functions
 *  for path containment, the CSRF/origin guard, HTTP range parsing and the hub
 *  host allowlist. Kept separate so they can be unit-tested (security.test.js)
 *  without spinning up the server. */
import path from "path";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// A child id/name must resolve to a DIRECT child of baseDir. Rejects "../", a
// path separator (including the %2f Express decodes back into "/"), and absolute
// paths, so an unnormalized route param can't escape the data dir on
// read/update/delete. Throws on anything unsafe; returns the absolute path.
export const resolveChildPath = (baseDir, name, label = "id") => {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, String(name ?? ""));
  if (path.dirname(resolved) !== base) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
  return resolved;
};

// True only for the local machine. IPv4-mapped IPv6 (::ffff:127.0.0.1) is
// unwrapped first.
export const isLoopbackAddress = (addr) => {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/i, "");
  return a === "::1" || a === "127.0.0.1" || /^127\./.test(a);
};

// Decide whether a state-changing request may proceed (CSRF / drive-by guard).
// Allowed: safe methods; same-origin app writes (Origin host === Host); and
// native clients with no Origin BUT only from loopback.
//
// KNOW WHAT THIS DOES AND DOES NOT COVER. It stops a BROWSER: a page on another
// origin cannot forge the Origin header, so a drive-by write to localhost is
// genuinely blocked. It does NOT stop a non-browser client, which sets both
// headers itself and passes the same-origin branch trivially:
//
//   curl -X POST http://192.168.1.9:3000/api/games/... \
//     -H "Host: 192.168.1.9:3000" -H "Origin: http://192.168.1.9:3000"
//
// Nothing header-based can tell that apart from the real app. Keeping an
// attacker on the network out is the job of WHERE THE SERVER LISTENS, not of
// this function — see the host resolution in server.js, which binds loopback
// until the player turns on LAN sharing (Settings → Network, or OH_HOST). Returns { allowed, reason }.
export const crossOriginWriteAllowed = ({ method, origin, host, remoteAddress, allowAll = false }) => {
  if (allowAll) return { allowed: true, reason: "override" };
  if (SAFE_METHODS.has(String(method || "").toUpperCase())) return { allowed: true, reason: "safe-method" };

  if (!origin) {
    return isLoopbackAddress(remoteAddress)
      ? { allowed: true, reason: "loopback" }
      : { allowed: false, reason: "no-origin-nonloopback" };
  }

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { allowed: false, reason: "invalid-origin" };
  }
  return originHost === host
    ? { allowed: true, reason: "same-origin" }
    : { allowed: false, reason: "cross-origin" };
};

// Parse an HTTP Range header against a file of totalSize bytes. Returns
// { status: 416 } for an unsatisfiable/empty range, else inclusive { start,
// end }. Suffix ranges ("bytes=-N") correctly mean the FINAL N bytes.
export const parseByteRange = (rangeHeader, totalSize) => {
  const match = /bytes=(\d*)-(\d*)/i.exec(String(rangeHeader || ""));
  if (!match || (!match[1] && !match[2])) return { status: 416 };

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    const s = Number.parseInt(match[1], 10);
    if (s >= totalSize) return { status: 416 }; // first-byte-pos past EOF
    const e = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
    start = Math.max(0, Math.min(s, totalSize - 1));
    end = Math.max(start, Math.min(e, totalSize - 1));
  }

  if (start >= totalSize) return { status: 416 };
  return { start, end };
};

// A hub download URL must be https and either on the fixed GitHub host allowlist
// OR any *.githubusercontent.com CDN host — checked on the initial URL AND every
// redirect hop. GitHub serves release/attachment downloads off a rotating family
// of those hosts (objects., release-assets., …); release assets now redirect to
// release-assets.githubusercontent.com, which a fixed list missed and wrongly
// rejected as "redirected off GitHub". Every *.githubusercontent.com host is
// GitHub-controlled, so this stays safe against redirect-to-internal SSRF.
export const isAllowedHubUrl = (candidate, allowedHosts) =>
  candidate.protocol === "https:" &&
  (allowedHosts.has(candidate.hostname) || candidate.hostname.endsWith(".githubusercontent.com"));

// --- Relay target guard -----------------------------------------------------
// The AI relay deliberately reaches PRIVATE addresses — a self-hosted model on
// localhost or the LAN box is the whole point — so a blanket private-range block
// would break the feature it exists for. What is never a legitimate AI endpoint
// is the cloud metadata service: 169.254.169.254 (AWS/GCP/Azure/DO), its IPv6
// form, and the hostnames that resolve to it. Those hand out instance
// credentials to anything that can issue a plain GET, so they are refused here
// even though the surrounding private ranges are allowed through.
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

// Strip the brackets Node's URL keeps around an IPv6 hostname.
const bareHostname = (hostname) => String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();

export const isMetadataAddress = (hostname) => {
  const host = bareHostname(hostname);
  if (METADATA_HOSTNAMES.has(host)) return true;
  // IPv4 link-local (169.254.0.0/16) — metadata lives at .169.254, but the whole
  // range is link-local and has no business being an AI endpoint.
  if (/^169\.254\./.test(host)) return true;
  // IPv6 link-local (fe80::/10) and the metadata alias fd00:ec2::254.
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (host === "fd00:ec2::254") return true;
  return false;
};

// Decide whether the AI relay may fetch `candidate`. Returns { allowed, reason }.
export const relayTargetAllowed = (candidate) => {
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    return { allowed: false, reason: "Only http(s) AI endpoints can be relayed." };
  }
  if (isMetadataAddress(candidate.hostname)) {
    return { allowed: false, reason: "That address is a cloud metadata endpoint, not an AI endpoint." };
  }
  return { allowed: true, reason: "ok" };
};

// Headers a caller may not set on a relayed request. Content-Type is added by the
// relay itself; the rest either belong to the hop the relay makes (Host,
// Connection, framing) or would let a caller smuggle a second request through a
// proxy that reads them.
const FORBIDDEN_RELAY_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authorization", "proxy-connection",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length", "expect",
]);

export const sanitizeRelayHeaders = (headers) => {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (FORBIDDEN_RELAY_HEADERS.has(String(key).toLowerCase())) continue;
    out[key] = String(value);
  }
  return out;
};

// --- CORS origin allowlist --------------------------------------------------
// The Android connect screen probes this server from the WebView's OWN origin,
// so some cross-origin reading has to be allowed. `*` was too broad: it also let
// any website a player happens to be visiting read their saved games off
// localhost (GET is a "safe method", so the write guard above never sees it).
// Reflect a known origin instead — the app's own origin, plus the handful of
// origins a Capacitor shell can run under.
const APP_SHELL_ORIGINS = new Set([
  "http://app.paxhistoria",
  "https://app.paxhistoria",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
]);

// Returns the value for Access-Control-Allow-Origin, or null to send no CORS
// header at all (same-origin requests don't need one).
export const allowedCorsOrigin = (origin, host, { allowAll = false } = {}) => {
  if (allowAll) return "*";
  if (!origin) return null;
  if (APP_SHELL_ORIGINS.has(String(origin).toLowerCase())) return origin;
  try {
    return new URL(origin).host === host ? origin : null;
  } catch {
    return null;
  }
};
