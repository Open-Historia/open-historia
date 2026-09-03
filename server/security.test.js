// Unit tests for the server security helpers. Run with `npm test`
// (node --test). No framework needed — these are pure functions.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  allowedCorsOrigin,
  crossOriginWriteAllowed,
  isAllowedHubUrl,
  isLoopbackAddress,
  isMetadataAddress,
  parseByteRange,
  relayTargetAllowed,
  resolveChildPath,
  sanitizeRelayHeaders,
} from "./security.js";

const BASE = path.resolve("/srv/data/scenarios");

test("resolveChildPath accepts a plain child id", () => {
  assert.equal(resolveChildPath(BASE, "modern-day"), path.join(BASE, "modern-day"));
  assert.equal(resolveChildPath(BASE, "default.json"), path.join(BASE, "default.json"));
});

test("resolveChildPath rejects traversal, separators, empty and absolute paths", () => {
  // Express decodes %2f to "/" before this runs, so the real attack arrives as "../".
  for (const bad of ["../../manifest", "../sibling", "sub/child", "", ".", "/etc/passwd"]) {
    assert.throws(() => resolveChildPath(BASE, bad), /Invalid/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("isLoopbackAddress recognises local addresses only", () => {
  for (const ok of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(ok), true, ok);
  }
  for (const no of ["192.168.1.5", "10.0.0.2", "::ffff:192.168.1.5", "", undefined, null]) {
    assert.equal(isLoopbackAddress(no), false, String(no));
  }
});

test("crossOriginWriteAllowed: safe methods always pass", () => {
  assert.equal(crossOriginWriteAllowed({ method: "GET" }).allowed, true);
  assert.equal(crossOriginWriteAllowed({ method: "OPTIONS" }).allowed, true);
});

test("crossOriginWriteAllowed: same-origin write allowed, foreign Origin blocked", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", origin: "http://localhost:3000", host: "localhost:3000" }).allowed,
    true,
  );
  assert.equal(
    crossOriginWriteAllowed({ method: "DELETE", origin: "https://evil.com", host: "localhost:3000" }).allowed,
    false,
  );
});

test("crossOriginWriteAllowed: no-Origin allowed from loopback, blocked from LAN", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", host: "localhost:3000", remoteAddress: "127.0.0.1" }).allowed,
    true,
  );
  // A curl from another host on the LAN with no Origin — the hostile-LAN case.
  const lan = crossOriginWriteAllowed({ method: "POST", host: "192.168.1.9:3000", remoteAddress: "192.168.1.50" });
  assert.equal(lan.allowed, false);
  assert.equal(lan.reason, "no-origin-nonloopback");
});

test("crossOriginWriteAllowed: override flag opens everything", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", origin: "https://evil.com", host: "x", allowAll: true }).allowed,
    true,
  );
});

test("parseByteRange: suffix range returns the FINAL N bytes", () => {
  assert.deepEqual(parseByteRange("bytes=-500", 10000), { start: 9500, end: 9999 });
});

test("parseByteRange: explicit and open-ended ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-499", 10000), { start: 0, end: 499 });
  assert.deepEqual(parseByteRange("bytes=500-", 10000), { start: 500, end: 9999 });
});

test("parseByteRange: empty / unsatisfiable ranges are 416", () => {
  assert.equal(parseByteRange("bytes=-", 10000).status, 416);
  assert.equal(parseByteRange("nonsense", 10000).status, 416);
  assert.equal(parseByteRange("bytes=99999-", 10000).status, 416);
});

test("isAllowedHubUrl: https GitHub hosts only", () => {
  const hosts = new Set(["github.com", "objects.githubusercontent.com"]);
  assert.equal(isAllowedHubUrl(new URL("https://github.com/a/b"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://objects.githubusercontent.com/x"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://evil.com/x"), hosts), false);
  assert.equal(isAllowedHubUrl(new URL("http://github.com/a/b"), hosts), false);
});

test("isAllowedHubUrl: any *.githubusercontent.com CDN host is allowed on redirect", () => {
  const hosts = new Set(["github.com"]); // release-assets host deliberately NOT listed
  // GitHub redirects release-asset downloads here — must be accepted.
  assert.equal(isAllowedHubUrl(new URL("https://release-assets.githubusercontent.com/x"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://objects.githubusercontent.com/y"), hosts), true);
  // Lookalike hosts must NOT slip through.
  assert.equal(isAllowedHubUrl(new URL("https://githubusercontent.com.evil.com/x"), hosts), false);
  assert.equal(isAllowedHubUrl(new URL("https://notgithubusercontent.com/x"), hosts), false);
});

// --- What the origin guard does NOT cover -----------------------------------
// The test above ("no-Origin allowed from loopback, blocked from LAN") reads as
// if the LAN were covered. It isn't, and pretending otherwise is how a guard
// gets trusted for something it never did. Pin the real behaviour: a client that
// sets its own headers walks straight through the same-origin branch, which is
// why the server binds loopback until the player shares it (server/network.test.js)
// rather than relying on this.
test("crossOriginWriteAllowed: a spoofed Origin from the LAN is NOT blocked", () => {
  const spoofed = crossOriginWriteAllowed({
    method: "DELETE",
    origin: "http://192.168.1.9:3000",
    host: "192.168.1.9:3000",
    remoteAddress: "192.168.1.50",
  });
  assert.equal(spoofed.allowed, true);
  assert.equal(spoofed.reason, "same-origin");
});

test("isMetadataAddress catches cloud metadata and link-local addresses", () => {
  for (const bad of [
    "169.254.169.254", "169.254.0.1", "metadata.google.internal", "METADATA.GOOG",
    "instance-data", "fd00:ec2::254", "fe80::1", "[fe80::1]",
  ]) {
    assert.equal(isMetadataAddress(bad), true, bad);
  }
  for (const ok of ["localhost", "127.0.0.1", "192.168.1.9", "10.0.0.2", "api.openai.com", "169.253.1.1"]) {
    assert.equal(isMetadataAddress(ok), false, ok);
  }
});

test("relayTargetAllowed: private AI endpoints pass, metadata and odd schemes don't", () => {
  // The whole point of the relay — a self-hosted model — must keep working.
  for (const ok of [
    "http://localhost:11434/v1/chat/completions",
    "http://192.168.1.50:8080/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions",
  ]) {
    assert.equal(relayTargetAllowed(new URL(ok)).allowed, true, ok);
  }
  for (const bad of [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_FLUSHALL",
  ]) {
    assert.equal(relayTargetAllowed(new URL(bad)).allowed, false, bad);
  }
});

test("sanitizeRelayHeaders drops hop-by-hop and framing headers, keeps auth", () => {
  const cleaned = sanitizeRelayHeaders({
    Authorization: "Bearer sk-test",
    "x-api-key": "k",
    Host: "evil.internal",
    "Transfer-Encoding": "chunked",
    "Content-Length": "0",
    Connection: "keep-alive",
    nested: { not: "a string" },
  });
  assert.deepEqual(cleaned, { Authorization: "Bearer sk-test", "x-api-key": "k" });
});

test("allowedCorsOrigin: app shell and same origin only", () => {
  const host = "192.168.1.9:3000";
  assert.equal(allowedCorsOrigin("http://app.paxhistoria", host), "http://app.paxhistoria");
  assert.equal(allowedCorsOrigin("capacitor://localhost", host), "capacitor://localhost");
  assert.equal(allowedCorsOrigin("http://192.168.1.9:3000", host), "http://192.168.1.9:3000");
  // The case that mattered: a random site the player is browsing must not be
  // able to read their saved games off this server.
  assert.equal(allowedCorsOrigin("https://evil.com", host), null);
  assert.equal(allowedCorsOrigin("not a url", host), null);
  // No Origin at all is a same-origin or native request — nothing to reflect.
  assert.equal(allowedCorsOrigin(undefined, host), null);
  // The documented escape hatch still opens it back up.
  assert.equal(allowedCorsOrigin("https://evil.com", host, { allowAll: true }), "*");
});
