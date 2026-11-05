/*! Open Historia — server security helpers. Pure, dependency-light functions
 *  for path containment, the CSRF/origin guard, the Host (DNS rebinding) guard,
 *  HTTP range parsing and the hub host allowlist. Kept separate so they can be unit-tested (security.test.js)
 *  without spinning up the server. */
import net from "net";
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
// native clients with no Origin BUT only from loopback. "Same origin" is only
// worth something because the server has already refused a Host it does not
// answer to (isAllowedHostHeader, below), so a matching Origin is one of those
// names too and never a rebinding page's.
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

// Strip the brackets Node's URL keeps around an IPv6 hostname, a zone id
// (fe80::1%eth0) and the trailing dot of a fully-qualified name.
const bareHostname = (hostname) => String(hostname || "")
  .replace(/^\[|\]$/g, "")
  .replace(/%.*$/, "")
  .replace(/\.$/, "")
  .toLowerCase();

// The eight 16-bit groups of a valid IPv6 address, expanding "::" and a dotted
// IPv4 tail (::ffff:169.254.169.254).
const ipv6Groups = (address) => {
  let text = address;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = (part) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const [head, tail] = text.split("::");
  if (tail === undefined) return parts(head);
  const front = parts(head);
  const back = parts(tail);
  return [...front, ...new Array(8 - front.length - back.length).fill(0), ...back];
};

// The IPv4 address an IPv6 one stands for, when it is one of the forms that
// reach an IPv4 host: mapped (::ffff:a.b.c.d), the old compatible form
// (::a.b.c.d) and NAT64 (64:ff9b::a.b.c.d). Node's URL writes
// http://[::ffff:169.254.169.254]/ as [::ffff:a9fe:a9fe], which is how the
// metadata service slipped past a check that compared text.
const embeddedIPv4 = (groups) => {
  const zeroPrefix = groups.slice(0, 5).every((group) => group === 0);
  const mapped = zeroPrefix && groups[5] === 0xffff;
  const compatible = zeroPrefix && groups[5] === 0 && groups[6] !== 0;
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (!mapped && !compatible && !nat64) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
};

const EC2_METADATA_IPV6 = ipv6Groups("fd00:ec2::254").join(":");

export const isMetadataAddress = (hostname) => {
  const host = bareHostname(hostname);
  if (METADATA_HOSTNAMES.has(host)) return true;
  const family = net.isIP(host);
  // IPv4 link-local (169.254.0.0/16) — metadata lives at .169.254, but the whole
  // range is link-local and has no business being an AI endpoint.
  if (family === 4) return /^169\.254\./.test(host);
  if (family !== 6) return false;
  const groups = ipv6Groups(host);
  const v4 = embeddedIPv4(groups);
  if (v4) return isMetadataAddress(v4);
  // IPv6 link-local (fe80::/10) and the metadata alias fd00:ec2::254.
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  return groups.join(":") === EC2_METADATA_IPV6;
};

// A dns.lookup for the relay's upstream socket that refuses a NAME resolving to
// a metadata address (a DNS record pointing at 169.254.169.254, or a name that
// rebinds to it after the URL check). relayTargetAllowed only sees the text of
// the URL; this sees where the connection actually goes. Node does not call a
// lookup for an IP literal, which relayTargetAllowed has already judged.
export const RELAY_BLOCKED_CODE = "ERELAYMETADATA";

export const metadataGuardedLookup = (baseLookup) => (hostname, options, callback) => {
  const done = typeof options === "function" ? options : callback;
  const lookupOptions = typeof options === "function" ? {} : options;
  baseLookup(hostname, lookupOptions, (error, address, family) => {
    if (error) return done(error);
    const resolved = Array.isArray(address) ? address : [{ address, family }];
    if (resolved.some((entry) => isMetadataAddress(entry?.address))) {
      const blocked = new Error("That address is a cloud metadata endpoint, not an AI endpoint.");
      blocked.code = RELAY_BLOCKED_CODE;
      return done(blocked);
    }
    return done(null, address, family);
  });
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

// --- Host allowlist (DNS rebinding) -----------------------------------------
// Every guard in this file that says "same origin" compares the Origin with the
// Host header, and every "loopback only" check looks at the socket. DNS
// rebinding passes all of them: a page on attacker.example re-points its own
// name at 127.0.0.1, so the browser connects over loopback and sends Origin
// and Host that both say attacker.example. The page can then read, export and
// delete every save, switch LAN sharing on and use the AI relay as a proxy.
//
// What rebinding cannot forge is the Host being a name the attacker does NOT
// control. So the server answers only to names nobody can re-point at it: an
// IP address (the browser connected to it directly, so the page's origin IS
// that address), localhost and *.localhost (browsers resolve those to loopback
// themselves), and the names the owner lists (OH_ALLOWED_HOSTS, a hostname in
// OH_HOST, and this computer's own name). "*" in the list turns the check off.
const hostnameOf = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || /[/?#@\\\s]/.test(text)) return "";
  try {
    return bareHostname(new URL(`http://${text}`).hostname);
  } catch {
    return "";
  }
};

// The owner's extra names, as the Set isAllowedHostHeader takes. A port on an
// entry ("mypc:3000") is ignored; only the name is compared.
export const allowedHostNames = (names) =>
  new Set((names ?? []).map((name) => (String(name ?? "").trim() === "*" ? "*" : hostnameOf(name))).filter(Boolean));

// No Host at all is an HTTP/1.0 client, never a browser, so it cannot be a
// rebinding page and is let through.
export const isAllowedHostHeader = (hostHeader, allowedNames = new Set()) => {
  if (hostHeader === undefined || hostHeader === null) return true;
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  if (net.isIP(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return allowedNames.has("*") || allowedNames.has(host);
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
