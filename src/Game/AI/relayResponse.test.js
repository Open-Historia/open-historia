/*! Open Historia — reading an answer through the AI relay: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/relayResponse.test.js
// The relay itself is exercised end to end in server/relay.test.js.

import assert from "node:assert/strict";
import test from "node:test";

import {
    isRelayRefusal,
    isRelayUnreachable,
    RELAY_CUT_OFF_MESSAGE,
    RELAY_REFUSED_HEADER,
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

test("the relay refusing this device is told apart from an endpoint's own 403", () => {
    const refused = new Response("{}", { status: 403, headers: { [RELAY_REFUSED_HEADER]: "refused" } });
    const rejectedKey = new Response("{}", { status: 403 });
    assert.equal(isRelayRefusal(refused), true);
    assert.equal(isRelayRefusal(rejectedKey), false, "a relayed 403 from the AI endpoint keeps the pin");
    assert.equal(isRelayRefusal(new Response("{}", { status: 200, headers: { [RELAY_REFUSED_HEADER]: "refused" } })), false);
    assert.equal(isRelayRefusal(null), false);
});

// A 502 is what a gateway in front of a busy model answers, and the game waits
// and asks again. The relay answers 502 too when it could not connect at all,
// and that must not be waited on: a server that is not running is not busy.
test("the relay failing to connect is told apart from an endpoint's own 502", async () => {
    const unreachable = () => new Response(JSON.stringify({ error: " (ECONNREFUSED)", unreachable: true, code: "ECONNREFUSED" }), {
        status: 502,
        headers: { [RELAY_REFUSED_HEADER]: "unreachable" },
    });
    assert.equal(isRelayUnreachable(unreachable()), true);
    assert.equal(await relayUnreachableReason(unreachable()), "ECONNREFUSED");

    // A gateway's own 502, relayed: no header, whatever its body claims.
    const busyGateway = new Response(JSON.stringify({ error: "Bad gateway", unreachable: true }), { status: 502 });
    assert.equal(isRelayUnreachable(busyGateway), false);
    assert.equal(isRelayUnreachable(new Response("{}", { status: 403, headers: { [RELAY_REFUSED_HEADER]: "refused" } })), false);
    assert.equal(isRelayUnreachable(new Response("{}", { status: 200, headers: { [RELAY_REFUSED_HEADER]: "unreachable" } })), false);
    assert.equal(isRelayUnreachable(null), false);
    assert.equal(isRelayRefusal(unreachable()), false);
});

test("with no code, the reason is the relay's own words, and a body that cannot be read says nothing", async () => {
    const worded = new Response(JSON.stringify({ error: "socket hang up", unreachable: true, code: "" }), { status: 502 });
    assert.equal(await relayUnreachableReason(worded), "socket hang up");
    // The relay's message for an error with no words of its own is the code in brackets.
    assert.equal(await relayUnreachableReason(new Response(JSON.stringify({ error: " (EHOSTUNREACH)" }), { status: 502 })), "EHOSTUNREACH");
    assert.equal(await relayUnreachableReason(new Response("<html>502</html>", { status: 502 })), "");
    assert.equal(await relayUnreachableReason(new Response(JSON.stringify({ error: { message: "nested" } }), { status: 502 })), "");
});

test("a response with no body is handed back untouched", () => {
    const empty = new Response(null, { status: 204 });
    assert.equal(withRelayCutoffHint(empty), empty);
    assert.equal(withRelayCutoffHint(null), null);
});
