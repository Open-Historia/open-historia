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
// native clients with no Origin BUT only from loopback. A foreign Origin, or a
// no-Origin write from a non-loopback host (the hostile-LAN case the Origin
// check can't see), is rejected. Returns { allowed, reason }.
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
