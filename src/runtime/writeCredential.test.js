/*! Open Historia — a page's credential to write a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/writeCredential.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { ENGINE_CREDENTIAL_HEADER, credentialFromAddress, hasWriteCredential, installWriteCredential } from "./writeCredential.js";

test("the credential is read from the window's address and taken out of it, and kept for that tab when it reloads", () => {
  const replaced = [];
  const history = { state: null, replaceState: (state, title, address) => replaced.push(address) };
  const kept = new Map();
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) };
  const credential = credentialFromAddress({ hash: "#credential=AbCdEfGhIjKlMnOpQrSt_-12", pathname: "/engine.html", search: "" }, history, storage);
  assert.equal(credential, "AbCdEfGhIjKlMnOpQrSt_-12");
  assert.deepEqual(replaced, ["/engine.html"]);
  assert.equal(credentialFromAddress({ hash: "", pathname: "/engine.html", search: "" }, history, storage), "AbCdEfGhIjKlMnOpQrSt_-12", "the same tab, reloaded");
  assert.equal(credentialFromAddress({ hash: "", pathname: "/engine.html", search: "" }, history, new Map()), "", "another tab has none");
  assert.equal(credentialFromAddress({ hash: "#credential=short", pathname: "/engine.html", search: "" }, history, { getItem: () => null, setItem: () => {} }), "", "too short to be one");
});

test("every write to this page's own server carries it; reads, and other servers, never do", async () => {
  const seen = [];
  const target = {
    location: { href: "http://localhost:3000/engine.html", origin: "http://localhost:3000" },
    fetch: async (input, init) => {
      seen.push({ url: String(typeof input === "string" ? input : input.url), method: init?.method ?? "GET", carries: new Headers(init?.headers).get(ENGINE_CREDENTIAL_HEADER) });
      return { ok: true };
    },
  };
  assert.equal(hasWriteCredential(), false);
  assert.equal(installWriteCredential("AbCdEfGhIjKlMnOpQrSt_-12", { target }), true);
  assert.equal(hasWriteCredential(), true);
  assert.equal(installWriteCredential("another-credential-entirely", { target }), false, "once per page");
  await target.fetch("/api/runtime/json/world", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
  await target.fetch("/api/runtime/json/world");
  await target.fetch("/api/runtime/turn-commit", { method: "PUT", body: "{}" });
  await target.fetch("https://generativelanguage.googleapis.com/v1beta/models", { method: "POST", body: "{}" });
  await target.fetch("/engine.html", { method: "POST" });
  assert.deepEqual(seen.map((entry) => [entry.url, entry.method, entry.carries]), [
    ["/api/runtime/json/world", "PUT", "AbCdEfGhIjKlMnOpQrSt_-12"],
    ["/api/runtime/json/world", "GET", null],
    ["/api/runtime/turn-commit", "PUT", "AbCdEfGhIjKlMnOpQrSt_-12"],
    ["https://generativelanguage.googleapis.com/v1beta/models", "POST", null],
    ["/engine.html", "POST", null],
  ]);
});
