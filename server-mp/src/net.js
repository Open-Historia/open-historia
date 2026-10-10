/*! Open Historia — whose connection this is, as far as limits go © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The server's limits (rooms, sockets and requests per address) need to know
// who is asking, and the only answer a server has is the client's address.
//
// Behind our own proxy (Caddy, TRUST_PROXY=true) every connection comes from
// the proxy, and the client's address is in X-Forwarded-For. Only the LAST
// entry of that header is ours: the proxy appends the address it saw, and
// everything before it is whatever the client chose to send. Trusting the
// first entry would let anyone pick a new address per request and walk past
// every limit. Without a proxy the header is ignored altogether, for the same
// reason.
//
// An IPv6 client is limited by its /64, not its address: one home or one
// phone is handed a whole /64 and can take a fresh address from it for every
// socket.

import { isIP } from "node:net";

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

// "::ffff:1.2.3.4" (how a dual-stack socket reports an IPv4 client) becomes
// "1.2.3.4", and a zone id ("fe80::1%eth0") is dropped.
const plain = (address) => {
  const text = String(address ?? "").split("%")[0];
  const mapped = MAPPED_V4.exec(text);
  return mapped ? mapped[1] : text;
};

// A proxy may write "1.2.3.4:5678" or "[2001:db8::1]:443".
const withoutPort = (text) => {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed) return bracketed[1];
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text);
  return v4 ? v4[1] : text;
};

export const clientAddress = (req, trustProxy) => {
  const socketAddress = plain(req.socket?.remoteAddress);
  if (!trustProxy) return socketAddress;
  // Node joins repeated X-Forwarded-For headers with ", ", so the last entry
  // of the joined text is still the one the proxy added.
  const header = req.headers?.["x-forwarded-for"];
  const last = String(Array.isArray(header) ? header.join(",") : header ?? "").split(",").at(-1).trim();
  const forwarded = plain(withoutPort(last));
  // No usable header means the request did not come through the proxy, or the
  // proxy is misconfigured; the socket's address is the honest fallback.
  return isIP(forwarded) ? forwarded : socketAddress;
};

// The eight groups of an IPv6 address, each four hex digits.
const expandIpv6 = (address) => {
  let text = address.toLowerCase();
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail[2].split(".").map(Number);
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  if (rest === undefined) return headGroups.map((group) => group.padStart(4, "0"));
  const restGroups = rest ? rest.split(":") : [];
  const zeros = Array(8 - headGroups.length - restGroups.length).fill("0");
  return [...headGroups, ...zeros, ...restGroups].map((group) => group.padStart(4, "0"));
};

// What the per-address limits count by: an IPv4 address, or an IPv6 /64.
export const addressKey = (address) => {
  const text = plain(address);
  const family = isIP(text);
  if (family === 4) return text;
  if (family !== 6) return "unknown";
  const groups = expandIpv6(text);
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const high = Number.parseInt(groups[6], 16);
    const low = Number.parseInt(groups[7], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
};

// The wider network an addressKey belongs to, for a second, looser limit:
// the /48 of an IPv6 /64 (a home is often handed a /56, which is 256 /64s,
// and a small site a /48), and nothing for IPv4. A network may hold
// NETWORK_SHARE times what one address may.
export const NETWORK_SHARE = 4;
export const networkKey = (key) => (key.endsWith("::/64") ? `${key.split(":").slice(0, 3).join(":")}::/48` : null);
