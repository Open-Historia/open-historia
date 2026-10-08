/*! Open Historia — tests for the public multiplayer server's settings © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/config.test.js
//
// The server refuses to start on a setting it cannot make sense of, and says
// which one; it never repeats the TURN secret while doing so. Origins are
// matched as browsers send them, with ":*" standing for any port.

import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, DEFAULTS, createOriginCheck, loadConfig, parseOriginPattern, resolveConfig } from "../src/config.js";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const refused = (env, pattern) => {
  assert.throws(() => loadConfig(env), (error) => error instanceof ConfigError && pattern.test(error.message), JSON.stringify(env));
};

test("with nothing set, the defaults: loopback, port 8787, TURN off, any origin", () => {
  const config = loadConfig({});
  assert.deepEqual({ ...config }, { ...DEFAULTS });
  assert.equal(config.port, 8787);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.turnSecret, "");
  assert.equal(config.turnTtlSeconds, 900);
  assert.equal(config.maxConnections, 1000);
  assert.equal(config.maxMemoryMb, 256);
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(Object.isFrozen(config), true);
  // An empty variable means its default too.
  assert.equal(loadConfig({ PORT: "", MAX_ROOMS: "  " }).port, 8787);
});

test("every setting is read from its variable", () => {
  const config = loadConfig({
    PORT: "9000",
    HOST: "0.0.0.0",
    TURN_SECRET: SECRET,
    TURN_URLS: "turn:turn.example.org:3478?transport=udp, turns:turn.example.org:5349?transport=tcp,turn:[2001:db8::1]",
    TURN_TTL_SECONDS: "600",
    MAX_ROOMS: "50",
    MAX_ROOMS_PER_IP: "2",
    MAX_CONNECTIONS_PER_IP: "4",
    MAX_CONNECTIONS: "100",
    MAX_MEMORY_MB: "150",
    TRUST_PROXY: "TRUE",
    ALLOWED_ORIGINS: "https://openhistoria.com, http://app.paxhistoria,http://localhost:*,HTTP://127.0.0.1:*,https://example.org:443",
  });
  assert.equal(config.port, 9000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.turnSecret, SECRET);
  assert.deepEqual(config.turnUrls, ["turn:turn.example.org:3478?transport=udp", "turns:turn.example.org:5349?transport=tcp", "turn:[2001:db8::1]"]);
  assert.equal(config.turnTtlSeconds, 600);
  assert.equal(config.maxRooms, 50);
  assert.equal(config.maxRoomsPerIp, 2);
  assert.equal(config.maxConnectionsPerIp, 4);
  assert.equal(config.maxConnections, 100);
  assert.equal(config.maxMemoryMb, 150);
  assert.equal(config.trustProxy, true);
  // Written the way a browser sends them: lower case, no default port.
  assert.deepEqual(config.allowedOrigins, [
    "https://openhistoria.com", "http://app.paxhistoria", "http://localhost:*", "http://127.0.0.1:*", "https://example.org",
  ]);
  assert.equal(loadConfig({ TRUST_PROXY: "no" }).trustProxy, false);
  assert.equal(loadConfig({ HOST: "::" }).host, "::");
});

test("nonsense is refused, naming the setting", () => {
  refused({ PORT: "http" }, /^PORT must be a whole number/);
  refused({ PORT: "0" }, /^PORT must be a whole number from 1 to 65535/);
  refused({ PORT: "70000" }, /^PORT must be a whole number from 1 to 65535/);
  assert.throws(() => resolveConfig({ port: 70000 }), /PORT must be a whole number from 0 to 65535/);
  refused({ PORT: "-1" }, /^PORT/);
  refused({ PORT: "8787.5" }, /^PORT/);
  refused({ HOST: "not a host" }, /^HOST/);
  refused({ HOST: "[::1]" }, /^HOST/);
  refused({ TURN_TTL_SECONDS: "10" }, /^TURN_TTL_SECONDS must be a whole number from 60 to 3600/);
  // A credential that outlived an hour would outlive its reason to exist.
  refused({ TURN_TTL_SECONDS: "86400" }, /^TURN_TTL_SECONDS must be a whole number from 60 to 3600/);
  refused({ MAX_MEMORY_MB: "16" }, /^MAX_MEMORY_MB must be a whole number from 64 to 65536/);
  refused({ MAX_ROOMS: "0" }, /^MAX_ROOMS must/);
  refused({ MAX_ROOMS_PER_IP: "lots" }, /^MAX_ROOMS_PER_IP/);
  refused({ MAX_CONNECTIONS_PER_IP: "0" }, /^MAX_CONNECTIONS_PER_IP/);
  refused({ MAX_CONNECTIONS: "0" }, /^MAX_CONNECTIONS must/);
  refused({ TRUST_PROXY: "maybe" }, /^TRUST_PROXY must be true or false/);
  assert.throws(() => resolveConfig({ maxRoom: 3 }), /Unknown setting "maxRoom"/);
  assert.throws(() => resolveConfig({ trustProxy: "true" }), /TRUST_PROXY/);
});

test("TURN: a weak or malformed secret is refused without being repeated, and secret and URLs go together", () => {
  for (const secret of ["short", `${SECRET} `, `${SECRET}"; rm -rf /`, "x".repeat(257)]) {
    assert.throws(
      () => loadConfig({ TURN_SECRET: secret, TURN_URLS: "turn:turn.example.org" }),
      (error) => error instanceof ConfigError && /^TURN_SECRET must be 32 to 256 characters/.test(error.message) && !error.message.includes(secret.trim()),
    );
  }
  refused({ TURN_SECRET: SECRET }, /TURN_SECRET is set but TURN_URLS is empty/);
  refused({ TURN_URLS: "turn:turn.example.org" }, /TURN_URLS is set but TURN_SECRET is empty/);
  for (const url of [
    "stun:stun.example.org", "http://turn.example.org", "turn:", "turn:turn.example.org:0", "turn:turn.example.org:99999",
    "turn:turn.example.org?transport=sctp", "turn:bad_host", "turn:[not-ipv6]", "turn:turn.example.org/path",
  ]) {
    refused({ TURN_SECRET: SECRET, TURN_URLS: url }, /^TURN_URLS: /);
  }
  refused({ TURN_SECRET: SECRET, TURN_URLS: "turns:turn.example.org:5349?transport=udp" }, /turns: is TLS over TCP/);
});

test("allowed origins: exact origins and :* patterns only", () => {
  for (const [entry, why] of [
    ["*", /leave ALLOWED_ORIGINS empty/],
    ["null", /sandboxed or file/],
    ["https://example.org/", /is not an origin/],
    ["https://example.org/play", /is not an origin/],
    ["https://user@example.org", /is not an origin/],
    ["ftp://example.org", /is not an origin/],
    ["example.org", /is not an origin/],
    ["https://*.example.org", /is not an origin/],
    ["http://localhost:99999", /port outside/],
    ["http://-bad-.example", /valid host/],
  ]) {
    assert.throws(() => parseOriginPattern(entry), (error) => error instanceof ConfigError && why.test(error.message), entry);
  }
  assert.equal(parseOriginPattern("http://[::1]:*").text, "http://[::1]:*");
});

test("an Origin header is allowed only if it is one of the list, exactly as a browser writes it", () => {
  const allowed = createOriginCheck(["https://openhistoria.com", "http://app.paxhistoria", "http://localhost:*", "http://[::1]:*"]);
  for (const origin of ["https://openhistoria.com", "http://app.paxhistoria", "http://localhost:3000", "http://localhost", "http://localhost:5173", "http://[::1]:3000"]) {
    assert.equal(allowed(origin), true, origin);
  }
  for (const origin of [
    undefined, "", "null", "http://openhistoria.com", "https://openhistoria.com.evil.example", "https://evil.example",
    "https://openhistoria.com:8443", "https://openhistoria.com/", "http://localhost.evil.example:3000",
    "https://app.paxhistoria", "http://127.0.0.1:3000", "x".repeat(300), ["https://openhistoria.com"],
  ]) {
    assert.equal(allowed(origin), false, String(origin));
  }
  // No list: anything, a missing Origin included.
  const any = createOriginCheck([]);
  assert.equal(any(undefined), true);
  assert.equal(any("https://anything.example"), true);
});
