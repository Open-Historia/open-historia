/*! Open Historia — endpoints that only answer through the relay: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/relayOrigins.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { RELAY_ONLY_TTL_MS, createRelayOnlyOrigins } from "./relayOrigins.js";

const OLLAMA = "http://192.168.1.20:11434";

test("an endpoint the relay answered for is remembered", () => {
    const origins = createRelayOnlyOrigins({ now: () => 0 });
    const response = { ok: true, status: 200 };
    assert.equal(origins.remember(OLLAMA, response), response);
    assert.equal(origins.has(OLLAMA), true);
    assert.equal(origins.has("https://openrouter.ai"), false);
});

test("a relay that refused the caller, or a server that is down, proves nothing", () => {
    const origins = createRelayOnlyOrigins({ now: () => 0 });
    origins.remember("https://api.openai.com", { ok: false, status: 403 });
    origins.remember(OLLAMA, { ok: false, status: 502 });
    origins.remember(OLLAMA, undefined);
    assert.equal(origins.has("https://api.openai.com"), false);
    assert.equal(origins.has(OLLAMA), false);
});

test("the memory lapses, so the direct route is tried again", () => {
    let clock = 0;
    const origins = createRelayOnlyOrigins({ now: () => clock });
    origins.remember(OLLAMA, { ok: true });
    clock = RELAY_ONLY_TTL_MS - 1;
    assert.equal(origins.has(OLLAMA), true);
    clock = RELAY_ONLY_TTL_MS;
    assert.equal(origins.has(OLLAMA), false);
});

test("each answer through the relay renews it", () => {
    let clock = 0;
    const origins = createRelayOnlyOrigins({ now: () => clock });
    origins.remember(OLLAMA, { ok: true });
    clock = RELAY_ONLY_TTL_MS - 1;
    origins.remember(OLLAMA, { ok: true });
    clock = RELAY_ONLY_TTL_MS + 1000;
    assert.equal(origins.has(OLLAMA), true);
});
