/*! Open Historia — reading an answer through the AI relay: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/relayResponse.test.js
// The relay itself is exercised end to end in server/relay.test.js.

import assert from "node:assert/strict";
import test from "node:test";

import {
    RELAY_CUT_OFF_MESSAGE,
    RELAY_HEADER,
    isRelayUnreachable,
    relayUnreachableReason,
    withRelayCutoffHint,
} from "./relayResponse.js";

const encoder = new TextEncoder();

// A body that sends `chunks` one read at a time and then either ends or fails
// with `failure`, the way a connection breaking mid-answer does.
const streamed = (chunks, failure = null) => {
    const queue = [...chunks];
    return new ReadableStream({
        pull(controller) {
            if (queue.length) controller.enqueue(encoder.encode(queue.shift()));
            else if (failure) controller.error(failure);
            else controller.close();
        },
    });
};

test("a complete answer reads exactly as it came, status and headers included", async () => {
    const original = new Response(streamed(["data: 1\n\n", "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
    const hinted = withRelayCutoffHint(original);
    assert.equal(hinted.status, 200);
    assert.equal(hinted.headers.get("content-type"), "text/event-stream");
    assert.equal(await hinted.text(), "data: 1\n\ndata: [DONE]\n\n");
});

test("an answer broken off partway says the relay cut it, and keeps the cause", async () => {
    const network = new TypeError("network error");
    const hinted = withRelayCutoffHint(new Response(streamed(["data: 1\n\n"], network), { status: 200 }));
    const reader = hinted.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "data: 1\n\n");
    await assert.rejects(reader.read(), (error) => {
        assert.equal(error.message, RELAY_CUT_OFF_MESSAGE);
        assert.match(error.message, /OH_RELAY_TIMEOUT_MS/);
        assert.equal(error.cause, network);
        return true;
    });
});

test("the player's own cancel stays an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const hinted = withRelayCutoffHint(new Response(streamed([], abort), { status: 200 }), controller.signal);
    await assert.rejects(hinted.text(), (error) => error === abort);
});

test("a response with no body is handed back untouched", () => {
    const empty = new Response(null, { status: 204 });
    assert.equal(withRelayCutoffHint(empty), empty);
    assert.equal(withRelayCutoffHint(null), null);
});

// What the relay answers when nothing is listening (server/relay.test.js pins
// that it does): a 502 of its own, with a header no endpoint can set.
const refusedByRelay = () => new Response(
    JSON.stringify({ error: "connect ECONNREFUSED 127.0.0.1:5001", code: "ECONNREFUSED", unreachable: true }),
    { status: 502, headers: { "Content-Type": "application/json", "X-OH-Relay": "unreachable" } },
);

test("the relay's own 'could not reach the endpoint' is told by its header", () => {
    assert.equal(RELAY_HEADER, "X-OH-Relay");
    assert.equal(isRelayUnreachable(refusedByRelay()), true);
    assert.equal(isRelayUnreachable(new Response("{}", { status: 502, headers: { "x-oh-relay": " Unreachable " } })), true, "header names and this value are not case-sensitive");
    // And is still told after the cut-off wrapper has rebuilt the response.
    assert.equal(isRelayUnreachable(withRelayCutoffHint(refusedByRelay())), true);
});

test("a provider's own 502, relayed as it came, is not taken for one", () => {
    // A busy provider. Its body can say anything; the relay did not mark it.
    const busy = new Response(JSON.stringify({ error: { message: "Bad gateway" }, unreachable: true }), { status: 502 });
    assert.equal(isRelayUnreachable(busy), false);
    assert.equal(isRelayUnreachable(new Response("{}", { status: 502, headers: { "X-OH-Relay": "cut" } })), false);
    assert.equal(isRelayUnreachable(new Response("ok", { status: 200 })), false);
    for (const nothing of [null, undefined, {}, { headers: null }, { headers: { get: () => { throw new Error("no"); } } }]) {
        assert.equal(isRelayUnreachable(nothing), false);
    }
});

test("why it could not be reached is the socket's own code, or failing that what the relay said", async () => {
    assert.equal(relayUnreachableReason(await refusedByRelay().json()), "ECONNREFUSED");
    assert.equal(relayUnreachableReason({ code: "ENOTFOUND", error: "getaddrinfo ENOTFOUND kobold.lan" }), "ENOTFOUND");
    assert.equal(relayUnreachableReason({ error: "socket hang up" }), "socket hang up");
    assert.equal(relayUnreachableReason({ code: "   ", error: " read ECONNRESET " }), "read ECONNRESET");
    for (const nothing of [null, undefined, {}, { code: 7 }, { error: {} }, { rawText: "<html>" }]) {
        assert.equal(relayUnreachableReason(nothing), "no answer");
    }
});
