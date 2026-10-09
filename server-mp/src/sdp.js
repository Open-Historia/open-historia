/*! Open Historia — what an offer or answer passed through the public server may hold © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The server passes each joiner's offer to a host and the host's answer back,
// and the schema alone lets an SDP be any 16,000 characters. Left at that,
// the relay is a free data tunnel between any two sockets. So each SDP must
// look like one: it starts "v=0", every line is "<letter>=" and printable
// text of a sane length, and there are not too many lines. That, with one
// answer per offer and a cap on offers per session (lobby.js), leaves no room
// for more than signaling.
//
// With TURN on, every game connection is meant to go through the relay
// (iceTransportPolicy "relay"), so the only ICE candidates an SDP may carry
// are relay candidates, and a relay candidate may not name the client's own
// address as its related address (raddr); browsers in relay mode write
// 0.0.0.0 there. A client that is not relay-only (or a modified one) would
// otherwise hand the other side its IP address through this server; it is
// refused instead. With TURN off (development, direct connections), any
// candidate passes.

const MAX_LINES = 100;
const MAX_LINE = 256;
const LINE = /^[a-z]=[\x20-\x7e]*$/;
const UNSPECIFIED = new Set(["0.0.0.0", "::"]);

// Why an SDP may not pass, or null.
export const sdpProblem = (sdp, { relayOnly }) => {
  if (!/^v=0\r?\n/.test(sdp)) return "an SDP starts with v=0";
  const lines = sdp.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_LINES) return `more than ${MAX_LINES} lines`;
  for (const line of lines) {
    if (line.length > MAX_LINE) return `a line longer than ${MAX_LINE} characters`;
    if (!LINE.test(line)) return "a line that is not SDP";
    if (!relayOnly || !line.startsWith("a=candidate:")) continue;
    const type = /\styp\s(\S+)/.exec(line)?.[1];
    if (type !== "relay") return "a candidate that is not a relay candidate (with TURN on, connections are relay-only)";
    const related = /\sraddr\s(\S+)/.exec(line)?.[1];
    if (related !== undefined && !UNSPECIFIED.has(related)) return "a relay candidate that names the client's own address (raddr)";
  }
  return null;
};
