/*! Open Historia — local endpoint tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/localEndpoint.test.js
//
// Runs without node_modules: localEndpoint.js imports nothing.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { endpointIsLocal, isLocalHostname } from "./localEndpoint.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("this machine and the private ranges are local; the rest of the world is not", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.8.9.10", "::1", "[::1]", "gaming-pc.local", "10.0.0.5", "192.168.1.20", "172.16.0.1", "172.31.255.254"]) {
        assert.equal(isLocalHostname(host), true, host);
    }
    for (const host of ["", null, "api.openai.com", "172.15.0.1", "172.32.0.1", "11.0.0.1", "192.169.1.1", "localhost.example.com", "mylocal"]) {
        assert.equal(isLocalHostname(host), false, String(host));
    }
});

test("an entry's endpoint is read as typed, with or without its scheme", () => {
    assert.equal(endpointIsLocal("http://localhost:1234/v1"), true, "LM Studio");
    assert.equal(endpointIsLocal("http://127.0.0.1:11434/v1"), true, "Ollama");
    assert.equal(endpointIsLocal("  http://192.168.1.20:5001/v1  "), true, "a server on the network");
    assert.equal(endpointIsLocal("localhost:1234/v1"), true, "no scheme");
    assert.equal(endpointIsLocal("https://openrouter.ai/api/v1"), false);
    assert.equal(endpointIsLocal("https://localhost.example.com/v1"), false);
});

test("a blank endpoint is not local, whatever page asks", () => {
    // A hosted provider's entry has no endpoint of its own. Read against the
    // page's address it would be "localhost" in the desktop app, and every
    // hosted model's window would stop being remembered.
    assert.equal(endpointIsLocal(""), false);
    assert.equal(endpointIsLocal(undefined), false);
    assert.equal(endpointIsLocal("   "), false);
    assert.equal(endpointIsLocal("/v1"), false);
});

test("the preflight and Settings ask this rule of the entry, and the fetch path keeps one rule", () => {
    const main = read("./main.jsx");
    assert.match(main, /const windowIsLearned = \(entry\) => !endpointIsLocal\(entry\?\.endpoint\);/);
    assert.match(main, /contextWindows\.refusal\(contextWindowKey\(entry\), requestTokens, \{ reserveTokens: answerReserve, trustLearned: windowIsLearned\(entry\) \}\)/);
    // Nothing is learned from a local server's refusal: the return comes first.
    const remember = main.slice(main.indexOf("const rememberContextWindow = "), main.indexOf("const requestScope = "));
    assert.ok(remember.indexOf("if (!windowIsLearned(entry))") > 0);
    assert.ok(remember.indexOf("if (!windowIsLearned(entry))") < remember.indexOf("contextWindows.learn("));
    // isLocalEndpoint is this rule, not a second list of hosts.
    const local = main.slice(main.indexOf("function isLocalEndpoint(url)"), main.indexOf("function isLocalEndpoint(url)") + 400);
    assert.match(local, /return isLocalHostname\(/);
    assert.doesNotMatch(local, /192/);

    const settings = read("../GameUI/settings.jsx");
    assert.match(settings, /contextWindowMemory\.remembered\(key, \{ trustLearned: !endpointIsLocal\(entry\.endpoint\) \}\)/);
});
