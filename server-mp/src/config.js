/*! Open Historia — the public multiplayer server's settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything the server can be told comes from the environment, and every
// value is checked before anything listens. A server that starts on a setting
// it misread is worse than one that refuses and says why, so a value that
// makes no sense stops the start with a message naming the setting.
//
//   PORT                     8787       where to listen (1-65535)
//   HOST                     127.0.0.1  the address to listen on (0.0.0.0 in a container)
//   TURN_SECRET              (empty)    shared with coturn (use-auth-secret); empty turns TURN off
//   TURN_URLS                (empty)    comma list of turn: / turns: URLs handed to clients
//   TURN_TTL_SECONDS         900        how long a TURN credential lasts (60-3600); clients renew
//   MAX_ROOMS                500        rooms on the server at once
//   MAX_ROOMS_PER_IP         3          rooms registered from one address
//   MAX_CONNECTIONS_PER_IP   10         sockets open from one address
//   MAX_CONNECTIONS          1000       sockets open in all
//   MAX_MEMORY_MB            256        above this resident size, new sockets are refused
//   TRUST_PROXY              false      true only behind our own proxy (net.js)
//   ALLOWED_ORIGINS          (empty)    comma list of origins that may connect; empty allows any
//
// An empty variable means its default. TURN_SECRET is the one secret, and no
// message here ever repeats it.

import { isIP } from "node:net";

export class ConfigError extends Error {
  name = "ConfigError";
}

export const DEFAULTS = Object.freeze({
  port: 8787,
  host: "127.0.0.1",
  turnSecret: "",
  turnUrls: Object.freeze([]),
  turnTtlSeconds: 900,
  maxRooms: 500,
  maxRoomsPerIp: 3,
  maxConnectionsPerIp: 10,
  maxConnections: 1000,
  maxMemoryMb: 256,
  trustProxy: false,
  allowedOrigins: Object.freeze([]),
});

// [variable, setting, kind]
const ENVIRONMENT = [
  ["PORT", "port", "integer"],
  ["HOST", "host", "text"],
  ["TURN_SECRET", "turnSecret", "secret"],
  ["TURN_URLS", "turnUrls", "list"],
  ["TURN_TTL_SECONDS", "turnTtlSeconds", "integer"],
  ["MAX_ROOMS", "maxRooms", "integer"],
  ["MAX_ROOMS_PER_IP", "maxRoomsPerIp", "integer"],
  ["MAX_CONNECTIONS_PER_IP", "maxConnectionsPerIp", "integer"],
  ["MAX_CONNECTIONS", "maxConnections", "integer"],
  ["MAX_MEMORY_MB", "maxMemoryMb", "integer"],
  ["TRUST_PROXY", "trustProxy", "boolean"],
  ["ALLOWED_ORIGINS", "allowedOrigins", "list"],
];
const VARIABLE = Object.fromEntries(ENVIRONMENT.map(([name, key]) => [key, name]));

const fail = (message) => {
  throw new ConfigError(message);
};
const shown = (value) => JSON.stringify(String(value).slice(0, 80));

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const validHost = (host) => (host.startsWith("[") && host.endsWith("]") ? isIP(host.slice(1, -1)) === 6 : isIP(host) === 4 || HOSTNAME.test(host));

// Characters that survive every place the secret goes (an env file, coturn's
// config file, a shell) without quoting. openssl rand -hex 32 makes one.
const SECRET = /^[A-Za-z0-9._~+/=-]{32,256}$/;

// RFC 7065: turn:host[:port][?transport=udp|tcp], turns: the same over TLS.
const TURN_URL = /^(turns?):(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/;

const checkTurnUrl = (url) => {
  const match = typeof url === "string" ? TURN_URL.exec(url) : null;
  const example = "turn:turn.example.org:3478?transport=udp or turns:turn.example.org:5349?transport=tcp";
  if (!match) fail(`TURN_URLS: ${shown(url)} is not a TURN URL like ${example}.`);
  const [, scheme, host, port, transport] = match;
  if (!validHost(host)) fail(`TURN_URLS: ${shown(url)} does not have a valid host.`);
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) fail(`TURN_URLS: ${shown(url)} has a port outside 1-65535.`);
  // turns: over UDP would be DTLS, which no browser speaks to a TURN server.
  if (scheme === "turns" && transport === "udp") fail(`TURN_URLS: ${shown(url)}: turns: is TLS over TCP; use ?transport=tcp.`);
};

const checkInteger = (key, value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${VARIABLE[key]} must be a whole number from ${min} to ${max} (it is ${shown(value)}).`);
  }
};

// An origin as a browser sends it (scheme://host[:port], nothing after), or
// the same with ":*" for any port: the desktop app serves itself from
// http://localhost on whichever port was free.
const ORIGIN = /^(https?):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}|\*))?$/i;

export const parseOriginPattern = (entry) => {
  const text = typeof entry === "string" ? entry.trim() : "";
  const bad = (why) => fail(`ALLOWED_ORIGINS: ${shown(entry)} ${why}`);
  if (text === "*") bad("is not needed: leave ALLOWED_ORIGINS empty to allow any origin.");
  // A sandboxed frame or a file:// page sends "null", and any site can make one.
  if (text.toLowerCase() === "null") bad("would admit any sandboxed or file:// page.");
  const match = ORIGIN.exec(text);
  if (!match) bad("is not an origin like https://example.org or http://localhost:* (a scheme and a host, no path).");
  const [, scheme, host, port] = match;
  if (!validHost(host)) bad("does not have a valid host.");
  if (port && port !== "*" && (Number(port) < 1 || Number(port) > 65535)) bad("has a port outside 1-65535.");
  const url = new URL(`${scheme.toLowerCase()}://${host}${port && port !== "*" ? `:${port}` : ""}`);
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: port === "*" ? "*" : url.port,
    text: port === "*" ? `${url.origin}:*` : url.origin,
  };
};

// Whether an Origin header is one of the allowed. With no list, everything is
// (a missing header included); with a list, a missing or malformed header is
// not. Browsers always send Origin on a WebSocket upgrade, so a missing one is
// a program that is not a browser, and it can send an allowed origin itself.
export const createOriginCheck = (patterns) => {
  if (!patterns.length) return () => true;
  const rules = patterns.map(parseOriginPattern);
  return (origin) => {
    if (typeof origin !== "string" || origin.length > 256) return false;
    let url;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    // Exactly as a browser serializes an origin: no path, no default port.
    if (url.origin !== origin) return false;
    return rules.some((rule) => rule.protocol === url.protocol && rule.hostname === url.hostname
      && (rule.port === "*" || rule.port === url.port));
  };
};

// Typed settings (from loadConfig, or a test) merged over the defaults and
// checked. Returns a frozen copy.
export const resolveConfig = (options = {}) => {
  for (const key of Object.keys(options)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) fail(`Unknown setting "${key.slice(0, 40)}".`);
  }
  const config = { ...DEFAULTS, ...options };

  checkInteger("port", config.port, 0, 65535);
  // A listening address is written bare, "::" or "0.0.0.0", not in brackets.
  if (typeof config.host !== "string" || !(isIP(config.host) || HOSTNAME.test(config.host))) {
    fail(`HOST must be an IP address or a host name (it is ${shown(config.host)}).`);
  }

  if (typeof config.turnSecret !== "string" || (config.turnSecret !== "" && !SECRET.test(config.turnSecret))) {
    fail("TURN_SECRET must be 32 to 256 characters of letters, digits and . _ ~ + / = - (make one with: openssl rand -hex 32).");
  }
  if (!Array.isArray(config.turnUrls) || config.turnUrls.length > 16) fail("TURN_URLS must be a list of at most 16 URLs.");
  config.turnUrls.forEach(checkTurnUrl);
  if (config.turnSecret && !config.turnUrls.length) {
    fail("TURN_SECRET is set but TURN_URLS is empty, so clients would get credentials for no server. Set both, or neither.");
  }
  if (!config.turnSecret && config.turnUrls.length) {
    fail("TURN_URLS is set but TURN_SECRET is empty, so TURN would be off without saying so. Set both, or neither.");
  }
  checkInteger("turnTtlSeconds", config.turnTtlSeconds, 60, 3600);

  checkInteger("maxRooms", config.maxRooms, 1, 100_000);
  checkInteger("maxRoomsPerIp", config.maxRoomsPerIp, 1, 1000);
  checkInteger("maxConnectionsPerIp", config.maxConnectionsPerIp, 1, 10_000);
  checkInteger("maxConnections", config.maxConnections, 1, 1_000_000);
  checkInteger("maxMemoryMb", config.maxMemoryMb, 64, 65_536);

  if (typeof config.trustProxy !== "boolean") fail("TRUST_PROXY must be true or false.");

  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length > 64) fail("ALLOWED_ORIGINS must be a list of at most 64 origins.");
  const allowedOrigins = [...new Set(config.allowedOrigins.map((entry) => parseOriginPattern(entry).text))];

  return Object.freeze({ ...config, turnUrls: Object.freeze([...config.turnUrls]), allowedOrigins: Object.freeze(allowedOrigins) });
};

// The settings from environment variables (process.env by default).
export const loadConfig = (env = process.env) => {
  const options = {};
  for (const [name, key, kind] of ENVIRONMENT) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    if (kind === "secret") {
      // Not trimmed: coturn reads the same variable as it is, and a stray
      // space kept on one side only would fail every credential. The check
      // in resolveConfig refuses the space instead.
      options[key] = String(raw);
      continue;
    }
    const text = String(raw).trim();
    if (text === "") continue;
    if (kind === "integer") {
      if (!/^\d{1,10}$/.test(text)) fail(`${name} must be a whole number (it is ${shown(text)}).`);
      options[key] = Number(text);
    } else if (kind === "boolean") {
      const lower = text.toLowerCase();
      if (["true", "1", "yes"].includes(lower)) options[key] = true;
      else if (["false", "0", "no"].includes(lower)) options[key] = false;
      else fail(`${name} must be true or false (it is ${shown(text)}).`);
    } else if (kind === "list") {
      options[key] = text.split(",").map((part) => part.trim()).filter(Boolean);
    } else {
      options[key] = text;
    }
  }
  // 0 asks the system for any free port: right for a test, never for a
  // service that a proxy has to find.
  if (options.port !== undefined && (options.port < 1 || options.port > 65535)) {
    fail(`PORT must be a whole number from 1 to 65535 (it is ${shown(options.port)}).`);
  }
  return resolveConfig(options);
};
